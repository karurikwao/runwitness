import type {
  AgentAdapter,
  AgentAdapterCapabilities,
  AgentAdapterEvent,
  AgentAdapterEventKind,
  AgentAdapterRunInput,
  AgentAdapterRunResult,
  AgentAdapterStatus,
  AgentAdapterStreamHandler
} from "./types.js";

type HermesNativePathResolver = string | ((run: HermesNativeRunReference) => string | undefined);

export interface HermesNativeRunReference {
  runId?: string;
  eventsUrl?: string;
  cancelUrl?: string;
  startResponse: Record<string, unknown>;
}

export interface HermesNativeAdapterConfig {
  id?: string;
  name?: string;
  description?: string;
  baseUrl: string | URL;
  startPath?: string;
  eventsPath?: HermesNativePathResolver | false;
  cancelPath?: HermesNativePathResolver | false;
  headers?: HeadersInit;
  fetch?: typeof fetch;
  capabilities?: AgentAdapterCapabilities;
}

interface StreamAccumulator {
  stdout: string[];
  stderr: string[];
  terminalSeen: boolean;
  status?: AgentAdapterStatus;
  exitCode?: number | null;
}

interface RemoteStreamEvent {
  eventName?: string;
  payload: Record<string, unknown>;
}

interface StartRunResult {
  ok: boolean;
  statusCode: number;
  statusText: string;
  body: Record<string, unknown>;
  rawBody: string;
}

