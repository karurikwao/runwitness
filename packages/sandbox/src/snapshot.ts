import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileChange } from "@runwitness/core";

export interface FileSnapshotEntry {
  path: string;
  hash: string;
  sizeBytes: number;
}

export type WorkspaceSnapshot = Map<string, FileSnapshotEntry>;

export const DEFAULT_IGNORED_NAMES = [
  ".git",
  ".runwitness",
  "node_modules",
  "dist",
  "coverage",
  "receipts"
] as const;

const DEFAULT_IGNORES = new Set<string>(DEFAULT_IGNORED_NAMES);

export interface SnapshotOptions {
  ignoreNames?: Set<string>;
}

export async function snapshotWorkspace(root: string, options: SnapshotOptions = {}): Promise<WorkspaceSnapshot> {
  const ignoreNames = options.ignoreNames ?? DEFAULT_IGNORES;
  const snapshot: WorkspaceSnapshot = new Map();
  await walk(root, root, ignoreNames, snapshot);
  return snapshot;
}

export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): FileChange[] {
  const changes: FileChange[] = [];

  for (const [relativePath, beforeEntry] of before.entries()) {
    const afterEntry = after.get(relativePath);
    if (!afterEntry) {
      changes.push({
        path: relativePath,
        type: "deleted",
        beforeHash: beforeEntry.hash
      });
      continue;
    }

    if (beforeEntry.hash !== afterEntry.hash) {
      changes.push({
        path: relativePath,
        type: "modified",
        beforeHash: beforeEntry.hash,
        afterHash: afterEntry.hash,
        sizeBytes: afterEntry.sizeBytes
      });
    }
  }

  for (const [relativePath, afterEntry] of after.entries()) {
    if (!before.has(relativePath)) {
      changes.push({
        path: relativePath,
        type: "added",
        afterHash: afterEntry.hash,
        sizeBytes: afterEntry.sizeBytes
      });
    }
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(
  root: string,
  current: string,
  ignoreNames: Set<string>,
  snapshot: WorkspaceSnapshot
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ignoreNames.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await walk(root, absolutePath, ignoreNames, snapshot);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const bytes = await fs.readFile(absolutePath);
    const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, "/");
    snapshot.set(relativePath, {
      path: relativePath,
      hash: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength
    });
  }
}
