import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  type BinaryLike,
  type ScryptOptions
} from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SecretReference } from "./secrets.js";

const VAULT_FORMAT_VERSION = 1;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const DEFAULT_SECRET_REPLACEMENT = "[REDACTED_SECRET]";

export type SecretVaultKeyInput =
  | { passphrase: string | Buffer | Uint8Array }
  | { key: Buffer | Uint8Array };

export interface SecretVaultOptions {
  rootDir: string;
  now?: () => Date;
}

export interface SaveSecretVaultInput extends SecretReference {
  value: string;
  key: SecretVaultKeyInput;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface LoadSecretVaultInput extends SecretReference {
  key: SecretVaultKeyInput;
}

export interface ListSecretVaultDescriptorsInput {
  workspaceId?: string;
}

export interface DeleteSecretVaultInput extends SecretReference {}

export interface SecretVaultDescriptor extends SecretReference {
  label?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  redacted: true;
  encrypted: true;
  valueRedacted: true;
  metadataKeyCount: number;
  metadataRedacted: true;
}

export type SecretVaultAction = "save" | "load" | "list" | "delete";
export type SecretVaultAccessResult = "allowed" | "denied";

export interface SecretVaultAuditEvent {
  id: string;
  kind: "secret_vault_access";
  action: SecretVaultAction;
  result: SecretVaultAccessResult;
  timestamp: string;
  workspaceId?: string;
  secretId?: string;
  descriptor?: SecretVaultDescriptor;
  descriptors?: SecretVaultDescriptor[];
  reason?: string;
}

export interface SecretVaultReceipt {
  kind: "secret_vault_access";
  capturedAt: string;
  status: SecretVaultAccessResult;
  descriptor?: SecretVaultDescriptor;
  descriptors?: SecretVaultDescriptor[];
  metadata: {
    eventId: string;
    action: SecretVaultAction;
    workspaceId?: string;
    secretId?: string;
    descriptorCount?: number;
    reason?: string;
  };
}

export interface SecretVaultTrace {
  event: SecretVaultAuditEvent;
  receipt: SecretVaultReceipt;
}

export type SecretVaultDeniedResult = {
  ok: false;
  reason: string;
  descriptor?: SecretVaultDescriptor;
} & SecretVaultTrace;

export type SecretVaultResult<TSuccess extends object> =
  | ({
      ok: true;
    } & TSuccess &
      SecretVaultTrace)
  | SecretVaultDeniedResult;

export interface SecretRedactionSource {
  value: string;
  replacement?: string;
}

export interface SecretRedactionOptions {
  replacement?: string;
  includeEncodedVariants?: boolean;
}

type SecretVaultKdf =
  | {
      name: "scrypt";
      salt: string;
      cost: number;
      blockSize: number;
      parallelization: number;
      keyLength: number;
    }
  | {
      name: "none";
      keyLength: number;
    };

interface SecretVaultFile {
  formatVersion: typeof VAULT_FORMAT_VERSION;
  descriptor: SecretVaultDescriptor;
  encryption: {
    algorithm: typeof ENCRYPTION_ALGORITHM;
    kdf: SecretVaultKdf;
    iv: string;
    authTag: string;
  };
  ciphertext: string;
}

interface SecretVaultPayload {
  value: string;
  metadata: Record<string, unknown>;
}

interface SecretNeedle {
  value: string;
  replacement: string;
}

export class EncryptedLocalSecretVault {
  private readonly rootDir: string;
  private readonly now: () => Date;

  constructor(options: SecretVaultOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.now = options.now ?? (() => new Date());
  }

  async saveSecret(
    input: SaveSecretVaultInput
  ): Promise<SecretVaultResult<{ descriptor: SecretVaultDescriptor }>> {
    const existing = await this.readEnvelope(input.workspaceId, input.secretId);
    const timestamp = this.now().toISOString();
    const descriptor: SecretVaultDescriptor = {
      workspaceId: input.workspaceId,
      secretId: input.secretId,
      label: input.label ?? existing?.descriptor.label,
      createdAt: existing?.descriptor.createdAt ?? timestamp,
      updatedAt: timestamp,
      version: (existing?.descriptor.version ?? 0) + 1,
      redacted: true,
      encrypted: true,
      valueRedacted: true,
      metadataKeyCount: Object.keys(input.metadata ?? {}).length,
      metadataRedacted: true
    };
    const payload: SecretVaultPayload = {
      value: input.value,
      metadata: input.metadata ?? {}
    };
    const envelope = await encryptPayload(payload, descriptor, input.key);
    await this.writeEnvelope(input.workspaceId, input.secretId, envelope);

    return this.allowed("save", { descriptor }, { descriptor });
  }

