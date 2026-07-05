import { createHash, randomBytes } from "node:crypto";
import {
  checkSkillRuntimePermission,
  digestSkillManifest,
  type SkillFilesystemRuntimeAction,
  type SkillManifest,
  type SkillManifestDigest,
  type SkillNetworkRuntimeAction,
  type SkillPermissionRiskDecision,
  type SkillPermissionRiskSummary,
  type SkillRuntimeAction,
  type SkillRuntimePermissionCheck,
  type SkillRuntimePermissionReason,
  type SkillSecretRuntimeAction,
  type SkillShellRuntimeAction,
  type SkillSignatureVerification
} from "./index.js";

export type SkillExecutionBrokerDecision = "allow" | "deny";
export type SkillExecutionBrokerStatus = "allowed" | "denied";
export type SkillExecutionBrokerIdFactory = (kind: "event" | "receipt") => string;

export interface SkillExecutionBrokerManifestInspection {
  manifest: SkillManifest;
  digest?: SkillManifestDigest;
  signature?: SkillSignatureVerification;
  permissions?: SkillPermissionRiskSummary;
}

export type SkillExecutionBrokerInput = SkillManifest | SkillExecutionBrokerManifestInspection;

export interface SkillExecutionBrokerOptions {
  now?: () => Date;
  createId?: SkillExecutionBrokerIdFactory;
  onEvent?: (event: SkillExecutionBrokerEvent) => void;
  onReceipt?: (receipt: SkillExecutionBrokerReceipt) => void;
  redactions?: readonly string[];
}

export interface SkillExecutionBrokerDigestRef {
  algorithm: "sha256";
  value: string;
}

export interface SkillExecutionBrokerSkillRef {
  name: string;
  version?: string;
  digest: SkillExecutionBrokerDigestRef;
  signatureStatus?: SkillSignatureVerification["status"];
  permissionDecision?: SkillPermissionRiskDecision;
}

export interface SkillExecutionBrokerReason {
  code: SkillRuntimePermissionReason["code"];
  message: string;
  value?: string;
  redacted?: boolean;
}

export interface SkillExecutionBrokerShellAction {
  kind: "shell";
  command: string;
  commandDigest: SkillExecutionBrokerDigestRef;
  redacted?: true;
}

export interface SkillExecutionBrokerFilesystemAction {
  kind: "filesystem";
  access: "read" | "write";
  path: string;
  pathDigest: SkillExecutionBrokerDigestRef;
  redacted?: true;
}

export interface SkillExecutionBrokerNetworkAction {
  kind: "network";
  host: string;
  hostDigest: SkillExecutionBrokerDigestRef;
  urlRedacted?: true;
  redacted?: true;
}

export interface SkillExecutionBrokerSecretAction {
  kind: "secret";
  nameDigest: SkillExecutionBrokerDigestRef;
  redacted: true;
}

export type SkillExecutionBrokerRedactedAction =
  | SkillExecutionBrokerShellAction
  | SkillExecutionBrokerFilesystemAction
  | SkillExecutionBrokerNetworkAction
  | SkillExecutionBrokerSecretAction;

export interface SkillExecutionBrokerEvent {
  id: string;
  kind: "skill_execution_broker_decision";
  timestamp: string;
  skill: SkillExecutionBrokerSkillRef;
  action: SkillExecutionBrokerRedactedAction;
  decision: SkillExecutionBrokerDecision;
  permissionDecision: SkillPermissionRiskDecision;
  reason: SkillExecutionBrokerReason;
  matchedPermission?: string;
}

export interface SkillExecutionBrokerReceipt {
  id: string;
  kind: "skill_execution_broker";
  capturedAt: string;
  status: SkillExecutionBrokerStatus;
  label: string;
  eventId: string;
  skill: SkillExecutionBrokerSkillRef;
  action: SkillExecutionBrokerRedactedAction;
  decision: SkillExecutionBrokerDecision;
  permissionDecision: SkillPermissionRiskDecision;
  reason: SkillExecutionBrokerReason;
  matchedPermission?: string;
}

export interface SkillExecutionBrokerResult {
  allowed: boolean;
  decision: SkillExecutionBrokerDecision;
  permission: SkillRuntimePermissionCheck;
  event: SkillExecutionBrokerEvent;
  receipt: SkillExecutionBrokerReceipt;
}

interface ResolvedBrokerInput {
  manifest: SkillManifest;
  skill: SkillExecutionBrokerSkillRef;
}

