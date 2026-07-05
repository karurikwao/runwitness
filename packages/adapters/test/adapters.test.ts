import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentAdapterRegistry,
  createCommandAgentAdapter,
  createDefaultAdapterRegistry,
  createHermesAdapter,
  createLocalCommandAdapter,
  createOpenClawAdapter
} from "../src/index.js";
import type { AgentAdapterEvent } from "../src/index.js";

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

  it("streams local command lifecycle and output events", async () => {
    const adapter = createLocalCommandAdapter();
    const events: AgentAdapterEvent[] = [];

    const result = await adapter.runStream?.(
      {
        task: "Stream output",
        workspace: root,
        commandParts: [process.execPath, "-e", "console.log('stream-ok'); console.error('stream-warn')"]
      },
      (event) => {
        events.push(event);
      }
    );

    expect(result?.status).toBe("completed");
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["adapter_started", "adapter_stdout", "adapter_stderr", "adapter_finished"])
    );
    expect(events.find((event) => event.kind === "adapter_stdout")?.message).toContain("stream-ok");
    expect(events.find((event) => event.kind === "adapter_stderr")?.message).toContain("stream-warn");
  });

  it("accepts an AbortSignal without changing normal local command execution", async () => {
    const adapter = createLocalCommandAdapter();
    const controller = new AbortController();

    const result = await adapter.run({
      task: "Run with cancellation interface",
      workspace: root,
      commandParts: [process.execPath, "-e", "console.log('signal-ok')"],
      signal: controller.signal
    });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("signal-ok");
  });

  it("short-circuits local command execution when already aborted", async () => {
    const adapter = createLocalCommandAdapter();
    const controller = new AbortController();
    controller.abort();

    const result = await adapter.run({
      task: "Abort before running",
      workspace: root,
      commandParts: [process.execPath, "-e", "console.log('should-not-run')"],
      signal: controller.signal
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(result.stdout).toBe("");
  });

  it("waits for async stream handlers before resolving", async () => {
    const adapter = createLocalCommandAdapter();
    const handled: string[] = [];

    await adapter.runStream?.(
      {
        task: "Async stream handler",
        workspace: root,
        commandParts: [process.execPath, "-e", "console.log('async-out'); console.error('async-err')"]
      },
      async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        handled.push(event.kind);
      }
    );

    expect(handled).toEqual(
      expect.arrayContaining(["adapter_started", "adapter_stdout", "adapter_stderr", "adapter_finished"])
    );
    expect(handled.at(-1)).toBe("adapter_finished");
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

  it("marks command-wrapper adapters as opaque while streaming output", async () => {
    const adapter = createCommandAgentAdapter({
      id: "wrapper-test",
      name: "Wrapper Test",
      executable: process.execPath,
      baseArgs: ["-e", "console.log('wrapper-ok')"],
      workspaceFlag: false,
      taskFlag: false,
      commandFlag: false
    });
    const events: AgentAdapterEvent[] = [];

    const result = await adapter.runStream(
      {
        task: "Wrapper stream",
        workspace: root
      },
      (event) => {
        events.push(event);
      }
    );

    expect(result.status).toBe("completed");
    expect(events[0]).toMatchObject({ kind: "adapter_opaque_action", adapterId: "wrapper-test" });
    expect(events.find((event) => event.kind === "adapter_stdout")?.message).toContain("wrapper-ok");
  });

  it("normalizes structured JSONL events emitted by OpenClaw and Hermes wrappers", async () => {
    const script = [
      "console.log(JSON.stringify({type:'artifact', path:'reports/openclaw.json', label:'OpenClaw report'}));",
      "console.log('data: ' + JSON.stringify({event:'tool_call', message:'Hermes delegated'}));"
    ].join("");
    const adapter = createOpenClawAdapter({
      executable: process.execPath,
      baseArgs: ["-e", script],
      workspaceFlag: false,
      taskFlag: false,
      commandFlag: false
    });
    const events: AgentAdapterEvent[] = [];

    const result = await adapter.runStream?.(
      {
        task: "Structured adapter stream",
        workspace: root
      },
      (event) => {
        events.push(event);
      }
    );

    expect(result?.status).toBe("completed");
    expect(events.find((event) => event.kind === "adapter_artifact")).toMatchObject({
      artifact: {
        uri: "reports/openclaw.json",
        label: "OpenClaw report"
      }
    });
    expect(events.find((event) => event.kind === "adapter_opaque_action" && event.message === "Hermes delegated")).toBeDefined();
  });
});
