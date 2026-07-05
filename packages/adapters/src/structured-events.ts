import type { AgentAdapterEvent, AgentAdapterEventKind } from "./types.js";

export interface StructuredAdapterEventOptions {
  adapterId: string;
  sequence: number;
  fallbackTimestamp?: string;
}

export function parseStructuredAdapterEvents(
  text: string,
  options: StructuredAdapterEventOptions
): AgentAdapterEvent[] {
  const events: AgentAdapterEvent[] = [];
  let sequence = options.sequence;

  for (const line of text.split(/\r?\n/u)) {
    const parsed = parseStructuredLine(line);
    if (!parsed) {
      continue;
    }

    const event = toAdapterEvent(parsed, {
      adapterId: options.adapterId,
      sequence,
      fallbackTimestamp: options.fallbackTimestamp
    });
    if (event) {
      events.push(event);
      sequence += 1;
    }
  }

  return events;
}

function parseStructuredLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  const payload = trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : trimmed;
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

function toAdapterEvent(
  payload: Record<string, unknown>,
  options: StructuredAdapterEventOptions
): AgentAdapterEvent | undefined {
  const kind = normalizeStructuredKind(payload);
  if (!kind) {
    return undefined;
  }

  return {
    kind,
    adapterId: options.adapterId,
    sequence: options.sequence,
    timestamp: stringValue(payload.timestamp) ?? options.fallbackTimestamp ?? new Date().toISOString(),
    message: stringValue(payload.message) ?? stringValue(payload.text) ?? stringValue(payload.summary),
    stream: kind === "adapter_stderr" ? "stderr" : kind === "adapter_stdout" ? "stdout" : undefined,
    artifact: kind === "adapter_artifact" ? readArtifact(payload) : undefined,
    payload
  };
}

function normalizeStructuredKind(payload: Record<string, unknown>): AgentAdapterEventKind | undefined {
  const rawKind = String(payload.kind ?? payload.type ?? payload.event ?? "").toLowerCase();

  if (["artifact", "adapter_artifact", "file", "output_file"].includes(rawKind) || payload.artifact !== undefined) {
    return "adapter_artifact";
  }

  if (["stderr", "error", "adapter_stderr"].includes(rawKind)) {
    return "adapter_stderr";
  }

  if (["stdout", "log", "message", "adapter_stdout"].includes(rawKind)) {
    return "adapter_stdout";
  }

  if (["action", "agent_action", "step", "tool_call", "adapter_opaque_action"].includes(rawKind)) {
    return "adapter_opaque_action";
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
