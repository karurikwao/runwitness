import {
  createHash,
  createPublicKey,
  sign as signNodeSignature,
  verify as verifyNodeSignature,
  type KeyLike
} from "node:crypto";
import YAML from "yaml";
import { POLICY_LAYER_PRECEDENCE, type PolicyLayerKind, type PolicyLayerSource } from "./policyHierarchy.js";

export const POLICY_BUNDLE_TYPE = "runwitness.policy.bundle.v1" as const;

export type PolicyBundleType = typeof POLICY_BUNDLE_TYPE;
export type PolicyBundleSignatureAlgorithm = "ed25519";
export type PolicyBundleBytesEncoding = "base64" | "base64url" | "hex";
export type PolicyBundlePublicKeyFormat = "pem" | "base64" | "base64url";
export type PolicyBundleJson = string | number | boolean | null | PolicyBundleJson[] | { [key: string]: PolicyBundleJson };

export interface PolicyBundleLayer {
  kind: PolicyLayerKind;
  source: string;
  label?: string;
  metadata?: Record<string, PolicyBundleJson>;
}

export interface PolicyBundleSignature {
  algorithm: PolicyBundleSignatureAlgorithm | string;
  value: string;
  encoding: PolicyBundleBytesEncoding;
  publicKey?: string;
  publicKeyFormat?: PolicyBundlePublicKeyFormat;
  keyId?: string;
  keyFingerprint?: string;
  signedAt?: string;
}

export interface PolicyBundle {
  type: PolicyBundleType;
  createdAt: string;
  issuer: string;
  subject: string;
  metadata?: Record<string, PolicyBundleJson>;
  layers: PolicyBundleLayer[];
  signatures?: PolicyBundleSignature[];
}

export interface PolicyBundleDigest {
  algorithm: "sha256";
  value: string;
  canonical: string;
}

export interface PolicyBundleTrustedKey {
  publicKey: string;
  publicKeyFormat?: PolicyBundlePublicKeyFormat;
  keyId?: string;
  keyFingerprint?: string;
}

export interface PolicyBundleTrustRegistry {
  trustedKeyFingerprints?: readonly string[];
  revokedKeyFingerprints?: readonly string[];
  trustedKeys?: readonly PolicyBundleTrustedKey[];
}

export interface NormalizedPolicyBundleTrustedKey {
  publicKey: string;
  publicKeyFormat: PolicyBundlePublicKeyFormat;
  keyId?: string;
  keyFingerprint: string;
}

export interface NormalizedPolicyBundleTrustRegistry {
  trustedKeyFingerprints: string[];
  revokedKeyFingerprints: string[];
  trustedKeys: NormalizedPolicyBundleTrustedKey[];
}

export type PolicyBundleSignatureVerificationStatus =
  | "unsigned"
  | "self-signed"
  | "trusted"
  | "revoked"
  | "invalid"
  | "unsupported";

export interface PolicyBundleSignatureVerification {
  status: PolicyBundleSignatureVerificationStatus;
  algorithm?: string;
  digest: PolicyBundleDigest;
  keyId?: string;
  publicKeyFingerprint?: string;
  reason?: string;
}

export interface PolicyBundleVerification {
  status: PolicyBundleSignatureVerificationStatus;
  digest: PolicyBundleDigest;
  signatures: PolicyBundleSignatureVerification[];
}

export type PolicyBundleInstallDecision = "accept" | "quarantine" | "reject";

export type PolicyBundleInstallReasonCode =
  | "signature_unsigned"
  | "signature_self_signed"
  | "signature_revoked"
  | "signature_invalid"
  | "signature_unsupported";

export type PolicyBundleInstallReasonSeverity = "medium" | "high" | "critical";

export interface PolicyBundleInstallReason {
  code: PolicyBundleInstallReasonCode;
  severity: PolicyBundleInstallReasonSeverity;
  message: string;
  value?: string;
}

