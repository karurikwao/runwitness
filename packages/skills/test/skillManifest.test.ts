import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SKILL_MANIFEST_TYPE,
  canonicalizeSkillManifest,
  digestSkillManifest,
  parseSkillManifest,
  summarizeSkillPermissionRisk,
  verifySkillManifestSignature,
  type SkillManifest,
  type SkillManifestSignatureBlock
} from "../src/index.js";

describe("skill manifests", () => {
  it("parses YAML manifests and normalizes the manifest type and name", () => {
    const manifest = parseSkillManifest(`
name: "  example-skill  "
version: 1.2.3
permissions:
  filesystem:
    read:
      - src
`);

    expect(manifest).toMatchObject({
      type: SKILL_MANIFEST_TYPE,
      name: "example-skill",
      version: "1.2.3"
    });
  });

  it("rejects unsupported manifest types", () => {
    expect(() =>
      parseSkillManifest(`
type: other.skill.v1
name: example-skill
`)
    ).toThrow(/Unsupported skill manifest type/);
  });

  it("summarizes permission risk from declared permissions", () => {
    const manifest = parseSkillManifest(`
name: risky-skill
permissions:
  filesystem:
    write:
      - /
  network:
    allow:
      - "*"
  shell:
    allow:
      - git push origin main
  secrets:
    - deploy_token
`);

    const risk = summarizeSkillPermissionRisk(manifest);

    expect(risk.decision).toBe("deny");
    expect(risk.severity).toBe("critical");
    expect(risk.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "filesystem_write_broad",
        "network_allow_wildcard",
        "shell_allow_high_impact",
        "secret_access"
      ])
    );
  });

  it("treats missing permissions as approval-worthy", () => {
    const manifest = parseSkillManifest("name: undeclared-skill");

    expect(summarizeSkillPermissionRisk(manifest)).toMatchObject({
      decision: "ask",
      severity: "medium",
      reasons: [{ code: "permissions_missing" }]
    });
  });

  it("creates a stable canonical digest that omits the signature value", () => {
    const first = parseSkillManifest(`
name: stable-skill
version: 1.0.0
signature:
  algorithm: ed25519
  value: first-signature
permissions:
  network:
    allow:
      - api.example.invalid
`);
    const second = parseSkillManifest(`
signature:
  value: second-signature
  algorithm: ed25519
permissions:
  network:
    allow:
      - api.example.invalid
version: 1.0.0
name: stable-skill
`);

    const firstDigest = digestSkillManifest(first);
    const secondDigest = digestSkillManifest(second);

    expect(firstDigest.value).toBe(secondDigest.value);
    expect(firstDigest.canonical).toBe(secondDigest.canonical);
    expect(firstDigest.canonical).toContain('"algorithm":"ed25519"');
    expect(firstDigest.canonical).not.toContain("first-signature");
    expect(firstDigest.canonical).not.toContain("second-signature");
  });

  it("verifies Ed25519 signatures over the canonical manifest", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const manifest: SkillManifest = {
      type: SKILL_MANIFEST_TYPE,
      name: "signed-skill",
      version: "1.0.0",
      permissions: {
        network: {
          allow: ["api.example.invalid"]
        }
      },
      signature: {
        algorithm: "ed25519",
        publicKey: publicKeyPem
      }
    };
    const signatureValue = sign(null, Buffer.from(canonicalizeSkillManifest(manifest), "utf8"), privateKey).toString(
      "base64"
    );
    const signedManifest: SkillManifest = {
      ...manifest,
      signature: {
        ...(manifest.signature as SkillManifestSignatureBlock),
        value: signatureValue
      }
    };

    expect(verifySkillManifestSignature(signedManifest)).toMatchObject({
      status: "valid",
      algorithm: "ed25519"
    });

    expect(
      verifySkillManifestSignature({
        ...signedManifest,
        description: "tampered after signing"
      })
    ).toMatchObject({
      status: "invalid",
      reason: "Signature does not match the canonical skill manifest."
    });
  });

  it("verifies top-level publicKey plus string signature manifests", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const unsignedManifest: SkillManifest = {
      type: SKILL_MANIFEST_TYPE,
      name: "top-level-signed-skill",
      publicKey: publicKeyPem,
      permissions: {
        filesystem: {
          read: ["src"]
        }
      }
    };
    const signatureValue = sign(
      null,
      Buffer.from(canonicalizeSkillManifest(unsignedManifest), "utf8"),
      privateKey
    ).toString("base64");

    expect(
      verifySkillManifestSignature({
        ...unsignedManifest,
        signature: signatureValue
      })
    ).toMatchObject({
      status: "valid",
      algorithm: "ed25519"
    });
  });
});
