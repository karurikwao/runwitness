import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildEnforcedSandboxInvocation,
  createEnforcedSandboxPlan,
  EnforcedSandboxError,
  runEnforcedSandbox,
  type EnforcedSandboxNetworkMode,
} from "../packages/sandbox/src/index.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-enforced-sandbox-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("enforced sandbox container invocation", () => {
  it("builds a Docker invocation with disabled network and read-only workspace by default", () => {
    const invocation = buildEnforcedSandboxInvocation({
      workspaceRoot: root,
      image: "node:22-alpine",
      command: ["npm", "test"],
    });

    expect(invocation.executable).toBe("docker");
    expect(invocation.args).toEqual([
      "run",
      "--rm",
      "--network",
      "none",
      "--workdir",
      "/workspace",
      "--mount",
      `type=bind,source=${path.resolve(root)},target=/workspace,readonly`,
      "node:22-alpine",
      "npm",
      "test",
    ]);
    expect(invocation.plan).toMatchObject({
      networkMode: "disabled",
      networkArgument: "none",
      readOnlyWorkspace: true,
      containerEnvKeys: [],
      omittedEnvKeys: [],
    });
  });

  it("maps supported network modes to explicit container runtime flags", () => {
    const cases: Array<[EnforcedSandboxNetworkMode, string]> = [
      ["disabled", "none"],
      ["host", "host"],
      ["bridge", "bridge"],
    ];

    for (const [networkMode, expectedRuntimeValue] of cases) {
      expect(
        createEnforcedSandboxPlan({
          workspaceRoot: root,
          image: "alpine:3.20",
          command: ["true"],
          networkMode,
        }),
      ).toMatchObject({
        networkMode,
        networkArgument: expectedRuntimeValue,
      });
    }
  });

  it("supports Podman-style invocations and an explicit read-write workspace", () => {
    const invocation = buildEnforcedSandboxInvocation({
      runtime: "podman",
      workspaceRoot: root,
      workspaceMountPath: "/repo",
      workdir: "/repo/src",
      image: "node:22-alpine",
      command: ["npm", "run", "build"],
      networkMode: "bridge",
      readOnlyWorkspace: false,
    });

    expect(invocation.executable).toBe("podman");
    expect(invocation.args).toEqual([
      "run",
      "--rm",
      "--network",
      "bridge",
      "--workdir",
      "/repo/src",
      "--mount",
      `type=bind,source=${path.resolve(root)},target=/repo`,
      "node:22-alpine",
      "npm",
      "run",
      "build",
    ]);
    expect(invocation.plan.warnings).toContain("Workspace is mounted read-write.");
  });

  it("validates additional bind mounts against the workspace root", () => {
    const cachePath = path.join(root, "cache");
    const invocation = buildEnforcedSandboxInvocation({
      workspaceRoot: root,
      image: "alpine:3.20",
      command: ["sh", "-lc", "ls /cache"],
      mounts: [{ source: cachePath, target: "/cache" }],
    });

    expect(invocation.plan.mounts.map((mount) => `${mount.kind}:${mount.workspaceRelativePath}:${mount.target}`)).toEqual([
      "workspace:.:/workspace",
      "additional:cache:/cache",
    ]);

    expect(() =>
      buildEnforcedSandboxInvocation({
        workspaceRoot: root,
        image: "alpine:3.20",
        command: ["true"],
        mounts: [{ source: path.join(root, "..", "outside"), target: "/outside" }],
      }),
    ).toThrowError(EnforcedSandboxError);
  });

  it("does not allow read-write workspace mounts when read-only workspace mode is enabled", () => {
    expect(() =>
      buildEnforcedSandboxInvocation({
        workspaceRoot: root,
        image: "alpine:3.20",
        command: ["true"],
        readOnlyWorkspace: true,
        mounts: [{ source: "scratch", target: "/scratch", readOnly: false }],
      }),
    ).toThrowError(EnforcedSandboxError);
  });

  it("passes only allowlisted environment keys through container --env flags", () => {
    const invocation = buildEnforcedSandboxInvocation({
      workspaceRoot: root,
      image: "alpine:3.20",
      command: ["env"],
      baseEnv: {
        PATH: "/usr/bin",
        ALLOWED_FROM_BASE: "base",
        SECRET_TOKEN: "blocked",
      },
      env: {
        ALLOWED_FROM_EXTRA: "extra",
        OMITTED_EXTRA: "omitted",
      },
      envAllowlist: ["ALLOWED_FROM_BASE", "ALLOWED_FROM_EXTRA"],
    });

    expect(invocation.args).toEqual(
      expect.arrayContaining(["--env", "ALLOWED_FROM_BASE", "--env", "ALLOWED_FROM_EXTRA"]),
    );
    expect(invocation.args.join(" ")).not.toContain("extra");
    expect(invocation.args.join(" ")).not.toContain("base");
    expect(invocation.env.ALLOWED_FROM_BASE).toBe("base");
    expect(invocation.env.ALLOWED_FROM_EXTRA).toBe("extra");
    expect(invocation.env.SECRET_TOKEN).toBeUndefined();
    expect(invocation.plan.omittedEnvKeys).toEqual(["OMITTED_EXTRA"]);
  });

  it("dry-runs without invoking a runner and delegates non-dry runs to the supplied runner", async () => {
    let calls = 0;
    const options = {
      workspaceRoot: root,
      image: "alpine:3.20",
      command: ["false"],
      networkMode: "host" as const,
      runner: async () => {
        calls += 1;
        return {
          exitCode: 7,
          stdout: "out",
          stderr: "err",
        };
      },
    };

    const dryRun = await runEnforcedSandbox({ ...options, dryRun: true });
    expect(dryRun).toMatchObject({
      status: "dry-run",
      dryRun: true,
      exitCode: null,
    });
    expect(calls).toBe(0);

    const executed = await runEnforcedSandbox(options);
    expect(executed).toMatchObject({
      status: "failed",
      dryRun: false,
      exitCode: 7,
      stdout: "out",
      stderr: "err",
      plan: {
        networkMode: "host",
        networkArgument: "host",
      },
    });
    expect(calls).toBe(1);
  });
});
