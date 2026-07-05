import { createHash, createPublicKey, verify as verifyNodeSignature } from "node:crypto";
import YAML from "yaml";

export const SKILL_MANIFEST_TYPE = "runwitness.skill.v1" as const;

export type SkillManifestType = typeof SKILL_MANIFEST_TYPE;
export type SkillSignatureAlgorithm = "ed25519";
export type EncodedBytesFormat = "base64" | "base64url" | "hex";
export type PublicKeyFormat = "pem" | "base64" | "base64url";
export type SkillPermissionRiskSeverity = "low" | "medium" | "high" | "critical";
export type SkillPermissionRiskDecision = "allow" | "ask" | "deny";

export interface SkillManifestSignatureBlock {
  algorithm?: SkillSignatureAlgorithm | string;
  publicKey?: string;
  publicKeyFormat?: PublicKeyFormat;
  value?: string;
  encoding?: EncodedBytesFormat;
}

export type SkillManifestSignature = string | SkillManifestSignatureBlock;

export interface SkillManifest {
  type: SkillManifestType;
  name: string;
  version?: string;
  description?: string;
  permissions?: {
    filesystem?: {
      read?: string[];
      write?: string[];
    };
    network?: {
      allow?: string[];
    };
    shell?: {
      allow?: string[];
      ask?: string[];
      deny?: string[];
    };
    secrets?: string[];
  };
  entrypoints?: Record<string, string>;
  author?: string;
  publicKey?: string;
  publicKeyFormat?: PublicKeyFormat;
  signature?: SkillManifestSignature;
}

export interface SkillPermissionRiskReason {
  code: string;
  severity: SkillPermissionRiskSeverity;
  message: string;
  value?: string;
}

export interface SkillPermissionRiskSummary {
  decision: SkillPermissionRiskDecision;
  severity: SkillPermissionRiskSeverity;
  reasons: SkillPermissionRiskReason[];
}

export interface SkillManifestDigest {
  algorithm: "sha256";
  value: string;
  canonical: string;
}

export type SkillSignatureVerificationStatus = "unsigned" | "valid" | "invalid" | "unsupported";

export interface SkillSignatureVerification {
  status: SkillSignatureVerificationStatus;
  algorithm?: string;
  digest: SkillManifestDigest;
  publicKeyFingerprint?: string;
  reason?: string;
}

type JsonScalar = string | number | boolean | null;
type CanonicalJson = JsonScalar | CanonicalJson[] | { [key: string]: CanonicalJson };

const severityRank: Record<SkillPermissionRiskSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

const broadFilesystemScopes = new Set([
  "*",
  "**",
  "**/*",
  ".",
  "./",
  "/",
  "/*",
  "~",
  "~/",
  "~/*",
  "$home",
  "$home/*",
  "%userprofile%",
  "%userprofile%/*"
]);

const wildcardNetworkScopes = new Set(["*", "**", "0.0.0.0/0", "::/0"]);

const highImpactShellPatterns = [
  /\brm\b.*\s-rf\b/i,
  /\brm\b.*--recursive\b.*--force\b/i,
  /\bdel\b.*\/s\b/i,
  /\bremove-item\b.*-recurse\b/i,
  /\bcurl\b.*\|\s*(sh|bash|pwsh|powershell)\b/i,
  /\biwr\b.*\|\s*iex\b/i,
  /\binvoke-webrequest\b.*\|\s*invoke-expression\b/i,
  /\bgit\s+push\b/i
];

export function parseSkillManifest(source: string): SkillManifest {
  const parsed = YAML.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Skill manifest must be a mapping");
  }

  const manifest = parsed as Partial<SkillManifest>;
  if (manifest.type !== undefined && manifest.type !== SKILL_MANIFEST_TYPE) {
    throw new Error(`Unsupported skill manifest type: ${String(manifest.type)}`);
  }
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new Error("Skill manifest requires a non-empty name");
  }

  return {
    ...manifest,
    type: SKILL_MANIFEST_TYPE,
    name: manifest.name.trim()
  };
}