export interface PolicyBundleInstallAssessment {
  decision: PolicyBundleInstallDecision;
  quarantine: boolean;
  reasons: PolicyBundleInstallReason[];
  digest: PolicyBundleDigest;
  verification: PolicyBundleVerification;
  bundle: PolicyBundle;
  layerSources: PolicyLayerSource[];
}

export interface AcceptedPolicyBundle {
  bundle: PolicyBundle;
  digest: PolicyBundleDigest;
  layerSources: PolicyLayerSource[];
}

export interface SignPolicyBundleOptions {
  keyId?: string;
  publicKey?: string;
  publicKeyFormat?: PolicyBundlePublicKeyFormat;
  signatureEncoding?: PolicyBundleBytesEncoding;
  includePublicKey?: boolean;
  signedAt?: string;
}

type CanonicalJson = PolicyBundleJson;
type KeyObject = ReturnType<typeof createPublicKey>;

const validLayerKinds = new Set<PolicyLayerKind>(POLICY_LAYER_PRECEDENCE);

export function parsePolicyBundle(source: string): PolicyBundle {
  const parsed = YAML.parse(source) as unknown;
  return normalizePolicyBundle(parsed);
}

export function normalizePolicyBundle(input: unknown): PolicyBundle {
  const raw = requireRecord(input, "Policy bundle");
  const type = typeof raw.type === "string" && raw.type.trim().length > 0 ? raw.type.trim() : POLICY_BUNDLE_TYPE;
  if (type !== POLICY_BUNDLE_TYPE) {
    throw new Error(`Unsupported policy bundle type: ${type}`);
  }

  const layers = normalizePolicyBundleLayers(raw.layers);
  const metadata = raw.metadata === undefined ? undefined : normalizeJsonRecord(raw.metadata, "metadata");
  const signatures = raw.signatures === undefined ? undefined : normalizePolicyBundleSignatures(raw.signatures);

  return {
    type: POLICY_BUNDLE_TYPE,
    createdAt: normalizeTimestamp(requiredString(raw.createdAt, "createdAt"), "createdAt"),
    issuer: requiredString(raw.issuer, "issuer"),
    subject: requiredString(raw.subject, "subject"),
    ...(metadata ? { metadata } : {}),
    layers,
    ...(signatures && signatures.length > 0 ? { signatures } : {})
  };
}

export function canonicalizePolicyBundle(input: unknown): string {
  const bundle = normalizePolicyBundle(input);
  return stableStringify(toCanonicalJson(stripPolicyBundleSignatures(bundle)));
}

export function digestPolicyBundle(input: unknown): PolicyBundleDigest {
  const canonical = canonicalizePolicyBundle(input);
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(canonical, "utf8").digest("hex"),
    canonical
  };
}

export function createPolicyBundleTrustRegistry(
  registry: PolicyBundleTrustRegistry = {}
): NormalizedPolicyBundleTrustRegistry {
  const trustedKeys = (registry.trustedKeys ?? []).map(normalizeTrustedKey);
  return {
    trustedKeyFingerprints: normalizeKeyFingerprints([
      ...(registry.trustedKeyFingerprints ?? []),
      ...trustedKeys.map((key) => key.keyFingerprint)
    ]),
    revokedKeyFingerprints: normalizeKeyFingerprints(registry.revokedKeyFingerprints ?? []),
    trustedKeys
  };
}

export function verifyPolicyBundleSignatures(
  input: unknown,
  trustRegistry?: PolicyBundleTrustRegistry
): PolicyBundleVerification {
  const bundle = normalizePolicyBundle(input);
  const digest = digestPolicyBundle(bundle);
  const registry = createPolicyBundleTrustRegistry(trustRegistry);
  const signatures = bundle.signatures ?? [];

  if (signatures.length === 0) {
    return { status: "unsigned", digest, signatures: [] };
  }

  const signatureResults = signatures.map((signature) => verifyPolicyBundleSignature(signature, digest, registry));
  return {
    status: strongestSignatureStatus(signatureResults),
    digest,
    signatures: signatureResults
  };
}