  async loadSecret(
    input: LoadSecretVaultInput
  ): Promise<
    SecretVaultResult<{
      value: string;
      metadata: Record<string, unknown>;
      descriptor: SecretVaultDescriptor;
    }>
  > {
    const envelope = await this.readEnvelope(input.workspaceId, input.secretId);
    if (!envelope) {
      return this.denied("load", input.workspaceId, input.secretId, "secret_not_found");
    }

    try {
      const payload = await decryptPayload(envelope, input.key);
      return this.allowed(
        "load",
        {
          descriptor: envelope.descriptor
        },
        {
          value: payload.value,
          metadata: payload.metadata,
          descriptor: envelope.descriptor
        }
      );
    } catch {
      return this.denied("load", input.workspaceId, input.secretId, "decrypt_failed", envelope.descriptor);
    }
  }

  async listSecretDescriptors(
    input: ListSecretVaultDescriptorsInput = {}
  ): Promise<SecretVaultResult<{ descriptors: SecretVaultDescriptor[] }>> {
    const descriptors = (await this.readAllDescriptors(input.workspaceId)).sort((left, right) => {
      const workspaceCompare = left.workspaceId.localeCompare(right.workspaceId);
      return workspaceCompare === 0 ? left.secretId.localeCompare(right.secretId) : workspaceCompare;
    });

    return this.allowed("list", { descriptors }, { descriptors });
  }

  async deleteSecret(
    input: DeleteSecretVaultInput
  ): Promise<SecretVaultResult<{ descriptor: SecretVaultDescriptor }>> {
    const envelope = await this.readEnvelope(input.workspaceId, input.secretId);
    if (!envelope) {
      return this.denied("delete", input.workspaceId, input.secretId, "secret_not_found");
    }

    await fs.unlink(this.secretPath(input.workspaceId, input.secretId));
    await removeEmptyDirectory(this.workspacePath(input.workspaceId));

    return this.allowed("delete", { descriptor: envelope.descriptor }, { descriptor: envelope.descriptor });
  }

