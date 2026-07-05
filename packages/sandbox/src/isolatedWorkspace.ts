import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFilteredEnvironment, type FilteredEnvironment, type FilteredEnvironmentOptions } from "./environment.js";
import { isPathInsideOrEqual, resolveSafePath, type SafeResolvedPath } from "./pathSafety.js";
import {
  createWorkspaceSnapshot,
  DEFAULT_IGNORED_NAMES,
  normalizeRelativePath,
  shouldIgnorePath,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotOptions,
} from "./workspaceSnapshot.js";

export interface IsolatedTempWorkspaceOptions {
  sourceWorkspace: string;
  tempRoot?: string;
  workspaceName?: string;
  ignoreNames?: readonly string[];
  environment?: FilteredEnvironmentOptions;
}

export interface IsolatedTempWorkspace {
  sourceWorkspace: string;
  tempRoot: string;
  workspaceRoot: string;
  ignoredNames: string[];
  environment: FilteredEnvironment;
  resolvePath(targetPath: string): SafeResolvedPath;
  createSnapshot(options?: WorkspaceSnapshotOptions): Promise<WorkspaceSnapshot>;
  cleanup(): Promise<void>;
}

export async function createIsolatedTempWorkspace(
  options: IsolatedTempWorkspaceOptions,
): Promise<IsolatedTempWorkspace> {
  const sourceWorkspace = path.resolve(options.sourceWorkspace);
  const sourceStat = await stat(sourceWorkspace);

  if (!sourceStat.isDirectory()) {
    throw new Error(`Source workspace is not a directory: ${sourceWorkspace}`);
  }

  const tempParent = path.resolve(options.tempRoot ?? os.tmpdir());
  await mkdir(tempParent, { recursive: true });
  const tempRoot = await mkdtemp(path.join(tempParent, "runwitness-sandbox-"));
  const workspaceRoot = path.join(tempRoot, options.workspaceName ?? "workspace");
  const ignoredNames = [...(options.ignoreNames ?? DEFAULT_IGNORED_NAMES)];

  await mkdir(workspaceRoot, { recursive: true });
  await copyWorkspaceTree(sourceWorkspace, sourceWorkspace, workspaceRoot, ignoredNames, [tempRoot]);

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    await rm(tempRoot, { recursive: true, force: true });
  };

  return {
    sourceWorkspace,
    tempRoot,
    workspaceRoot,
    ignoredNames,
    environment: buildFilteredEnvironment({
      ...options.environment,
      extraEnv: {
        ...options.environment?.extraEnv,
        RUNWITNESS_SANDBOX_WORKSPACE: workspaceRoot,
      },
    }),
    resolvePath(targetPath: string): SafeResolvedPath {
      return resolveSafePath(workspaceRoot, targetPath);
    },
    createSnapshot(snapshotOptions: WorkspaceSnapshotOptions = {}): Promise<WorkspaceSnapshot> {
      return createWorkspaceSnapshot(workspaceRoot, {
        ignoreNames: snapshotOptions.ignoreNames ?? ignoredNames,
      });
    },
    cleanup,
  };
}

export async function withIsolatedTempWorkspace<T>(
  options: IsolatedTempWorkspaceOptions,
  callback: (workspace: IsolatedTempWorkspace) => Promise<T>,
): Promise<T> {
  const workspace = await createIsolatedTempWorkspace(options);

  try {
    return await callback(workspace);
  } finally {
    await workspace.cleanup();
  }
}

async function copyWorkspaceTree(
  sourceRoot: string,
  currentSource: string,
  currentTarget: string,
  ignoredNames: readonly string[],
  excludedAbsolutePaths: readonly string[],
): Promise<void> {
  const entries = await readdir(currentSource, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(currentSource, entry.name);
    const relativePath = normalizeRelativePath(path.relative(sourceRoot, sourcePath));

    if (shouldSkipExcludedPath(sourcePath, excludedAbsolutePaths)) {
      continue;
    }

    if (shouldIgnorePath(relativePath, { ignoreNames: ignoredNames }) || entry.isSymbolicLink()) {
      continue;
    }

    const targetPath = path.join(currentTarget, entry.name);

    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyWorkspaceTree(sourceRoot, sourcePath, targetPath, ignoredNames, excludedAbsolutePaths);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

function shouldSkipExcludedPath(sourcePath: string, excludedAbsolutePaths: readonly string[]): boolean {
  return excludedAbsolutePaths.some(
    (excludedPath) => isPathInsideOrEqual(excludedPath, sourcePath) || isPathInsideOrEqual(sourcePath, excludedPath),
  );
}
