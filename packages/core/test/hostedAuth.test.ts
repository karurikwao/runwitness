import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authenticateHostedBearerToken,
  createHostedBearerCredential,
  exportHostedAuthAuditView,
  generateHostedBearerToken,
  hashHostedBearerToken,
  HostedAuthConfigError,
  loadHostedAuthConfig,
  parseHostedAuthConfig,
  validateHostedAuthConfig
} from "../src/index.js";

const fixedNow = new Date("2026-07-05T12:00:00.000Z");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("hosted auth config helpers", () => {
  it("loads bearer credentials from JSON and hashes environment tokens without leaking them", async () => {
    const root = await createTempDir();
    const configPath = path.join(root, "hosted-auth.json");
    const token = "rwop_release_manager_super_secret_token";
    const expectedHash = hashHostedBearerToken(token);
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          bearerCredentials: [
            {
              id: "release-manager-primary",
              operatorId: "release-manager",
              roles: ["approver", "viewer", "approver"],
              tokenEnv: "RUNWITNESS_RELEASE_TOKEN",
              allowedUsers: ["alice", "alice"],
              allowedWorkspaces: [root],
              metadata: {
                purpose: "release approvals"
              }
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const config = await loadHostedAuthConfig(configPath, {
      env: {
        RUNWITNESS_RELEASE_TOKEN: token
      }
    });

    expect(config.bearerCredentials).toEqual([
      expect.objectContaining({
        id: "release-manager-primary",
        operatorId: "release-manager",
        roles: ["approver", "viewer"],
        allowedUsers: ["alice"],
        allowedWorkspaces: [root],
        tokenHash: expectedHash
      })
    ]);
    expect(JSON.stringify(config)).not.toContain(token);
    expect(JSON.stringify(config)).not.toContain("RUNWITNESS_RELEASE_TOKEN");

    expect(authenticateHostedBearerToken(config, token, { at: fixedNow })).toEqual({
      id: "release-manager",
      roles: ["approver", "viewer"],
      allowedUsers: ["alice"],
      allowedWorkspaces: [root]
    });
    expect(authenticateHostedBearerToken(config, "rwop_wrong_secret_token", { at: fixedNow })).toBeUndefined();

    const audit = exportHostedAuthAuditView(config, { now: () => fixedNow });
    const auditJson = JSON.stringify(audit);
    expect(audit).toMatchObject({
      kind: "hosted_auth_config",
      generatedAt: fixedNow.toISOString(),
      credentialCount: 1,
      credentials: [
        {
          id: "release-manager-primary",
          operatorId: "release-manager",
          roles: ["approver", "viewer"],
          tokenDigest: expectedHash.displayDigest,
          metadataKeyCount: 1,
          metadataRedacted: true
        }
      ]
    });
    expect(audit.configDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(auditJson).not.toContain(token);
    expect(auditJson).not.toContain(expectedHash.sha256);
    expect(auditJson).not.toContain("RUNWITNESS_RELEASE_TOKEN");
    expect(auditJson).not.toContain("release approvals");
  });

  it("creates persistent hashed credential entries and authenticates from the hash", () => {
    const token = generateHostedBearerToken({ byteLength: 24 });
    const credential = createHostedBearerCredential({
      id: "policy-owner-primary",
      operatorId: "policy-owner",
      roles: ["admin"],
      token,
      allowedWorkspaces: ["workspace-a"],
      createdAt: fixedNow.toISOString()
    });

    expect(credential).toMatchObject({
      id: "policy-owner-primary",
      operatorId: "policy-owner",
      roles: ["admin"],
      allowedWorkspaces: ["workspace-a"],
      tokenDigest: hashHostedBearerToken(token).displayDigest
    });
    expect("token" in credential).toBe(false);

    const config = parseHostedAuthConfig({
      version: 1,
      bearerCredentials: [credential]
    });
    expect(authenticateHostedBearerToken(config, token, { at: fixedNow })).toEqual({
      id: "policy-owner",
      roles: ["admin"],
      allowedUsers: undefined,
      allowedWorkspaces: ["workspace-a"]
    });

    const auditJson = JSON.stringify(exportHostedAuthAuditView(config, { now: () => fixedNow }));
    expect(auditJson).not.toContain(token);
    expect(auditJson).not.toContain(hashHostedBearerToken(token).sha256);
    expect(auditJson).toContain(hashHostedBearerToken(token).displayDigest);
  });

  it("reports invalid roles, scopes, and credential sources with field paths", () => {
    const result = validateHostedAuthConfig({
      version: 1,
      bearerCredentials: [
        {
          operatorId: "",
          roles: ["approver", "root"],
          token: "short",
          password: "not-supported",
          allowedUsers: ["alice", ""],
          allowedWorkspaces: "workspace-a,"
        }
      ]
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "bearerCredentials[0]", message: expect.stringContaining("password") }),
        expect.objectContaining({ path: "bearerCredentials[0].operatorId", message: expect.stringContaining("required") }),
        expect.objectContaining({ path: "bearerCredentials[0].roles", message: expect.stringContaining("root") }),
        expect.objectContaining({ path: "bearerCredentials[0].token", message: expect.stringContaining("at least") }),
        expect.objectContaining({ path: "bearerCredentials[0].allowedUsers[1]", message: "must not be empty" }),
        expect.objectContaining({ path: "bearerCredentials[0].allowedWorkspaces[1]", message: "must not be empty" })
      ])
    );

    expect(() =>
      parseHostedAuthConfig({
        version: 1,
        bearerCredentials: []
      })
    ).toThrow(HostedAuthConfigError);
  });

  it("does not authenticate disabled or expired credentials", () => {
    const disabledToken = "rwop_disabled_operator_secret";
    const expiredToken = "rwop_expired_operator_secret";
    const activeToken = "rwop_active_operator_secret";
    const config = parseHostedAuthConfig({
      version: 1,
      bearerCredentials: [
        {
          operatorId: "disabled",
          roles: ["admin"],
          tokenSha256: hashHostedBearerToken(disabledToken).sha256,
          disabled: true
        },
        {
          operatorId: "expired",
          roles: ["approver"],
          tokenSha256: hashHostedBearerToken(expiredToken).sha256,
          expiresAt: "2026-07-05T11:59:59.000Z"
        },
        {
          operatorId: "active",
          roles: ["viewer"],
          tokenSha256: hashHostedBearerToken(activeToken).sha256,
          expiresAt: "2026-07-05T12:30:00.000Z"
        }
      ]
    });

    expect(authenticateHostedBearerToken(config, disabledToken, { at: fixedNow })).toBeUndefined();
    expect(authenticateHostedBearerToken(config, expiredToken, { at: fixedNow })).toBeUndefined();
    expect(authenticateHostedBearerToken(config, activeToken, { at: fixedNow })).toMatchObject({
      id: "active",
      roles: ["viewer"]
    });
  });
});

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-hosted-auth-"));
  tempDirs.push(dir);
  return dir;
}
