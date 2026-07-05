import { promises as fs } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultAdapterRegistry, createHermesNativeAdapter } from "../src/index.js";
import type { AgentAdapterEvent } from "../src/index.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-hermes-native-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("Hermes native adapter", () => {
  it("starts a run over JSON API and consumes JSONL events", async () => {
    let startBody: Record<string, unknown> | undefined;
    const server = await listenTestServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://hermes.test");
      if (request.method === "POST" && url.pathname === "/runs") {
        startBody = await readJsonBody(request);
        sendJson(response, 202, {
          runId: "jsonl-run",
          eventsUrl: "/runs/jsonl-run/events"
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/runs/jsonl-run/events") {
        response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
        response.write(`${JSON.stringify({ event: "run_started", message: "Remote run accepted." })}\n`);
        response.write(`${JSON.stringify({ type: "stdout", message: "hello from hermes" })}\n`);
        response.write(`${JSON.stringify({ event: "tool_call", message: "delegated to subagent" })}\n`);
        response.write(
          `${JSON.stringify({ type: "artifact", path: "reports/hermes.json", label: "Hermes report" })}\n`
        );
        response.end(`${JSON.stringify({ event: "completed", status: "completed", exitCode: 0 })}\n`);
        return;
      }

      sendJson(response, 404, { error: "not found" });
    });
    try {
      const adapter = createHermesNativeAdapter({
        baseUrl: server.url,
        headers: { Authorization: "Bearer test-token" }
      });
      const events: AgentAdapterEvent[] = [];

      const result = await adapter.runStream(
        {
          task: "Run native Hermes",
          workspace: root,
          command: "npm test",
          commandParts: ["npm", "test"],
          metadata: { traceId: "trace-jsonl" }
        },
        (event) => {
          events.push(event);
        }
      );

      expect(startBody).toMatchObject({
        task: "Run native Hermes",
        workspace: root,
        command: "npm test",
        commandParts: ["npm", "test"],
        metadata: { traceId: "trace-jsonl" }
      });
      expect(result).toMatchObject({
        adapterId: "hermes-native",
        status: "completed",
        exitCode: 0,
        signal: null,
        cwd: root
      });
      expect(result.command).toBe(`POST ${server.url}/runs`);
      expect(result.stdout).toContain("hello from hermes");
      expect(result.metadata).toMatchObject({
        runId: "jsonl-run",
        eventsUrl: `${server.url}/runs/jsonl-run/events`,
        traceId: "trace-jsonl"
      });
      expect(events.map((event) => event.kind)).toEqual(
        expect.arrayContaining([
          "adapter_started",
          "adapter_stdout",
          "adapter_opaque_action",
          "adapter_artifact",
          "adapter_finished"
        ])
      );
      expect(events.find((event) => event.kind === "adapter_artifact")).toMatchObject({
        artifact: {
          uri: "reports/hermes.json",
          label: "Hermes report"
        }
      });
      expect(events.find((event) => event.kind === "adapter_opaque_action" && event.message === "delegated to subagent"))
        .toBeDefined();
    } finally {
      await server.close();
    }
  });

  it("consumes SSE events from a configured stream path", async () => {
    const server = await listenTestServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://hermes.test");
      if (request.method === "POST" && url.pathname === "/api/runs") {
        sendJson(response, 201, { runId: "sse-run" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/streams/sse-run") {
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
        response.write("event: stdout\n");
        response.write(`data: ${JSON.stringify({ message: "sse hello" })}\n\n`);
        response.write("event: stderr\n");
        response.write(`data: ${JSON.stringify({ message: "sse warning" })}\n\n`);
        response.write("event: finished\n");
        response.end(`data: ${JSON.stringify({ status: "blocked", message: "needs approval" })}\n\n`);
        return;
      }

      sendJson(response, 404, { error: "not found" });
    });
    try {
      const adapter = createHermesNativeAdapter({
        baseUrl: `${server.url}/api/`,
        startPath: "runs",
        eventsPath: "streams/{runId}"
      });
      const events: AgentAdapterEvent[] = [];

      const result = await adapter.runStream(
        {
          task: "Run SSE Hermes",
          workspace: root
        },
        (event) => {
          events.push(event);
        }
      );

      expect(result.status).toBe("blocked");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("sse hello");
      expect(result.stderr).toContain("sse warning");
      expect(result.metadata).toMatchObject({
        runId: "sse-run",
        eventsUrl: `${server.url}/api/streams/sse-run`
      });
      expect(events.find((event) => event.kind === "adapter_finished")).toMatchObject({
        message: "needs approval",
        payload: expect.objectContaining({ status: "blocked", event: "finished" })
      });
    } finally {
      await server.close();
    }
  });

  it("posts to the configured cancellation endpoint when the input signal aborts", async () => {
    let cancelBody: Record<string, unknown> | undefined;
    const cancelReceived = deferred<void>();
    const server = await listenTestServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://hermes.test");
      if (request.method === "POST" && url.pathname === "/runs") {
        sendJson(response, 202, {
          runId: "cancel-run",
          eventsUrl: "/runs/cancel-run/events"
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/runs/cancel-run/events") {
        response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
        response.write(`${JSON.stringify({ type: "stdout", message: "waiting" })}\n`);
        request.on("close", () => {
          response.end();
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/runs/cancel-run/cancel") {
        cancelBody = await readJsonBody(request);
        sendJson(response, 202, { cancelled: true });
        cancelReceived.resolve();
        return;
      }

      sendJson(response, 404, { error: "not found" });
    });
    try {
      const adapter = createHermesNativeAdapter({
        baseUrl: server.url,
        cancelPath: "/runs/{runId}/cancel"
      });
      const controller = new AbortController();

      const result = await adapter.runStream(
        {
          task: "Cancel Hermes",
          workspace: root,
          signal: controller.signal
        },
        (event) => {
          if (event.kind === "adapter_stdout" && event.message === "waiting") {
            controller.abort(new Error("test cancellation"));
          }
        }
      );

      await cancelReceived.promise;
      expect(result).toMatchObject({
        status: "failed",
        exitCode: null,
        signal: "SIGTERM"
      });
      expect(result.stdout).toBe("waiting");
      expect(result.metadata).toMatchObject({
        runId: "cancel-run",
        cancelled: true
      });
      expect(cancelBody).toMatchObject({
        runId: "cancel-run",
        reason: "test cancellation"
      });
    } finally {
      await server.close();
    }
  });

  it("registers the native adapter only when opted into the default registry", () => {
    expect(createDefaultAdapterRegistry().list().map((adapter) => adapter.id)).not.toContain("hermes-native");

    expect(
      createDefaultAdapterRegistry({
        hermesNative: { baseUrl: "http://127.0.0.1:1" },
        browserAutomation: false,
        mcp: false,
        ci: false,
        deployment: false
      }).list().map((adapter) => adapter.id)
    ).toEqual(["local-command", "openclaw", "hermes", "hermes-native"]);
  });
});

async function listenTestServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    void handler(request, response).catch((error: unknown) => {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