export class HermesNativeAdapter implements AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly capabilities: AgentAdapterCapabilities;

  readonly #baseUrl: URL;
  readonly #startPath: string;
  readonly #eventsPath: HermesNativePathResolver | false;
  readonly #cancelPath: HermesNativePathResolver | false;
  readonly #headers: HeadersInit | undefined;
  readonly #fetch: typeof fetch;

  constructor(config: HermesNativeAdapterConfig) {
    this.id = config.id ?? "hermes-native";
    this.name = config.name ?? "Hermes Native";
    this.description = config.description ?? "Runs tasks through the Hermes native HTTP adapter.";
    this.capabilities = {
      externalTool: true,
      requiresConfiguredTool: true,
      eventStream: true,
      opaqueActions: true,
      artifacts: true,
      ...config.capabilities
    };
    this.#baseUrl = new URL(config.baseUrl);
    this.#startPath = config.startPath ?? "/runs";
    this.#eventsPath = config.eventsPath ?? "/runs/{runId}/events";
    this.#cancelPath = config.cancelPath ?? false;
    this.#headers = config.headers;
    this.#fetch = config.fetch ?? fetch;
  }

  async run(input: AgentAdapterRunInput): Promise<AgentAdapterRunResult> {
    return this.runStream(input, async () => {});
  }

  async runStream(input: AgentAdapterRunInput, onEvent: AgentAdapterStreamHandler): Promise<AgentAdapterRunResult> {
    const startedAt = Date.now();
    const startUrl = this.#resolveUrl(this.#startPath);
    const command = `POST ${startUrl.href}`;
    const accumulator: StreamAccumulator = {
      stdout: [],
      stderr: [],
      terminalSeen: false
    };
    let sequence = 0;
    let runReference: HermesNativeRunReference | undefined;
    let cancelPromise: Promise<void> | undefined;
    let cancellationRequested = input.signal?.aborted === true;
    const requestController = new AbortController();

    const emit = async (
      event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }
    ): Promise<AgentAdapterEvent> => {
      sequence += 1;
      const normalized: AgentAdapterEvent = {
        ...event,
        adapterId: this.id,
        sequence,
        timestamp: event.timestamp ?? new Date().toISOString()
      };
      updateAccumulator(accumulator, normalized);
      await onEvent(normalized);
      return normalized;
    };

    const requestCancellation = (): void => {
      cancellationRequested = true;
      requestController.abort();
      if (runReference) {
        cancelPromise ??= this.#cancelRun(runReference, input);
      }
    };

    if (input.signal?.aborted === true) {
      return createResult({
        adapterId: this.id,
        status: "failed",
        command,
        cwd: input.workspace,
        startedAt,
        stdout: "",
        stderr: "Hermes native adapter cancelled before start.",
        signal: "SIGTERM",
        metadata: {
          baseUrl: this.#baseUrl.href,
          startUrl: startUrl.href,
          ...input.metadata
        }
      });
    }

    input.signal?.addEventListener("abort", requestCancellation, { once: true });

    try {
      await emit({
        kind: "adapter_started",
        message: "Hermes native adapter started.",
        payload: {
          baseUrl: this.#baseUrl.href,
          startUrl: startUrl.href
        }
      });

      const startResult = await this.#startRun(startUrl, input, requestController.signal);
      if (!startResult.ok) {
        await emit({
          kind: "adapter_finished",
          message: `Hermes start request failed with HTTP ${startResult.statusCode}.`,
          payload: {
            status: "failed",
            statusCode: startResult.statusCode,
            statusText: startResult.statusText,
            body: startResult.body
          }
        });
        return createResult({
          adapterId: this.id,
          status: "failed",
          command,
          cwd: input.workspace,
          startedAt,
          stdout: accumulator.stdout.join("\n"),
          stderr: startResult.rawBody,
          signal: null,
          exitCode: 1,
          metadata: {
            baseUrl: this.#baseUrl.href,
            startUrl: startUrl.href,
            statusCode: startResult.statusCode,
            ...input.metadata
          }
        });
      }

      runReference = createRunReference(startResult.body);
      const eventsUrl = this.#resolveEventsUrl(runReference);
      const cancelUrl = this.#resolveCancelUrl(runReference);
      runReference = {
        ...runReference,
        eventsUrl: eventsUrl?.href,
        cancelUrl: cancelUrl?.href
      };

      if (eventsUrl) {
        await this.#consumeEventStream(eventsUrl, requestController.signal, async (remoteEvent) => {
          const normalized = normalizeRemoteEvent(remoteEvent, this.id, sequence + 1);
          if (!normalized) {
            return;
          }
          await emit({
            kind: normalized.kind,
            timestamp: normalized.timestamp,
            message: normalized.message,
            stream: normalized.stream,
            artifact: normalized.artifact,
            payload: normalized.payload
          });
        });
      }

      const fallbackStatus = statusFromPayload(startResult.body);
      const status = accumulator.status ?? fallbackStatus ?? "completed";
      if (!accumulator.terminalSeen) {
        await emit({
          kind: "adapter_finished",
          message: `Hermes native adapter ${status}.`,
          payload: {
            status,
            runId: runReference.runId
          }
        });
      }

      return createResult({
        adapterId: this.id,
        status,
        command,
        cwd: input.workspace,
        startedAt,
        stdout: accumulator.stdout.join("\n"),
        stderr: accumulator.stderr.join("\n"),
        signal: null,
        exitCode: accumulator.exitCode ?? defaultExitCode(status),
        metadata: {
          baseUrl: this.#baseUrl.href,
          startUrl: startUrl.href,
          eventsUrl: runReference.eventsUrl,
          cancelUrl: runReference.cancelUrl,
          runId: runReference.runId,
          startResponse: startResult.body,
          ...input.metadata
        }
      });
    } catch (error) {
      if (cancellationRequested || isAbortError(error)) {
        await cancelPromise;
        if (!accumulator.terminalSeen) {
          await emit({
            kind: "adapter_finished",
            message: "Hermes native adapter cancelled.",
            payload: {
              status: "failed",
              runId: runReference?.runId,
              cancelled: true
            }
          });
        }
        return createResult({
          adapterId: this.id,
          status: "failed",
          command,
          cwd: input.workspace,
          startedAt,
          stdout: accumulator.stdout.join("\n"),
          stderr: accumulator.stderr.join("\n"),
          signal: "SIGTERM",
          exitCode: null,
          metadata: {
            baseUrl: this.#baseUrl.href,
            startUrl: startUrl.href,
            eventsUrl: runReference?.eventsUrl,
            cancelUrl: runReference?.cancelUrl,
            runId: runReference?.runId,
            cancelled: true,
            ...input.metadata
          }
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      if (!accumulator.terminalSeen) {
        await emit({
          kind: "adapter_finished",
          message: "Hermes native adapter failed.",
          payload: {
            status: "failed",
            error: message,
            runId: runReference?.runId
          }
        });
      }
      return createResult({
        adapterId: this.id,
        status: "failed",
        command,
        cwd: input.workspace,
        startedAt,
        stdout: accumulator.stdout.join("\n"),
        stderr: appendOutput(accumulator.stderr.join("\n"), message),
        signal: null,
        exitCode: 1,
        metadata: {
          baseUrl: this.#baseUrl.href,
          startUrl: startUrl.href,
          eventsUrl: runReference?.eventsUrl,
          cancelUrl: runReference?.cancelUrl,
          runId: runReference?.runId,
          error: message,
          ...input.metadata
        }
      });
    } finally {
      input.signal?.removeEventListener("abort", requestCancellation);
    }
  }

  async #startRun(url: URL, input: AgentAdapterRunInput, signal: AbortSignal): Promise<StartRunResult> {
    const response = await this.#fetch(url, {
      method: "POST",
      headers: this.#jsonHeaders(),
      body: JSON.stringify({
        task: input.task,
        workspace: input.workspace,
        command: input.command,
        commandParts: input.commandParts,
        metadata: input.metadata
      }),
      signal
    });
    const rawBody = await response.text();
    return {
      ok: response.ok,
      statusCode: response.status,
      statusText: response.statusText,
      body: parseJsonRecord(rawBody),
      rawBody
    };
  }

  async #consumeEventStream(
    url: URL,
    signal: AbortSignal,
    onRemoteEvent: (event: RemoteStreamEvent) => Promise<void>
  ): Promise<void> {
    const response = await this.#fetch(url, {
      method: "GET",
      headers: this.#streamHeaders(),
      signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hermes event stream failed with HTTP ${response.status}: ${text}`);
    }
    if (!response.body) {
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("text/event-stream")) {
      await consumeSseStream(response.body, signal, onRemoteEvent);
      return;
    }

    await consumeJsonlStream(response.body, signal, onRemoteEvent);
  }

  async #cancelRun(run: HermesNativeRunReference, input: AgentAdapterRunInput): Promise<void> {
    const cancelUrl = run.cancelUrl ? this.#resolveUrl(run.cancelUrl) : this.#resolveCancelUrl(run);
    if (!cancelUrl) {
      return;
    }

    try {
      await this.#fetch(cancelUrl, {
        method: "POST",
        headers: this.#jsonHeaders(),
        body: JSON.stringify({
          runId: run.runId,
          reason: abortReason(input.signal)
        })
      });
    } catch {
      // Cancellation is best-effort: the local abort result should still resolve.
    }
  }

  #resolveEventsUrl(run: HermesNativeRunReference): URL | undefined {
    if (run.eventsUrl) {
      return this.#resolveUrl(run.eventsUrl);
    }
    const path = resolvePath(this.#eventsPath, run);
    return path ? this.#resolveUrl(path) : undefined;
  }

  #resolveCancelUrl(run: HermesNativeRunReference): URL | undefined {
    const configuredPath = resolvePath(this.#cancelPath, run);
    if (configuredPath) {
      return this.#resolveUrl(configuredPath);
    }
    return run.cancelUrl ? this.#resolveUrl(run.cancelUrl) : undefined;
  }

  #resolveUrl(pathOrUrl: string): URL {
    if (/^https?:\/\//iu.test(pathOrUrl)) {
      return new URL(pathOrUrl);
    }

    return new URL(pathOrUrl, this.#baseUrl);
  }

  #jsonHeaders(): Headers {
    const headers = new Headers(this.#headers);
    headers.set("Accept", "application/json, application/x-ndjson, text/event-stream");
    headers.set("Content-Type", "application/json");
    return headers;
  }

  #streamHeaders(): Headers {
    const headers = new Headers(this.#headers);
    headers.set("Accept", "text/event-stream, application/x-ndjson, application/jsonl, application/json");
    return headers;
  }
}

export function createHermesNativeAdapter(config: HermesNativeAdapterConfig): HermesNativeAdapter {
  return new HermesNativeAdapter(config);
}

async function consumeJsonlStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onRemoteEvent: (event: RemoteStreamEvent) => Promise<void>
): Promise<void> {
  let buffer = "";
  for await (const chunk of decodeBody(body, signal)) {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stripTrailingCarriageReturn(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      await emitJsonlLine(line, onRemoteEvent);
      throwIfAborted(signal);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  await emitJsonlLine(buffer, onRemoteEvent);
}

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onRemoteEvent: (event: RemoteStreamEvent) => Promise<void>
): Promise<void> {
  let buffer = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const dispatch = async (): Promise<void> => {
    if (dataLines.length === 0) {
      eventName = undefined;
      return;
    }
    const data = dataLines.join("\n");
    dataLines = [];
    const parsed = parseEventPayload(data);
    await onRemoteEvent({
      eventName,
      payload: parsed
    });
    eventName = undefined;
  };

  for await (const chunk of decodeBody(body, signal)) {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stripTrailingCarriageReturn(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        await dispatch();
        throwIfAborted(signal);
      } else if (!line.startsWith(":")) {
        const separator = line.indexOf(":");
        const field = separator >= 0 ? line.slice(0, separator) : line;
        const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /u, "") : "";
        if (field === "event") {
          eventName = value;
        } else if (field === "data") {
          dataLines.push(value);
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  if (buffer.length > 0) {
    const line = stripTrailingCarriageReturn(buffer);
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  await dispatch();
}

async function* decodeBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const cancelReader = (): void => {
    void reader.cancel().catch(() => {});
  };

  if (signal.aborted) {
    cancelReader();
  }
  signal.addEventListener("abort", cancelReader, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      const read = await reader.read();
      throwIfAborted(signal);
      if (read.done) {
        break;
      }
      yield decoder.decode(read.value, { stream: true });
    }
    const trailing = decoder.decode();
    if (trailing.length > 0) {
      yield trailing;
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

async function emitJsonlLine(
  line: string,
  onRemoteEvent: (event: RemoteStreamEvent) => Promise<void>
): Promise<void> {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  const parsed = parseEventPayload(trimmed);
  await onRemoteEvent({ payload: parsed });
}

function normalizeRemoteEvent(
  remoteEvent: RemoteStreamEvent,
  adapterId: string,
  sequence: number
): AgentAdapterEvent | undefined {
  const payload =
    remoteEvent.eventName && remoteEvent.payload.event === undefined
      ? { ...remoteEvent.payload, event: remoteEvent.eventName }
      : remoteEvent.payload;
  const token = normalizedEventToken(remoteEvent.eventName ?? stringValue(payload.kind) ?? stringValue(payload.type) ?? stringValue(payload.event));
  const kind = normalizeEventKind(token, payload);
  if (!kind) {
    return undefined;
  }

  return {
    kind,
    adapterId,
    sequence,
    timestamp: stringValue(payload.timestamp) ?? new Date().toISOString(),
    message: messageFromPayload(payload),
    stream: kind === "adapter_stderr" ? "stderr" : kind === "adapter_stdout" ? "stdout" : undefined,
    artifact: kind === "adapter_artifact" ? readArtifact(payload) : undefined,
    payload
  };
}

function normalizeEventKind(token: string | undefined, payload: Record<string, unknown>): AgentAdapterEventKind | undefined {
  if (payload.artifact !== undefined) {
    return "adapter_artifact";
  }

  if (stringValue(payload.stream) === "stderr") {
    return "adapter_stderr";
  }
  if (stringValue(payload.stream) === "stdout") {
    return "adapter_stdout";
  }

  if (!token) {
    return messageFromPayload(payload) ? "adapter_stdout" : undefined;
  }

  if (["adapter_started", "run_started", "started", "start"].includes(token)) {
    return "adapter_started";
  }
  if (
    [
      "adapter_finished",
      "run_finished",
      "run_completed",
      "finished",
      "complete",
      "completed",
      "done",
      "success",
      "succeeded",
      "failed",
      "failure",
      "run_failed",
      "blocked",
      "cancelled",
      "canceled",
      "aborted"
    ].includes(token)
  ) {
    return "adapter_finished";
  }
  if (["stdout", "output", "log", "message", "text", "token"].includes(token)) {
    return "adapter_stdout";
  }
  if (["stderr", "error", "warning", "warn"].includes(token)) {
    return "adapter_stderr";
  }
  if (["artifact", "adapter_artifact", "file", "output_file", "attachment"].includes(token)) {
    return "adapter_artifact";
  }
  if (["action", "agent_action", "step", "tool_call", "tool", "adapter_opaque_action"].includes(token)) {
    return "adapter_opaque_action";
  }

  return "adapter_opaque_action";
}

function updateAccumulator(accumulator: StreamAccumulator, event: AgentAdapterEvent): void {
  if (event.kind === "adapter_stdout" && event.message) {
    accumulator.stdout.push(event.message);
  }
  if (event.kind === "adapter_stderr" && event.message) {
    accumulator.stderr.push(event.message);
  }
  if (event.kind === "adapter_finished") {
    accumulator.terminalSeen = true;
    accumulator.status = statusFromPayload(event.payload ?? {}) ?? statusFromTerminalEvent(event) ?? "completed";
    accumulator.exitCode = numberValue(event.payload?.exitCode) ?? numberValue(event.payload?.exit_code) ?? defaultExitCode(accumulator.status);
  }
}

function createRunReference(body: Record<string, unknown>): HermesNativeRunReference {
  const run = isRecord(body.run) ? body.run : undefined;
  return {
    runId:
      stringValue(body.runId) ??
      stringValue(body.run_id) ??
      stringValue(body.id) ??
      stringValue(run?.runId) ??
      stringValue(run?.run_id) ??
      stringValue(run?.id),
    eventsUrl:
      stringValue(body.eventsUrl) ??
      stringValue(body.eventStreamUrl) ??
      stringValue(body.streamUrl) ??
      stringValue(body.events_url) ??
      stringValue(body.stream_url),
    cancelUrl:
      stringValue(body.cancelUrl) ??
      stringValue(body.cancel_url) ??
      stringValue(body.cancellationUrl) ??
      stringValue(body.cancellation_url),
    startResponse: body
  };
}

function resolvePath(path: HermesNativePathResolver | false, run: HermesNativeRunReference): string | undefined {
  if (path === false) {
    return undefined;
  }
  const resolved = typeof path === "function" ? path(run) : path;
  if (!resolved) {
    return undefined;
  }
  if (resolved.includes("{runId}")) {
    if (!run.runId) {
      return undefined;
    }
    return resolved.replaceAll("{runId}", encodeURIComponent(run.runId));
  }
  return resolved;
}

function parseEventPayload(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const payload = trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : trimmed;
  if (payload.startsWith("{") && payload.endsWith("}")) {
    const parsed = parseJsonRecord(payload);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }
  return { message: payload };
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  if (raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return {};
  }
}

function readArtifact(payload: Record<string, unknown>): NonNullable<AgentAdapterEvent["artifact"]> | undefined {
  const artifact = isRecord(payload.artifact) ? payload.artifact : payload;
  const uri = stringValue(artifact.uri) ?? stringValue(artifact.path) ?? stringValue(artifact.file) ?? stringValue(artifact.url);
  if (!uri) {
    return undefined;
  }

  return {
    uri,
    label: stringValue(artifact.label) ?? stringValue(artifact.name),
    kind: stringValue(artifact.kind) ?? stringValue(artifact.type),
    mimeType: stringValue(artifact.mimeType) ?? stringValue(artifact.mime_type)
  };
}

function statusFromPayload(payload: Record<string, unknown>): AgentAdapterStatus | undefined {
  const token = normalizedEventToken(stringValue(payload.status) ?? stringValue(payload.result) ?? stringValue(payload.outcome) ?? stringValue(payload.event));
  if (!token) {
    return undefined;
  }
  if (["completed", "complete", "done", "success", "succeeded", "adapter_finished", "run_finished", "run_completed"].includes(token)) {
    return "completed";
  }
  if (["blocked", "needs_approval"].includes(token)) {
    return "blocked";
  }
  if (["failed", "failure", "error", "cancelled", "canceled", "aborted", "run_failed"].includes(token)) {
    return "failed";
  }
  return undefined;
}

function statusFromTerminalEvent(event: AgentAdapterEvent): AgentAdapterStatus | undefined {
  const token = normalizedEventToken(stringValue(event.payload?.event) ?? stringValue(event.payload?.type) ?? stringValue(event.payload?.kind));
  if (!token) {
    return undefined;
  }
  if (["failed", "failure", "run_failed", "cancelled", "canceled", "aborted"].includes(token)) {
    return "failed";
  }
  if (token === "blocked") {
    return "blocked";
  }
  if (["completed", "complete", "done", "success", "succeeded", "run_completed"].includes(token)) {
    return "completed";
  }
  return undefined;
}

function defaultExitCode(status: AgentAdapterStatus): number {
  return status === "completed" ? 0 : 1;
}

function createResult(options: {
  adapterId: string;
  status: AgentAdapterStatus;
  command: string;
  cwd: string;
  startedAt: number;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  exitCode?: number | null;
  metadata?: Record<string, unknown>;
}): AgentAdapterRunResult {
  return {
    adapterId: options.adapterId,
    status: options.status,
    command: options.command,
    cwd: options.cwd,
    exitCode: options.exitCode === undefined ? defaultExitCode(options.status) : options.exitCode,
    signal: options.signal,
    durationMs: Date.now() - options.startedAt,
    stdout: options.stdout,
    stderr: options.stderr,
    metadata: options.metadata
  };
}

function messageFromPayload(payload: Record<string, unknown>): string | undefined {
  return (
    stringValue(payload.message) ??
    stringValue(payload.text) ??
    stringValue(payload.summary) ??
    stringValue(payload.content) ??
    stringValue(payload.data)
  );
}

function normalizedEventToken(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase().replace(/[\s.:-]+/gu, "_");
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripTrailingCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function appendOutput(output: string, message: string): string {
  return output.length === 0 ? message : `${output}\n${message}`;
}

function abortReason(signal: AbortSignal | undefined): string | undefined {
  if (!signal?.aborted) {
    return undefined;
  }
  return signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "aborted");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}
