import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import { copyFile, lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { isPathInsideOrEqual, resolveSafePath, SandboxPathError, type SafeResolvedPath } from "./pathSafety.js";
import {
  readRollbackBundleManifest,
  ROLLBACK_BUNDLE_VERSION,
  type RollbackBundleEntry,
  type RollbackBundleManifest,
} from "./rollbackBundle.js";

export type RollbackApplyAction = "delete" | "restore";
export type RollbackApplyStatus = "applied" | "would_apply" | "skipped" | "error";
export type RollbackApplyReason =
  | "before_file_mismatch"
  | "dry_run"
  | "invalid_manifest"
  | "io_error"
  | "missing_before_file"
  | "missing_restore_metadata"
  | "source_outside_bundle"
  | "source_outside_bundle_files"
  | "source_not_file"
  | "target_missing"
  | "target_not_file"
  | "target_outside_workspace"
  | "target_workspace_root"
  | "unsupported_action";

export interface RollbackApplyOptions {
  workspaceRoot: string;
  manifestPath?: string;
  manifest?: RollbackBundleManifest;
  bundleDirectory?: string;
  dryRun?: boolean;
}

export interface RollbackApplyEntryResult {
  path: string;
  action: RollbackApplyAction;
  changeType?: RollbackBundleEntry["changeType"];
  status: RollbackApplyStatus;
  reason?: RollbackApplyReason;
  message?: string;
  targetPath?: string;
  sourcePath?: string;
  expectedSha256?: string;
  actualSha256?: string;
}

export interface RollbackApplyResult {
  dryRun: boolean;
  workspaceRoot: string;
  bundleDirectory: string;
  manifestPath?: string;
  entries: RollbackApplyEntryResult[];
  applied: RollbackApplyEntryResult[];
  wouldApply: RollbackApplyEntryResult[];
  skipped: RollbackApplyEntryResult[];
  errors: RollbackApplyEntryResult[];
}

interface VerifiedRestoreSource {
  resolved: SafeResolvedPath;
  sha256: string;
}

export async function applyRollbackBundle(options: RollbackApplyOptions): Promise<RollbackApplyResult> {
  const dryRun = options.dryRun ?? false;
  const manifestPath = options.manifestPath ? path.resolve(options.manifestPath) : undefined;
  const manifest = options.manifest ?? (await readManifestOption(manifestPath));
  const bundleDirectory = resolveBundleDirectory(options.bundleDirectory, manifestPath);
  const result: RollbackApplyResult = {
    dryRun,
    workspaceRoot: path.resolve(options.workspaceRoot),
    bundleDirectory,
    manifestPath,
    entries: [],
    applied: [],
    wouldApply: [],
    skipped: [],
    errors: [],
  };

  const manifestError = validateManifest(manifest);
  if (manifestError) {
    addResult(result, {
      path: ".",
      action: "restore",
      status: "error",
      reason: "invalid_manifest",
      message: manifestError,
    });
    return result;
  }

  for (const entry of manifest.entries) {
    const entryResult = await applyRollbackEntry(entry, {
      dryRun,
      workspaceRoot: result.workspaceRoot,
      bundleDirectory,
    });
    addResult(result, entryResult);
  }

  return result;
}

async function applyRollbackEntry(
  entry: RollbackBundleEntry,
  context: { dryRun: boolean; workspaceRoot: string; bundleDirectory: string },
): Promise<RollbackApplyEntryResult> {
  const action = entry.rollbackAction;

  if (action !== "delete" && action !== "restore") {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "error",
      reason: "unsupported_action",
      message: `Unsupported rollback action: ${String(action)}`,
    };
  }

  const target = resolveWorkspaceTarget(context.workspaceRoot, entry.path, action, entry.changeType);
  if ("status" in target) {
    return target;
  }

  try {
    if (action === "delete") {
      return await deleteAddedFile(entry, target, context.dryRun);
    }

    return await restoreBeforeFile(entry, target, context);
  } catch (error) {
    return {
      path: entry.path,
      action,
      changeType: entry.changeType,
      status: "error",
      reason: "io_error",
      message: error instanceof Error ? error.message : String(error),
      targetPath: target.absolutePath,
    };
  }
}

