import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentAdapterRegistry,
  createBrowserAutomationAdapter,
  createCiAdapter,
  createCommandAgentAdapter,
  createDefaultAdapterRegistry,
  createDeploymentAdapter,
  createHermesAdapter,
  createLocalCommandAdapter,
  createMcpAdapter,
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

  it("creates a default registry with the built-in command adapters", () => {
    expect(createDefaultAdapterRegistry().list().map((adapter) => adapter.id)).toEqual([
      "local-command",
      "openclaw",
      "hermes",
      "browser-automation",
      "mcp",
      "ci",
      "deployment"
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

describe("browser automation, MCP, CI, and deployment adapters", () => {
  it("builds configurable browser automation invocations without requiring a browser tool to be installed", () => {
    const adapter = createBrowserAutomationAdapter({
      executable: "browser-runner-test",
      extraArgs: ["--jsonl"]
    });

    expect(adapter.buildInvocation({ task: "Capture login", workspace: root, command: "npm run smoke" })).toMatchObject({
      command: "browser-runner-test",
      args: ["run", "--workspace", root, "--task", "Capture login", "--command", "npm run smoke", "--jsonl"],
      cwd: root
    });
    expect(adapter.capabilities).toMatchObject({
      externalTool: true,
      requiresConfiguredTool: true,
      eventStream: true,
      opaqueActions: true,
      artifacts: true
    });
  });

  it("builds configurable MCP invocations without claiming direct MCP tool access", () => {
    const adapter = createMcpAdapter({
      executable: "mcp-wrapper-test",
      baseArgs: ["dispatch"],
      taskFlag: "--request"
    });

    expect(adapter.buildInvocation({ task: "List tools", workspace: root, command: "tools/list" })).toMatchObject({
      command: "mcp-wrapper-test",
      args: ["dispatch", "--workspace", root, "--request", "List tools", "--command", "tools/list"],
      cwd: root
    });
    expect(adapter.capabilities).toMatchObject({
      externalTool: true,
      requiresConfiguredTool: true,
      eventStream: true,
      opaqueActions: true
    });
  });

  it("builds configurable CI and deployment invocations", () => {
    const ci = createCiAdapter({
      executable: "ci-wrapper-test",
      commandFlag: "--check-command"
    });
    const deployment = createDeploymentAdapter({
      executable: "deploy-wrapper-test",
      workspaceFlag: "--repo",
      extraArgs: ["--jsonl"]
    });

    expect(ci.buildInvocation({ task: "Run checks", workspace: root, command: "npm test" })).toMatchObject({
      command: "ci-wrapper-test",
      args: ["run", "--workspace", root, "--task", "Run checks", "--check-command", "npm test"],
      cwd: root
    });
    expect(deployment.buildInvocation({ task: "Deploy preview", workspace: root, command: "deploy --preview" })).toMatchObject({
      command: "deploy-wrapper-test",
      args: ["run", "--repo", root, "--task", "Deploy preview", "--command", "deploy --preview", "--jsonl"],
      cwd: root
    });
  });

  it("allows new wrapper adapters to be disabled in the default registry", () => {
    expect(
      createDefaultAdapterRegistry({
        browserAutomation: false,
        mcp: false,
        ci: false,
        deployment: false
      }).list().map((adapter) => adapter.id)
    ).toEqual(["local-command", "openclaw", "hermes"]);
  });

  it("normalizes structured JSONL emitted by the new wrapper foundations", async () => {
    const script = [
      "console.log(JSON.stringify({type:'artifact', path:'screenshots/login.png', label:'Login screenshot'}));",
      "console.log(JSON.stringify({event:'step', message:'Clicked sign in'}));"
    ].join("");
    const adapter = createBrowserAutomationAdapter({
      executable: process.execPath,
      baseArgs: ["-e", script],
      workspaceFlag: false,
      taskFlag: false,
      commandFlag: false
    });
    const events: AgentAdapterEvent[] = [];

    const result = await adapter.runStream?.(
      {
        task: "Browser JSONL stream",
        workspace: root
      },
      (event) => {
        events.push(event);
      }
    );

    expect(result?.status).toBe("completed");
    expect(events.find((event) => event.kind === "adapter_artifact")).toMatchObject({
      artifact: {
        uri: "screenshots/login.png",
        label: "Login screenshot"
      }
    });
    expect(events.find((event) => event.kind === "adapter_opaque_action" && event.message === "Clicked sign in")).toBeDefined();
  });
});