export function signPolicyBundle(input: unknown, privateKey: KeyLike, options: SignPolicyBundleOptions = {}): PolicyBundle {
  const bundle = normalizePolicyBundle(input);
  const digest = digestPolicyBundle(bundle);
  const publicKeyObject = options.publicKey
    ? createPublicKeyObject(options.publicKey, options.publicKeyFormat ?? "pem")
    : createPublicKey(privateKey);
  const publicKey = exportPublicKey(publicKeyObject);
  const keyFingerprint = fingerprintPolicyBundlePublicKey(publicKeyObject);
  const encoding = options.signatureEncoding ?? "base64";
  const value = encodeBytes(signNodeSignature(null, Buffer.from(digest.canonical, "utf8"), privateKey), encoding);
  const signedAt = options.signedAt ? normalizeTimestamp(options.signedAt, "signedAt") : undefined;
  const signature: PolicyBundleSignature = {
    algorithm: "ed25519",
    value,
    encoding,
    ...(options.includePublicKey === false ? {} : { publicKey, publicKeyFormat: "pem" as const }),
    ...(options.keyId ? { keyId: options.keyId.trim() } : {}),
    keyFingerprint,
    ...(signedAt ? { signedAt } : {})
  };

  return {
    ...bundle,
    signatures: [...(bundle.signatures ?? []), signature]
  };
}

export function assessPolicyBundleInstall(
  input: unknown,
  trustRegistry?: PolicyBundleTrustRegistry
): PolicyBundleInstallAssessment {
  const bundle = normalizePolicyBundle(input);
  const verification = verifyPolicyBundleSignatures(bundle, trustRegistry);
  const reasons = signatureVerificationReasons(verification);
  const decision = policyBundleInstallDecision(verification.status);

  return {
    decision,
    quarantine: decision !== "accept",
    reasons,
    digest: verification.digest,
    verification,
    bundle,
    layerSources: policyBundleLayersToPolicyLayerSources(bundle)
  };
}

export function assessPolicyBundleAcceptance(
  input: unknown,
  trustRegistry?: PolicyBundleTrustRegistry
): PolicyBundleInstallAssessment {
  return assessPolicyBundleInstall(input, trustRegistry);
}

export function acceptPolicyBundle(input: unknown, trustRegistry?: PolicyBundleTrustRegistry): AcceptedPolicyBundle {
  const assessment = assessPolicyBundleInstall(input, trustRegistry);
  if (assessment.decision !== "accept") {
    const reason = assessment.reasons[0]?.message ?? "Policy bundle is not accepted by the local trust registry.";
    throw new Error(reason);
  }

  return {
    bundle: assessment.bundle,
    digest: assessment.digest,
    layerSources: assessment.layerSources
  };
}

export function policyBundleLayersToPolicyLayerSources(input: unknown): PolicyLayerSource[] {
  return normalizePolicyBundle(input).layers.map((layer) => ({
    kind: layer.kind,
    source: layer.source,
    ...(layer.label ? { label: layer.label } : {})
  }));
}

