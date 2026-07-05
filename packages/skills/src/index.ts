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

export type SkillSignatureVerificationStatus =
  | "unsigned"
  | "self-signed"
  | "trusted"
  | "revoked"
  | "invalid"
  | "unsupported";

export interface SkillSignatureVerification {
  status: SkillSignatureVerificationStatus;
  algorithm?: string;
  digest: SkillManifestDigest;
  publicKeyFingerprint?: string;
  reason?: string;
}

export interface SkillTrustRegistry {
  trustedKeyFingerprints?: readonly string[];
  revokedKeyFingerprints?: readonly string[];
}

export interface NormalizedSkillTrustRegistry {
  trustedKeyFingerprints: string[];
  revokedKeyFingerprints: string[];
}

export type SkillInstallDecision = "install" | "quarantine";

export type SkillInstallDecisionReasonCode =
  | "signature_unsigned"
  | "signature_self_signed"
  | "signature_revoked"
  | "signature_invalid"
  | "signature_unsupported"
  | "permissions_missing"
  | "permissions_denied";

export interface SkillInstallDecisionReason {
  code: SkillInstallDecisionReasonCode;
  severity: SkillPermissionRiskSeverity;
  message: string;
  value?: string;
}

export interface SkillInstallAssessment {
  decision: SkillInstallDecision;
  quarantine: boolean;
  reasons: SkillInstallDecisionReason[];
  permissions: SkillPermissionRiskSummary;
  digest: SkillManifestDigest;
  signature: SkillSignatureVerification;
}

export interface SkillShellRuntimeAction {
  kind: "shell";
  command: string;
}

export interface SkillFilesystemRuntimeAction {
  kind: "filesystem";
  access: "read" | "write";
  path: string;
}

export type SkillNetworkRuntimeAction =
  | {
      kind: "network";
      host: string;
      url?: string;
    }
  | {
      kind: "network";
      url: string;
      host?: string;
    };

export interface SkillSecretRuntimeAction {
  kind: "secret";
  name: string;
}

export type SkillRuntimeAction =
  | SkillShellRuntimeAction
  | SkillFilesystemRuntimeAction
  | SkillNetworkRuntimeAction
  | SkillSecretRuntimeAction;

export type SkillRuntimePermissionReasonCode =
  | "permissions_missing"
  | "shell_allowed"
  | "shell_requires_approval"
  | "shell_denied"
  | "shell_undeclared"
  | "filesystem_allowed"
  | "filesystem_undeclared"
  | "network_allowed"
  | "network_undeclared"
  | "secret_allowed"
  | "secret_undeclared";

export interface SkillRuntimePermissionReason {
  code: SkillRuntimePermissionReasonCode;
  message: string;
  value?: string;
}

export interface SkillRuntimePermissionCheck {
  action: SkillRuntimeAction;
  decision: SkillPermissionRiskDecision;
  reason: SkillRuntimePermissionReason;
  matchedPermission?: string;
}

type JsonScalar = string | number | boolean | null;
type CanonicalJson = JsonScalar | CanonicalJson[] | { [key: string]: CanonicalJson };

const severityRank: Record<SkillPermissionRiskSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