  private async readEnvelope(workspaceId: string, secretId: string): Promise<SecretVaultFile | undefined> {
    try {
      const contents = await fs.readFile(this.secretPath(workspaceId, secretId), "utf8");
      return parseEnvelope(contents);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async readAllDescriptors(workspaceId?: string): Promise<SecretVaultDescriptor[]> {
    const workspaceDirs = workspaceId
      ? [this.workspacePath(workspaceId)]
      : await listChildDirectories(this.rootDir);
    const descriptors: SecretVaultDescriptor[] = [];

    for (const workspaceDir of workspaceDirs) {
      const files = await listJsonFiles(workspaceDir);
      for (const file of files) {
        const contents = await fs.readFile(file, "utf8");
        descriptors.push(parseEnvelope(contents).descriptor);
      }
    }

    return descriptors;
  }

  private async writeEnvelope(workspaceId: string, secretId: string, envelope: SecretVaultFile): Promise<void> {
    const secretPath = this.secretPath(workspaceId, secretId);
    const workspaceDir = path.dirname(secretPath);
    await fs.mkdir(workspaceDir, { recursive: true });

    const tempPath = path.join(
      workspaceDir,
      `${path.basename(secretPath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
    );
    await fs.writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempPath, secretPath);
  }

  private workspacePath(workspaceId: string): string {
    return path.join(this.rootDir, storageToken(workspaceId));
  }

  private secretPath(workspaceId: string, secretId: string): string {
    return path.join(this.workspacePath(workspaceId), `${storageToken(secretId)}.json`);
  }

  private allowed<TSuccess extends object>(
    action: SecretVaultAction,
    eventDetails: {
      descriptor?: SecretVaultDescriptor;
      descriptors?: SecretVaultDescriptor[];
    },
    success: TSuccess
  ): SecretVaultResult<TSuccess> {
    const event = this.createEvent(action, "allowed", eventDetails);
    return {
      ok: true,
      ...success,
      event,
      receipt: createReceipt(event)
    };
  }

  private denied(
    action: SecretVaultAction,
    workspaceId: string,
    secretId: string,
    reason: string,
    descriptor?: SecretVaultDescriptor
  ): SecretVaultDeniedResult {
    const event = this.createEvent(action, "denied", {
      workspaceId,
      secretId,
      descriptor,
      reason
    });
    return {
      ok: false,
      reason,
      descriptor,
      event,
      receipt: createReceipt(event)
    };
  }

  private createEvent(
    action: SecretVaultAction,
    result: SecretVaultAccessResult,
    details: {
      workspaceId?: string;
      secretId?: string;
      descriptor?: SecretVaultDescriptor;
      descriptors?: SecretVaultDescriptor[];
      reason?: string;
    }
  ): SecretVaultAuditEvent {
    return {
      id: createSecretVaultEventId(),
      kind: "secret_vault_access",
      action,
      result,
      timestamp: this.now().toISOString(),
      workspaceId: details.workspaceId ?? details.descriptor?.workspaceId,
      secretId: details.secretId ?? details.descriptor?.secretId,
      descriptor: details.descriptor,
      descriptors: details.descriptors,
      reason: details.reason
    };
  }
}

export function redactKnownSecrets<T>(
  input: T,
  secrets: Iterable<string | SecretRedactionSource>,
  options: SecretRedactionOptions = {}
): T {
  const needles = buildSecretNeedles(secrets, options);
  if (needles.length === 0) {
    return input;
  }

  return redactValue(input, needles, new WeakMap<object, unknown>()) as T;
}

async function encryptPayload(
  payload: SecretVaultPayload,
  descriptor: SecretVaultDescriptor,
  keyInput: SecretVaultKeyInput
): Promise<SecretVaultFile> {
  const kdf = createKdf(keyInput);
  const key = await resolveEncryptionKey(keyInput, kdf);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const authenticatedDescriptor = descriptorAad(descriptor);
  cipher.setAAD(authenticatedDescriptor);

  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    formatVersion: VAULT_FORMAT_VERSION,
    descriptor,
    encryption: {
      algorithm: ENCRYPTION_ALGORITHM,
      kdf,
      iv: iv.toString("base64url"),
      authTag: authTag.toString("base64url")
    },
    ciphertext: encrypted.toString("base64url")
  };
}

async function decryptPayload(envelope: SecretVaultFile, keyInput: SecretVaultKeyInput): Promise<SecretVaultPayload> {
  const key = await resolveEncryptionKey(keyInput, envelope.encryption.kdf);
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(envelope.encryption.iv, "base64url"));
  decipher.setAAD(descriptorAad(envelope.descriptor));
  decipher.setAuthTag(Buffer.from(envelope.encryption.authTag, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
  const payload = JSON.parse(decrypted) as unknown;
  if (!isSecretVaultPayload(payload)) {
    throw new Error("invalid secret vault payload");
  }

  return payload;
}

function createKdf(keyInput: SecretVaultKeyInput): SecretVaultKdf {
  if ("key" in keyInput) {
    return {
      name: "none",
      keyLength: KEY_LENGTH_BYTES
    };
  }

  return {
    name: "scrypt",
    salt: randomBytes(16).toString("base64url"),
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
    keyLength: KEY_LENGTH_BYTES
  };
}

async function resolveEncryptionKey(keyInput: SecretVaultKeyInput, kdf: SecretVaultKdf): Promise<Buffer> {
  if ("key" in keyInput) {
    return normalizeRawKey(keyInput.key);
  }

  if (kdf.name !== "scrypt") {
    throw new Error("secret vault key material does not match stored kdf");
  }

  return deriveScryptKey(secretMaterialToBuffer(keyInput.passphrase), Buffer.from(kdf.salt, "base64url"), kdf.keyLength, {
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
    maxmem: SCRYPT_MAXMEM
  });
}

function deriveScryptKey(
  password: BinaryLike,
  salt: BinaryLike,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function normalizeRawKey(key: Buffer | Uint8Array): Buffer {
  const rawKey = Buffer.from(key);
  if (rawKey.length !== KEY_LENGTH_BYTES) {
    throw new Error("secret vault raw key must be 32 bytes");
  }

  return rawKey;
}

function secretMaterialToBuffer(value: string | Buffer | Uint8Array): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function descriptorAad(descriptor: SecretVaultDescriptor): Buffer {
  return Buffer.from(JSON.stringify(descriptor), "utf8");
}

function parseEnvelope(contents: string): SecretVaultFile {
  const parsed = JSON.parse(contents) as unknown;
  if (!isSecretVaultFile(parsed)) {
    throw new Error("invalid secret vault file");
  }

  return parsed;
}

function isSecretVaultFile(value: unknown): value is SecretVaultFile {
  if (!isRecord(value)) {
    return false;
  }

  const encryption = value.encryption;
  return (
    value.formatVersion === VAULT_FORMAT_VERSION &&
    isSecretVaultDescriptor(value.descriptor) &&
    isRecord(encryption) &&
    encryption.algorithm === ENCRYPTION_ALGORITHM &&
    isSecretVaultKdf(encryption.kdf) &&
    typeof encryption.iv === "string" &&
    typeof encryption.authTag === "string" &&
    typeof value.ciphertext === "string"
  );
}

function isSecretVaultDescriptor(value: unknown): value is SecretVaultDescriptor {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    typeof value.secretId === "string" &&
    (value.label === undefined || typeof value.label === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.version === "number" &&
    value.redacted === true &&
    value.encrypted === true &&
    value.valueRedacted === true &&
    typeof value.metadataKeyCount === "number" &&
    value.metadataRedacted === true
  );
}

function isSecretVaultKdf(value: unknown): value is SecretVaultKdf {
  if (!isRecord(value)) {
    return false;
  }

  if (value.name === "none") {
    return value.keyLength === KEY_LENGTH_BYTES;
  }

  return (
    value.name === "scrypt" &&
    typeof value.salt === "string" &&
    typeof value.cost === "number" &&
    typeof value.blockSize === "number" &&
    typeof value.parallelization === "number" &&
    value.keyLength === KEY_LENGTH_BYTES
  );
}

function isSecretVaultPayload(value: unknown): value is SecretVaultPayload {
  return isRecord(value) && typeof value.value === "string" && isRecord(value.metadata);
}

function createReceipt(event: SecretVaultAuditEvent): SecretVaultReceipt {
  return {
    kind: "secret_vault_access",
    capturedAt: event.timestamp,
    status: event.result,
    descriptor: event.descriptor,
    descriptors: event.descriptors,
    metadata: {
      eventId: event.id,
      action: event.action,
      workspaceId: event.workspaceId,
      secretId: event.secretId,
      descriptorCount: event.descriptors?.length,
      reason: event.reason
    }
  };
}

function buildSecretNeedles(
  secrets: Iterable<string | SecretRedactionSource>,
  options: SecretRedactionOptions
): SecretNeedle[] {
  const includeEncodedVariants = options.includeEncodedVariants ?? true;
  const needles: SecretNeedle[] = [];
  const seen = new Set<string>();

  for (const secret of secrets) {
    const value = typeof secret === "string" ? secret : secret.value;
    const replacement =
      typeof secret === "string"
        ? options.replacement ?? DEFAULT_SECRET_REPLACEMENT
        : secret.replacement ?? options.replacement ?? DEFAULT_SECRET_REPLACEMENT;
    if (value.length === 0) {
      continue;
    }

    for (const variant of secretVariants(value, includeEncodedVariants)) {
      if (variant.length === 0 || seen.has(variant)) {
        continue;
      }
      seen.add(variant);
      needles.push({ value: variant, replacement });
    }
  }

  return needles.sort((left, right) => right.value.length - left.value.length);
}

function secretVariants(value: string, includeEncodedVariants: boolean): string[] {
  if (!includeEncodedVariants) {
    return [value];
  }

  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  return [value, encodeURIComponent(value), jsonEscaped];
}

function redactValue(value: unknown, needles: readonly SecretNeedle[], seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") {
    return redactString(value, needles);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const redactedArray: unknown[] = [];
    seen.set(value, redactedArray);
    for (const item of value) {
      redactedArray.push(redactValue(item, needles, seen));
    }
    return redactedArray;
  }

  if (Buffer.isBuffer(value) || value instanceof Date) {
    return value;
  }

  const redactedRecord: Record<string, unknown> = {};
  seen.set(value, redactedRecord);
  for (const [key, item] of Object.entries(value)) {
    redactedRecord[redactString(key, needles)] = redactValue(item, needles, seen);
  }

  return redactedRecord;
}

function redactString(value: string, needles: readonly SecretNeedle[]): string {
  let redacted = value;
  for (const needle of needles) {
    redacted = redacted.split(needle.value).join(needle.replacement);
  }

  return redacted;
}

async function listChildDirectories(rootDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(rootDir, entry.name));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listJsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await fs.rmdir(directory);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTEMPTY")) {
      return;
    }
    throw error;
  }
}

function storageToken(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function createSecretVaultEventId(): string {
  return `secret_vault_event_${randomBytes(6).toString("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
