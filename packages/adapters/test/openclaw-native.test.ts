import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultAdapterRegistry, createOpenClawNativeAdapter } from "../src/index.js";
import type { AgentAdapterEvent } from "../src/index.js";

let root: string;
const servers: Server[] = [];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-openclaw-native-"));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  await fs.rm(root, { recursive: true, force: true });
});

describe("OpenClaw native adapter", () => {
  it("starts a run and consumes JSONL events from a local server", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const { baseUrl } = await startServer(async (req, res, url) => {
      if (req.method === "POST" && req.url === "/runs") {
        requestBody = await readJsonBody(req);
        sendJson(res, 202, {
          id: "run-jsonl",
          eventsUrl: `${url}/runs/run-jsonl/events`
        });
        return;
      }

      if (req.method === "GET" && req.url === "/runs/run-jsonl/events") {
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.write(`${JSON.stringify({ type: "stdout", message: "jsonl-out\n" })}\n`);
        res.write(`${JSON.stringify({ type: "artifact", path: "reports/openclaw.json", label: "OpenClaw report" })}\n`);
        res.end(`${JSON.stringify({ type: "completed", status: "completed", message: "done" })}\n`);
        return;
      }

      res.writeHead(404).end();
    });
    const adapter = createOpenClawNativeAdapter({ baseUrl });
    const events: AgentAdapterEvent[] = [];

    const result = await adapter.runStream?.(
      {
        task: "Run JSONL",
        workspace: root,
        command: "npm test",
        metadata: {
          source: "jsonl-test"
        }
      },
      (event) => {
        events.push(event);
      }
    );

    expect(requestBody).toMatchObject({
      task: "Run JSONL",
      workspace: root,
      command: "npm test",
      metadata: {
        source: "jsonl-test"
      }
    });
    expect(result).toMatchObject({
      adapterId: "openclaw-native",
      status: "completed",
      cwd: root,
      exitCode: 0
    });
    expect(result?.stdout).toContain("jsonl-out");
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["adapter_started", "adapter_stdout", "adapter_artifact", "adapter_finished"])
    );
    expect(events.find((event) => event.kind === "adapter_artifact")).toMatchObject({
      artifact: {
        uri: "reports/openclaw.json",
        label: "OpenClaw report"
      }
    });
  });

  it("normalizes SSE event names and data payloads", async () => {
    const { baseUrl } = await startServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/runs") {
        await readBody(req);
        sendJson(res, 200, { id: "sse-run" });
        return;
      }

      if (req.method === "GET" && req.url === "/runs/sse-run/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: stdout\ndata: ${JSON.stringify({ message: "sse-out" })}\n\n`);
        res.write(`event: tool_call\ndata: ${JSON.stringify({ message: "delegated" })}\n\n`);
        res.write(`event: artifact\ndata: ${JSON.stringify({ uri: "reports/sse.txt", label: "SSE report" })}\n\n`);
        res.end(`event: completed\ndata: ${JSON.stringify({ status: "completed", message: "finished" })}\n\n`);
        return;
      }

      res.writeHead(404).end();
    });
    const adapter = createOpenClawNativeAdapter({ baseUrl });
    const events: AgentAdapterEvent[] = [];

    const result = await adapter.runStream?.(
      {
        task: "Run SSE",
        workspace: root
      },
      (event) => {
        events.push(event);
      }
    );

    expect(result?.status).toBe("completed");
    expect(result?.stdout).toContain("sse-out");
    expect(events.find((event) => event.kind === "adapter_opaque_action" && event.message === "delegated")).toBeDefined();
    expect(events.find((event) => event.kind === "adapter_artifact")).toMatchObject({
      artifact: {
        uri: "reports/sse.txt",
        label: "SSE report"
      }
    });
  });

  it("posts to the configured cancellation endpoint when aborted", async () => {
    let cancelRequests = 0;
    let cancelBody: Record<string, unknown> | undefined;
    let resolveEventsStarted: () => void = () => undefined;
    const eventsStarted = new Promise<void>((resolve) => {
      resolveEventsStarted = resolve;
    });
    const { baseUrl } = await startServer(async (req, res, url) => {
      if (req.method === "POST" && req.url === "/runs") {
        await readBody(req);
        sendJson(res, 200, {
          id: "cancel-run",
          eventsUrl: `${url}/runs/cancel-run/events`
        });
        return;
      }

      if (req.method === "GET" && req.url === "/runs/cancel-run/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: stdout\ndata: ${JSON.stringify({ message: "before-cancel" })}\n\n`);
        resolveEventsStarted();
        req.on("close", () => {
          res.end();
        });
        return;
      }

      if (req.method === "POST" && req.url === "/runs/cancel-run/cancel") {
        cancelRequests += 1;
        cancelBody = await readJsonBody(req);
        sendJson(res, 200, { ok: true });
        return;
      }

      res.writeHead(404).end();
    });
    const adapter = createOpenClawNativeAdapter({
      baseUrl,
      cancelPath: (run) => `/runs/${String(run.id)}/cancel`
    });
    const controller = new AbortController();
    const events: AgentAdapterEvent[] = [];
    const resultPromise = adapter.runStream?.(
      {
        task: "Cancel run",
        workspace: root,
        signal: controller.signal
      },
      (event) => {
        events.push(event);
      }
    );

    await eventsStarted;
    controller.abort();
    const result = await resultPromise;

    expect(cancelRequests).toBe(1);
    expect(cancelBody).toMatchObject({
      reason: "aborted",
      runId: "cancel-run"
    });
    expect(result).toMatchObject({
      status: "failed",
      exitCode: null,
      signal: "SIGTERM"
    });
    expect(events.find((event) => event.kind === "adapter_finished" && event.payload?.aborted === true)).toBeDefined();
  });

  it("registers OpenClaw native only when explicitly configured", async () => {
    const { baseUrl } = await startServer(async (_req, res) => {
      res.writeHead(404).end();
    });

    expect(createDefaultAdapterRegistry().has("openclaw-native")).toBe(false);
    expect(createDefaultAdapterRegistry({ openClawNative: { baseUrl } }).has("openclaw-native")).toBe(true);
  });
});

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, baseUrl: string) => Promise<void> | void
): Promise<{ baseUrl: string }> {
  let baseUrl = "";
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res, baseUrl)).catch((error: unknown) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  servers.push(server);
  return { baseUrl };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  const parsed = JSON.parse(body) as unknown;
  return isRecord(parsed) ? parsed : {};
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