export function fingerprintPolicyBundlePublicKey(
  publicKey: string | KeyObject,
  format: PolicyBundlePublicKeyFormat = "pem"
): string {
  const publicKeyObject = typeof publicKey === "string" ? createPublicKeyObject(publicKey, format) : publicKey;
  const der = publicKeyObject.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

function verifyPolicyBundleSignature(
  signature: PolicyBundleSignature,
  digest: PolicyBundleDigest,
  registry: NormalizedPolicyBundleTrustRegistry
): PolicyBundleSignatureVerification {
  const algorithm = signature.algorithm.toLowerCase();
  if (algorithm !== "ed25519") {
    return {
      status: "unsupported",
      algorithm,
      digest,
      keyId: signature.keyId,
      reason: `Unsupported policy bundle signature algorithm: ${algorithm}`
    };
  }

  try {
    const signatureBytes = decodeBytes(signature.value, signature.encoding);
    const candidates = publicKeyCandidates(signature, registry);
    if (candidates.length === 0) {
      return {
        status: "invalid",
        algorithm,
        digest,
        keyId: signature.keyId,
        publicKeyFingerprint: signature.keyFingerprint,
        reason: "Policy bundle signature verification requires a public key."
      };
    }

    const declaredFingerprint = signature.keyFingerprint ? normalizeKeyFingerprint(signature.keyFingerprint) : undefined;
    const fingerprintMismatch =
      declaredFingerprint !== undefined &&
      signature.publicKey !== undefined &&
      candidates.every((candidate) => candidate.keyFingerprint !== declaredFingerprint);
    for (const candidate of candidates) {
      if (declaredFingerprint !== undefined && declaredFingerprint !== candidate.keyFingerprint) {
        continue;
      }

      const verified = verifyNodeSignature(null, Buffer.from(digest.canonical, "utf8"), candidate.publicKey, signatureBytes);
      if (!verified) {
        continue;
      }

      const trust = resolveKeyTrust(candidate.keyFingerprint, registry);
      return {
        status: trust.status,
        algorithm,
        digest,
        keyId: signature.keyId ?? candidate.keyId,
        publicKeyFingerprint: candidate.keyFingerprint,
        reason: trust.reason
      };
    }

    return {
      status: "invalid",
      algorithm,
      digest,
      keyId: signature.keyId,
      publicKeyFingerprint: signature.keyFingerprint,
      reason: fingerprintMismatch
        ? "Signature key fingerprint does not match the public key or signed policy bundle."
        : "Signature does not match the canonical policy bundle."
    };
  } catch (error) {
    return {
      status: "invalid",
      algorithm,
      digest,
      keyId: signature.keyId,
      publicKeyFingerprint: signature.keyFingerprint,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function publicKeyCandidates(
  signature: PolicyBundleSignature,
  registry: NormalizedPolicyBundleTrustRegistry
): Array<{ publicKey: KeyObject; keyFingerprint: string; keyId?: string }> {
  if (signature.publicKey) {
    const publicKey = createPublicKeyObject(signature.publicKey, signature.publicKeyFormat ?? "pem");
    return [
      {
        publicKey,
        keyFingerprint: fingerprintPolicyBundlePublicKey(publicKey),
        ...(signature.keyId ? { keyId: signature.keyId } : {})
      }
    ];
  }

  const expectedFingerprint = signature.keyFingerprint ? normalizeKeyFingerprint(signature.keyFingerprint) : undefined;
  const expectedKeyId = signature.keyId;
  return registry.trustedKeys
    .filter((key) => expectedFingerprint === undefined || key.keyFingerprint === expectedFingerprint)
    .filter((key) => expectedKeyId === undefined || key.keyId === expectedKeyId)
    .map((key) => ({
      publicKey: createPublicKeyObject(key.publicKey, key.publicKeyFormat),
      keyFingerprint: key.keyFingerprint,
      ...(key.keyId ? { keyId: key.keyId } : {})
    }));
}

function normalizePolicyBundleLayers(value: unknown): PolicyBundleLayer[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Policy bundle requires at least one layer");
  }

  return value.map((layer, index) => normalizePolicyBundleLayer(layer, `layers[${index}]`));
}

function normalizePolicyBundleLayer(value: unknown, field: string): PolicyBundleLayer {
  const raw = requireRecord(value, field);
  const kind = requiredString(raw.kind, `${field}.kind`) as PolicyLayerKind;
  if (!validLayerKinds.has(kind)) {
    throw new Error(`${field}.kind is not a supported policy layer kind: ${kind}`);
  }

  const metadata = raw.metadata === undefined ? undefined : normalizeJsonRecord(raw.metadata, `${field}.metadata`);

  return {
    kind,
    source: requiredString(raw.source, `${field}.source`),
    ...(raw.label !== undefined ? { label: requiredString(raw.label, `${field}.label`) } : {}),
    ...(metadata ? { metadata } : {})
  };
}

function normalizePolicyBundleSignatures(value: unknown): PolicyBundleSignature[] {
  if (!Array.isArray(value)) {
    throw new Error("signatures must be a list");
  }

  return value.map((signature, index) => normalizePolicyBundleSignature(signature, `signatures[${index}]`));
}

function normalizePolicyBundleSignature(value: unknown, field: string): PolicyBundleSignature {
  const raw = requireRecord(value, field);
  const algorithm = optionalString(raw.algorithm) ?? "ed25519";
  const encoding = optionalString(raw.encoding) ?? "base64";
  if (!isPolicyBundleBytesEncoding(encoding)) {
    throw new Error(`${field}.encoding is not supported: ${encoding}`);
  }

  const publicKeyFormat = optionalString(raw.publicKeyFormat);
  if (publicKeyFormat !== undefined && !isPolicyBundlePublicKeyFormat(publicKeyFormat)) {
    throw new Error(`${field}.publicKeyFormat is not supported: ${publicKeyFormat}`);
  }

  return {
    algorithm,
    value: requiredString(raw.value, `${field}.value`),
    encoding,
    ...(raw.publicKey !== undefined ? { publicKey: requiredString(raw.publicKey, `${field}.publicKey`) } : {}),
    ...(publicKeyFormat ? { publicKeyFormat } : {}),
    ...(raw.keyId !== undefined ? { keyId: requiredString(raw.keyId, `${field}.keyId`) } : {}),
    ...(raw.keyFingerprint !== undefined
      ? { keyFingerprint: normalizeKeyFingerprint(requiredString(raw.keyFingerprint, `${field}.keyFingerprint`)) }
      : {}),
    ...(raw.signedAt !== undefined
      ? { signedAt: normalizeTimestamp(requiredString(raw.signedAt, `${field}.signedAt`), `${field}.signedAt`) }
      : {})
  };
}

function normalizeTrustedKey(value: PolicyBundleTrustedKey): NormalizedPolicyBundleTrustedKey {
  const publicKeyFormat = value.publicKeyFormat ?? "pem";
  const publicKeyObject = createPublicKeyObject(value.publicKey, publicKeyFormat);
  const actualFingerprint = fingerprintPolicyBundlePublicKey(publicKeyObject);
  const declaredFingerprint = value.keyFingerprint ? normalizeKeyFingerprint(value.keyFingerprint) : actualFingerprint;
  if (declaredFingerprint !== actualFingerprint) {
    throw new Error("Trusted policy bundle key fingerprint does not match the public key.");
  }

  return {
    publicKey: value.publicKey,
    publicKeyFormat,
    keyFingerprint: actualFingerprint,
    ...(value.keyId ? { keyId: value.keyId.trim() } : {})
  };
}

function stripPolicyBundleSignatures(bundle: PolicyBundle): Omit<PolicyBundle, "signatures"> {
  const { signatures: _signatures, ...unsigned } = bundle;
  return unsigned;
}

function signatureVerificationReasons(verification: PolicyBundleVerification): PolicyBundleInstallReason[] {
  if (verification.status === "trusted") {
    return [];
  }

  const signature = representativeSignatureVerification(verification);
  if (verification.status === "unsigned") {
    return [
      {
        code: "signature_unsigned",
        severity: "high",
        message: "Policy bundle is unsigned and cannot be linked to a trusted local key."
      }
    ];
  }

  if (verification.status === "self-signed") {
    return [
      {
        code: "signature_self_signed",
        severity: "medium",
        message: "Policy bundle signature is valid, but its key is not trusted in the local registry.",
        value: signature?.publicKeyFingerprint
      }
    ];
  }

  if (verification.status === "revoked") {
    return [
      {
        code: "signature_revoked",
        severity: "critical",
        message: "Policy bundle signing key fingerprint is revoked in the local registry.",
        value: signature?.publicKeyFingerprint
      }
    ];
  }

  if (verification.status === "unsupported") {
    return [
      {
        code: "signature_unsupported",
        severity: "high",
        message: signature?.reason ?? "Policy bundle uses an unsupported signature algorithm.",
        value: signature?.algorithm
      }
    ];
  }

  return [
    {
      code: "signature_invalid",
      severity: "critical",
      message: signature?.reason ?? "Policy bundle signature is invalid.",
      value: signature?.publicKeyFingerprint
    }
  ];
}

function representativeSignatureVerification(
  verification: PolicyBundleVerification
): PolicyBundleSignatureVerification | undefined {
  return (
    verification.signatures.find((signature) => signature.status === verification.status) ?? verification.signatures[0]
  );
}

function policyBundleInstallDecision(status: PolicyBundleSignatureVerificationStatus): PolicyBundleInstallDecision {
  if (status === "trusted") {
    return "accept";
  }

  if (status === "unsigned" || status === "self-signed") {
    return "quarantine";
  }

  return "reject";
}

function strongestSignatureStatus(
  signatures: readonly PolicyBundleSignatureVerification[]
): PolicyBundleSignatureVerificationStatus {
  if (signatures.some((signature) => signature.status === "trusted")) {
    return "trusted";
  }
  if (signatures.some((signature) => signature.status === "revoked")) {
    return "revoked";
  }
  if (signatures.some((signature) => signature.status === "self-signed")) {
    return "self-signed";
  }
  if (signatures.some((signature) => signature.status === "unsupported")) {
    return "unsupported";
  }
  return "invalid";
}

function resolveKeyTrust(
  publicKeyFingerprint: string,
  registry: NormalizedPolicyBundleTrustRegistry
): Pick<PolicyBundleSignatureVerification, "status" | "reason"> {
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Policy bundle requires a non-empty ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeTimestamp(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Policy bundle ${field} must be a valid timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeJsonRecord(value: unknown, field: string): Record<string, PolicyBundleJson> {
  if (!isRecord(value)) {
    throw new Error(`Policy bundle ${field} must be a mapping`);
  }

  const result: Record<string, PolicyBundleJson> = {};
  for (const [key, propertyValue] of Object.entries(value)) {
    if (propertyValue !== undefined) {
      result[key] = normalizeJsonValue(propertyValue, `${field}.${key}`);
    }
  }
  return result;
}

function normalizeJsonValue(value: unknown, field: string): PolicyBundleJson {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJsonValue(item, `${field}[${index}]`));
  }

  if (isRecord(value)) {
    return normalizeJsonRecord(value, field);
  }

  throw new Error(`Policy bundle ${field} must be JSON-compatible`);
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

  throw new Error(`Unsupported policy bundle value type: ${typeof value}`);
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

function decodeBytes(value: string, encoding: PolicyBundleBytesEncoding): Buffer {
  if (encoding === "base64url") {
    return Buffer.from(value, "base64url");
  }
  return Buffer.from(value, encoding);
}

function encodeBytes(value: Buffer, encoding: PolicyBundleBytesEncoding): string {
  if (encoding === "base64url") {
    return value.toString("base64url");
  }
  return value.toString(encoding);
}

function createPublicKeyObject(publicKey: string, format: PolicyBundlePublicKeyFormat): KeyObject {
  if (format === "pem") {
    return createPublicKey(publicKey);
  }

  return createPublicKey({ key: decodeBytes(publicKey, format), format: "der", type: "spki" });
}

function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: "pem", type: "spki" }).toString();
}

function normalizeKeyFingerprints(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizeKeyFingerprint(value)).filter((value) => value.length > 0))];
}

function normalizeKeyFingerprint(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("sha256:") ? normalized.slice("sha256:".length) : normalized;
}

function isPolicyBundleBytesEncoding(value: string): value is PolicyBundleBytesEncoding {
  return value === "base64" || value === "base64url" || value === "hex";
}

function isPolicyBundlePublicKeyFormat(value: string): value is PolicyBundlePublicKeyFormat {
  return value === "pem" || value === "base64" || value === "base64url";
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
