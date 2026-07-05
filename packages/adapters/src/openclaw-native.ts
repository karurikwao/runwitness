import type {
  AgentAdapter,
  AgentAdapterEvent,
  AgentAdapterEventKind,
  AgentAdapterRunInput,
  AgentAdapterRunResult,
  AgentAdapterStatus,
  AgentAdapterStreamHandler
} from "./types.js";

export type OpenClawNativePathResolver =
  | string
  | URL
  | ((run: OpenClawNativeRunStartResponse, input: AgentAdapterRunInput) => string | URL | undefined);

export type OpenClawNativeRunStartResponse = Record<string, unknown>;

export interface OpenClawNativeAdapterConfig {
  id?: string;
  name?: string;
  description?: string;
  baseUrl: string | URL;
  runPath?: string | URL;
  eventStreamPath?: OpenClawNativePathResolver;
  cancelPath?: OpenClawNativePathResolver;
  runMethod?: string;
  cancelMethod?: string;
  headers?: HeadersInit | ((input: AgentAdapterRunInput) => HeadersInit);
  buildRunRequest?: (input: AgentAdapterRunInput) => unknown;
  fetch?: typeof fetch;
}

interface OpenClawRunState {
  status: AgentAdapterStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  finished: boolean;
  aborted: boolean;
  cancelError?: string;
}

interface ParsedSseEvent {
  eventName?: string;
  data: string;
  id?: string;
}

export function createOpenClawNativeAdapter(config: OpenClawNativeAdapterConfig): AgentAdapter {
  const id = config.id ?? "openclaw-native";
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetchImpl = config.fetch ?? fetch;

  return {
    id,
    name: config.name ?? "OpenClaw Native",
    description: config.description ?? "Runs tasks through a native OpenClaw HTTP/SSE adapter.",
    capabilities: {
      externalTool: true,
      requiresConfiguredTool: true,
      eventStream: true,
      artifacts: true,
      opaqueActions: true
    },
    async run(input: AgentAdapterRunInput): Promise<AgentAdapterRunResult> {
      return runOpenClawNative(input, async () => undefined);
    },
    async runStream(input: AgentAdapterRunInput, onEvent: AgentAdapterStreamHandler): Promise<AgentAdapterRunResult> {
      return runOpenClawNative(input, onEvent);
    }
  };

  async function runOpenClawNative(
    input: AgentAdapterRunInput,
    onEvent: AgentAdapterStreamHandler
  ): Promise<AgentAdapterRunResult> {
    const started = performance.now();
    const state: OpenClawRunState = {
      status: "completed",
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      finished: false,
      aborted: input.signal?.aborted === true
    };
    let sequence = 0;
    let run: OpenClawNativeRunStartResponse | undefined;
    let cancelPromise: Promise<void> = Promise.resolve();
    const runUrl = resolveEndpoint(baseUrl, config.runPath ?? "/runs");
    const command = `${config.runMethod ?? "POST"} ${runUrl.toString()}`;

    const emit = async (
      event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }
    ): Promise<void> => {
      sequence += 1;
      const adapterEvent: AgentAdapterEvent = {
        ...event,
        adapterId: id,
        sequence,
        timestamp: event.timestamp ?? new Date().toISOString()
      };
      updateStateFromEvent(state, adapterEvent);
      await onEvent(adapterEvent);
    };

    const streamController = new AbortController();
    const abort = (): void => {
      state.aborted = true;
      state.status = "failed";
      state.exitCode = null;
      state.signal = "SIGTERM";
      if (run) {
        cancelPromise = cancelRemoteRun(fetchImpl, baseUrl, config, run, input).catch((error: unknown) => {
          state.cancelError = error instanceof Error ? error.message : String(error);
          state.stderr += state.cancelError;
        });
      }
      streamController.abort();
    };

    input.signal?.addEventListener("abort", abort, { once: true });

    try {
      await emit({
        kind: "adapter_started",
        message: command,
        payload: {
          baseUrl: baseUrl.toString(),
          method: config.runMethod ?? "POST",
          runPath: config.runPath ?? "/runs"
        }
      });

      if (state.aborted) {
        await emitFinished(state, emit, "Adapter cancelled.");
        return createResult(id, input, command, started, state, run);
      }

      const start = await startOpenClawRun(fetchImpl, runUrl, config, input);
      if (!start.ok) {
        state.status = "failed";
        state.exitCode = 1;
        state.stderr += start.error;
        await emit({
          kind: "adapter_stderr",
          stream: "stderr",
          message: start.error,
          payload: {
            status: start.status
          }
        });
        await emitFinished(state, emit, "Adapter failed.");
        return createResult(id, input, command, started, state, run);
      }

      run = start.run;
      const eventStreamUrl = resolveEventStreamUrl(baseUrl, config, run, input);
      if (eventStreamUrl) {
        await consumeOpenClawEventStream(fetchImpl, eventStreamUrl, config, input, streamController.signal, emit);
      }

      await cancelPromise;
      if (!state.finished) {
        await emitFinished(state, emit, state.aborted ? "Adapter cancelled." : "Adapter completed.");
      }
      return createResult(id, input, command, started, state, run);
    } catch (error: unknown) {
      await cancelPromise;
      if (state.aborted && isAbortError(error)) {
        if (!state.finished) {
          await emitFinished(state, emit, "Adapter cancelled.");
        }
        return createResult(id, input, command, started, state, run);
      }
      state.status = "failed";
      state.exitCode = 1;
      const message = error instanceof Error ? error.message : String(error);
      state.stderr += message;
      await emit({
        kind: "adapter_stderr",
        stream: "stderr",
        message,
        payload: {
          error: message
        }
      });
      if (!state.finished) {
        await emitFinished(state, emit, "Adapter failed.");
      }
      return createResult(id, input, command, started, state, run);
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
  }
}

