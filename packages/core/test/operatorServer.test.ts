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

  it("requires configured bearer auth and records authenticated approver identity", async () => {
    const run = await ledger.createRun({
      id: "rw_authenticated_approval",
      task: "Approve protected deploy",
      agent: "test-agent",
      workspace: root
    });
    const request = await ledger.appendEvent(run.id, "approval_requested", {
      action: "git push origin main",
      policyDecision: "ask",
      riskLevel: "high",
      reasons: ["publishes changes"]
    });

    const server = await listenOperatorServer({
      ledger,
      auth: {
        bearerTokens: [
          { token: "viewer-token", operatorId: "audit-only", roles: ["viewer"] },
          { token: "approver-token", operatorId: "release-manager", roles: ["approver"], allowedWorkspaces: [root] },
          { token: "admin-token-secret", operatorId: "policy-owner", roles: ["admin"], allowedWorkspaces: [root] }
        ]
      }
    });
    try {
      const unauthenticatedRead = await fetch(`${server.url}/approvals/pending`);
      expect(unauthenticatedRead.status).toBe(401);

      const pending = await getJson(`${server.url}/approvals/pending`, {
        headers: { Authorization: "Bearer approver-token" }
      });
      expect(pending.approvals).toEqual([expect.objectContaining({ runId: run.id })]);

      const identity = await getJson(`${server.url}/operator/me`, {
        headers: { Authorization: "Bearer admin-token-secret" }
      });
      expect(identity).toMatchObject({
        authenticated: true,
        authRequired: true,
        principal: { id: "policy-owner", roles: ["admin"], allowedWorkspaces: [root] },
        capabilities: {
          canExplainPolicy: true,
          canRequestPolicyEdit: true,
          canEditPolicy: false,
          policyWrites: "disabled"
        }
      });
      expect(JSON.stringify(identity)).not.toContain("admin-token-secret");

      const viewerWrite = await fetch(`${server.url}/runs/${run.id}/approvals`, {
        method: "POST",
        headers: { Authorization: "Bearer viewer-token", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "allow" })
      });
      expect(viewerWrite.status).toBe(403);

      const spoofedActorWrite = await fetch(`${server.url}/runs/${run.id}/approvals`, {
        method: "POST",
        headers: { Authorization: "Bearer approver-token", "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "allow",
          decidedBy: { type: "human", id: "someone-else" }
        })
      });
      expect(spoofedActorWrite.status).toBe(403);

      const approvalResponse = await fetch(`${server.url}/runs/${run.id}/approvals`, {
        method: "POST",
        headers: { Authorization: "Bearer approver-token", "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "allow",
          rationale: "Release reviewed."
        })
      });
      expect(approvalResponse.status).toBe(201);
      const approval = (await approvalResponse.json()) as { approval: { payload: Record<string, any> } };
      expect(approval.approval.payload).toMatchObject({
        action: "git push origin main",
        decision: "allow",
        decidedBy: { type: "human", id: "release-manager", roles: ["approver"] },
        operator: { id: "release-manager", roles: ["approver"], allowedWorkspaces: [root] },
        requestSequence: request.sequence,
        source: "operator_server"
      });

      const after = await getJson(`${server.url}/runs/${run.id}/approvals`, {
        headers: { Authorization: "Bearer approver-token" }
      });
      expect(after.approvals).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("filters durable pending approvals by user and workspace", async () => {
    const aliceRun = await ledger.createRun({
      id: "rw_filter_alice",
      task: "Approve alice workspace",
      agent: "test-agent",
      workspace: root,
      metadata: { userId: "alice" }
    });
    await ledger.appendEvent(aliceRun.id, "approval_requested", {
      action: "deploy alice",
      userId: "alice",
      reasons: ["requires review"]
    });

    const otherWorkspace = path.join(root, "other-workspace");
    const bobRun = await ledger.createRun({
      id: "rw_filter_bob",
      task: "Approve bob workspace",
      agent: "test-agent",
      workspace: otherWorkspace,
      metadata: { userId: "bob" }
    });
    await ledger.appendEvent(bobRun.id, "approval_requested", {
      action: "deploy bob",
      userId: "bob",
      reasons: ["requires review"]
    });

    const dbPath = path.join(root, "runwitness.sqlite");
    ledger.close();
    ledger = await RunLedger.open(dbPath);

    const server = await listenOperatorServer({ ledger });
    try {
      const aliceApprovals = await getJson(`${server.url}/approvals/pending?user=alice`);
      expect(aliceApprovals.approvals).toEqual([expect.objectContaining({ runId: aliceRun.id, action: "deploy alice" })]);

      const bobApprovals = await getJson(
        `${server.url}/approvals/pending?workspace=${encodeURIComponent(otherWorkspace)}`
      );
      expect(bobApprovals.approvals).toEqual([expect.objectContaining({ runId: bobRun.id, action: "deploy bob" })]);

      const aliceRuns = await getJson(`${server.url}/runs?user=alice&limit=10`);
      expect(aliceRuns.runs).toEqual([expect.objectContaining({ id: aliceRun.id, workspace: root })]);
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

  it("streams authenticated operator snapshots", async () => {
    const run = await ledger.createRun({
      id: "rw_events",
      task: "Stream live cockpit events",
      agent: "test-agent",
      workspace: root
    });
    await ledger.appendEvent(run.id, "approval_requested", {
      action: "npm publish",
      policyDecision: "ask",
      reasons: ["publishes package"]
    });

    const server = await listenOperatorServer({ ledger, auth: { bearerTokens: ["event-token"] } });
    const controller = new AbortController();
    try {
      const missingToken = await fetch(`${server.url}/events`, { signal: controller.signal });
      expect(missingToken.status).toBe(401);

      const response = await fetch(`${server.url}/events?token=event-token`, { signal: controller.signal });
      expect(response.status).toBe(200);
      const text = await readFirstChunk(response);
      expect(text).toContain("event: snapshot");
      expect(text).toContain("rw_events");
      expect(text).toContain("npm publish");
    } finally {
      controller.abort();
      await server.close();
    }
  });
});

async function getJson(url: string, init?: RequestInit): Promise<Record<string, any>> {
  const response = await fetch(url, init);
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, any>;
}

async function readFirstChunk(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  const chunk = await reader!.read();
  return Buffer.from(chunk.value ?? new Uint8Array()).toString("utf8");
}
