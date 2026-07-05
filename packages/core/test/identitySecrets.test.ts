import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore, LocalSecretBroker } from "../src/index.js";

const fixedNow = new Date("2026-07-05T12:00:00.000Z");

describe("identity and secret isolation", () => {
  it("checks workspace roles and explicit secret grants", () => {
    const identity = new InMemoryIdentityStore({ now: () => fixedNow });
    identity.upsertUser({ id: "owner" });
    identity.upsertUser({ id: "operator" });
    identity.upsertUser({ id: "viewer" });

    identity.grantWorkspace({ userId: "owner", workspaceId: "workspace-a", role: "owner" });
    identity.grantWorkspace({ userId: "operator", workspaceId: "workspace-a", role: "operator" });
    identity.grantWorkspace({ userId: "viewer", workspaceId: "workspace-a", role: "viewer" });

    expect(
      identity.canAccessWorkspace({ userId: "operator", workspaceId: "workspace-a", action: "write" })
    ).toMatchObject({
      allowed: true,
      role: "operator"
    });
    expect(identity.canAccessWorkspace({ userId: "viewer", workspaceId: "workspace-a", action: "write" })).toMatchObject(
      {
        allowed: false,
        reason: "missing_workspace_grant"
      }
    );

    expect(
      identity.canAccessSecret({
        userId: "operator",
        workspaceId: "workspace-a",
        secretId: "deploy-token",
        action: "read"
      })
    ).toMatchObject({
      allowed: false,
      reason: "missing_secret_grant"
    });

    const grant = identity.grantSecret({
      workspaceId: "workspace-a",
      secretId: "deploy-token",
      target: { type: "role", role: "operator" },
      permissions: ["read"]
    });

    expect(
      identity.canAccessSecret({
        userId: "operator",
        workspaceId: "workspace-a",
        secretId: "deploy-token",
        action: "read"
      })
    ).toMatchObject({
      allowed: true,
      grantId: grant.id,
      role: "operator"
    });
    expect(
      identity.canAccessSecret({
        userId: "operator",
        workspaceId: "workspace-a",
        secretId: "billing-token",
        action: "read"
      })
    ).toMatchObject({
      allowed: false,
      reason: "missing_secret_grant"
    });
  });

  it("keeps local secret broker receipts and audit events redacted", () => {
    const identity = new InMemoryIdentityStore({ now: () => fixedNow });
    identity.upsertUser({ id: "owner" });
    identity.upsertUser({ id: "operator" });
    identity.grantWorkspace({ userId: "owner", workspaceId: "workspace-a", role: "owner" });
    identity.grantWorkspace({ userId: "operator", workspaceId: "workspace-a", role: "operator" });
    const broker = new LocalSecretBroker(identity, { now: () => fixedNow });
    const secretValue = "sk_live_phase8_super_secret";

    const stored = broker.putSecret(
      { userId: "owner", runId: "rw_phase8" },
      {
        workspaceId: "workspace-a",
        secretId: "deploy-token",
        value: secretValue,
        label: "Deploy token",
        metadata: { [secretValue]: "metadata key must not leak" }
      }
    );

    expect(stored.ok).toBe(true);
    expect(stored).toMatchObject({
      descriptor: {
        workspaceId: "workspace-a",
        secretId: "deploy-token",
        redacted: true,
        metadataKeyCount: 1,
        metadataRedacted: true
      }
    });
    expect(JSON.stringify(stored.receipt)).not.toContain(secretValue);
    expect(JSON.stringify(stored.event)).not.toContain(secretValue);

    const denied = broker.resolveSecretValue(
      { userId: "operator", runId: "rw_phase8" },
      { workspaceId: "workspace-a", secretId: "deploy-token" }
    );

    expect(denied).toMatchObject({
      ok: false,
      reason: "missing_secret_grant",
      event: {
        kind: "secret_access",
        action: "read",
        result: "denied",
        workspaceId: "workspace-a",
        secretId: "deploy-token"
      }
    });
    expect(JSON.stringify(denied.receipt)).not.toContain(secretValue);
    expect(JSON.stringify(denied.event)).not.toContain(secretValue);

    identity.grantSecret({
      workspaceId: "workspace-a",
      secretId: "deploy-token",
      target: { type: "user", userId: "operator" },
      permissions: ["read", "write"]
    });

    const resolved = broker.resolveSecretValue(
      { userId: "operator", runId: "rw_phase8", stepId: "step_secret" },
      { workspaceId: "workspace-a", secretId: "deploy-token" }
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error("expected secret resolution to be allowed");
    }
    expect(resolved.value).toBe(secretValue);
    expect(resolved.descriptor).toMatchObject({
      redacted: true,
      secretId: "deploy-token",
      metadataKeyCount: 1,
      metadataRedacted: true
    });
    expect(resolved.event).toMatchObject({
      kind: "secret_access",
      action: "read",
      result: "allowed",
      actor: {
        userId: "operator",
        runId: "rw_phase8",
        stepId: "step_secret"
      }
    });
    expect(JSON.stringify(resolved.receipt)).not.toContain(secretValue);
    expect(JSON.stringify(resolved.event)).not.toContain(secretValue);

    const rotatedValue = "sk_live_phase8_rotated_secret";
    const updated = broker.putSecret(
      { userId: "operator", runId: "rw_phase8" },
      {
        workspaceId: "workspace-a",
        secretId: "deploy-token",
        value: rotatedValue
      }
    );
    expect(updated.ok).toBe(true);
    expect(JSON.stringify(updated.receipt)).not.toContain(rotatedValue);

    const deleted = broker.deleteSecret(
      { userId: "operator", runId: "rw_phase8" },
      { workspaceId: "workspace-a", secretId: "deploy-token" }
    );
    expect(deleted).toMatchObject({
      ok: false,
      reason: "missing_secret_grant"
    });
    expect(JSON.stringify(deleted.receipt)).not.toContain(rotatedValue);
  });
});
