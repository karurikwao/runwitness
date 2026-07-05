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
        rules: [
          { code: "effective-policy", label: "Effective policy digest", decision: "loaded", description: "sha256:policy-digest" },
          { code: "recursive_delete", label: "Recursive delete", decision: "ask" },
        ],
      },
      receipts: [
        {
          id: "receipt_1",
          label: "Receipt Markdown",
          kind: "artifact",
          status: "passed",
          capturedAt: "2026-07-05T12:02:00.000Z",
          uri: "./rw_1.md",
          digest: "sha256:receipt-digest",
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
    expect(html).toContain('aria-label="Cockpit sections"');
    expect(html).toContain('aria-label="Cockpit status summary"');
    expect(html).toContain('data-summary-value="health"');
    expect(html).toContain('data-operator-session');
    expect(html).toContain("Verify receipts");
    expect(html).toContain("Effective policy digest");
    expect(html).toContain("sha256:policy-digest");
    expect(html).toContain("Recursive delete");
    expect(html).toContain("Receipt Markdown");
    expect(html).toContain("sha256:receipt-digest");
    expect(html).toContain("Policy edit unavailable");
  });

  it("can render just the body for embedding", () => {
    const body = renderWebCockpitBody(createCockpitViewModel({ generatedAt: "2026-07-05T12:00:00.000Z" }));

    expect(body).toContain('<main class="rw-shell rw-cockpit"');
    expect(body).not.toContain("<html");
  });

  it("renders redesigned navigation, summary cards, and responsive run controls", () => {
    const body = renderWebCockpitBody(
      createCockpitViewModel({
        generatedAt: "2026-07-05T12:00:00.000Z",
        selectedRunId: "rw_selected",
        runs: [
          {
            id: "rw_selected",
            task: "Audit cockpit",
            agent: "worker-6",
            workspace: "C:/repo",
            status: "running",
            startedAt: "2026-07-05T12:00:00.000Z",
            metrics: [{ label: "tests", value: 4, tone: "success" }],
          },
        ],
      }),
    );

    expect(body).toContain('href="#rw-panel-runs"');
    expect(body).toContain('data-refresh-cockpit');
    expect(body).toContain('data-summary-card="approvals"');
    expect(body).toContain('data-label="Workspace"');
    expect(body).toContain('data-run-id="rw_selected"');
    expect(body).toContain('aria-current="true"');
    expect(body).toContain('aria-label="Select run rw_selected"');
    expect(body).toContain("tests: 4");
  });

  it("keeps receipt links safe in the web cockpit pane", () => {
    const html = renderWebCockpitBody(
      createCockpitViewModel({
        generatedAt: "2026-07-05T12:00:00.000Z",
        receipts: [
          {
            id: "receipt_unsafe",
            label: "Unsafe receipt",
            kind: "artifact",
            status: "passed",
            capturedAt: "2026-07-05T12:02:00.000Z",
            uri: "javascript:alert(1)",
          },
        ],
      }),
    );

    expect(html).toContain("Unsafe receipt");
    expect(html).toContain("javascript:alert(1)");
    expect(html).not.toContain('href="javascript:alert(1)"');
  });

  it("reports the static renderer status", () => {
    expect(webAppStatus).toMatchObject({
      name: "RunWitness Web",
      status: "static-cockpit-foundation",
      renderer: "static-html",
    });
  });

  it("renders a live cockpit shell with API polling and approval actions", () => {
    const secretTokenValue = "super-secret-bearer-token";
    const html = renderLiveWebCockpitDocument({
      live: {
        apiBase: "http://127.0.0.1:8787",
        authTokenStorageKey: "rw.token",
        pollIntervalMs: 1000,
      },
    });

    expect(html).toContain("rw.token");
    expect(html).toContain("/operator/me");
    expect(html).toContain("data-operator-session");
    expect(html).toContain("data-refresh-cockpit");
    expect(html).toContain("updateStatusSummary");
    expect(html).toContain("setSummary");
    expect(html).toContain('data-label="Status"');
    expect(html).toContain("Operator roles");
    expect(html).toContain("role:");
    expect(html).toContain("workspace:");
    expect(html).toContain("policy writes:");
    expect(html).toContain("canRequestPolicyEdit");
    expect(html).toContain("Admin role required before audited policy edit controls are shown.");
    expect(html).toContain("/approvals/pending");
    expect(html).toContain("/receipts");
    expect(html).toContain("/receipt?format=json");
    expect(html).toContain("Effective policy digest");
    expect(html).toContain("Audited policy edit placeholder");
    expect(html).toContain("Admin operator verified. Policy writes remain disabled while the audited edit workflow is prepared.");
    expect(html).toContain("Policy edit unavailable");
    expect(html).toContain("data-approval-run");
    expect(html).toContain("EventSource");
    expect(html).toContain("new URL(apiBase, window.location.href)");
    expect(html).not.toContain("new URL(path.replace(/^\\\\//, \"\"), apiBase, window.location.href)");
    expect(html).not.toContain(secretTokenValue);
  });
});
