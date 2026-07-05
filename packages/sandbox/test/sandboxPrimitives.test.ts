import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFilteredEnvironment,
  checkWritePath,
  createIsolatedTempWorkspace,
  createRollbackBaseline,
  createRollbackBundle,
  createWorkspaceSnapshot,
  preflightCommandWrites,
  readRollbackBundleManifest,
  resolveSafePath,
  SandboxPathError,
} from "../src/index.js";

let root: string;

async function writeFile(relativePath: string, contents: string, base = root): Promise<void> {
  const target = path.join(base, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-sandbox-primitives-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("filtered environment builder", () => {
  it("removes secret-like keys and filters PATH entries to absolute allowed roots", async () => {
    const tools = path.join(root, "tools");
    const blockedTools = path.join(root, "blocked-tools");
    await fs.mkdir(tools, { recursive: true });
    await fs.mkdir(blockedTools, { recursive: true });

    const result = buildFilteredEnvironment({
      baseEnv: {
        Path: [tools, "relative-bin", blockedTools, tools].join(path.delimiter),
        APIKEY: "secret",
        AUTHORIZATION: "Bearer secret",
        GITHUB_TOKEN: "secret",
        USERNAME: "local-user",
        CUSTOM_VALUE: "not-allowed-by-default",
      },
      extraEnv: {
        EXTRA_APIKEY: "secret",
        EXTRA_AUTHORIZATION: "Bearer secret",
      },
      allowedPathRoots: [root],
      blockedPathRoots: [blockedTools],
    });

    expect(result.env.APIKEY).toBeUndefined();
    expect(result.env.AUTHORIZATION).toBeUndefined();
    expect(result.env.USERNAME).toBe("local-user");
    expect(result.env.GITHUB_TOKEN).toBeUndefined();
    expect(result.env.EXTRA_APIKEY).toBeUndefined();
    expect(result.env.EXTRA_AUTHORIZATION).toBeUndefined();
    expect(result.env.CUSTOM_VALUE).toBeUndefined();
    expect(result.pathKey).toBe("Path");
    expect(result.env.Path).toBe(tools);
    expect(result.removedKeys).toEqual([
      "APIKEY",
      "AUTHORIZATION",
      "CUSTOM_VALUE",
      "EXTRA_APIKEY",
      "EXTRA_AUTHORIZATION",
      "GITHUB_TOKEN",
    ]);
    expect(result.removedPathEntries).toEqual(["relative-bin", blockedTools, tools]);
  });
});

describe("safe path and write policy checks", () => {
  it("keeps resolved paths inside the workspace root", () => {
    const resolved = resolveSafePath(root, "src/app.ts");
    expect(resolved.relativePath).toBe("src/app.ts");
    expect(resolved.absolutePath).toBe(path.join(root, "src", "app.ts"));

    expect(() => resolveSafePath(root, "../outside.txt")).toThrow(SandboxPathError);
  });

  it("applies protected path deny lists before write allowlists", () => {
    expect(
      checkWritePath("src/generated.txt", {
        workspaceRoot: root,
        allowedWritePaths: ["src"],
      }),
    ).toMatchObject({ allowed: true, relativePath: "src/generated.txt" });

    expect(
      checkWritePath("docs/generated.txt", {
        workspaceRoot: root,
        allowedWritePaths: ["src"],
      }),
    ).toMatchObject({ allowed: false, code: "not_allowlisted" });

    expect(
      checkWritePath(".git/config", {
        workspaceRoot: root,
        allowedWritePaths: ["."],
      }),
    ).toMatchObject({ allowed: false, code: "protected_path" });

    expect(
      checkWritePath("secrets/token.txt", {
        workspaceRoot: root,
        allowedWritePaths: ["."],
        protectedPaths: ["secrets/*"],
      }),
    ).toMatchObject({ allowed: false, code: "protected_path" });

    expect(
      checkWritePath(".runwitness/config.yml", {
        workspaceRoot: root,
        allowedWritePaths: ["."],
        protectedPaths: [".runwitness/**"],
      }),
    ).toMatchObject({ allowed: false, code: "protected_path" });
  });
});

describe("command write preflight", () => {
  it("detects redirection targets and obvious destructive write operands", () => {
    const result = preflightCommandWrites("echo hi > src/out.txt && del .git/config", {
      workspaceRoot: root,
      allowedWritePaths: ["src"],
    });

    expect(result.detectedWrites.map((write) => `${write.intent}:${write.path}:${write.check.allowed}`)).toEqual([
      "redirect:src/out.txt:true",
      "delete:.git/config:false",
    ]);
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.check.code).toBe("protected_path");
  });

  it("detects PowerShell write and delete cmdlets", () => {
    const result = preflightCommandWrites(
      "Set-Content -Path .runwitness/config.yml -Value weak; Remove-Item user.policy.yml",
      {
        workspaceRoot: root,
        allowedWritePaths: ["."],
        protectedPaths: [".runwitness/**", "user.policy.yml"],
      },
    );

    expect(result.detectedWrites.map((write) => `${write.command}:${write.intent}:${write.path}:${write.check.code}`)).toEqual([
      "set-content:write:.runwitness/config.yml:protected_path",
      "remove-item:delete:user.policy.yml:protected_path",
    ]);
    expect(result.allowed).toBe(false);
  });
});

describe("rollback bundles", () => {
  it("creates a rollback bundle with verified before-file contents", async () => {
    const workspace = path.join(root, "workspace");
    const outputDirectory = path.join(root, "bundles");
    await writeFile("keep.txt", "keep", workspace);
    await writeFile("modify.txt", "before", workspace);
    await writeFile("delete.txt", "delete me", workspace);

    const baseline = await createRollbackBaseline(workspace, {
      outputDirectory,
      baselineName: "before",
      createdAt: "2026-07-05T00:00:00.000Z",
    });

    await fs.rm(path.join(workspace, "delete.txt"));
    await writeFile("modify.txt", "after", workspace);
    await writeFile("add.txt", "new", workspace);

    const afterSnapshot = await createWorkspaceSnapshot(workspace);
    const bundle = await createRollbackBundle({
      beforeSnapshot: baseline.snapshot,
      afterSnapshot,
      beforeFilesRoot: baseline.filesRoot,
      outputDirectory,
      bundleName: "rollback",
      createdAt: "2026-07-05T00:01:00.000Z",
    });

    expect(bundle.manifest.entries.map((entry) => `${entry.changeType}:${entry.path}:${entry.rollbackAction}`)).toEqual([
      "added:add.txt:delete",
      "deleted:delete.txt:restore",
      "modified:modify.txt:restore",
    ]);
    await expect(fs.readFile(path.join(bundle.directory, "files", "delete.txt"), "utf8")).resolves.toBe("delete me");
    await expect(fs.readFile(path.join(bundle.directory, "files", "modify.txt"), "utf8")).resolves.toBe("before");
    await expect(readRollbackBundleManifest(bundle.manifestPath)).resolves.toMatchObject({
      kind: "rollback-bundle",
      changes: {
        added: ["add.txt"],
        deleted: ["delete.txt"],
        modified: ["modify.txt"],
      },
    });
  });
});

describe("isolated temp workspaces", () => {
  it("copies tracked workspace files into a disposable workspace and skips runtime folders", async () => {
    const workspace = path.join(root, "workspace");
    const tempRoot = path.join(root, "tmp");
    await writeFile("src/app.ts", "tracked", workspace);
    await writeFile("node_modules/pkg/index.js", "ignored", workspace);
    await writeFile(".git/config", "ignored", workspace);

    const isolated = await createIsolatedTempWorkspace({
      sourceWorkspace: workspace,
      tempRoot,
      environment: {
        baseEnv: {
          Path: path.join(root, "tools"),
          SECRET_TOKEN: "hidden",
        },
        pathEntries: [path.join(root, "tools")],
        allowedPathRoots: [root],
      },
    });

    try {
      expect(await pathExists(path.join(isolated.workspaceRoot, "src", "app.ts"))).toBe(true);
      expect(await pathExists(path.join(isolated.workspaceRoot, "node_modules"))).toBe(false);
      expect(await pathExists(path.join(isolated.workspaceRoot, ".git"))).toBe(false);
      expect(isolated.environment.env.SECRET_TOKEN).toBeUndefined();
      expect(isolated.environment.env.RUNWITNESS_SANDBOX_WORKSPACE).toBe(isolated.workspaceRoot);

      await writeFile("src/generated.ts", "isolated only", isolated.workspaceRoot);
      expect(await pathExists(path.join(workspace, "src", "generated.ts"))).toBe(false);

      const snapshot = await isolated.createSnapshot();
      expect(snapshot.files.map((file) => file.path).sort()).toEqual(["src/app.ts", "src/generated.ts"]);
    } finally {
      const tempWorkspaceRoot = isolated.tempRoot;
      await isolated.cleanup();
      expect(await pathExists(tempWorkspaceRoot)).toBe(false);
    }
  });

  it("does not recursively copy a temp root located inside the source workspace", async () => {
    await writeFile("src/app.ts", "tracked");

    const isolated = await createIsolatedTempWorkspace({
      sourceWorkspace: root,
      tempRoot: path.join(root, "tmp"),
    });

    try {
      expect(await pathExists(path.join(isolated.workspaceRoot, "src", "app.ts"))).toBe(true);
      expect(await pathExists(path.join(isolated.workspaceRoot, "tmp"))).toBe(false);
    } finally {
      await isolated.cleanup();
    }
  });
});
