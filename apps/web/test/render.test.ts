import { describe, expect, it } from "vitest";
import {
  createCockpitViewModel,
  renderLiveWebCockpitDocument,
  renderWebCockpitBody,
  renderWebCockpitDocument,
  webAppStatus,
} from "../src/index.js";

describe("web cockpit renderer", () => {
  it("renders a complete static HTML document", () => {
    const view = createCockpitViewModel({
      title: "Operator Cockpit",
      generatedAt: "2026-07-05T12:00:00.000Z",
      runs: [
        {
          id: "rw_1",
          task: "Verify receipts",
          agent: "subagent",
          workspace: "C:/repo",
          status: "running",
          startedAt: "2026-07-05T12:00:00.000Z",
        },
      ],
      approvals: [
        {
          id: "approval_1",
          action: "Remove-Item -Recurse dist",
          actionType: "shell_command",
          decision: "ask",
          requestedAt: "2026-07-05T12:01:00.000Z",
        },
      ],
      policy: {
        defaultDecision: "ask",
        rules: [{ code: "recursive_delete", label: "Recursive delete", decision: "ask" }],
      },
      receipts: [
        {
          id: "receipt_1",
          label: "Receipt Markdown",
          kind: "artifact",
          status: "passed",
          capturedAt: "2026-07-05T12:02:00.000Z",
          uri: "./rw_1.md",
        },
      ],
      timeline: [
        {
          sequence: 1,
          label: "Run started",
          kind: "run_started",
          timestamp: "2026-07-05T12:00:00.000Z",
          tone: "neutral",
        },
      ],
    });

    const html = renderWebCockpitDocument(view);

    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>Operator Cockpit | RunWitness</title>");
    expect(html).toContain("<style>");
    expect(html).toContain("Verify receipts");
    expect(html).toContain("Recursive delete");
    expect(html).toContain("Receipt Markdown");
  });

  it("can render just the body for embedding", () => {
    const body = renderWebCockpitBody(createCockpitViewModel({ generatedAt: "2026-07-05T12:00:00.000Z" }));

    expect(body).toContain('<main class="rw-shell">');
    expect(body).not.toContain("<html");
  });

  it("reports the static renderer status", () => {
    expect(webAppStatus).toMatchObject({
      name: "RunWitness Web",
      status: "static-cockpit-foundation",
      renderer: "static-html",
    });
  });

  it("renders a live cockpit shell with API polling and approval actions", () => {
    const html = renderLiveWebCockpitDocument({
      live: {
        apiBase: "http://127.0.0.1:8787",
        authTokenStorageKey: "rw.token",
        pollIntervalMs: 1000,
      },
    });

    expect(html).toContain("rw.token");
    expect(html).toContain("/approvals/pending");
    expect(html).toContain("data-approval-run");
    expect(html).toContain("EventSource");
    expect(html).toContain("new URL(apiBase, window.location.href)");
    expect(html).not.toContain("new URL(path.replace(/^\\\\//, \"\"), apiBase, window.location.href)");
  });
});