async function deleteAddedFile(
  entry: RollbackBundleEntry,
  target: SafeResolvedPath,
  dryRun: boolean,
): Promise<RollbackApplyEntryResult> {
  const targetStat = await lstatIfExists(target.absolutePath);
  if (!targetStat) {
    return {
      path: entry.path,
      action: "delete",
      changeType: entry.changeType,
      status: "skipped",
      reason: "target_missing",
      message: `Target is already absent: ${entry.path}`,
      targetPath: target.absolutePath,
    };
  }

  if (targetStat.isDirectory()) {
    return {
      path: entry.path,
      action: "delete",
      changeType: entry.changeType,
      status: "error",
      reason: "target_not_file",
      message: `Rollback delete refuses to remove a directory: ${entry.path}`,
      targetPath: target.absolutePath,
    };
  }

  if (dryRun) {
    return {
      path: entry.path,
      action: "delete",
      changeType: entry.changeType,
      status: "would_apply",
      reason: "dry_run",
      targetPath: target.absolutePath,
    };
  }

  await rm(target.absolutePath, { force: true });
  return {
    path: entry.path,
    action: "delete",
    changeType: entry.changeType,
    status: "applied",
    targetPath: target.absolutePath,
  };
}

async function restoreBeforeFile(
  entry: RollbackBundleEntry,
  target: SafeResolvedPath,
  context: { dryRun: boolean; bundleDirectory: string },
): Promise<RollbackApplyEntryResult> {
  const source = await verifyRestoreSource(entry, context.bundleDirectory);
  if ("status" in source) {
    return {
      ...source,
      targetPath: target.absolutePath,
    };
  }

  const targetStat = await lstatIfExists(target.absolutePath);
  if (targetStat?.isDirectory()) {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "error",
      reason: "target_not_file",
      message: `Rollback restore refuses to replace a directory: ${entry.path}`,
      targetPath: target.absolutePath,
      sourcePath: source.resolved.absolutePath,
      expectedSha256: entry.before?.sha256,
      actualSha256: source.sha256,
    };
  }

  if (context.dryRun) {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "would_apply",
      reason: "dry_run",
      targetPath: target.absolutePath,
      sourcePath: source.resolved.absolutePath,
      expectedSha256: entry.before?.sha256,
      actualSha256: source.sha256,
    };
  }

  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  if (targetStat?.isSymbolicLink()) {
    await rm(target.absolutePath, { force: true });
  }
  await copyFile(source.resolved.absolutePath, target.absolutePath);

  return {
    path: entry.path,
    action: "restore",
    changeType: entry.changeType,
    status: "applied",
    targetPath: target.absolutePath,
    sourcePath: source.resolved.absolutePath,
    expectedSha256: entry.before?.sha256,
    actualSha256: source.sha256,
  };
}

