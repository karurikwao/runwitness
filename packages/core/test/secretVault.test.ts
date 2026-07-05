import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EncryptedLocalSecretVault, redactKnownSecrets } from "../src/index.js";

const fixedNow = new Date("2026-07-05T12:00:00.000Z");
const laterNow = new Date("2026-07-05T12:05:00.000Z");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("encrypted local secret vault", () => {
  it("round-trips secrets from encrypted durable storage", async () => {
    const rootDir = await createTempVaultDir();
    const secretValue = "sk_live_repo_cleaner_super_secret";
    const passphrase = "correct horse repo cleaner";
    const vault = new EncryptedLocalSecretVault({ rootDir, now: () => fixedNow });

    const saved = await vault.saveSecret({
      workspaceId: "workspace-a",
      secretId: "deploy-token",
      value: secretValue,
      label: "Deploy token",
      metadata: {
        hint: "metadata stays encrypted",
        tokenCopy: secretValue
      },
      key: { passphrase }
    });

    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      throw new Error("expected secret save to succeed");
    }
    expect(saved.descriptor).toMatchObject({
      workspaceId: "workspace-a",
      secretId: "deploy-token",
      label: "Deploy token",
      version: 1,
      redacted: true,
      encrypted: true,
      valueRedacted: true,
      metadataKeyCount: 2,
      metadataRedacted: true
    });

    const rawVaultText = await readAllText(rootDir);
    expect(rawVaultText).not.toContain(secretValue);
    expect(rawVaultText).not.toContain("metadata stays encrypted");
    expect(JSON.stringify(saved.event)).not.toContain(secretValue);
    expect(JSON.stringify(saved.receipt)).not.toContain(secretValue);

    const reopened = new EncryptedLocalSecretVault({ rootDir, now: () => laterNow });
    const listed = await reopened.listSecretDescriptors({ workspaceId: "workspace-a" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      throw new Error("expected descriptor list to succeed");
    }
    expect(listed.descriptors).toEqual([saved.descriptor]);
    expect(JSON.stringify(listed.event)).not.toContain(secretValue);

    const loaded = await reopened.loadSecret({
      workspaceId: "workspace-a",
      secretId: "deploy-token",
      key: { passphrase }
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      throw new Error("expected secret load to succeed");
    }
    expect(loaded.value).toBe(secretValue);
    expect(loaded.metadata).toEqual({
      hint: "metadata stays encrypted",
      tokenCopy: secretValue
    });
    expect(loaded.descriptor).toEqual(saved.descriptor);
    expect(JSON.stringify(loaded.event)).not.toContain(secretValue);
    expect(JSON.stringify(loaded.receipt)).not.toContain(secretValue);
  });

  it("fails closed with the wrong key and keeps descriptors redacted", async () => {
    const rootDir = await createTempVaultDir();
    const secretValue = "ghp_repo_cleaner_wrong_key_secret";
    const vault = new EncryptedLocalSecretVault({ rootDir, now: () => fixedNow });

    await vault.saveSecret({
      workspaceId: "workspace-a",
      secretId: "github-token",
      value: secretValue,
      key: { passphrase: "right key" }
    });

    const denied = await vault.loadSecret({
      workspaceId: "workspace-a",
      secretId: "github-token",
      key: { passphrase: "wrong key" }
    });

    expect(denied).toMatchObject({
      ok: false,
      reason: "decrypt_failed",
      descriptor: {
        workspaceId: "workspace-a",
        secretId: "github-token",
        redacted: true,
        encrypted: true,
        valueRedacted: true
      },
      event: {
        kind: "secret_vault_access",
        action: "load",
        result: "denied"
      }
    });
    expect(JSON.stringify(denied)).not.toContain(secretValue);
    expect("value" in denied).toBe(false);
  });

  it("deletes descriptors without exposing secret values", async () => {
    const rootDir = await createTempVaultDir();
    const secretValue = "delete_me_without_leaking";
    const vault = new EncryptedLocalSecretVault({ rootDir, now: () => fixedNow });

    await vault.saveSecret({
      workspaceId: "workspace-a",
      secretId: "temporary-token",
      value: secretValue,
      key: { passphrase: "delete key" }
    });

    const deleted = await vault.deleteSecret({
      workspaceId: "workspace-a",
      secretId: "temporary-token"
    });

    expect(deleted.ok).toBe(true);
    if (!deleted.ok) {
      throw new Error("expected secret delete to succeed");
    }
    expect(deleted.descriptor).toMatchObject({
      secretId: "temporary-token",
      redacted: true,
      encrypted: true,
      valueRedacted: true
    });
    expect(JSON.stringify(deleted.event)).not.toContain(secretValue);
    expect(JSON.stringify(deleted.receipt)).not.toContain(secretValue);

    const listed = await vault.listSecretDescriptors({ workspaceId: "workspace-a" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      throw new Error("expected descriptor list to succeed");
    }
    expect(listed.descriptors).toEqual([]);
  });
});

describe("known secret redaction", () => {
  it("scrubs known secret values from strings and records", () => {
    const secretValue = "tok_repo_cleaner:pa/ss word";
    const redactedString = redactKnownSecrets(
      `stdout=${secretValue} url=https://user:${encodeURIComponent(secretValue)}@example.test`,
      [secretValue]
    );

    expect(redactedString).not.toContain(secretValue);
    expect(redactedString).not.toContain(encodeURIComponent(secretValue));
    expect(redactedString).toContain("[REDACTED_SECRET]");

    const redactedRecord = redactKnownSecrets(
      {
        stdout: `token ${secretValue}`,
        nested: {
          [`${secretValue}-key`]: "secret in object key",
          stderr: `escaped ${JSON.stringify(secretValue).slice(1, -1)}`
        },
        values: ["safe", secretValue]
      },
      [{ value: secretValue, replacement: "<secret>" }]
    );
    const redactedJson = JSON.stringify(redactedRecord);

    expect(redactedJson).not.toContain(secretValue);
    expect(redactedJson).not.toContain(encodeURIComponent(secretValue));
    expect(redactedJson).toContain("<secret>");
    expect(Object.keys(redactedRecord.nested)).toEqual(["<secret>-key", "stderr"]);
  });
});

async function createTempVaultDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "repo-cleaner-vault-"));
  tempDirs.push(dir);
  return dir;
}

async function readAllText(rootDir: string): Promise<string> {
  const files = await collectFiles(rootDir);
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return contents.join("\n");
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}
