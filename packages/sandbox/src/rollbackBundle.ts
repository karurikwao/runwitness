import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createWorkspaceSnapshot,
  diffWorkspaceSnapshots,
  normalizeRelativePath,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotDiff,
  type WorkspaceSnapshotFile,
  type WorkspaceSnapshotOptions,
} from "./workspaceSnapshot.js";
import { resolveSafePath } from "./pathSafety.js";

export const ROLLBACK_BUNDLE_VERSION = 1 as const;

export interface RollbackBaselineOptions {
  outputDirectory: string;
  snapshotOptions?: WorkspaceSnapshotOptions;
  baselineName?: string;
  createdAt?: string | Date;
}

export interface RollbackBaselineManifest {
  version: typeof ROLLBACK_BUNDLE_VERSION;
  kind: "rollback-baseline";
  createdAt: string;
  workspaceRoot: string;
  filesRoot: string;
  snapshot: WorkspaceSnapshot;
}

export interface RollbackBaseline {
  directory: string;
  filesRoot: string;
  manifestPath: string;
  manifest: RollbackBaselineManifest;
  snapshot: WorkspaceSnapshot;
}

export interface RollbackBundleOptions {
  beforeSnapshot: WorkspaceSnapshot;
  afterSnapshot: WorkspaceSnapshot;
  beforeFilesRoot: string;
  outputDirectory: string;
  workspaceRoot?: string;
  bundleName?: string;
  createdAt?: string | Date;
}

export interface RollbackBundleEntry {
  path: string;
  changeType: "added" | "modified" | "deleted";
  rollbackAction: "delete" | "restore";
  before?: WorkspaceSnapshotFile;
  after?: WorkspaceSnapshotFile;
  restoreFrom?: string;
}

export interface RollbackBundleManifest {
  version: typeof ROLLBACK_BUNDLE_VERSION;
  kind: "rollback-bundle";
  createdAt: string;
  workspaceRoot: string;
  beforeRoot: string;
  afterRoot: string;
  ignoredNames: string[];
  changes: WorkspaceSnapshotDiff["changed"];
  entries: RollbackBundleEntry[];
}

export interface RollbackBundle {
  directory: string;
  filesRoot: string;
  manifestPath: string;
  manifest: RollbackBundleManifest;
}

export async function createRollbackBaseline(
  workspaceRoot: string,
  options: RollbackBaselineOptions,
): Promise<RollbackBaseline> {
  const snapshot = await createWorkspaceSnapshot(workspaceRoot, options.snapshotOptions);
  const createdAt = toIsoTimestamp(options.createdAt);
  const directory = path.join(path.resolve(options.outputDirectory), options.baselineName ?? timestampedName("baseline", createdAt));
  const filesRoot = path.join(directory, "files");

  await mkdir(filesRoot, { recursive: true });

  for (const file of snapshot.files) {
    const source = resolveSafePath(snapshot.root, file.path).absolutePath;
    const target = resolveSafePath(filesRoot, file.path).absolutePath;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  const manifest: RollbackBaselineManifest = {
    version: ROLLBACK_BUNDLE_VERSION,
    kind: "rollback-baseline",
    createdAt,
    workspaceRoot: snapshot.root,
    filesRoot,
    snapshot,
  };
  const manifestPath = path.join(directory, "baseline.json");
  await writeJson(manifestPath, manifest);

  return {
    directory,
    filesRoot,
    manifestPath,
    manifest,
    snapshot,
  };
}

export async function createRollbackBundle(options: RollbackBundleOptions): Promise<RollbackBundle> {
  const createdAt = toIsoTimestamp(options.createdAt);
  const directory = path.join(path.resolve(options.outputDirectory), options.bundleName ?? timestampedName("rollback", createdAt));
  const filesRoot = path.join(directory, "files");
  const beforeFilesRoot = path.resolve(options.beforeFilesRoot);
  const diff = diffWorkspaceSnapshots(options.beforeSnapshot, options.afterSnapshot);
  const entries: RollbackBundleEntry[] = [];

  await mkdir(filesRoot, { recursive: true });

  for (const file of diff.deleted) {
    const restoreFrom = await copyBeforeFile(file, beforeFilesRoot, directory, filesRoot);
    entries.push({
      path: file.path,
      changeType: "deleted",
      rollbackAction: "restore",
      before: file,
      restoreFrom,
    });
  }

  for (const change of diff.modified) {
    const restoreFrom = await copyBeforeFile(change.before, beforeFilesRoot, directory, filesRoot);
    entries.push({
      path: change.path,
      changeType: "modified",
      rollbackAction: "restore",
      before: change.before,
      after: change.after,
      restoreFrom,
    });
  }

  for (const file of diff.added) {
    entries.push({
      path: file.path,
      changeType: "added",
      rollbackAction: "delete",
      after: file,
    });
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));

  const manifest: RollbackBundleManifest = {
    version: ROLLBACK_BUNDLE_VERSION,
    kind: "rollback-bundle",
    createdAt,
    workspaceRoot: path.resolve(options.workspaceRoot ?? options.afterSnapshot.root),
    beforeRoot: options.beforeSnapshot.root,
    afterRoot: options.afterSnapshot.root,
    ignoredNames: options.afterSnapshot.ignoredNames,
    changes: diff.changed,
    entries,
  };
  const manifestPath = path.join(directory, "rollback.json");
  await writeJson(manifestPath, manifest);

  return {
    directory,
    filesRoot,
    manifestPath,
    manifest,
  };
}

export async function readRollbackBundleManifest(manifestPath: string): Promise<RollbackBundleManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as RollbackBundleManifest;
}

async function copyBeforeFile(
  file: WorkspaceSnapshotFile,
  beforeFilesRoot: string,
  bundleDirectory: string,
  filesRoot: string,
): Promise<string> {
  const source = resolveSafePath(beforeFilesRoot, file.path).absolutePath;
  const actualSha256 = await sha256File(source);

  if (actualSha256 !== file.sha256) {
    throw new Error(`Rollback source does not match before snapshot for ${file.path}`);
  }

  const target = resolveSafePath(filesRoot, file.path).absolutePath;
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return normalizeRelativePath(path.relative(bundleDirectory, target));
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toIsoTimestamp(value: string | Date | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  return (value ?? new Date()).toISOString();
}

function timestampedName(prefix: string, timestamp: string): string {
  return `${prefix}-${timestamp.replace(/[:.]/g, "-")}`;
}
