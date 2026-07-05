import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SKILL_MANIFEST_TYPE,
  assessSkillInstall,
  canonicalizeSkillManifest,
  checkSkillRuntimePermission,
  createSkillTrustRegistry,
  inspectSkillManifest,
  parseSkillManifest,
  verifySkillManifestSignature,
  type SkillManifest,
  type SkillManifestSignatureBlock
} from "../src/index.js";

describe("skill trust registry", () => {
  it("classifies valid signatures as self-signed, trusted, or revoked", () => {
    const { fingerprint, manifest } = createSignedManifest();

    expect(verifySkillManifestSignature(manifest)).toMatchObject({
      status: "self-signed",
      publicKeyFingerprint: fingerprint
    });

    const registry = createSkillTrustRegistry({
      trustedKeyFingerprints: [`SHA256:${fingerprint.toUpperCase()}`]
    });
    expect(registry.trustedKeyFingerprints).toEqual([fingerprint]);
    expect(verifySkillManifestSignature(manifest, registry)).toMatchObject({
      status: "trusted",
      publicKeyFingerprint: fingerprint
    });

    expect(
      verifySkillManifestSignature(manifest, {
        trustedKeyFingerprints: [fingerprint],
        revokedKeyFingerprints: [fingerprint]
      })
    ).toMatchObject({
      status: "revoked",
      publicKeyFingerprint: fingerprint
    });
  });

  it("decides whether install should proceed or quarantine", () => {
    const { fingerprint, manifest } = createSignedManifest();

    expect(assessSkillInstall(manifest)).toMatchObject({
      decision: "quarantine",
      quarantine: true,
      reasons: [{ code: "signature_self_signed" }]
    });

    expect(
      assessSkillInstall(manifest, {
        trustedKeyFingerprints: [fingerprint]
      })
    ).toMatchObject({
      decision: "install",
      quarantine: false,
      reasons: []
    });

    const unsigned = parseSkillManifest(`
name: unsigned-skill
permissions:
  filesystem:
    read:
      - src/**
`);
    expect(assessSkillInstall(unsigned).reasons.map((reason) => reason.code)).toContain("signature_unsigned");

    const broad = createSignedManifest({
      name: "broad-skill",
      permissions: {
        filesystem: {
          write: ["/"]
        }
      }
    });
    expect(
      assessSkillInstall(broad.manifest, {
        trustedKeyFingerprints: [broad.fingerprint]
      }).reasons.map((reason) => reason.code)
    ).toContain("permissions_denied");
  });

  it("keeps inspect output shape compatible", () => {
    const inspected = inspectSkillManifest(`
name: inspect-shape
permissions:
  filesystem:
    read:
      - src/**
`);

    expect(Object.keys(inspected)).toEqual(["manifest", "permissions", "digest", "signature"]);
    expect(inspected.signature.status).toBe("unsigned");
  });
});

describe("skill runtime permission checks", () => {
  it("checks shell, filesystem, network, and secret actions against manifest permissions", () => {
    const manifest = parseSkillManifest(`
name: runtime-skill
permissions:
  filesystem:
    read:
      - src/**
    write:
      - dist/**
  network:
    allow:
      - api.example.invalid
      - "*.trusted.invalid"
  shell:
    allow:
      - npm test
    ask:
      - git push*
    deny:
      - npm publish*
  secrets:
    - DEPLOY_TOKEN
    - RW_*
`);

    expect(checkSkillRuntimePermission(manifest, { kind: "shell", command: "npm   test" })).toMatchObject({
      decision: "allow",
      reason: { code: "shell_allowed" },
      matchedPermission: "npm test"
    });
    expect(checkSkillRuntimePermission(manifest, { kind: "shell", command: "git push origin main" })).toMatchObject({
      decision: "ask",
      reason: { code: "shell_requires_approval" },
      matchedPermission: "git push*"
    });
    expect(checkSkillRuntimePermission(manifest, { kind: "shell", command: "npm publish --access public" })).toMatchObject({
      decision: "deny",
      reason: { code: "shell_denied" },
      matchedPermission: "npm publish*"
    });
    expect(checkSkillRuntimePermission(manifest, { kind: "shell", command: "npm install" })).toMatchObject({
      decision: "deny",
      reason: { code: "shell_undeclared" }
    });

    expect(
      checkSkillRuntimePermission(manifest, { kind: "filesystem", access: "read", path: "src/index.ts" })
    ).toMatchObject({
      decision: "allow",
      reason: { code: "filesystem_allowed" },
      matchedPermission: "src/**"
    });
    expect(
      checkSkillRuntimePermission(manifest, { kind: "filesystem", access: "read", path: "../secrets.txt" })
    ).toMatchObject({
      decision: "deny",
      reason: { code: "filesystem_undeclared" }
    });
    expect(
      checkSkillRuntimePermission(manifest, { kind: "filesystem", access: "write", path: "dist/output.txt" })
    ).toMatchObject({
      decision: "allow",
      matchedPermission: "dist/**"
    });

    expect(
      checkSkillRuntimePermission(manifest, { kind: "network", url: "https://api.example.invalid/v1/run" })
    ).toMatchObject({
      decision: "allow",
      matchedPermission: "api.example.invalid"
    });
    expect(checkSkillRuntimePermission(manifest, { kind: "network", host: "cdn.trusted.invalid" })).toMatchObject({
      decision: "allow",
      matchedPermission: "*.trusted.invalid"
    });
    expect(checkSkillRuntimePermission(manifest, { kind: "network", host: "example.com" })).toMatchObject({
      decision: "deny",
      reason: { code: "network_undeclared" }
    });

    expect(checkSkillRuntimePermission(manifest, { kind: "secret", name: "DEPLOY_TOKEN" })).toMatchObject({
      decision: "allow",
      matchedPermission: "DEPLOY_TOKEN"
    });
    expect(checkSkillRuntimePermission(manifest, { kind: "secret", name: "RW_API_KEY" })).toMatchObject({
      decision: "allow",
      matchedPermission: "RW_*"
    });
    expect(checkSkillRuntimePermission(manifest, { kind: "secret", name: "OTHER_TOKEN" })).toMatchObject({
      decision: "deny",
      reason: { code: "secret_undeclared" }
    });
  });

  it("denies runtime actions when permissions are missing", () => {
    const manifest = parseSkillManifest("name: no-permissions");

    expect(
      checkSkillRuntimePermission(manifest, { kind: "filesystem", access: "read", path: "src/index.ts" })
    ).toMatchObject({
      decision: "deny",
      reason: { code: "permissions_missing" }
    });
  });
});

function createSignedManifest(overrides: Partial<SkillManifest> = {}): { manifest: SkillManifest; fingerprint: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const unsignedManifest: SkillManifest = {
    type: SKILL_MANIFEST_TYPE,
    name: "trusted-skill",
    version: "1.0.0",
    permissions: {
      filesystem: {
        read: ["src/**"]
      }
    },
    ...overrides,
    signature: {
      algorithm: "ed25519",
      publicKey: publicKeyPem
    }
  };
  const signatureValue = sign(
    null,
    Buffer.from(canonicalizeSkillManifest(unsignedManifest), "utf8"),
    privateKey
  ).toString("base64");
  const manifest: SkillManifest = {
    ...unsignedManifest,
    signature: {
      ...(unsignedManifest.signature as SkillManifestSignatureBlock),
      value: signatureValue
    }
  };
  const fingerprint = verifySkillManifestSignature(manifest).publicKeyFingerprint;
  if (!fingerprint) {
    throw new Error("Expected signed test manifest to produce a public key fingerprint");
  }
  return { manifest, fingerprint };
}