export function summarizeSkillPermissionRisk(manifest: SkillManifest): SkillPermissionRiskSummary {
  const reasons: SkillPermissionRiskReason[] = [];
  const permissions = manifest.permissions;

  if (!permissions) {
    reasons.push({
      code: "permissions_missing",
      severity: "medium",
      message: "Skill manifest does not declare permissions, so requested access is unknown."
    });
    return finishRiskSummary(reasons);
  }

  for (const scope of permissions.filesystem?.read ?? []) {
    if (isBroadFilesystemScope(scope)) {
      reasons.push({
        code: "filesystem_read_broad",
        severity: "high",
        message: "Skill requests broad filesystem read access.",
        value: scope
      });
    }
  }

  for (const scope of permissions.filesystem?.write ?? []) {
    reasons.push({
      code: isBroadFilesystemScope(scope) ? "filesystem_write_broad" : "filesystem_write",
      severity: isBroadFilesystemScope(scope) ? "critical" : "high",
      message: isBroadFilesystemScope(scope)
        ? "Skill requests broad filesystem write access."
        : "Skill requests filesystem write access.",
      value: scope
    });
  }

  for (const scope of permissions.network?.allow ?? []) {
    reasons.push({
      code: isWildcardNetworkScope(scope) ? "network_allow_wildcard" : "network_allow",
      severity: isWildcardNetworkScope(scope) ? "high" : "medium",
      message: isWildcardNetworkScope(scope)
        ? "Skill requests unrestricted network access."
        : "Skill requests network access.",
      value: scope
    });
  }

  for (const command of permissions.shell?.allow ?? []) {
    reasons.push({
      code: highImpactShellPatterns.some((pattern) => pattern.test(command)) ? "shell_allow_high_impact" : "shell_allow",
      severity: highImpactShellPatterns.some((pattern) => pattern.test(command)) ? "critical" : "high",
      message: "Skill pre-declares shell commands that may run without per-command approval.",
      value: command
    });
  }

  for (const command of permissions.shell?.ask ?? []) {
    reasons.push({
      code: "shell_ask",
      severity: "medium",
      message: "Skill declares shell commands that require explicit approval.",
      value: command
    });
  }

  for (const secret of permissions.secrets ?? []) {
    reasons.push({
      code: "secret_access",
      severity: "high",
      message: "Skill requests access to named secrets.",
      value: secret
    });
  }

  return finishRiskSummary(reasons);
}

export function canonicalizeSkillManifest(manifest: SkillManifest): string {
  return stableStringify(toCanonicalJson(stripSignatureValue(manifest)));
}

export function digestSkillManifest(manifest: SkillManifest): SkillManifestDigest {
  const canonical = canonicalizeSkillManifest(manifest);
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(canonical, "utf8").digest("hex"),
    canonical
  };
}

