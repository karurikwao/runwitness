export type AgentAdapterStatus = "completed" | "failed" | "blocked";
export type AgentAdapterEventKind =
  | "adapter_started"
  | "adapter_stdout"
  | "adapter_stderr"
  | "adapter_artifact"
  | "adapter_opaque_action"
  | "adapter_finished";

export interface AgentAdapterCapabilities {
  localExecution?: boolean;
  externalTool?: boolean;
  requiresConfiguredTool?: boolean;
  eventStream?: boolean;
  artifacts?: boolean;
  opaqueActions?: boolean;
}

export interface AgentAdapterRunInput {
  task: string;
  workspace: string;
  command?: string;
  commandParts?: string[];
  env?: NodeJS.ProcessEnv;
  metadata?: Record<string, unknown>;
}

export interface AgentAdapterRunResult {
  adapterId: string;
  status: AgentAdapterStatus;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  metadata?: Record<string, unknown>;
}

export interface AgentAdapterEvent {
  kind: AgentAdapterEventKind;
  timestamp: string;
  adapterId: string;
  sequence: number;
  message?: string;
  stream?: "stdout" | "stderr";
  artifact?: {
    uri: string;
    label?: string;
    kind?: string;
    mimeType?: string;
  };
  payload?: Record<string, unknown>;
}

export interface AgentAdapterStreamHandler {
  (event: AgentAdapterEvent): void | Promise<void>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly capabilities: AgentAdapterCapabilities;

  run(input: AgentAdapterRunInput): Promise<AgentAdapterRunResult>;
  runStream?(input: AgentAdapterRunInput, onEvent: AgentAdapterStreamHandler): Promise<AgentAdapterRunResult>;
}