async function startOpenClawRun(
  fetchImpl: typeof fetch,
  runUrl: URL,
  config: OpenClawNativeAdapterConfig,
  input: AgentAdapterRunInput
): Promise<{ ok: true; run: OpenClawNativeRunStartResponse } | { ok: false; status: number; error: string }> {
  const response = await fetchImpl(runUrl, {
    method: config.runMethod ?? "POST",
    headers: jsonHeaders(config.headers, input),
    body: JSON.stringify(config.buildRunRequest?.(input) ?? defaultRunRequest(input)),
    signal: input.signal
  });
  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `${config.runMethod ?? "POST"} ${runUrl.toString()} failed with ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`
    };
  }

  if (!text.trim()) {
    return {
      ok: true,
      run: {}
    };
  }

  const parsed = JSON.parse(text) as unknown;
  return {
    ok: true,
    run: isRecord(parsed) ? parsed : { value: parsed }
  };
}

async function consumeOpenClawEventStream(
  fetchImpl: typeof fetch,
  url: URL,
  config: OpenClawNativeAdapterConfig,
  input: AgentAdapterRunInput,
  signal: AbortSignal,
  emit: (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }) => Promise<void>
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: streamHeaders(config.headers, input),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${url.toString()} failed with ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("text/event-stream")) {
    await consumeSseStream(response.body, emit);
    return;
  }

  await consumeJsonLineStream(response.body, emit);
}

async function cancelRemoteRun(
  fetchImpl: typeof fetch,
  baseUrl: URL,
  config: OpenClawNativeAdapterConfig,
  run: OpenClawNativeRunStartResponse,
  input: AgentAdapterRunInput
): Promise<void> {
  if (!config.cancelPath) {
    return;
  }
  const cancelPath = typeof config.cancelPath === "function" ? config.cancelPath(run, input) : config.cancelPath;
  if (!cancelPath) {
    return;
  }
  const cancelUrl = resolveEndpoint(baseUrl, cancelPath);
  const response = await fetchImpl(cancelUrl, {
    method: config.cancelMethod ?? "POST",
    headers: jsonHeaders(config.headers, input),
    body: JSON.stringify({
      reason: "aborted",
      runId: readRunId(run)
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `${config.cancelMethod ?? "POST"} ${cancelUrl.toString()} failed with ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`
    );
  }
}

function normalizeRemotePayload(
  text: string,
  eventName?: string,
  eventId?: string
): Array<Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }> {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "[DONE]") {
    return [];
  }

  const parsed = parseJsonPayload(trimmed);
  if (parsed) {
    const payload = eventName && !hasEventDiscriminator(parsed) ? { ...parsed, event: eventName } : parsed;
    return [remoteRecordToAdapterEvent(payload, eventId)].filter(isDefined);
  }

  if (eventName) {
    return [
      remoteRecordToAdapterEvent({
        event: eventName,
        message: trimmed,
        id: eventId
      })
    ].filter(isDefined);
  }

  return [
    {
      kind: "adapter_stdout",
      stream: "stdout",
      message: trimmed,
      payload: {
        raw: trimmed
      }
    }
  ];
}