const permissionDecisionRank: Record<SkillPermissionRiskDecision, number> = {
  allow: 0,
  ask: 1,
  deny: 2
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

export function createSkillTrustRegistry(registry: SkillTrustRegistry = {}): NormalizedSkillTrustRegistry {
  return {
    trustedKeyFingerprints: normalizeKeyFingerprints(registry.trustedKeyFingerprints ?? []),
    revokedKeyFingerprints: normalizeKeyFingerprints(registry.revokedKeyFingerprints ?? [])
  };
}

export function verifySkillManifestSignature(
  manifest: SkillManifest,
  trustRegistry?: SkillTrustRegistry
): SkillSignatureVerification {
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
    const publicKeyFingerprint = fingerprintPublicKey(publicKeyObject);

    if (!verified) {
      return {
        status: "invalid",
        algorithm,
        digest,
        publicKeyFingerprint,
        reason: "Signature does not match the canonical skill manifest."
      };
    }

    const trust = resolveKeyTrust(publicKeyFingerprint, trustRegistry);
    return {
      status: trust.status,
      algorithm,
      digest,
      publicKeyFingerprint,
      reason: trust.reason
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

export function assessSkillInstall(manifest: SkillManifest, trustRegistry?: SkillTrustRegistry): SkillInstallAssessment {
  const signature = verifySkillManifestSignature(manifest, trustRegistry);
  const permissions = summarizeSkillPermissionRisk(manifest);
  const reasons: SkillInstallDecisionReason[] = [];

  if (signature.status === "unsigned") {
    reasons.push({
      code: "signature_unsigned",
      severity: "high",
      message: "Skill manifest is unsigned and cannot be linked to a trusted local key."
    });
  } else if (signature.status === "self-signed") {
    reasons.push({
      code: "signature_self_signed",
      severity: "medium",
      message: "Skill signature is valid, but its key is not trusted in the local registry.",
      value: signature.publicKeyFingerprint
    });
  } else if (signature.status === "revoked") {
    reasons.push({
      code: "signature_revoked",
      severity: "critical",
      message: "Skill signing key fingerprint is revoked in the local registry.",
      value: signature.publicKeyFingerprint
    });
  } else if (signature.status === "invalid") {
    reasons.push({
      code: "signature_invalid",
      severity: "critical",
      message: signature.reason ?? "Skill manifest signature is invalid.",
      value: signature.publicKeyFingerprint
    });
  } else if (signature.status === "unsupported") {
    reasons.push({
      code: "signature_unsupported",
      severity: "high",
      message: signature.reason ?? "Skill manifest uses an unsupported signature algorithm.",
      value: signature.algorithm
    });
  }

  if (permissions.reasons.some((reason) => reason.code === "permissions_missing")) {
    reasons.push({
      code: "permissions_missing",
      severity: "high",
      message: "Skill manifest does not declare runtime permissions."
    });
  }

  if (permissions.decision === "deny") {
    reasons.push({
      code: "permissions_denied",
      severity: permissions.severity,
      message: "Skill manifest declares permissions that are too broad for automatic install."
    });
  }

  const decision: SkillInstallDecision = reasons.length > 0 ? "quarantine" : "install";
  return {
    decision,
    quarantine: decision === "quarantine",
    reasons,
    permissions,
    digest: signature.digest,
    signature
  };
}

export function checkSkillRuntimePermission(
  manifest: SkillManifest,
  action: SkillRuntimeAction
): SkillRuntimePermissionCheck {
  if (!manifest.permissions) {
    return runtimePermissionDecision(action, "deny", {
      code: "permissions_missing",
      message: "Skill manifest does not declare runtime permissions."
    });
  }

  if (action.kind === "shell") {
    return checkShellRuntimePermission(manifest, action);
  }

  if (action.kind === "filesystem") {
    return checkFilesystemRuntimePermission(manifest, action);
  }

  if (action.kind === "network") {
    return checkNetworkRuntimePermission(manifest, action);
  }

  return checkSecretRuntimePermission(manifest, action);
}

export function inspectSkillManifest(source: string, trustRegistry?: SkillTrustRegistry): {
  manifest: SkillManifest;
  permissions: SkillPermissionRiskSummary;
  digest: SkillManifestDigest;
  signature: SkillSignatureVerification;
} {
  const manifest = parseSkillManifest(source);
  const signature = verifySkillManifestSignature(manifest, trustRegistry);
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

function resolveKeyTrust(
  publicKeyFingerprint: string,
  trustRegistry: SkillTrustRegistry | undefined
): Pick<SkillSignatureVerification, "status" | "reason"> {
  const registry = createSkillTrustRegistry(trustRegistry);
  const fingerprint = normalizeKeyFingerprint(publicKeyFingerprint);

  if (registry.revokedKeyFingerprints.includes(fingerprint)) {
    return {
      status: "revoked",
      reason: "Signing key fingerprint is revoked in the local trust registry."
    };
  }

  if (registry.trustedKeyFingerprints.includes(fingerprint)) {
    return { status: "trusted" };
  }

  return {
    status: "self-signed",
    reason: "Signature is valid, but the signing key is not trusted locally."
  };
}

function normalizeKeyFingerprints(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizeKeyFingerprint(value)).filter((value) => value.length > 0))];
}

function normalizeKeyFingerprint(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("sha256:") ? normalized.slice("sha256:".length) : normalized;
}

function checkShellRuntimePermission(
  manifest: SkillManifest,
  action: SkillShellRuntimeAction
): SkillRuntimePermissionCheck {
  const permissions = manifest.permissions;
  const matches = [
    ...collectShellRuntimeMatches(action.command, permissions?.shell?.allow ?? [], "allow"),
    ...collectShellRuntimeMatches(action.command, permissions?.shell?.ask ?? [], "ask"),
    ...collectShellRuntimeMatches(action.command, permissions?.shell?.deny ?? [], "deny")
  ];
  const strongestMatch = strongestRuntimeMatch(matches);

  if (!strongestMatch) {
    return runtimePermissionDecision(action, "deny", {
      code: "shell_undeclared",
      message: "Shell command is not declared in skill permissions.",
      value: action.command
    });
  }

  if (strongestMatch.decision === "deny") {
    return runtimePermissionDecision(
      action,
      "deny",
      {
        code: "shell_denied",
        message: "Shell command matches a denied skill permission.",
        value: strongestMatch.pattern
      },
      strongestMatch.pattern
    );
  }

  if (strongestMatch.decision === "ask") {
    return runtimePermissionDecision(
      action,
      "ask",
      {
        code: "shell_requires_approval",
        message: "Shell command requires approval by skill manifest permission.",
        value: strongestMatch.pattern
      },
      strongestMatch.pattern
    );
  }

  return runtimePermissionDecision(
    action,
    "allow",
    {
      code: "shell_allowed",
      message: "Shell command matches an allowed skill permission.",
      value: strongestMatch.pattern
    },
    strongestMatch.pattern
  );
}

function checkFilesystemRuntimePermission(
  manifest: SkillManifest,
  action: SkillFilesystemRuntimeAction
): SkillRuntimePermissionCheck {
  const scopes = action.access === "read" ? manifest.permissions?.filesystem?.read ?? [] : manifest.permissions?.filesystem?.write ?? [];
  const matchedScope = scopes.find((scope) => pathMatchesScope(action.path, scope));

  if (!matchedScope) {
    return runtimePermissionDecision(action, "deny", {
      code: "filesystem_undeclared",
      message: `Filesystem ${action.access} path is outside declared skill permissions.`,
      value: action.path
    });
  }

  return runtimePermissionDecision(
    action,
    "allow",
    {
      code: "filesystem_allowed",
      message: `Filesystem ${action.access} path matches a declared skill permission.`,
      value: matchedScope
    },
    matchedScope
  );
}

function checkNetworkRuntimePermission(
  manifest: SkillManifest,
  action: SkillNetworkRuntimeAction
): SkillRuntimePermissionCheck {
  const host = networkRuntimeActionHost(action);
  const matchedAllow = manifest.permissions?.network?.allow?.find((allow) => networkHostMatches(host, allow));

  if (!matchedAllow) {
    return runtimePermissionDecision(action, "deny", {
      code: "network_undeclared",
      message: "Network host is outside declared skill permissions.",
      value: host
    });
  }

  return runtimePermissionDecision(
    action,
    "allow",
    {
      code: "network_allowed",
      message: "Network host matches a declared skill permission.",
      value: matchedAllow
    },
    matchedAllow
  );
}

function checkSecretRuntimePermission(
  manifest: SkillManifest,
  action: SkillSecretRuntimeAction
): SkillRuntimePermissionCheck {
  const matchedSecret = manifest.permissions?.secrets?.find((secret) => secretScopeMatches(action.name, secret));

  if (!matchedSecret) {
    return runtimePermissionDecision(action, "deny", {
      code: "secret_undeclared",
      message: "Secret name is outside declared skill permissions.",
      value: action.name
    });
  }

  return runtimePermissionDecision(
    action,
    "allow",
    {
      code: "secret_allowed",
      message: "Secret name matches a declared skill permission.",
      value: matchedSecret
    },
    matchedSecret
  );
}

function runtimePermissionDecision(
  action: SkillRuntimeAction,
  decision: SkillPermissionRiskDecision,
  reason: SkillRuntimePermissionReason,
  matchedPermission?: string
): SkillRuntimePermissionCheck {
  return {
    action,
    decision,
    reason,
    ...(matchedPermission ? { matchedPermission } : {})
  };
}

function collectShellRuntimeMatches(
  command: string,
  patterns: string[],
  decision: SkillPermissionRiskDecision
): Array<{ decision: SkillPermissionRiskDecision; pattern: string }> {
  return patterns
    .filter((pattern) => commandPatternMatches(command, pattern))
    .map((pattern) => ({
      decision,
      pattern
    }));
}

function strongestRuntimeMatch(
  matches: Array<{ decision: SkillPermissionRiskDecision; pattern: string }>
): { decision: SkillPermissionRiskDecision; pattern: string } | undefined {
  return matches.reduce<{ decision: SkillPermissionRiskDecision; pattern: string } | undefined>(
    (current, match) =>
      current === undefined || permissionDecisionRank[match.decision] > permissionDecisionRank[current.decision]
        ? match
        : current,
    undefined
  );
}

function commandPatternMatches(command: string, pattern: string): boolean {
  const normalizedCommand = normalizeShellText(command);
  const normalizedPattern = normalizeShellText(pattern);

  if (normalizedPattern.startsWith("/") && normalizedPattern.lastIndexOf("/") > 0) {
    const lastSlash = normalizedPattern.lastIndexOf("/");
    const expression = normalizedPattern.slice(1, lastSlash);
    const flags = normalizedPattern.slice(lastSlash + 1) || "i";
    try {
      return new RegExp(expression, flags).test(normalizedCommand);
    } catch {
      return false;
    }
  }

  if (hasWildcard(normalizedPattern)) {
    return wildcardToRegExp(normalizedPattern, { pathMode: false, caseInsensitive: true }).test(normalizedCommand);
  }

  return normalizedCommand === normalizedPattern;
}

function pathMatchesScope(path: string, scope: string): boolean {
  const normalizedPath = normalizePathLike(path);
  const normalizedScope = normalizePathLike(scope);

  if (normalizedScope === "." || normalizedScope === "./**" || normalizedScope === "**") {
    return isWorkspaceRelativePath(normalizedPath);
  }

  if (isWorkspaceRelativePath(normalizedScope) && !isWorkspaceRelativePath(normalizedPath)) {
    return false;
  }

  if (hasWildcard(normalizedScope)) {
    return wildcardToRegExp(normalizedScope, { pathMode: true, caseInsensitive: true }).test(normalizedPath);
  }

  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function networkHostMatches(host: string, allow: string): boolean {
  const normalizedHost = normalizeNetworkHost(host);
  const normalizedAllow = normalizeNetworkHost(allow);

  if (hasWildcard(normalizedAllow)) {
    return wildcardToRegExp(normalizedAllow, { pathMode: false, caseInsensitive: true }).test(normalizedHost);
  }

  return normalizedHost === normalizedAllow;
}

function secretScopeMatches(name: string, scope: string): boolean {
  if (hasWildcard(scope)) {
    return wildcardToRegExp(scope, { pathMode: false, caseInsensitive: false }).test(name);
  }

  return name === scope;
}

function networkRuntimeActionHost(action: SkillNetworkRuntimeAction): string {
  if (action.host && action.host.trim().length > 0) {
    return normalizeNetworkHost(action.host);
  }

  if (action.url && action.url.trim().length > 0) {
    return normalizeNetworkHost(action.url);
  }

  return "";
}

function normalizeShellText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizePathLike(path: string): string {
  const stripped = stripShellQuotes(path).replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  if (stripped === "" || stripped === "." || stripped === "./") {
    return ".";
  }

  const driveMatch = stripped.match(/^([a-z]:)(?:\/|$)(.*)$/iu);
  const prefix = driveMatch?.[1]?.toLowerCase();
  const body = driveMatch ? driveMatch[2] ?? "" : stripped;
  const isAbsolute = prefix !== undefined || body.startsWith("/");
  const rawSegments = body.split("/");
  const segments: string[] = [];

  for (const segment of rawSegments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      const previous = segments.at(-1);
      if (previous !== undefined && previous !== "..") {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push("..");
      }
      continue;
    }

    segments.push(segment);
  }

  const normalizedBody = segments.join("/");
  if (prefix !== undefined) {
    return normalizedBody ? `${prefix}/${normalizedBody}` : `${prefix}/`;
  }

  if (isAbsolute) {
    return normalizedBody ? `/${normalizedBody}` : "/";
  }

  return normalizedBody.length > 0 ? normalizedBody : ".";
}

function isWorkspaceRelativePath(path: string): boolean {
  return !/^(?:[a-z]:\/|\/|~|\$home(?:\/|$)|%userprofile%(?:\/|$)|\.\.(?:\/|$))/iu.test(path);
}

function normalizeNetworkHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value
      .trim()
      .toLowerCase()
      .replace(/^\*?\.+/u, value.trim().startsWith("*.") ? "*." : "")
      .replace(/\/.*$/u, "");
  }
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function wildcardToRegExp(
  pattern: string,
  options: { pathMode: boolean; caseInsensitive: boolean }
): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += options.pathMode ? "[^/]*" : ".*";
      continue;
    }

    if (char === "?") {
      source += options.pathMode ? "[^/]" : ".";
      continue;
    }

    source += escapeRegExp(char ?? "");
  }

  return new RegExp(`^${source}$`, options.caseInsensitive ? "i" : "");
}

function hasWildcard(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export * from "./executionBroker.js";
