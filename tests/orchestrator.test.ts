import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunLedger, runWitnessedCommand } from "../packages/core/src/index.js";
import type { AgentAdapter, AgentAdapterEvent, AgentAdapterRunInput } from "../packages/adapters/src/index.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-e2e-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("runWitnessedCommand", () => {
  it("records command events, file changes, and exports receipts", async () => {
    const command = "node -e \"require('node:fs').writeFileSync('created.txt','ok')\"";
    const result = await runWitnessedCommand({
      task: "Create a file",
      command,
      workspace: root
    });

    expect(result.run.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(await exists(result.receiptJsonPath)).toBe(true);
    expect(await exists(result.receiptMarkdownPath)).toBe(true);

    const receipt = JSON.parse(await fs.readFile(result.receiptJsonPath, "utf8")) as {
      files: Array<{ path: string; action: string }>;
      commands: Array<{ command: string; status: string }>;
    };
    expect(receipt.commands.at(0)?.status).toBe("passed");
    expect(receipt.files).toContainEqual(expect.objectContaining({ path: "created.txt", action: "created" }));

    const ledger = await RunLedger.open(result.dbPath);
    try {
      expect(ledger.timeline(result.run.id).map((event) => event.kind)).toEqual(
        expect.arrayContaining(["run_started", "command_started", "command_finished", "file_changes", "run_finished"])
      );
    } finally {
      ledger.close();
    }
  });

  it("preserves argv quoting for command parts", async () => {
    const result = await runWitnessedCommand({
      task: "Preserve quoted node eval",
      command: "node -e \"require('node:fs').writeFileSync('quoted.txt','ok')\"",
      commandParts: ["node", "-e", "require('node:fs').writeFileSync('quoted.txt','ok')"],
      workspace: root
    });

    expect(result.run.status).toBe("completed");
    expect(await fs.readFile(path.join(root, "quoted.txt"), "utf8")).toBe("ok");
  });

  it("records streamed non-local adapter events in the ledger timeline and receipt", async () => {
    const adapter = createFakeStreamAdapter();

    const result = await runWitnessedCommand({
      task: "Run through a fake stream adapter",
      command: "echo adapter",
      workspace: root,
      adapter
    });

    expect(result.run.status).toBe("completed");
    expect(result.run.agent).toBe("fake-stream");
    expect(await fs.readFile(path.join(root, "adapter-output.txt"), "utf8")).toBe("ok");

    const ledger = await RunLedger.open(result.dbPath);
    try {
      const events = ledger.timeline(result.run.id);
      expect(events.map((event) => event.kind)).toEqual(
        expect.arrayContaining([
          "command_started",
          "adapter_started",
          "adapter_stdout",
          "adapter_artifact",
          "adapter_opaque_action",
          "adapter_finished",
          "command_finished",
          "file_changes"
        ])
      );
      expect(events.find((event) => event.kind === "adapter_artifact")?.payload).toMatchObject({
        adapterId: "fake-stream",
        artifact: {
          uri: "adapter-output.txt",
          label: "Fake output"
        }
      });
      expect(events.find((event) => event.kind === "command_started")?.payload.command).toBe("echo adapter");
      expect(events.find((event) => event.kind === "command_finished")?.payload).toMatchObject({
        command: "echo adapter",
        adapterCommand: "fake stream adapter"
      });
    } finally {
      ledger.close();
    }

    const receipt = JSON.parse(await fs.readFile(result.receiptJsonPath, "utf8")) as {
      timeline: Array<{ kind: string }>;
    };
    expect(receipt.timeline.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["adapter_artifact", "adapter_opaque_action"])
    );
  });

  it("redacts configured secret values from command output events", async () => {
    const secretValue = "sk_live_orchestrator_secret_output_value";
    const result = await runWitnessedCommand({
      task: "Redact command output",
      command: "node -e \"console.log(process.env.SECRET_VALUE); console.error(process.env.SECRET_VALUE)\"",
      commandParts: ["node", "-e", "console.log(process.env.SECRET_VALUE); console.error(process.env.SECRET_VALUE)"],
      workspace: root,
      secretRedactions: [secretValue],
      sandbox: {
        environment: {
          extraEnv: {
            SECRET_VALUE: secretValue
          },
          allowKeys: ["SECRET_VALUE"]
        }
      }
    });

    const ledger = await RunLedger.open(result.dbPath);
    try {
      const commandFinished = ledger.timeline(result.run.id).find((event) => event.kind === "command_finished");
      const serialized = JSON.stringify(commandFinished?.payload);
      expect(serialized).not.toContain(secretValue);
      expect(serialized).toContain("[REDACTED_SECRET]");
    } finally {
      ledger.close();
    }
  });

  it("blocks risky commands without auto approval and still exports a receipt", async () => {
    const result = await runWitnessedCommand({
      task: "Risky delete",
      command: "rm -rf ./important",
      workspace: root
    });

    expect(result.run.status).toBe("blocked");
    expect(await exists(result.receiptJsonPath)).toBe(true);
  });

  it("blocks denied network preflight before command execution", async () => {
    const command =
      "node -e \"require('node:fs').writeFileSync('network-ran.txt','bad'); console.log('https://api.example.invalid')\"";
    const result = await runWitnessedCommand({
      task: "Block undeclared network access",
      command,
      commandParts: [
        "node",
        "-e",
        "require('node:fs').writeFileSync('network-ran.txt','bad'); console.log('https://api.example.invalid')"
      ],
      workspace: root,
      sandbox: {
        network: {
          defaultDecision: "deny"
        }
      }
    });

    expect(result.run.status).toBe("blocked");
    expect(result.exitCode).toBeNull();
    expect(await exists(path.join(root, "network-ran.txt"))).toBe(false);

    const ledger = await RunLedger.open(result.dbPath);
    try {
      const events = ledger.timeline(result.run.id);
      expect(events.map((event) => event.kind)).toEqual(
        expect.arrayContaining(["network_preflight", "approval_requested", "approval_recorded", "receipt_exported"])
      );
      const networkPreflight = events.find((event) => event.kind === "network_preflight");
      expect(networkPreflight?.payload).toMatchObject({
        allowed: false,
        decision: "deny",
        detectedHosts: [expect.objectContaining({ host: "api.example.invalid", decision: "deny" })]
      });
      expect(events.map((event) => event.kind)).not.toContain("command_started");
    } finally {
      ledger.close();
    }
  });

  it("allows approved network preflight ask decisions", async () => {
    const command =
      "node -e \"require('node:fs').writeFileSync('network-approved.txt','ok'); console.log('https://api.example.invalid')\"";
    const result = await runWitnessedCommand({
      task: "Approve network access",
      command,
      commandParts: [
        "node",
        "-e",
        "require('node:fs').writeFileSync('network-approved.txt','ok'); console.log('https://api.example.invalid')"
      ],
      workspace: root,
      yes: true,
      sandbox: {
        network: {
          defaultDecision: "ask"
        }
      }
    });

    expect(result.run.status).toBe("completed");
    expect(await fs.readFile(path.join(root, "network-approved.txt"), "utf8")).toBe("ok");

    const ledger = await RunLedger.open(result.dbPath);
    try {
      const events = ledger.timeline(result.run.id);
      expect(events.find((event) => event.kind === "network_preflight")?.payload).toMatchObject({
        allowed: false,
        decision: "ask"
      });
      expect(events.find((event) => event.kind === "approval_recorded")?.payload).toMatchObject({
        actionType: "network",
        decision: "allow",
        mode: "preapproved"
      });
      expect(events.map((event) => event.kind)).toContain("command_started");
    } finally {
      ledger.close();
    }
  });

  it("creates rollback bundles and dry-runs rollback after failed commands", async () => {
    await fs.writeFile(path.join(root, "rollback-target.txt"), "before", "utf8");
    const command =
      "node -e \"const fs=require('node:fs'); fs.writeFileSync('rollback-target.txt','after'); fs.writeFileSync('rollback-added.txt','new'); process.exit(1)\"";
    const result = await runWitnessedCommand({
      task: "Dry-run rollback",
      command,
      commandParts: [
        "node",
        "-e",
        "const fs=require('node:fs'); fs.writeFileSync('rollback-target.txt','after'); fs.writeFileSync('rollback-added.txt','new'); process.exit(1)"
      ],
      workspace: root,
      rollback: {
        enabled: true,
        mode: "dry-run"
      }
    });

    expect(result.run.status).toBe("failed");
    expect(await fs.readFile(path.join(root, "rollback-target.txt"), "utf8")).toBe("after");
    expect(await fs.readFile(path.join(root, "rollback-added.txt"), "utf8")).toBe("new");

    const ledger = await RunLedger.open(result.dbPath);
    try {
      const events = ledger.timeline(result.run.id);
      expect(events.map((event) => event.kind)).toEqual(
        expect.arrayContaining(["rollback_baseline_created", "rollback_bundle_created", "rollback_apply_result"])
      );
      expect(events.find((event) => event.kind === "rollback_apply_result")?.payload).toMatchObject({
        dryRun: true,
        applied: 0,
        wouldApply: 2,
        errors: 0
      });
    } finally {
      ledger.close();
    }
  });

  it("can apply rollback after failed commands", async () => {
    await fs.writeFile(path.join(root, "apply-target.txt"), "before", "utf8");
    const command =
      "node -e \"const fs=require('node:fs'); fs.writeFileSync('apply-target.txt','after'); fs.writeFileSync('apply-added.txt','new'); process.exit(1)\"";
    const result = await runWitnessedCommand({
      task: "Apply rollback",
      command,
      commandParts: [
        "node",
        "-e",
        "const fs=require('node:fs'); fs.writeFileSync('apply-target.txt','after'); fs.writeFileSync('apply-added.txt','new'); process.exit(1)"
      ],
      workspace: root,
      rollback: {
        enabled: true,
        mode: "apply"
      }
    });

    expect(result.run.status).toBe("failed");
    expect(await fs.readFile(path.join(root, "apply-target.txt"), "utf8")).toBe("before");
    expect(await exists(path.join(root, "apply-added.txt"))).toBe(false);

    const ledger = await RunLedger.open(result.dbPath);
    try {
      expect(eventsByKind(ledger.timeline(result.run.id), "rollback_apply_result").at(0)?.payload).toMatchObject({
        dryRun: false,
        applied: 2,
        errors: 0
      });
    } finally {
      ledger.close();
    }
  });

  it("runs sandboxed commands in an isolated workspace with filtered environment", async () => {
    await fs.writeFile(path.join(root, "source.txt"), "source", "utf8");
    const sandboxTempRoot = path.join(root, "tmp");

    const result = await runWitnessedCommand({
      task: "Sandbox write",
      command: `${process.execPath} -e "require('node:fs').writeFileSync('created-in-sandbox.txt', process.env.SECRET_TOKEN || 'filtered')"`,
      commandParts: [
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync('created-in-sandbox.txt', process.env.SECRET_TOKEN || 'filtered')"
      ],
      workspace: root,
      sandbox: {
        enabled: true,
        tempRoot: sandboxTempRoot,
        environment: {
          baseEnv: {
            Path: process.env.Path ?? process.env.PATH,
            SECRET_TOKEN: "should-not-leak"
          }
        }
      }
    });

    expect(result.run.status).toBe("completed");
    expect(await exists(path.join(root, "created-in-sandbox.txt"))).toBe(false);

    const receipt = JSON.parse(await fs.readFile(result.receiptJsonPath, "utf8")) as {
      files: Array<{ path: string; action: string }>;
    };
    expect(receipt.files).toContainEqual(expect.objectContaining({ path: "created-in-sandbox.txt", action: "created" }));

    const ledger = await RunLedger.open(result.dbPath);
    try {
      const events = ledger.timeline(result.run.id);
      expect(events.map((event) => event.kind)).toEqual(
        expect.arrayContaining(["sandbox_preflight", "sandbox_environment", "sandbox_workspace_created"])
      );
      expect(events.find((event) => event.kind === "sandbox_environment")?.payload.removedKeys).toContain("SECRET_TOKEN");
    } finally {
      ledger.close();
    }
  });
});

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function eventsByKind<T extends { kind: string }>(events: T[], kind: string): T[] {
  return events.filter((event) => event.kind === kind);
}

