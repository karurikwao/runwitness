import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentAdapterRegistry,
  createDefaultAdapterRegistry,
  createHermesAdapter,
  createLocalCommandAdapter,
  createOpenClawAdapter
} from "../src/index.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-adapters-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("AgentAdapterRegistry", () => {
  it("registers, resolves, and lists adapters", () => {
    const local = createLocalCommandAdapter();
    const registry = new AgentAdapterRegistry([local]);

    expect(registry.has("local-command")).toBe(true);
    expect(registry.get("local-command")).toBe(local);
    expect(registry.require("local-command")).toBe(local);
    expect(registry.list().map((adapter) => adapter.id)).toEqual(["local-command"]);
  });

  it("guards duplicate adapter ids unless replacement is explicit", () => {
    const registry = new AgentAdapterRegistry([createLocalCommandAdapter()]);

    expect(() => registry.register(createLocalCommandAdapter())).toThrow(/already registered/);

    registry.register(createLocalCommandAdapter({ name: "Replacement" }), { replace: true });
    expect(registry.require("local-command").name).toBe("Replacement");
  });
});

describe("local command adapter", () => {
  it("runs commandParts through the local command runner", async () => {
    const adapter = createLocalCommandAdapter();
    const result = await adapter.run({
      task: "Print a marker",
      workspace: root,
      commandParts: [process.execPath, "-e", "console.log('adapter-ok')"]
    });

    expect(result).toMatchObject({
      adapterId: "local-command",
      status: "completed",
      exitCode: 0,
      cwd: root
    });
    expect(result.stdout.trim()).toBe("adapter-ok");
    expect(result.command).toContain("adapter-ok");
  });

  it("requires a command or commandParts", async () => {
    const adapter = createLocalCommandAdapter();

    await expect(
      adapter.run({
        task: "No command",
        workspace: root
      })
    ).rejects.toThrow(/requires command or commandParts/);
  });
});

describe("OpenClaw and Hermes command adapters", () => {
  it("builds a configurable OpenClaw invocation without requiring OpenClaw to be installed", () => {
    const adapter = createOpenClawAdapter({
      executable: "openclaw-test",
      extraArgs: ["--json"]
    });

    expect(adapter.buildInvocation({ task: "Fix tests", workspace: root, command: "npm test" })).toMatchObject({
      command: "openclaw-test",
      args: ["run", "--workspace", root, "--task", "Fix tests", "--command", "npm test", "--json"],
      cwd: root
    });
  });

  it("builds a configurable Hermes invocation without requiring Hermes to be installed", () => {
    const adapter = createHermesAdapter({
      executable: "hermes-test",
      baseArgs: ["exec"],
      taskFlag: "--prompt",
      commandFlag: false
    });

    expect(adapter.buildInvocation({ task: "Review adapters", workspace: root, command: "npm test" })).toMatchObject({
      command: "hermes-test",
      args: ["exec", "--workspace", root, "--prompt", "Review adapters"],
      cwd: root
    });
  });

  it("creates a default registry with local, OpenClaw, and Hermes adapters", () => {
    expect(createDefaultAdapterRegistry().list().map((adapter) => adapter.id)).toEqual([
      "local-command",
      "openclaw",
      "hermes"
    ]);
  });
});