function remoteRecordToAdapterEvent(
  payload: Record<string, unknown>,
  eventId?: string
): (Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }) | undefined {
  const kind = normalizeRemoteKind(payload);
  if (!kind) {
    return undefined;
  }

  return {
    kind,
    timestamp: stringValue(payload.timestamp),
    message: stringValue(payload.message) ?? stringValue(payload.text) ?? stringValue(payload.summary),
    stream: kind === "adapter_stderr" ? "stderr" : kind === "adapter_stdout" ? "stdout" : undefined,
    artifact: kind === "adapter_artifact" ? readArtifact(payload) : undefined,
    payload: {
      ...payload,
      ...(eventId ? { sseId: eventId } : {})
    }
  };
}

function normalizeRemoteKind(payload: Record<string, unknown>): AgentAdapterEventKind | undefined {
  const rawKind = String(payload.kind ?? payload.type ?? payload.event ?? "").toLowerCase();
  const status = String(payload.status ?? "").toLowerCase();
  const discriminator = rawKind || status;

  if (["completed", "complete", "done", "succeeded", "success", "finished", "run_completed", "run_succeeded"].includes(discriminator)) {
    return "adapter_finished";
  }

  if (["failed", "failure", "run_failed", "cancelled", "canceled", "aborted", "blocked"].includes(discriminator)) {
    return "adapter_finished";
  }

  if (["artifact", "adapter_artifact", "file", "output_file"].includes(rawKind) || payload.artifact !== undefined) {
    return "adapter_artifact";
  }

  if (["stderr", "error", "adapter_stderr"].includes(rawKind)) {
    return "adapter_stderr";
  }

  if (["stdout", "log", "message", "adapter_stdout"].includes(rawKind)) {
    return "adapter_stdout";
  }

  if (["action", "agent_action", "step", "tool_call", "adapter_opaque_action", "run_started", "started"].includes(rawKind)) {
    return "adapter_opaque_action";
  }

  return undefined;
}

function updateStateFromEvent(state: OpenClawRunState, event: AgentAdapterEvent): void {
  if (event.kind === "adapter_stdout" && event.message) {
    state.stdout += event.message;
  }
  if (event.kind === "adapter_stderr" && event.message) {
    state.stderr += event.message;
  }
  if (event.kind !== "adapter_finished") {
    return;
  }

  state.finished = true;
  const payload = event.payload ?? {};
  state.status = readStatus(payload) ?? (state.aborted ? "failed" : state.status);
  const exitCode = numberValue(payload.exitCode) ?? numberValue(payload.exit_code);
  state.exitCode = exitCode ?? (state.status === "completed" ? 0 : state.aborted ? null : 1);
  const payloadSignal = stringValue(payload.signal) as NodeJS.Signals | undefined;
  state.signal = payloadSignal ?? (state.aborted ? "SIGTERM" : null);
}

async function emitFinished(
  state: OpenClawRunState,
  emit: (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }) => Promise<void>,
  message: string
): Promise<void> {
  await emit({
    kind: "adapter_finished",
    message,
    payload: {
      status: state.status,
      exitCode: state.exitCode,
      signal: state.signal,
      aborted: state.aborted,
      ...(state.cancelError ? { cancelError: state.cancelError } : {})
    }
  });
}

function createResult(
  adapterId: string,
  input: AgentAdapterRunInput,
  command: string,
  started: number,
  state: OpenClawRunState,
  run?: OpenClawNativeRunStartResponse
): AgentAdapterRunResult {
  return {
    adapterId,
    status: state.status,
    command,
    cwd: input.workspace,
    exitCode: state.exitCode,
    signal: state.signal,
    durationMs: Math.round(performance.now() - started),
    stdout: state.stdout,
    stderr: state.stderr,
    metadata: {
      run,
      ...input.metadata
    }
  };
}

function defaultRunRequest(input: AgentAdapterRunInput): Record<string, unknown> {
  return {
    task: input.task,
    workspace: input.workspace,
    command: input.command,
    commandParts: input.commandParts,
    metadata: input.metadata
  };
}

function resolveEventStreamUrl(
  baseUrl: URL,
  config: OpenClawNativeAdapterConfig,
  run: OpenClawNativeRunStartResponse,
  input: AgentAdapterRunInput
): URL | undefined {
  const configuredPath = typeof config.eventStreamPath === "function"
    ? config.eventStreamPath(run, input)
    : config.eventStreamPath;
  const responsePath = stringValue(run.eventsUrl) ?? stringValue(run.eventStreamUrl) ?? stringValue(run.streamUrl);
  const fallbackPath = readRunId(run) ? `/runs/${encodeURIComponent(readRunId(run) ?? "")}/events` : undefined;
  const path = configuredPath ?? responsePath ?? fallbackPath;
  return path ? resolveEndpoint(baseUrl, path) : undefined;
}

