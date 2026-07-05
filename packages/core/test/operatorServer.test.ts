import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listenOperatorServer, RunLedger } from "../src/index.js";

let root: string;
let ledger: RunLedger;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-operator-"));
  ledger = await RunLedger.open(path.join(root, "runwitness.sqlite"));
});

afterEach(async () => {
  ledger.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("operator server", () => {
  it("serves run, timeline, receipt summary, and receipt artifact APIs", async () => {
    const run = await ledger.createRun({
      id: "rw_server",
      task: "Serve operator API",
      agent: "test-agent",
      workspace: root
    });
    const receipt = await ledger.appendReceipt({
      id: "receipt_server",
      runId: run.id,
      kind: "artifact",
      status: "passed",
      label: "Server receipt"
    });
    const jsonPath = path.join(root, "receipt.json");
    const markdownPath = path.join(root, "receipt.md");
    await fs.writeFile(jsonPath, JSON.stringify({ runId: run.id, ok: true }), "utf8");
    await fs.writeFile(markdownPath, `# ${run.id}\n`, "utf8");
    await ledger.appendEvent(run.id, "receipt_exported", { jsonPath, markdownPath });

    const server = await listenOperatorServer({ ledger });
    try {
      const health = await getJson(`${server.url}/health`);
      expect(health).toMatchObject({ ok: true, service: "runwitness-operator" });

      const runs = await getJson(`${server.url}/runs?limit=10`);
      expect(runs.runs).toContainEqual(expect.objectContaining({ id: run.id, task: "Serve operator API" }));

      const timeline = await getJson(`${server.url}/runs/${run.id}/timeline`);
      expect(timeline.events.map((event: { kind: string }) => event.kind)).toContain("receipt_exported");

      const latest = await getJson(`${server.url}/runs/${run.id}/receipts/latest`);
      expect(latest.receipt).toEqual(receipt);

      const artifactResponse = await fetch(`${server.url}/runs/${run.id}/receipt`);
      expect(artifactResponse.status).toBe(200);
      expect(await artifactResponse.json()).toMatchObject({ runId: run.id, ok: true });
    } finally {
      await server.close();
    }
  });

  it("lists pending approvals and records operator approval decisions", async () => {
    const run = await ledger.createRun({
      id: "rw_approval",
      task: "Approve deploy",
      agent: "test-agent",
      workspace: root
    });
    await ledger.appendEvent(run.id, "approval_requested", {
      action: "git push origin main",
      policyDecision: "ask",
      riskLevel: "high",
      reasons: ["publishes changes"]
    });

    const server = await listenOperatorServer({ ledger, operatorId: "test-operator" });
    try {
      const pending = await getJson(`${server.url}/approvals/pending`);
      expect(pending.approvals).toEqual([
        expect.objectContaining({
          runId: run.id,
          action: "git push origin main",
          reasons: ["publishes changes"]
        })
      ]);

      const approvalResponse = await fetch(`${server.url}/runs/${run.id}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "allow",
          rationale: "Release reviewed."
        })
      });
      expect(approvalResponse.status).toBe(201);
      const approval = (await approvalResponse.json()) as { approval: { kind: string; payload: Record<string, unknown> } };
      expect(approval.approval).toMatchObject({
        kind: "approval_recorded",
        payload: {
          action: "git push origin main",
          decision: "allow",
          rationale: "Release reviewed.",
          source: "operator_server"
        }
      });

      const after = await getJson(`${server.url}/runs/${run.id}/approvals`);
      expect(after.approvals).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("rejects unexpected approval subpaths", async () => {
    const run = await ledger.createRun({
      id: "rw_strict_approval_route",
      task: "Keep approval routes strict",
      agent: "test-agent",
      workspace: root
    });
    await ledger.appendEvent(run.id, "approval_requested", {
      action: "git push origin main",
      policyDecision: "ask",
      riskLevel: "high",
      reasons: ["publishes changes"]
    });

    const server = await listenOperatorServer({ ledger });
    try {
      const getResponse = await fetch(`${server.url}/runs/${run.id}/approvals/extra`);
      expect(getResponse.status).toBe(404);

      const postResponse = await fetch(`${server.url}/runs/${run.id}/approvals/extra`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "allow" })
      });
      expect(postResponse.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

async function getJson(url: string): Promise<Record<string, any>> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, any>;
}