export class SkillExecutionBroker {
  private readonly manifest: SkillManifest;
  private readonly skill: SkillExecutionBrokerSkillRef;
  private readonly now: () => Date;
  private readonly createId: SkillExecutionBrokerIdFactory;
  private readonly redactions: readonly string[];
  private readonly onEvent?: (event: SkillExecutionBrokerEvent) => void;
  private readonly onReceipt?: (receipt: SkillExecutionBrokerReceipt) => void;
  private readonly events: SkillExecutionBrokerEvent[] = [];
  private readonly receipts: SkillExecutionBrokerReceipt[] = [];

  constructor(input: SkillExecutionBrokerInput, options: SkillExecutionBrokerOptions = {}) {
    const resolved = resolveBrokerInput(input);
    this.manifest = resolved.manifest;
    this.skill = resolved.skill;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? createBrokerId;
    this.redactions = options.redactions ?? [];
    this.onEvent = options.onEvent;
    this.onReceipt = options.onReceipt;
  }

  requestAction(action: SkillRuntimeAction): SkillExecutionBrokerResult {
    const permission = checkSkillRuntimePermission(this.manifest, action);
    const decision: SkillExecutionBrokerDecision = permission.decision === "allow" ? "allow" : "deny";
    const timestamp = this.now().toISOString();
    const redactedAction = redactAction(action, this.redactions);
    const reason = redactReason(action, permission.reason, this.redactions);
    const matchedPermission =
      permission.matchedPermission === undefined
        ? undefined
        : redactPermissionValue(action, permission.matchedPermission, this.redactions);

    const event: SkillExecutionBrokerEvent = {
      id: this.createId("event"),
      kind: "skill_execution_broker_decision",
      timestamp,
      skill: this.skill,
      action: redactedAction,
      decision,
      permissionDecision: permission.decision,
      reason,
      ...(matchedPermission === undefined ? {} : { matchedPermission })
    };
    const receipt: SkillExecutionBrokerReceipt = {
      id: this.createId("receipt"),
      kind: "skill_execution_broker",
      capturedAt: timestamp,
      status: decision === "allow" ? "allowed" : "denied",
      label: `${decision === "allow" ? "Allowed" : "Denied"} ${action.kind} action`,
      eventId: event.id,
      skill: this.skill,
      action: redactedAction,
      decision,
      permissionDecision: permission.decision,
      reason,
      ...(matchedPermission === undefined ? {} : { matchedPermission })
    };

    this.events.push(event);
    this.receipts.push(receipt);
    this.onEvent?.(event);
    this.onReceipt?.(receipt);

    return {
      allowed: decision === "allow",
      decision,
      permission,
      event,
      receipt
    };
  }

  requestShell(command: string | Pick<SkillShellRuntimeAction, "command">): SkillExecutionBrokerResult {
    return this.requestAction(skillShellAction(typeof command === "string" ? command : command.command));
  }

  requestFilesystem(action: Omit<SkillFilesystemRuntimeAction, "kind">): SkillExecutionBrokerResult {
    return this.requestAction(skillFilesystemAction(action.access, action.path));
  }

  requestFileRead(path: string): SkillExecutionBrokerResult {
    return this.requestAction(skillFileReadAction(path));
  }

  requestFileWrite(path: string): SkillExecutionBrokerResult {
    return this.requestAction(skillFileWriteAction(path));
  }

  requestNetwork(target: string | Omit<SkillNetworkRuntimeAction, "kind">): SkillExecutionBrokerResult {
    return this.requestAction(skillNetworkAction(target));
  }

  requestSecret(name: string | Pick<SkillSecretRuntimeAction, "name">): SkillExecutionBrokerResult {
    return this.requestAction(skillSecretAction(typeof name === "string" ? name : name.name));
  }

  getEvents(): SkillExecutionBrokerEvent[] {
    return [...this.events];
  }

  getReceipts(): SkillExecutionBrokerReceipt[] {
    return [...this.receipts];
  }
}

export function createSkillExecutionBroker(
  input: SkillExecutionBrokerInput,
  options: SkillExecutionBrokerOptions = {}
): SkillExecutionBroker {
  return new SkillExecutionBroker(input, options);
}

export function skillShellAction(command: string): SkillShellRuntimeAction {
  return {
    kind: "shell",
    command
  };
}

export function skillFilesystemAction(
  access: SkillFilesystemRuntimeAction["access"],
  path: string
): SkillFilesystemRuntimeAction {
  return {
    kind: "filesystem",
    access,
    path
  };
}

export function skillFileReadAction(path: string): SkillFilesystemRuntimeAction {
  return skillFilesystemAction("read", path);
}

export function skillFileWriteAction(path: string): SkillFilesystemRuntimeAction {
  return skillFilesystemAction("write", path);
}