function createFakeStreamAdapter(): AgentAdapter {
  return {
    id: "fake-stream",
    name: "Fake Stream Adapter",
    capabilities: {
      externalTool: true,
      eventStream: true,
      artifacts: true,
      opaqueActions: true
    },
    async run(input: AgentAdapterRunInput) {
      await fs.writeFile(path.join(input.workspace, "adapter-output.txt"), "ok", "utf8");
      return {
        adapterId: "fake-stream",
        status: "completed",
        command: "fake stream adapter",
        cwd: input.workspace,
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdout: "adapter stdout\n",
        stderr: "",
        metadata: {}
      };
    },
    async runStream(input, onEvent) {
      let sequence = 0;
      const emit = async (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp">): Promise<void> => {
        sequence += 1;
        await onEvent({
          ...event,
          adapterId: "fake-stream",
          sequence,
          timestamp: new Date().toISOString()
        });
      };

      await emit({ kind: "adapter_started", message: "Fake adapter started." });
      await emit({ kind: "adapter_stdout", stream: "stdout", message: "adapter stdout\n" });
      await emit({
        kind: "adapter_artifact",
        message: "Fake output artifact.",
        artifact: { uri: "adapter-output.txt", label: "Fake output" }
      });
      await emit({
        kind: "adapter_opaque_action",
        message: "Fake nested action.",
        payload: { tool: "fake-nested-tool" }
      });
      await fs.writeFile(path.join(input.workspace, "adapter-output.txt"), "ok", "utf8");
      await emit({ kind: "adapter_finished", message: "Fake adapter finished.", payload: { exitCode: 0 } });

      return {
        adapterId: "fake-stream",
        status: "completed",
        command: "fake stream adapter",
        cwd: input.workspace,
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdout: "adapter stdout\n",
        stderr: "",
        metadata: {}
      };
    }
  };
}