export function verifySkillManifestSignature(manifest: SkillManifest): SkillSignatureVerification {
  const digest = digestSkillManifest(manifest);
  const signature = getSignatureValue(manifest.signature);
  const publicKey = getPublicKeyValue(manifest);

  if (!signature && !publicKey) {
    return { status: "unsigned", digest };
  }

  if (!signature || !publicKey) {
    return {
      status: "invalid",
      digest,
      reason: "Skill signature verification requires both a public key and signature value."
    };
  }

  const algorithm = getSignatureAlgorithm(manifest.signature);
  if (algorithm !== "ed25519") {
    return {
      status: "unsupported",
      algorithm,
      digest,
      reason: `Unsupported skill signature algorithm: ${algorithm}`
    };
  }

  try {
    const publicKeyObject = createPublicKeyObject(publicKey, getPublicKeyFormat(manifest));
    const signatureBytes = decodeBytes(signature, getSignatureEncoding(manifest.signature));
    const verified = verifyNodeSignature(null, Buffer.from(digest.canonical, "utf8"), publicKeyObject, signatureBytes);

    return {
      status: verified ? "valid" : "invalid",
      algorithm,
      digest,
      publicKeyFingerprint: fingerprintPublicKey(publicKeyObject),
      reason: verified ? undefined : "Signature does not match the canonical skill manifest."
    };
  } catch (error) {
    return {
      status: "invalid",
      algorithm,
      digest,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export function inspectSkillManifest(source: string): {
  manifest: SkillManifest;
  permissions: SkillPermissionRiskSummary;
  digest: SkillManifestDigest;
  signature: SkillSignatureVerification;
} {
  const manifest = parseSkillManifest(source);
  const signature = verifySkillManifestSignature(manifest);
  return {
    manifest,
    permissions: summarizeSkillPermissionRisk(manifest),
    digest: signature.digest,
    signature
  };
}

function finishRiskSummary(reasons: SkillPermissionRiskReason[]): SkillPermissionRiskSummary {
  const severity = reasons.reduce<SkillPermissionRiskSeverity>(
    (highest, reason) => (severityRank[reason.severity] > severityRank[highest] ? reason.severity : highest),
    "low"
  );

  return {
    decision: severity === "critical" ? "deny" : severity === "low" ? "allow" : "ask",
    severity,
    reasons
  };
}

function isBroadFilesystemScope(scope: string): boolean {
  const normalized = scope.trim().replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
  if (normalized.length === 0 || broadFilesystemScopes.has(normalized)) {
    return true;
  }
  return /^[a-z]:$/u.test(normalized) || normalized.endsWith(":/") || normalized.includes("**");
}

function isWildcardNetworkScope(scope: string): boolean {
  const normalized = scope.trim().toLowerCase();
  return wildcardNetworkScopes.has(normalized);
}

function stripSignatureValue(manifest: SkillManifest): Record<string, unknown> {
  const { signature, ...rest } = manifest;
  if (!signature) {
    return rest;
  }

  if (typeof signature === "string") {
    return rest;
  }

  const { value: _value, encoding: _encoding, ...signatureMetadata } = signature;
  if (Object.keys(signatureMetadata).length === 0) {
    return rest;
  }

  return {
    ...rest,
    signature: signatureMetadata
  };
}

function toCanonicalJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalJson(item));
  }

  if (typeof value === "object") {
    const result: { [key: string]: CanonicalJson } = {};
    for (const key of Object.keys(value).sort()) {
      const propertyValue = (value as Record<string, unknown>)[key];
      if (propertyValue !== undefined) {
        result[key] = toCanonicalJson(propertyValue);
      }
    }
    return result;
  }

  throw new Error(`Unsupported skill manifest value type: ${typeof value}`);
}

function stableStringify(value: CanonicalJson): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`)
    .join(",")}}`;
}

function getSignatureValue(signature: SkillManifestSignature | undefined): string | undefined {
  if (typeof signature === "string") {
    return signature.trim() || undefined;
  }
  return signature?.value?.trim() || undefined;
}

function getPublicKeyValue(manifest: SkillManifest): string | undefined {
  if (typeof manifest.signature === "object" && manifest.signature?.publicKey) {
    return manifest.signature.publicKey;
  }
  return manifest.publicKey;
}

function getSignatureAlgorithm(signature: SkillManifestSignature | undefined): string {
  if (typeof signature === "object" && signature.algorithm) {
    return signature.algorithm.toLowerCase();
  }
  return "ed25519";
}

function getSignatureEncoding(signature: SkillManifestSignature | undefined): EncodedBytesFormat {
  if (typeof signature === "object" && signature.encoding) {
    return signature.encoding;
  }
  return "base64";
}

function getPublicKeyFormat(manifest: SkillManifest): PublicKeyFormat {
  if (typeof manifest.signature === "object" && manifest.signature.publicKeyFormat) {
    return manifest.signature.publicKeyFormat;
  }
  return manifest.publicKeyFormat ?? "pem";
}

function decodeBytes(value: string, encoding: EncodedBytesFormat): Buffer {
  if (encoding === "base64url") {
    return Buffer.from(value, "base64url");
  }
  return Buffer.from(value, encoding);
}

function createPublicKeyObject(publicKey: string, format: PublicKeyFormat): ReturnType<typeof createPublicKey> {
  if (format === "pem") {
    return createPublicKey(publicKey);
  }

  const key = decodeBytes(publicKey, format);
  return createPublicKey({ key, format: "der", type: "spki" });
}

function fingerprintPublicKey(publicKey: ReturnType<typeof createPublicKey>): string {
  const der = publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}