export function skillNetworkAction(target: string | Omit<SkillNetworkRuntimeAction, "kind">): SkillNetworkRuntimeAction {
  if (typeof target === "string") {
    return target.includes("://")
      ? {
          kind: "network",
          url: target
        }
      : {
          kind: "network",
          host: target
        };
  }

  if ("url" in target && typeof target.url === "string" && target.url.length > 0) {
    return {
      kind: "network",
      url: target.url,
      ...("host" in target && typeof target.host === "string" ? { host: target.host } : {})
    };
  }

  return {
    kind: "network",
    host: "host" in target && typeof target.host === "string" ? target.host : ""
  };
}

export function skillSecretAction(name: string): SkillSecretRuntimeAction {
  return {
    kind: "secret",
    name
  };
}

function resolveBrokerInput(input: SkillExecutionBrokerInput): ResolvedBrokerInput {
  if (isInspection(input)) {
    return {
      manifest: input.manifest,
      skill: createSkillRef(
        input.manifest,
        input.digest ?? digestSkillManifest(input.manifest),
        input.signature,
        input.permissions
      )
    };
  }

  return {
    manifest: input,
    skill: createSkillRef(input, digestSkillManifest(input))
  };
}

function isInspection(input: SkillExecutionBrokerInput): input is SkillExecutionBrokerManifestInspection {
  return "manifest" in input;
}

function createSkillRef(
  manifest: SkillManifest,
  digest: SkillManifestDigest,
  signature?: SkillSignatureVerification,
  permissions?: SkillPermissionRiskSummary
): SkillExecutionBrokerSkillRef {
  return {
    name: manifest.name,
    version: manifest.version,
    digest: digestRef(digest.value),
    signatureStatus: signature?.status,
    permissionDecision: permissions?.decision
  };
}

function redactAction(action: SkillRuntimeAction, redactions: readonly string[]): SkillExecutionBrokerRedactedAction {
  if (action.kind === "shell") {
    const command = redactText(action.command, redactions);
    return {
      kind: "shell",
      command,
      commandDigest: digestRef(hashText(action.command)),
      ...(command === action.command ? {} : { redacted: true })
    };
  }

  if (action.kind === "filesystem") {
    const path = redactText(action.path, redactions);
    return {
      kind: "filesystem",
      access: action.access,
      path,
      pathDigest: digestRef(hashText(action.path)),
      ...(path === action.path ? {} : { redacted: true })
    };
  }

  if (action.kind === "network") {
    const host = redactText(networkActionHost(action), redactions);
    return {
      kind: "network",
      host,
      hostDigest: digestRef(hashText(networkActionHost(action))),
      ...(action.url ? { urlRedacted: true } : {}),
      ...(host === networkActionHost(action) ? {} : { redacted: true })
    };
  }

  return {
    kind: "secret",
    nameDigest: digestRef(hashText(action.name)),
    redacted: true
  };
}

function redactReason(
  action: SkillRuntimeAction,
  reason: SkillRuntimePermissionReason,
  redactions: readonly string[]
): SkillExecutionBrokerReason {
  if (reason.value === undefined) {
    return {
      code: reason.code,
      message: reason.message
    };
  }

  const value = redactPermissionValue(action, reason.value, redactions);
  return {
    code: reason.code,
    message: reason.message,
    value,
    ...(value === reason.value ? {} : { redacted: true })
  };
}

function redactPermissionValue(action: SkillRuntimeAction, value: string, redactions: readonly string[]): string {
  if (action.kind === "secret") {
    return `sha256:${hashText(value)}`;
  }

  if (action.kind === "network") {
    return redactText(networkPermissionValue(value), redactions);
  }

  return redactText(value, redactions);
}

function networkPermissionValue(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value;
  }
}

function networkActionHost(action: SkillNetworkRuntimeAction): string {
  if (action.host && action.host.trim().length > 0) {
    return networkPermissionValue(action.host.trim());
  }

  if (action.url && action.url.trim().length > 0) {
    return networkPermissionValue(action.url.trim());
  }

  return "";
}

function redactText(value: string, redactions: readonly string[]): string {
  let redacted = value;
  for (const token of [...redactions].filter((entry) => entry.length > 0).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(token).join("[REDACTED]");
  }

  redacted = redacted.replace(/\b(?:sk|pk|rk)_(?:live|test|proj)?_?[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]");
  redacted = redacted.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu, "$1[REDACTED]");
  redacted = redacted.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Za-z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
    "$1[REDACTED]"
  );

  return redacted;
}

function digestRef(value: string): SkillExecutionBrokerDigestRef {
  return {
    algorithm: "sha256",
    value
  };
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createBrokerId(kind: "event" | "receipt"): string {
  return `skill_broker_${kind}_${randomBytes(6).toString("hex")}`;
}