async function verifyRestoreSource(
  entry: RollbackBundleEntry,
  bundleDirectory: string,
): Promise<VerifiedRestoreSource | RollbackApplyEntryResult> {
  if (!entry.before || !entry.restoreFrom) {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "error",
      reason: "missing_restore_metadata",
      message: `Restore entry is missing before metadata or restoreFrom: ${entry.path}`,
    };
  }

  let resolved: SafeResolvedPath;
  try {
    resolved = resolveSafePath(bundleDirectory, entry.restoreFrom);
  } catch (error) {
    return sourceSafetyError(entry, error, "source_outside_bundle");
  }

  const bundleFilesRoot = path.join(bundleDirectory, "files");
  if (!isPathInsideOrEqual(bundleFilesRoot, resolved.absolutePath)) {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "error",
      reason: "source_outside_bundle_files",
      message: `Restore source is outside the bundle files directory: ${entry.restoreFrom}`,
      sourcePath: resolved.absolutePath,
      expectedSha256: entry.before.sha256,
    };
  }

  const sourceStat = await lstatIfExists(resolved.absolutePath);
  if (!sourceStat) {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "skipped",
      reason: "missing_before_file",
      message: `Rollback before-file is missing: ${entry.restoreFrom}`,
      sourcePath: resolved.absolutePath,
      expectedSha256: entry.before.sha256,
    };
  }

  if (!sourceStat.isFile()) {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "error",
      reason: "source_not_file",
      message: `Rollback before-file is not a regular file: ${entry.restoreFrom}`,
      sourcePath: resolved.absolutePath,
      expectedSha256: entry.before.sha256,
    };
  }

  const actualSha256 = await sha256File(resolved.absolutePath);
  if (actualSha256 !== entry.before.sha256 || sourceStat.size !== entry.before.sizeBytes) {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "error",
      reason: "before_file_mismatch",
      message: `Rollback before-file does not match manifest metadata: ${entry.path}`,
      sourcePath: resolved.absolutePath,
      expectedSha256: entry.before.sha256,
      actualSha256,
    };
  }

  return {
    resolved,
    sha256: actualSha256,
  };
}

function resolveWorkspaceTarget(
  workspaceRoot: string,
  requestedPath: string,
  action: RollbackApplyAction,
  changeType?: RollbackBundleEntry["changeType"],
): SafeResolvedPath | RollbackApplyEntryResult {
  try {
    return resolveSafePath(workspaceRoot, requestedPath);
  } catch (error) {
    if (error instanceof SandboxPathError) {
      return {
        path: requestedPath,
        action,
        changeType,
        status: "error",
        reason: error.code === "PATH_ROOT_NOT_ALLOWED" ? "target_workspace_root" : "target_outside_workspace",
        message: error.message,
        targetPath: error.resolvedPath,
      };
    }

    throw error;
  }
}

function sourceSafetyError(
  entry: RollbackBundleEntry,
  error: unknown,
  reason: RollbackApplyReason,
): RollbackApplyEntryResult {
  if (error instanceof SandboxPathError) {
    return {
      path: entry.path,
      action: "restore",
      changeType: entry.changeType,
      status: "error",
      reason,
      message: error.message,
      sourcePath: error.resolvedPath,
      expectedSha256: entry.before?.sha256,
    };
  }

  throw error;
}

function validateManifest(manifest: RollbackBundleManifest): string | undefined {
  if (manifest.version !== ROLLBACK_BUNDLE_VERSION) {
    return `Unsupported rollback bundle version: ${String(manifest.version)}`;
  }

  if (manifest.kind !== "rollback-bundle") {
    return `Unsupported rollback manifest kind: ${String(manifest.kind)}`;
  }

  if (!Array.isArray(manifest.entries)) {
    return "Rollback manifest entries must be an array.";
  }

  return undefined;
}

function addResult(result: RollbackApplyResult, entry: RollbackApplyEntryResult): void {
  result.entries.push(entry);

  if (entry.status === "applied") {
    result.applied.push(entry);
    return;
  }

  if (entry.status === "would_apply") {
    result.wouldApply.push(entry);
    return;
  }

  if (entry.status === "skipped") {
    result.skipped.push(entry);
    return;
  }

  result.errors.push(entry);
}

async function readManifestOption(manifestPath: string | undefined): Promise<RollbackBundleManifest> {
  if (!manifestPath) {
    throw new Error("applyRollbackBundle requires either manifest or manifestPath.");
  }

  return readRollbackBundleManifest(manifestPath);
}

function resolveBundleDirectory(bundleDirectory: string | undefined, manifestPath: string | undefined): string {
  if (bundleDirectory) {
    return path.resolve(bundleDirectory);
  }

  if (manifestPath) {
    return path.dirname(manifestPath);
  }

  throw new Error("applyRollbackBundle requires bundleDirectory when manifest is provided without manifestPath.");
}

async function lstatIfExists(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Uint8Array) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return hash.digest("hex");
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
