import type { PolicyDecision, ShellCommandRiskClassification } from "./shellRiskClassifier.js";

export type ApprovalActionType = "file_write" | "network" | "shell_command" | "skill" | "other";

export type ApprovalActorType = "agent" | "human" | "policy" | "system";

export type ApprovalDecision = "allow" | "ask" | "deny";

export type ApprovalMode = "interactive" | "non_interactive" | "policy" | "preapproved";

export interface ApprovalActor {
  type: ApprovalActorType;
  id: string;
  displayName?: string;
}

export interface ApprovalRecord {
  id: string;
  runId?: string;
  actionType: ApprovalActionType;
  action: string;
  actionSummary: string;
  policyDecision: PolicyDecision;
  decision: ApprovalDecision;
  risk?: ShellCommandRiskClassification;
  requestedAt: string;
  requestedBy?: ApprovalActor;
  mode: ApprovalMode;
  decidedAt?: string;
  decidedBy?: ApprovalActor;
  rationale?: string;
  metadata: Record<string, unknown>;
}

export interface CreateApprovalRecordInput {
  id?: string;
  runId?: string;
  actionType?: ApprovalActionType;
  action: string;
  actionSummary?: string;
  policyDecision?: PolicyDecision;
  decision?: ApprovalDecision;
  risk?: ShellCommandRiskClassification;
  requestedAt?: string;
  requestedBy?: ApprovalActor;
  mode?: ApprovalMode;
  decidedAt?: string;
  decidedBy?: ApprovalActor;
  rationale?: string;
  metadata?: Record<string, unknown>;
}

export interface ResolveApprovalRecordInput {
  decision: Exclude<ApprovalDecision, "ask">;
  decidedAt?: string;
  decidedBy?: ApprovalActor;
  rationale?: string;
  metadata?: Record<string, unknown>;
}

export function createApprovalRecord(input: CreateApprovalRecordInput): ApprovalRecord {
  const requestedAt = input.requestedAt ?? new Date().toISOString();
  const policyDecision = input.policyDecision ?? input.risk?.decision ?? "ask";
  const decision = input.decision ?? toInitialApprovalDecision(policyDecision);
  const decidedAt = decision === "ask" ? input.decidedAt : input.decidedAt ?? requestedAt;

  const record: ApprovalRecord = {
    id: input.id ?? createApprovalId(),
    actionType: input.actionType ?? input.risk?.actionType ?? "other",
    action: input.action,
    actionSummary: input.actionSummary ?? summarizeAction(input.action),
    policyDecision,
    decision,
    requestedAt,
    mode: input.mode ?? (decision === "ask" ? "interactive" : "policy"),
    metadata: input.metadata ?? {},
  };

  if (input.runId !== undefined) {
    record.runId = input.runId;
  }

  if (input.risk !== undefined) {
    record.risk = input.risk;
  }

  if (input.requestedBy !== undefined) {
    record.requestedBy = input.requestedBy;
  }

  if (decidedAt !== undefined) {
    record.decidedAt = decidedAt;
  }

  if (input.decidedBy !== undefined) {
    record.decidedBy = input.decidedBy;
  }

  if (input.rationale !== undefined) {
    record.rationale = input.rationale;
  }

  return record;
}

export function resolveApprovalRecord(
  record: ApprovalRecord,
  input: ResolveApprovalRecordInput,
): ApprovalRecord {
  const resolved: ApprovalRecord = {
    ...record,
    decision: input.decision,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
    metadata: {
      ...record.metadata,
      ...input.metadata,
    },
  };

  if (input.decidedBy !== undefined) {
    resolved.decidedBy = input.decidedBy;
  }

  if (input.rationale !== undefined) {
    resolved.rationale = input.rationale;
  }

  return resolved;
}

export function isApprovalTerminal(record: ApprovalRecord): boolean {
  return record.decision === "allow" || record.decision === "deny";
}

function toInitialApprovalDecision(policyDecision: PolicyDecision): ApprovalDecision {
  return policyDecision;
}

function createApprovalId(): string {
  return `approval_${globalThis.crypto?.randomUUID?.() ?? fallbackRandomId()}`;
}

function fallbackRandomId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function summarizeAction(action: string): string {
  const compacted = action.trim().replace(/\s+/g, " ");
  return compacted.length > 120 ? `${compacted.slice(0, 117)}...` : compacted;
}
