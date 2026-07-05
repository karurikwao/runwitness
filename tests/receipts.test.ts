import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../packages/receipts/schemas/receipt.schema.json" with { type: "json" };
import { buildReceipt, renderReceiptMarkdown } from "../packages/receipts/src/index.js";
import type { RunEvent, RunRecord } from "../packages/core/src/index.js";

describe("receipts", () => {
  it("summarizes commands, tests, approvals, and file changes", () => {
    const run: RunRecord = {
      id: "rw_test",
      task: "Test receipt generation",
      agent: "test-agent",
      status: "completed",
      workspace: "/tmp/runwitness",
      startedAt: "2026-07-04T00:00:00.000Z",
      endedAt: "2026-07-04T00:00:01.000Z",
      metadata: {}
    };
    const events: RunEvent[] = [
      {
        sequence: 1,
        runId: run.id,
        kind: "command_finished",
        timestamp: run.startedAt,
        payload: { command: "npm test", cwd: run.workspace, exitCode: 0, durationMs: 12 }
      },
      {
        sequence: 2,
        runId: run.id,
        kind: "test_result",
        timestamp: run.startedAt,
        payload: { command: "npm test", passed: true, durationMs: 12 }
      },
      {
        sequence: 3,
        runId: run.id,
        kind: "approval_recorded",
        timestamp: run.startedAt,
        payload: { action: "git push", decision: "approved", reasons: ["publishes changes"] }
      },
      {
        sequence: 4,
        runId: run.id,
        kind: "file_changes",
        timestamp: run.startedAt,
        payload: {
          changes: [{ path: "src/app.ts", type: "added", afterHash: "a".repeat(64), sizeBytes: 10 }]
        }
      }
    ];

    const receipt = buildReceipt(run, events);
    expect(receipt.summary.commands.passed).toBe(1);
    expect(receipt.summary.tests.passed).toBe(1);
    expect(receipt.summary.approvals.granted).toBe(1);
    expect(receipt.summary.files.created).toBe(1);
    expect(receipt.fileTracking.ignoredNames).toEqual([]);
    expect(renderReceiptMarkdown(receipt)).toContain("# RunWitness Receipt");

    const ajv = new Ajv2020({ validateFormats: false });
    const validate = ajv.compile(schema);
    expect(validate(receipt), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});
