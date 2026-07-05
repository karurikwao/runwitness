import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunLedger, runWitnessedCommand } from "../packages/core/src/index.js";

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

  it("blocks risky commands without auto approval and still exports a receipt", async () => {
    const result = await runWitnessedCommand({
      task: "Risky delete",
      command: "rm -rf ./important",
      workspace: root
    });

    expect(result.run.status).toBe("blocked");
    expect(await exists(result.receiptJsonPath)).toBe(true);
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
