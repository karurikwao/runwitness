export type AgentAdapterStatus = "completed" | "failed" | "blocked";

export interface AgentAdapterCapabilities {
  localExecution?: boolean;
  externalTool?: boolean;
  requiresConfiguredTool?: boolean;
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

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly capabilities: AgentAdapterCapabilities;

  run(input: AgentAdapterRunInput): Promise<AgentAdapterRunResult>;
}
