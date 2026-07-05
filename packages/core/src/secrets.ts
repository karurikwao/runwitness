import { randomBytes } from "node:crypto";
import type {
  AccessDecision,
  SecretAction,
  SecretGrant,
  SecretGrantAccessRequest,
  SecretGrantInput,
  WorkspaceAccessRequest
} from "./identity.js";

export interface SecretActor {
  userId: string;
  runId?: string;
  stepId?: string;
}

export interface SecretReference {
  workspaceId: string;
  secretId: string;
}

export interface PutSecretInput {
  workspaceId: string;
  secretId?: string;
  value: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface RedactedSecretDescriptor extends SecretReference {
  label?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  redacted: true;
  metadataKeyCount: number;
  metadataRedacted: true;
}

export type SecretBrokerAction = "store" | "describe" | "read" | "delete";
export type SecretAccessResult = "allowed" | "denied";

export interface SecretAccessAuditEvent {
  id: string;
  kind: "secret_access";
  action: SecretBrokerAction;
  result: SecretAccessResult;
  timestamp: string;
  actor: SecretActor;
  workspaceId: string;
  secretId: string;
  descriptor?: RedactedSecretDescriptor;
  reason?: string;
  decision?: Pick<AccessDecision, "reason" | "role" | "grantId">;
}

export interface SecretAccessReceipt {
  kind: "secret_access";
  capturedAt: string;
  status: SecretAccessResult;
  descriptor?: RedactedSecretDescriptor;
  metadata: {
    eventId: string;
    action: SecretBrokerAction;
    userId: string;
    workspaceId: string;
    secretId: string;
    reason?: string;
  };
}

export interface SecretBrokerTrace {
  event: SecretAccessAuditEvent;
  receipt: SecretAccessReceipt;
}

export type SecretBrokerDeniedResult = {
  ok: false;
  reason: string;
  descriptor?: RedactedSecretDescriptor;
} & SecretBrokerTrace;

export type SecretBrokerResult<TSuccess extends object> =
  | ({
      ok: true;
    } & TSuccess &
      SecretBrokerTrace)
  | SecretBrokerDeniedResult;

export interface SecretBrokerAuthorizer {
  canAccessWorkspace(request: WorkspaceAccessRequest): AccessDecision;
  canAccessSecret(request: SecretGrantAccessRequest): AccessDecision;
  grantSecret?(input: SecretGrantInput): SecretGrant;
}

export interface LocalSecretBrokerOptions {
  now?: () => Date;
}

interface StoredSecret extends SecretReference {
  value: string;
  label?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class LocalSecretBroker {
  private readonly secrets = new Map<string, StoredSecret>();
  private readonly now: () => Date;

  constructor(
    private readonly authorizer: SecretBrokerAuthorizer,
    options: LocalSecretBrokerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  putSecret(actor: SecretActor, input: PutSecretInput): SecretBrokerResult<{ descriptor: RedactedSecretDescriptor }> {
    const secretId = input.secretId || createSecretId();
    const existing = this.secrets.get(secretKey(input.workspaceId, secretId));
    const decision = existing
      ? this.authorizer.canAccessSecret({
          userId: actor.userId,
          workspaceId: input.workspaceId,
          secretId,
          action: "write"
        })
      : this.authorizer.canAccessWorkspace({
          userId: actor.userId,
          workspaceId: input.workspaceId,
          action: "admin"
        });

    if (!decision.allowed) {
      return this.denied(actor, "store", input.workspaceId, secretId, decision.reason ?? "access_denied", decision);
    }

    const timestamp = this.now().toISOString();
    const stored: StoredSecret = {
      workspaceId: input.workspaceId,
      secretId,
      value: input.value,
      label: input.label ?? existing?.label,
      metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      version: (existing?.version ?? 0) + 1
    };
    this.secrets.set(secretKey(input.workspaceId, secretId), stored);
    if (!existing) {
      this.authorizer.grantSecret?.({
        workspaceId: input.workspaceId,
        secretId,
        target: { type: "user", userId: actor.userId },
        permissions: ["admin"],
        grantedAt: timestamp,
        grantedBy: actor.userId
      });
    }

    const descriptor = redactSecret(stored);
    return this.allowed(actor, "store", descriptor, { descriptor });
  }

  describeSecret(
    actor: SecretActor,
    reference: SecretReference
  ): SecretBrokerResult<{ descriptor: RedactedSecretDescriptor }> {
    const stored = this.secrets.get(secretKey(reference.workspaceId, reference.secretId));
    if (!stored) {
      return this.denied(actor, "describe", reference.workspaceId, reference.secretId, "secret_not_found");
    }

    const decision = this.authorizer.canAccessSecret({
      userId: actor.userId,
      workspaceId: reference.workspaceId,
      secretId: reference.secretId,
      action: "describe"
    });
    if (!decision.allowed) {
      return this.denied(
        actor,
        "describe",
        reference.workspaceId,
        reference.secretId,
        decision.reason ?? "access_denied",
        decision
      );
    }

    const descriptor = redactSecret(stored);
    return this.allowed(actor, "describe", descriptor, { descriptor });
  }

  resolveSecretValue(
    actor: SecretActor,
    reference: SecretReference
  ): SecretBrokerResult<{ value: string; descriptor: RedactedSecretDescriptor }> {
    const stored = this.secrets.get(secretKey(reference.workspaceId, reference.secretId));
    if (!stored) {
      return this.denied(actor, "read", reference.workspaceId, reference.secretId, "secret_not_found");
    }

    const decision = this.authorizer.canAccessSecret({
      userId: actor.userId,
      workspaceId: reference.workspaceId,
      secretId: reference.secretId,
      action: "read"
    });
    if (!decision.allowed) {
      return this.denied(
        actor,
        "read",
        reference.workspaceId,
        reference.secretId,
        decision.reason ?? "access_denied",
        decision,
        redactSecret(stored)
      );
    }

    const descriptor = redactSecret(stored);
    return this.allowed(actor, "read", descriptor, {
      value: stored.value,
      descriptor
    });
  }

  deleteSecret(actor: SecretActor, reference: SecretReference): SecretBrokerResult<{ descriptor: RedactedSecretDescriptor }> {
    const stored = this.secrets.get(secretKey(reference.workspaceId, reference.secretId));
    if (!stored) {
      return this.denied(actor, "delete", reference.workspaceId, reference.secretId, "secret_not_found");
    }

    const decision = this.authorizer.canAccessSecret({
      userId: actor.userId,
      workspaceId: reference.workspaceId,
      secretId: reference.secretId,
      action: "admin"
    });
    if (!decision.allowed) {
      return this.denied(
        actor,
        "delete",
        reference.workspaceId,
        reference.secretId,
        decision.reason ?? "access_denied",
        decision,
        redactSecret(stored)
      );
    }

    this.secrets.delete(secretKey(reference.workspaceId, reference.secretId));
    const descriptor = redactSecret(stored);
    return this.allowed(actor, "delete", descriptor, { descriptor });
  }

  private allowed<TSuccess extends object>(
    actor: SecretActor,
    action: SecretBrokerAction,
    descriptor: RedactedSecretDescriptor,
    success: TSuccess
  ): SecretBrokerResult<TSuccess> {
    const event = this.createEvent(actor, action, "allowed", descriptor.workspaceId, descriptor.secretId, {
      descriptor
    });
    return {
      ok: true,
      ...success,
      event,
      receipt: createReceipt(event)
    };
  }

  private denied<TSuccess extends object = Record<string, never>>(
    actor: SecretActor,
    action: SecretBrokerAction,
    workspaceId: string,
    secretId: string,
    reason: string,
    decision?: AccessDecision,
    descriptor?: RedactedSecretDescriptor
  ): SecretBrokerResult<TSuccess> {
    const event = this.createEvent(actor, action, "denied", workspaceId, secretId, {
      descriptor,
      reason,
      decision
    });
    return {
      ok: false,
      reason,
      descriptor,
      event,
      receipt: createReceipt(event)
    };
  }

  private createEvent(
    actor: SecretActor,
    action: SecretBrokerAction,
    result: SecretAccessResult,
    workspaceId: string,
    secretId: string,
    details: {
      descriptor?: RedactedSecretDescriptor;
      reason?: string;
      decision?: AccessDecision;
    } = {}
  ): SecretAccessAuditEvent {
    return {
      id: createSecretEventId(),
      kind: "secret_access",
      action,
      result,
      timestamp: this.now().toISOString(),
      actor: { ...actor },
      workspaceId,
      secretId,
      descriptor: details.descriptor,
      reason: details.reason,
      decision: details.decision
        ? {
            reason: details.decision.reason,
            role: details.decision.role,
            grantId: details.decision.grantId
          }
        : undefined
    };
  }
}

export class InMemorySecretBroker extends LocalSecretBroker {}

function createReceipt(event: SecretAccessAuditEvent): SecretAccessReceipt {
  return {
    kind: "secret_access",
    capturedAt: event.timestamp,
    status: event.result,
    descriptor: event.descriptor,
    metadata: {
      eventId: event.id,
      action: event.action,
      userId: event.actor.userId,
      workspaceId: event.workspaceId,
      secretId: event.secretId,
      reason: event.reason
    }
  };
}

function redactSecret(secret: StoredSecret): RedactedSecretDescriptor {
  return {
    workspaceId: secret.workspaceId,
    secretId: secret.secretId,
    label: secret.label,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
    version: secret.version,
    redacted: true,
    metadataKeyCount: Object.keys(secret.metadata).length,
    metadataRedacted: true
  };
}

function secretKey(workspaceId: string, secretId: string): string {
  return `${workspaceId}\0${secretId}`;
}

function createSecretId(): string {
  return `secret_${randomBytes(6).toString("hex")}`;
}

function createSecretEventId(): string {
  return `secret_event_${randomBytes(6).toString("hex")}`;
}
