import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  POLICY_BUNDLE_TYPE,
  acceptPolicyBundle,
  assessPolicyBundleInstall,
  digestPolicyBundle,
  loadPolicyHierarchy,
  parsePolicyBundle,
  policyBundleLayersToPolicyLayerSources,
  signPolicyBundle,
  verifyPolicyBundleSignatures,
  type PolicyBundle
} from "../src/index.js";

describe("policy bundles", () => {
  it("verifies trusted Ed25519 signatures and accepts install", () => {
    const signed = createSignedPolicyBundle();
    const selfSigned = verifyPolicyBundleSignatures(signed.bundle);

    expect(selfSigned).toMatchObject({
      status: "self-signed",
      signatures: [{ status: "self-signed", publicKeyFingerprint: signed.fingerprint }]
    });

    const trusted = verifyPolicyBundleSignatures(signed.bundle, {
      trustedKeyFingerprints: [`SHA256:${signed.fingerprint.toUpperCase()}`]
    });
    expect(trusted).toMatchObject({
      status: "trusted",
      signatures: [{ status: "trusted", publicKeyFingerprint: signed.fingerprint }]
    });

    const assessment = assessPolicyBundleInstall(signed.bundle, {
      trustedKeyFingerprints: [signed.fingerprint]
    });
    expect(assessment).toMatchObject({
      decision: "accept",
      quarantine: false,
      reasons: []
    });
    expect(acceptPolicyBundle(signed.bundle, { trustedKeyFingerprints: [signed.fingerprint] }).layerSources).toEqual(
      policyBundleLayersToPolicyLayerSources(signed.bundle)
    );
  });

  it("normalizes unsigned bundles and quarantines install assessment", () => {
    const bundle = parsePolicyBundle(`
type: ${POLICY_BUNDLE_TYPE}
issuer: local-admin
subject: repo-cleaner
createdAt: 2026-07-05T12:00:00Z
metadata:
  ticket: RW-17
layers:
  - kind: workspace
    label: Workspace defaults
    source: |
      version: 1
      shell:
        ask:
          - git push*
`);

    expect(bundle.createdAt).toBe("2026-07-05T12:00:00.000Z");
    expect(digestPolicyBundle(bundle).value).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyPolicyBundleSignatures(bundle)).toMatchObject({ status: "unsigned" });
    expect(assessPolicyBundleInstall(bundle)).toMatchObject({
      decision: "quarantine",
      quarantine: true,
      reasons: [{ code: "signature_unsigned" }]
    });
  });

  it("rejects tampered signed bundle content", () => {
    const signed = createSignedPolicyBundle();
    const tampered: PolicyBundle = {
      ...signed.bundle,
      layers: [
        {
          ...signed.bundle.layers[0]!,
          source: [
            signed.bundle.layers[0]!.source,
            "shell:",
            "  allow:",
            "    - npm publish*"
          ].join("\n")
        }
      ]
    };

    expect(
      verifyPolicyBundleSignatures(tampered, {
        trustedKeyFingerprints: [signed.fingerprint]
      })
    ).toMatchObject({
      status: "invalid",
      signatures: [{ status: "invalid", reason: "Signature does not match the canonical policy bundle." }]
    });
    expect(
      assessPolicyBundleInstall(tampered, {
        trustedKeyFingerprints: [signed.fingerprint]
      })
    ).toMatchObject({
      decision: "reject",
      quarantine: true,
      reasons: [{ code: "signature_invalid" }]
    });
  });

  it("loads bundle layer sources through the existing policy hierarchy loader", async () => {
    const bundle = parsePolicyBundle(`
type: ${POLICY_BUNDLE_TYPE}
issuer: local-admin
subject: repo-cleaner
createdAt: 2026-07-05T12:00:00Z
layers:
  - kind: workspace
    label: Workspace bundle layer
    source: |
      version: 1
      filesystem:
        write:
          - packages/policy/**
      network:
        allow:
          - workspace.example
  - kind: run-override
    label: Run override bundle layer
    source: |
      version: 1
      shell:
        allow:
          - npm test
      network:
        allow:
          - run.example
`);

    const hierarchy = await loadPolicyHierarchy({
      layers: policyBundleLayersToPolicyLayerSources(bundle)
    });

    expect(hierarchy.layers.map((layer) => layer.kind)).toEqual(["built-in", "workspace", "run-override"]);
    expect(hierarchy.policy.filesystem.write).toEqual([{ path: "packages/policy/**" }]);
    expect(hierarchy.policy.shell.allow).toEqual([{ match: "npm test" }]);
    expect(hierarchy.policy.network.allow).toEqual([{ host: "run.example" }]);
  });
});

function createSignedPolicyBundle(): { bundle: PolicyBundle; fingerprint: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  const unsigned: PolicyBundle = {
    type: POLICY_BUNDLE_TYPE,
    issuer: "local-admin",
    subject: "repo-cleaner",
    createdAt: "2026-07-05T12:00:00.000Z",
    metadata: {
      purpose: "hardening"
    },
    layers: [
      {
        kind: "workspace",
        label: "Workspace bundle layer",
        source: [
          "version: 1",
          "filesystem:",
          "  read:",
          "    - packages/policy/**"
        ].join("\n")
      }
    ]
  };

  const bundle = signPolicyBundle(unsigned, privateKey, { keyId: "test-key" });
  const fingerprint = verifyPolicyBundleSignatures(bundle).signatures[0]?.publicKeyFingerprint;
  if (!fingerprint) {
    throw new Error("Expected signed policy bundle to produce a public key fingerprint");
  }
  return { bundle, fingerprint };
}
