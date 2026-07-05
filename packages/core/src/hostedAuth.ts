import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import type { OperatorPrincipal, OperatorRole } from "./operatorServer.js";

export const HOSTED_AUTH_CONFIG_VERSION = 1;
export const HOSTED_OPERATOR_ROLES = ["viewer", "approver", "admin"] as const satisfies readonly OperatorRole[];

const HOSTED_OPERATOR_ROLE_SET = new Set<string>(HOSTED_OPERATOR_ROLES);
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_TOKEN_BYTE_LENGTH = 32;
const DEFAULT_MIN_TOKEN_LENGTH = 16;
const TOKEN_DIGEST_PREFIX_LENGTH = 12;

export interface HostedAuthConfigFile {
  version?: typeof HOSTED_AUTH_CONFIG_VERSION;
  bearerCredentials: readonly HostedBearerCredentialConfig[];
}

export interface HostedBearerCredentialConfig {
  id?: string;
  operatorId: string;
  roles: readonly OperatorRole[];
  token?: string;
  tokenEnv?: string;
  tokenSha256?: string;
  tokenDigest?: string;
  allowedUsers?: readonly string[];
  allowedWorkspaces?: readonly string[];
  createdAt?: string;
  expiresAt?: string;
  disabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateHostedBearerCredentialInput {
  operatorId: string;
  roles: readonly OperatorRole[];
  token: string;
  id?: string;
  allowedUsers?: readonly string[];
  allowedWorkspaces?: readonly string[];
  createdAt?: string;
  expiresAt?: string;
  disabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface HostedBearerTokenHash {
  algorithm: "sha256";
  sha256: string;
  displayDigest: string;
}

export interface LoadedHostedAuthConfig {
  version: typeof HOSTED_AUTH_CONFIG_VERSION;
  bearerCredentials: LoadedHostedBearerCredential[];
}

export interface LoadedHostedBearerCredential {
  id: string;
  operatorId: string;
  roles: OperatorRole[];
  tokenHash: HostedBearerTokenHash;
  allowedUsers?: string[];
  allowedWorkspaces?: string[];
  createdAt?: string;
  expiresAt?: string;
  disabled?: boolean;
  metadata: Record<string, unknown>;
}

export interface HostedAuthConfigIssue {
  path: string;
  message: string;
}

export interface HostedAuthConfigWarning {
  path: string;
  code: "plaintext_token_hashed" | "environment_token_hashed" | "legacy_bearer_tokens_alias";
  message: string;
}

export type HostedAuthConfigValidationResult =
  | {
      ok: true;
      config: LoadedHostedAuthConfig;
      warnings: HostedAuthConfigWarning[];
    }
  | {
      ok: false;
      issues: HostedAuthConfigIssue[];
      warnings: HostedAuthConfigWarning[];
    };

export interface HostedAuthConfigParseOptions {
  env?: Record<string, string | undefined>;
  minTokenLength?: number;
}

export interface HostedBearerAuthenticationOptions {
  at?: Date;
}

export interface GenerateHostedBearerTokenOptions {
  byteLength?: number;
  prefix?: string;
}

export interface HostedAuthAuditExport {
  kind: "hosted_auth_config";
  formatVersion: typeof HOSTED_AUTH_CONFIG_VERSION;
  generatedAt: string;
  configDigest: string;
  credentialCount: number;
  credentials: HostedBearerCredentialAuditDescriptor[];
}

export interface HostedBearerCredentialAuditDescriptor {
  id: string;
  operatorId: string;
  roles: OperatorRole[];
  tokenDigest: string;
  scope: {
    allUsers: boolean;
    allWorkspaces: boolean;
    allowedUsers?: string[];
    allowedWorkspaces?: string[];
  };
  createdAt?: string;
  expiresAt?: string;
  disabled?: boolean;
  metadataKeyCount: number;
  metadataRedacted: true;
}

export class HostedAuthConfigError extends Error {
  readonly issues: HostedAuthConfigIssue[];

  constructor(issues: HostedAuthConfigIssue[]) {
    super(`Invalid hosted auth config: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "HostedAuthConfigError";
    this.issues = issues;
  }
}

export async function loadHostedAuthConfig(
  filePath: string,
  options: HostedAuthConfigParseOptions = {}
): Promise<LoadedHostedAuthConfig> {
  const contents = await fs.readFile(filePath, "utf8");
  return parseHostedAuthConfigJson(contents, options);
}

export function parseHostedAuthConfigJson(
  contents: string,
  options: HostedAuthConfigParseOptions = {}
): LoadedHostedAuthConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new HostedAuthConfigError([{ path: "$", message: `must be valid JSON (${message})` }]);
  }

  return parseHostedAuthConfig(parsed, options);
}

export function parseHostedAuthConfig(
  value: unknown,
  options: HostedAuthConfigParseOptions = {}
): LoadedHostedAuthConfig {
  const result = validateHostedAuthConfig(value, options);
  if (!result.ok) {
    throw new HostedAuthConfigError(result.issues);
  }

  return result.config;
}

export function validateHostedAuthConfig(
  value: unknown,
  options: HostedAuthConfigParseOptions = {}
): HostedAuthConfigValidationResult {
  const issues: HostedAuthConfigIssue[] = [];
  const warnings: HostedAuthConfigWarning[] = [];
  const credentialInputs = readCredentialInputs(value, issues, warnings);
  const credentials: LoadedHostedBearerCredential[] = [];
  const seenCredentialIds = new Set<string>();
  const seenTokenHashes = new Set<string>();

  for (let index = 0; index < credentialInputs.length; index += 1) {
    const credential = normalizeHostedBearerCredential(
      credentialInputs[index],
      `bearerCredentials[${index}]`,
      options,
      issues,
      warnings
    );
    if (!credential) {
      continue;
    }

    if (seenCredentialIds.has(credential.id)) {
      issues.push({ path: `bearerCredentials[${index}].id`, message: "must be unique" });
    }
    seenCredentialIds.add(credential.id);

    if (seenTokenHashes.has(credential.tokenHash.sha256)) {
      issues.push({ path: `bearerCredentials[${index}].tokenSha256`, message: "must be unique" });
    }
    seenTokenHashes.add(credential.tokenHash.sha256);
    credentials.push(credential);
  }

  if (credentialInputs.length === 0) {
    issues.push({ path: "bearerCredentials", message: "must include at least one credential" });
  }

  if (issues.length > 0) {
    return { ok: false, issues, warnings };
  }

  return {
    ok: true,
    config: {
      version: HOSTED_AUTH_CONFIG_VERSION,
      bearerCredentials: credentials
    },
    warnings
  };
}

export function createHostedBearerCredential(
  input: CreateHostedBearerCredentialInput,
  options: HostedAuthConfigParseOptions = {}
): HostedBearerCredentialConfig {
  const config = parseHostedAuthConfig(
    {
      version: HOSTED_AUTH_CONFIG_VERSION,
      bearerCredentials: [
        {
          ...input,
          token: input.token
        }
      ]
    },
    options
  );
  const credential = config.bearerCredentials[0];
  if (!credential) {
    throw new Error("expected hosted bearer credential");
  }

  return {
    id: credential.id,
    operatorId: credential.operatorId,
    roles: credential.roles,
    tokenSha256: credential.tokenHash.sha256,
    tokenDigest: credential.tokenHash.displayDigest,
    allowedUsers: credential.allowedUsers,
    allowedWorkspaces: credential.allowedWorkspaces,
    createdAt: credential.createdAt,
    expiresAt: credential.expiresAt,
    disabled: credential.disabled,
    metadata: credential.metadata
  };
}

export function generateHostedBearerToken(options: GenerateHostedBearerTokenOptions = {}): string {
  const byteLength = options.byteLength ?? DEFAULT_TOKEN_BYTE_LENGTH;
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new Error("hosted bearer token byte length must be at least 16");
  }

  return `${options.prefix ?? "rwop_"}${randomBytes(byteLength).toString("base64url")}`;
}

export function hashHostedBearerToken(token: string): HostedBearerTokenHash {
  if (token.length === 0) {
    throw new Error("hosted bearer token must not be empty");
  }
  const sha256 = createHash("sha256").update(token, "utf8").digest("hex");
  return {
    algorithm: "sha256",
    sha256,
    displayDigest: formatHostedBearerTokenDigest(sha256)
  };
}

export function formatHostedBearerTokenDigest(tokenSha256: string): string {
  const normalized = normalizeSha256Hex(tokenSha256);
  return `sha256:${normalized.slice(0, TOKEN_DIGEST_PREFIX_LENGTH)}`;
}

export function authenticateHostedBearerToken(
  config: LoadedHostedAuthConfig,
  token: string,
  options: HostedBearerAuthenticationOptions = {}
): OperatorPrincipal | undefined {
  if (token.length === 0) {
    return undefined;
  }

  const tokenHash = hashHostedBearerToken(token).sha256;
  const at = options.at ?? new Date();
  for (const credential of config.bearerCredentials) {
    if (!isCredentialActive(credential, at)) {
      continue;
    }
    if (sha256DigestsEqual(credential.tokenHash.sha256, tokenHash)) {
      return {
        id: credential.operatorId,
        roles: [...credential.roles],
        allowedUsers: credential.allowedUsers ? [...credential.allowedUsers] : undefined,
        allowedWorkspaces: credential.allowedWorkspaces ? [...credential.allowedWorkspaces] : undefined
      };
    }
  }

  return undefined;
}

export function exportHostedAuthAuditView(
  config: LoadedHostedAuthConfig,
  options: { now?: () => Date } = {}
): HostedAuthAuditExport {
  return {
    kind: "hosted_auth_config",
    formatVersion: HOSTED_AUTH_CONFIG_VERSION,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    configDigest: digestHostedAuthConfig(config),
    credentialCount: config.bearerCredentials.length,
    credentials: config.bearerCredentials.map((credential) => ({
      id: credential.id,
      operatorId: credential.operatorId,
      roles: [...credential.roles],
      tokenDigest: credential.tokenHash.displayDigest,
      scope: {
        allUsers: credential.allowedUsers === undefined,
        allWorkspaces: credential.allowedWorkspaces === undefined,
        allowedUsers: credential.allowedUsers ? [...credential.allowedUsers] : undefined,
        allowedWorkspaces: credential.allowedWorkspaces ? [...credential.allowedWorkspaces] : undefined
      },
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
      disabled: credential.disabled,
      metadataKeyCount: Object.keys(credential.metadata).length,
      metadataRedacted: true
    }))
  };
}

export function digestHostedAuthConfig(config: LoadedHostedAuthConfig): string {
  const digestible = {
    version: config.version,
    bearerCredentials: config.bearerCredentials.map((credential) => ({
      id: credential.id,
      operatorId: credential.operatorId,
      roles: credential.roles,
      tokenSha256: credential.tokenHash.sha256,
      allowedUsers: credential.allowedUsers,
      allowedWorkspaces: credential.allowedWorkspaces,
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
      disabled: credential.disabled,
      metadata: credential.metadata
    }))
  };
  return `sha256:${createHash("sha256").update(stableJson(digestible), "utf8").digest("hex")}`;
}

function readCredentialInputs(
  value: unknown,
  issues: HostedAuthConfigIssue[],
  warnings: HostedAuthConfigWarning[]
): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    issues.push({ path: "$", message: "must be a hosted auth config object" });
    return [];
  }

  if (value.version !== undefined && value.version !== HOSTED_AUTH_CONFIG_VERSION) {
    issues.push({ path: "version", message: `must be ${HOSTED_AUTH_CONFIG_VERSION}` });
  }

  if (value.bearerCredentials !== undefined && value.bearerTokens !== undefined) {
    issues.push({ path: "bearerCredentials", message: "must not be combined with bearerTokens" });
  }

  const credentials = value.bearerCredentials ?? value.bearerTokens;
  if (value.bearerTokens !== undefined) {
    warnings.push({
      path: "bearerTokens",
      code: "legacy_bearer_tokens_alias",
      message: "bearerTokens is accepted as a legacy alias; prefer bearerCredentials for hosted configs"
    });
  }
  if (!Array.isArray(credentials)) {
    issues.push({ path: "bearerCredentials", message: "must be an array" });
    return [];
  }

  return credentials;
}

function normalizeHostedBearerCredential(
  value: unknown,
  path: string,
  options: HostedAuthConfigParseOptions,
  issues: HostedAuthConfigIssue[],
  warnings: HostedAuthConfigWarning[]
): LoadedHostedBearerCredential | undefined {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be a credential object with operatorId, roles, and tokenSha256/token/tokenEnv" });
    return undefined;
  }

  if ("password" in value || "passwordHash" in value) {
    issues.push({ path, message: "must not include password fields; use bearer token hashes instead" });
  }

  const operatorId = readRequiredString(value.operatorId, `${path}.operatorId`, issues);
  const roles = readOperatorRoles(value.roles, `${path}.roles`, issues);
  const allowedUsers = readOptionalStringList(value.allowedUsers, `${path}.allowedUsers`, issues);
  const allowedWorkspaces = readOptionalStringList(value.allowedWorkspaces, `${path}.allowedWorkspaces`, issues);
  const createdAt = readOptionalIsoDate(value.createdAt, `${path}.createdAt`, issues);
  const expiresAt = readOptionalIsoDate(value.expiresAt, `${path}.expiresAt`, issues);
  const disabled = readOptionalBoolean(value.disabled, `${path}.disabled`, issues);
  const metadata = readMetadata(value.metadata, `${path}.metadata`, issues);
  const tokenHash = readTokenHash(value, path, options, issues, warnings);
  if (!operatorId || roles.length === 0 || !tokenHash) {
    return undefined;
  }

  const suppliedId = readOptionalString(value.id, `${path}.id`, issues);
  const id = suppliedId ?? `${operatorId}:${tokenHash.displayDigest}`;
  return {
    id,
    operatorId,
    roles,
    tokenHash,
    allowedUsers,
    allowedWorkspaces,
    createdAt,
    expiresAt,
    disabled,
    metadata
  };
}

function readTokenHash(
  value: Record<string, unknown>,
  path: string,
  options: HostedAuthConfigParseOptions,
  issues: HostedAuthConfigIssue[],
  warnings: HostedAuthConfigWarning[]
): HostedBearerTokenHash | undefined {
  const sources = [
    typeof value.token === "string" && value.token.length > 0 ? "token" : undefined,
    typeof value.tokenEnv === "string" && value.tokenEnv.length > 0 ? "tokenEnv" : undefined,
    typeof value.tokenSha256 === "string" && value.tokenSha256.length > 0 ? "tokenSha256" : undefined
  ].filter((source): source is string => source !== undefined);
  if (sources.length !== 1) {
    issues.push({ path, message: "must include exactly one of token, tokenEnv, or tokenSha256" });
    return undefined;
  }

  let tokenHash: HostedBearerTokenHash | undefined;
  if (sources[0] === "token") {
    tokenHash = hashAndValidateRawToken(value.token as string, `${path}.token`, options, issues);
    warnings.push({
      path: `${path}.token`,
      code: "plaintext_token_hashed",
      message: "plaintext token was hashed and will not be included in normalized output"
    });
  } else if (sources[0] === "tokenEnv") {
    const envName = readRequiredString(value.tokenEnv, `${path}.tokenEnv`, issues);
    const token = envName ? (options.env ?? process.env)[envName] : undefined;
    if (!token) {
      issues.push({ path: `${path}.tokenEnv`, message: "must name a set, non-empty environment variable" });
      return undefined;
    }
    tokenHash = hashAndValidateRawToken(token, `${path}.tokenEnv`, options, issues);
    warnings.push({
      path: `${path}.tokenEnv`,
      code: "environment_token_hashed",
      message: "environment token was hashed and will not be included in normalized output"
    });
  } else {
    const tokenSha256 = readRequiredSha256(value.tokenSha256, `${path}.tokenSha256`, issues);
    tokenHash = tokenSha256
      ? {
          algorithm: "sha256",
          sha256: tokenSha256,
          displayDigest: formatHostedBearerTokenDigest(tokenSha256)
        }
      : undefined;
  }

  if (!tokenHash) {
    return undefined;
  }

  const suppliedDigest = readOptionalString(value.tokenDigest, `${path}.tokenDigest`, issues);
  if (suppliedDigest !== undefined && suppliedDigest !== tokenHash.displayDigest) {
    issues.push({ path: `${path}.tokenDigest`, message: `must match derived digest ${tokenHash.displayDigest}` });
  }

  return tokenHash;
}

function hashAndValidateRawToken(
  token: string,
  path: string,
  options: HostedAuthConfigParseOptions,
  issues: HostedAuthConfigIssue[]
): HostedBearerTokenHash | undefined {
  if (token.length < (options.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH)) {
    issues.push({ path, message: `must be at least ${options.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH} characters` });
    return undefined;
  }

  return hashHostedBearerToken(token);
}

function readOperatorRoles(value: unknown, path: string, issues: HostedAuthConfigIssue[]): OperatorRole[] {
  const roles = readStringList(value, path, issues, { required: true });
  const normalized: OperatorRole[] = [];
  for (const role of roles) {
    if (!HOSTED_OPERATOR_ROLE_SET.has(role)) {
      issues.push({ path, message: `contains unsupported role ${JSON.stringify(role)}` });
      continue;
    }
    normalized.push(role as OperatorRole);
  }

  return uniqueStrings(normalized) as OperatorRole[];
}

function readOptionalStringList(
  value: unknown,
  path: string,
  issues: HostedAuthConfigIssue[]
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values = readStringList(value, path, issues, { required: false });
  return values.length > 0 ? values : undefined;
}

function readStringList(
  value: unknown,
  path: string,
  issues: HostedAuthConfigIssue[],
  options: { required: boolean }
): string[] {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined;
  if (!rawValues) {
    issues.push({ path, message: options.required ? "must be a non-empty string array" : "must be a string array" });
    return [];
  }

  const values: string[] = [];
  for (let index = 0; index < rawValues.length; index += 1) {
    const item = rawValues[index];
    if (typeof item !== "string") {
      issues.push({ path: `${path}[${index}]`, message: "must be a string" });
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      issues.push({ path: `${path}[${index}]`, message: "must not be empty" });
      continue;
    }
    values.push(trimmed);
  }

  const unique = uniqueStrings(values);
  if (options.required && unique.length === 0) {
    issues.push({ path, message: "must include at least one value" });
  }
  return unique;
}

function readRequiredString(value: unknown, path: string, issues: HostedAuthConfigIssue[]): string | undefined {
  const stringValue = readOptionalString(value, path, issues);
  if (!stringValue) {
    issues.push({ path, message: "is required" });
  }
  return stringValue;
}

function readOptionalString(value: unknown, path: string, issues: HostedAuthConfigIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push({ path, message: "must be a string" });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push({ path, message: "must not be empty" });
    return undefined;
  }
  return trimmed;
}

function readRequiredSha256(value: unknown, path: string, issues: HostedAuthConfigIssue[]): string | undefined {
  const raw = readRequiredString(value, path, issues);
  if (!raw) {
    return undefined;
  }
  try {
    return normalizeSha256Hex(raw);
  } catch {
    issues.push({ path, message: "must be a 64-character SHA-256 hex digest" });
    return undefined;
  }
}

function readOptionalIsoDate(value: unknown, path: string, issues: HostedAuthConfigIssue[]): string | undefined {
  const raw = readOptionalString(value, path, issues);
  if (!raw) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(raw))) {
    issues.push({ path, message: "must be an ISO date string" });
    return undefined;
  }
  return raw;
}

function readOptionalBoolean(value: unknown, path: string, issues: HostedAuthConfigIssue[]): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push({ path, message: "must be a boolean" });
    return undefined;
  }
  return value;
}

function readMetadata(value: unknown, path: string, issues: HostedAuthConfigIssue[]): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return {};
  }
  return { ...value };
}

function normalizeSha256Hex(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(normalized)) {
    throw new Error("invalid SHA-256 digest");
  }
  return normalized;
}

function isCredentialActive(credential: LoadedHostedBearerCredential, at: Date): boolean {
  if (credential.disabled === true) {
    return false;
  }
  return !credential.expiresAt || Date.parse(credential.expiresAt) > at.getTime();
}

function sha256DigestsEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
