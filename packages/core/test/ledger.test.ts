import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { RunLedger } from "../src/index.js";

describe("RunLedger", () => {
  it("persists runs and append-only events to SQLite", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-ledger-"));
    try {
      const dbPath = path.join(root, "runwitness.sqlite");
      const ledger = await RunLedger.open(dbPath);
      const run = await ledger.createRun({
        task: "Record a command",
        agent: "test-agent",
        workspace: root
      });
      const step = await ledger.createStep({
        runId: run.id,
        name: "Run tests"
      });
      await ledger.appendEvent(run.id, "command_started", { command: "npm test", cwd: root }, step.id);
      await ledger.appendEvent(run.id, "command_finished", { command: "npm test", exitCode: 0 }, step.id);
      const receipt = await ledger.appendReceipt({
        runId: run.id,
        stepId: step.id,
        kind: "command",
        status: "passed",
        label: "npm test",
        digest: "sha256:test"
      });
      await ledger.finishRun(run.id, "completed");

      const SQL = await initSqlJs({
        locateFile: () => createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm")
      });
      const snapshot = new SQL.Database(ledger.exportSnapshot());
      try {
        expect(() => snapshot.run("update runs set status = 'failed'")).toThrow(/append-only/);
        expect(() => snapshot.run("delete from events")).toThrow(/append-only/);
      } finally {
        snapshot.close();
      }

      ledger.close();

      const reopened = await RunLedger.open(dbPath);
      try {
        expect(reopened.getRun(run.id)).toMatchObject({
          id: run.id,
          status: "completed",
          task: "Record a command"
        });
        expect(reopened.listSteps(run.id)).toMatchObject([
          {
            id: step.id,
            status: "completed",
            name: "Run tests"
          }
        ]);
        expect(reopened.listReceipts(run.id)).toEqual([receipt]);
        expect(reopened.getRun(run.id)?.receipts).toMatchObject({
          total: 1,
          byKind: { command: 1 }
        });
        expect(reopened.timeline(run.id).map((event) => event.kind)).toEqual([
          "run_started",
          "step_created",
          "command_started",
          "command_finished",
          "receipt_recorded",
          "run_finished"
        ]);
      } finally {
        reopened.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("lists runs and reads ledger receipt records", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-ledger-"));
    try {
      const dbPath = path.join(root, "runwitness.sqlite");
      const ledger = await RunLedger.open(dbPath);
      try {
        const completedRun = await ledger.createRun({
          id: "rw_completed",
          task: "Completed task",
          agent: "test-agent",
          workspace: root
        });
        const runningRun = await ledger.createRun({
          id: "rw_running",
          task: "Running task",
          agent: "test-agent",
          workspace: root
        });
        const firstReceipt = await ledger.appendReceipt({
          id: "receipt_first",
          runId: completedRun.id,
          kind: "note",
          status: "info",
          label: "First"
        });
        const secondReceipt = await ledger.appendReceipt({
          id: "receipt_second",
          runId: completedRun.id,
          kind: "artifact",
          status: "passed",
          label: "Second"
        });
        await ledger.appendEvent(completedRun.id, "receipt_exported", {
          jsonPath: path.join(root, "receipt.json"),
          markdownPath: path.join(root, "receipt.md")
        });
        await ledger.finishRun(completedRun.id, "completed");

        expect(ledger.listRuns().map((run) => run.id)).toEqual(
          expect.arrayContaining([completedRun.id, runningRun.id])
        );
        expect(ledger.listRuns({ status: "completed" }).map((run) => run.id)).toEqual([completedRun.id]);
        expect(ledger.listRuns({ limit: 1 })).toHaveLength(1);
        expect(ledger.readReceipt(completedRun.id)).toEqual(secondReceipt);
        expect(ledger.readReceipt(completedRun.id, firstReceipt.id)).toEqual(firstReceipt);
        expect(ledger.listReceiptExports(completedRun.id)).toEqual([
          expect.objectContaining({
            runId: completedRun.id,
            jsonPath: path.join(root, "receipt.json"),
            markdownPath: path.join(root, "receipt.md")
          })
        ]);
      } finally {
        ledger.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
