import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const SNAPSHOT_VERSION = 1 as const;

export const DEFAULT_IGNORED_NAMES = [
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".runwitness",
  "receipts",
] as const;

export interface WorkspaceSnapshotOptions {
  ignoreNames?: readonly string[];
}

export interface WorkspaceSnapshotFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface WorkspaceSnapshot {
  version: typeof SNAPSHOT_VERSION;
  root: string;
  ignoredNames: string[];
  files: WorkspaceSnapshotFile[];
}

export interface WorkspaceSnapshotDiff {
  added: WorkspaceSnapshotFile[];
  modified: Array<{
    path: string;
    before: WorkspaceSnapshotFile;
    after: WorkspaceSnapshotFile;
  }>;
  deleted: WorkspaceSnapshotFile[];
  unchanged: string[];
  changed: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

function toIgnoredNameSet(ignoreNames: readonly string[] = DEFAULT_IGNORED_NAMES): Set<string> {
  return new Set(ignoreNames.map((name) => name.toLowerCase()));
}

function shouldIgnoreName(name: string, ignoredNames: Set<string>): boolean {
  return ignoredNames.has(name.toLowerCase());
}

export function shouldIgnorePath(relativePath: string, options: WorkspaceSnapshotOptions = {}): boolean {
  const ignoredNames = toIgnoredNameSet(options.ignoreNames);
  return normalizeRelativePath(relativePath)
    .split("/")
    .filter(Boolean)
    .some((segment) => shouldIgnoreName(segment, ignoredNames));
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

async function collectFiles(
  root: string,
  absoluteDirectory: string,
  ignoredNames: Set<string>,
  files: WorkspaceSnapshotFile[],
): Promise<void> {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldIgnoreName(entry.name, ignoredNames)) {
      continue;
    }

    const absolutePath = path.join(absoluteDirectory, entry.name);
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath));

    if (entry.isDirectory()) {
      await collectFiles(root, absolutePath, ignoredNames, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    files.push({
      path: relativePath,
      sha256: await sha256File(absolutePath),
      sizeBytes: fileStat.size,
    });
  }
}

export async function createWorkspaceSnapshot(
  rootPath: string,
  options: WorkspaceSnapshotOptions = {},
): Promise<WorkspaceSnapshot> {
  const root = path.resolve(rootPath);
  const rootStat = await stat(root);

  if (!rootStat.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${root}`);
  }

  const files: WorkspaceSnapshotFile[] = [];
  await collectFiles(root, root, toIgnoredNameSet(options.ignoreNames), files);
  files.sort((left, right) => left.path.localeCompare(right.path));

  return {
    version: SNAPSHOT_VERSION,
    root,
    ignoredNames: [...(options.ignoreNames ?? DEFAULT_IGNORED_NAMES)],
    files,
  };
}

function mapFilesByPath(snapshot: WorkspaceSnapshot): Map<string, WorkspaceSnapshotFile> {
  if (!Array.isArray(snapshot.files)) {
    throw new Error("Snapshot must contain a files array.");
  }

  return new Map(snapshot.files.map((file) => [file.path, file]));
}

export function diffWorkspaceSnapshots(
  beforeSnapshot: WorkspaceSnapshot,
  afterSnapshot: WorkspaceSnapshot,
): WorkspaceSnapshotDiff {
  const beforeFiles = mapFilesByPath(beforeSnapshot);
  const afterFiles = mapFilesByPath(afterSnapshot);
  const added: WorkspaceSnapshotFile[] = [];
  const deleted: WorkspaceSnapshotFile[] = [];
  const modified: WorkspaceSnapshotDiff["modified"] = [];
  const unchanged: string[] = [];

  for (const [filePath, afterFile] of afterFiles) {
    const beforeFile = beforeFiles.get(filePath);

    if (!beforeFile) {
      added.push(afterFile);
      continue;
    }

    if (beforeFile.sha256 !== afterFile.sha256) {
      modified.push({
        path: filePath,
        before: beforeFile,
        after: afterFile,
      });
      continue;
    }

    unchanged.push(filePath);
  }

  for (const [filePath, beforeFile] of beforeFiles) {
    if (!afterFiles.has(filePath)) {
      deleted.push(beforeFile);
    }
  }

  added.sort(compareByPath);
  deleted.sort(compareByPath);
  modified.sort(compareByPath);
  unchanged.sort((left, right) => left.localeCompare(right));

  return {
    added,
    modified,
    deleted,
    unchanged,
    changed: {
      added: added.map((file) => file.path),
      modified: modified.map((file) => file.path),
      deleted: deleted.map((file) => file.path),
    },
  };
}

function compareByPath<T extends { path: string }>(left: T, right: T): number {
  return left.path.localeCompare(right.path);
}

export async function writeWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  outputPath: string,
): Promise<void> {
  const targetPath = path.resolve(outputPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function readWorkspaceSnapshot(snapshotPath: string): Promise<WorkspaceSnapshot> {
  const rawSnapshot = await readFile(snapshotPath, "utf8");
  return JSON.parse(rawSnapshot) as WorkspaceSnapshot;
}
