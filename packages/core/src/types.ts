export type RunStatus = "running" | "completed" | "failed" | "blocked";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "blocked" | "skipped";

export type EventKind =
  | "run_started"
  | "run_status_changed"
  | "step_created"
  | "step_started"
  | "step_finished"
  | "receipt_recorded"
  | "approval_requested"
  | "approval_recorded"
  | "command_started"
  | "command_finished"
  | "file_changes"
  | "test_result"
  | "receipt_exported"
  | "run_finished"
  | (string & {});

export type ReceiptKind = "artifact" | "command" | "file" | "http" | "metric" | "note" | (string & {});

export type ReceiptStatus = "passed" | "failed" | "warning" | "info" | (string & {});

export interface ReceiptSummary {
  id: string;
  kind: ReceiptKind;
  capturedAt: string;
  status?: ReceiptStatus;
  label?: string;
  uri?: string;
  digest?: string;
  sizeBytes?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface RunReceiptSummary {
  total: number;
  byKind: Record<string, number>;
  latest?: ReceiptSummary;
}

export interface RunRecord {
  id: string;
  task: string;
  agent: string;
  status: RunStatus;
  workspace: string;
  startedAt: string;
  endedAt?: string;
  metadata: Record<string, unknown>;
  receipts?: RunReceiptSummary;
}

export type Run = RunRecord;

export interface RunStep {
  id: string;
  runId: string;
  name: string;
  status: StepStatus;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  parentStepId?: string;
  startedAt?: string;
  endedAt?: string;
  metadata: Record<string, unknown>;
}

export interface RunEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id?: string;
  sequence: number;
  runId: string;
  type?: EventKind;
  kind: EventKind;
  stepId?: string;
  observedAt?: string;
  timestamp: string;
  payload: TPayload;
  receipt?: ReceiptSummary;
}

export interface CreateRunInput {
  id?: string;
  task: string;
  agent: string;
  workspace: string;
  metadata?: Record<string, unknown>;
}

export interface CreateStepInput {
  id?: string;
  runId: string;
  name: string;
  parentStepId?: string;
  status?: StepStatus;
  sequence?: number;
  metadata?: Record<string, unknown>;
}

export interface AppendReceiptInput {
  id?: string;
  runId: string;
  stepId?: string;
  kind: ReceiptKind;
  capturedAt?: string;
  status?: ReceiptStatus;
  label?: string;
  uri?: string;
  digest?: string;
  sizeBytes?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface FileChange {
  path: string;
  type: "added" | "modified" | "deleted";
  beforeHash?: string;
  afterHash?: string;
  sizeBytes?: number;
}