function resolveEndpoint(baseUrl: URL, endpoint: string | URL): URL {
  if (endpoint instanceof URL) {
    return endpoint;
  }
  return new URL(endpoint, baseUrl);
}

function normalizeBaseUrl(baseUrl: string | URL): URL {
  return baseUrl instanceof URL ? baseUrl : new URL(baseUrl);
}

function jsonHeaders(headers: OpenClawNativeAdapterConfig["headers"], input: AgentAdapterRunInput): Headers {
  const result = new Headers(resolveHeaders(headers, input));
  result.set("accept", result.get("accept") ?? "application/json");
  result.set("content-type", result.get("content-type") ?? "application/json");
  return result;
}

function streamHeaders(headers: OpenClawNativeAdapterConfig["headers"], input: AgentAdapterRunInput): Headers {
  const result = new Headers(resolveHeaders(headers, input));
  result.set("accept", result.get("accept") ?? "text/event-stream, application/x-ndjson, application/jsonl, application/json");
  return result;
}

function resolveHeaders(headers: OpenClawNativeAdapterConfig["headers"], input: AgentAdapterRunInput): HeadersInit | undefined {
  return typeof headers === "function" ? headers(input) : headers;
}

async function consumeSseStream(
  body: ReadableStream<Uint8Array> | null,
  emit: (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }) => Promise<void>
): Promise<void> {
  if (!body) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2).replace(/^\n+/u, "");
      const parsed = parseSseBlock(block);
      if (parsed) {
        await emitParsedRemoteEvent(parsed, emit);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, "\n");
  const parsed = parseSseBlock(buffer);
  if (parsed) {
    await emitParsedRemoteEvent(parsed, emit);
  }
}

async function consumeJsonLineStream(
  body: ReadableStream<Uint8Array> | null,
  emit: (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }) => Promise<void>
): Promise<void> {
  if (!body) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      await emitRemoteLine(line, emit);
    }
  }

  buffer += decoder.decode();
  await emitRemoteLine(buffer, emit);
}

async function emitParsedRemoteEvent(
  event: ParsedSseEvent,
  emit: (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }) => Promise<void>
): Promise<void> {
  for (const adapterEvent of normalizeRemotePayload(event.data, event.eventName, event.id)) {
    await emit(adapterEvent);
  }
}

async function emitRemoteLine(
  line: string,
  emit: (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp"> & { timestamp?: string }) => Promise<void>
): Promise<void> {
  for (const adapterEvent of normalizeRemotePayload(line)) {
    await emit(adapterEvent);
  }
}

function parseSseBlock(block: string): ParsedSseEvent | undefined {
  const data: string[] = [];
  let eventName: string | undefined;
  let id: string | undefined;

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const rawValue = separator >= 0 ? line.slice(separator + 1) : "";
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      data.push(value);
    } else if (field === "id") {
      id = value;
    }
  }

  if (data.length === 0) {
    return undefined;
  }

  return {
    eventName,
    data: data.join("\n"),
    id
  };
}

function parseJsonPayload(text: string): Record<string, unknown> | undefined {
  const payload = text.startsWith("data:") ? text.slice("data:".length).trim() : text;
  if (!payload.startsWith("{") || !payload.endsWith("}")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readStatus(payload: Record<string, unknown>): AgentAdapterStatus | undefined {
  const rawStatus = String(payload.status ?? payload.type ?? payload.event ?? payload.kind ?? "").toLowerCase();
  if (["completed", "complete", "done", "succeeded", "success", "finished", "run_completed", "run_succeeded"].includes(rawStatus)) {
    return "completed";
  }
  if (["blocked"].includes(rawStatus)) {
    return "blocked";
  }
  if (["failed", "failure", "run_failed", "cancelled", "canceled", "aborted"].includes(rawStatus)) {
    return "failed";
  }
  return undefined;
}

function readArtifact(payload: Record<string, unknown>): NonNullable<AgentAdapterEvent["artifact"]> | undefined {
  const artifact = isRecord(payload.artifact) ? payload.artifact : payload;
  const uri = stringValue(artifact.uri) ?? stringValue(artifact.path) ?? stringValue(artifact.file);
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

function readRunId(run: OpenClawNativeRunStartResponse): string | undefined {
  return stringValue(run.id) ?? stringValue(run.runId) ?? stringValue(run.run_id);
}

function hasEventDiscriminator(payload: Record<string, unknown>): boolean {
  return payload.kind !== undefined || payload.type !== undefined || payload.event !== undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
