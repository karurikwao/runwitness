import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderOperatorCockpit,
  renderReceiptsPanel,
  renderRunTable,
} from "../src/index.js";
import type { OperatorCockpitViewModel } from "../src/index.js";

describe("cockpit UI components", () => {
  it("renders the core operator sections", () => {
    const html = renderOperatorCockpit(exampleCockpit());

    expect(html).toContain("RunWitness Cockpit");
    expect(html).toContain("Runs");
    expect(html).toContain("Approvals");
    expect(html).toContain("Policy");
    expect(html).toContain("Receipts");
    expect(html).toContain("Timeline");
    expect(html).toContain("npm test");
  });

  it("escapes run content before rendering it into tables", () => {
    const html = renderRunTable([
      {
        id: "rw_xss",
        task: "Patch <script>alert(1)</script>",
        agent: "agent",
        workspace: "C:/repo/<unsafe>",
        status: "completed",
        startedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("C:/repo/&lt;unsafe&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("does not turn unsafe receipt URIs into links", () => {
    const html = renderReceiptsPanel([
      {
        id: "receipt_1",
        label: "Proof bundle",
        kind: "artifact",
        status: "passed",
        capturedAt: "2026-07-05T12:00:00.000Z",
        uri: "javascript:alert(1)",
      },
    ]);

    expect(html).toContain("Proof bundle");
    expect(html).not.toContain('href="javascript:alert(1)"');
  });

  it("escapes quoted text consistently", () => {
    expect(escapeHtml(`"approve" & 'deny'`)).toBe("&quot;approve&quot; &amp; &#39;deny&#39;");
  });
});

function exampleCockpit(): OperatorCockpitViewModel {
  return {
    title: "RunWitness Cockpit",
    generatedAt: "2026-07-05T12:00:00.000Z",
    selectedRunId: "rw_1",
    runs: [
      {
        id: "rw_1",
        task: "Build cockpit foundation",
        agent: "RunWitness Subagent 4",
        workspace: "C:/Users/lnw73/Documents/RepoCleaner",
        status: "completed",
        startedAt: "2026-07-05T12:00:00.000Z",
        metrics: [
          { label: "commands", value: 2, tone: "success" },
          { label: "tests", value: 1, tone: "success" },
        ],
      },
    ],
    approvals: [
      {
        id: "approval_1",
        action: "git push origin main",
        actionSummary: "Publish branch",
        actionType: "shell_command",
        decision: "ask",
        policyDecision: "ask",
        requestedAt: "2026-07-05T12:01:00.000Z",
        reasons: ["git push publishes changes"],
      },
    ],
    policy: {
      defaultDecision: "ask",
      rules: [
        {
          code: "git_push",
          label: "Git push",
          decision: "ask",
          severity: "high",
        },
      ],
    },
    receipts: [
      {
        id: "receipt_1",
        label: "Receipt JSON",
        kind: "artifact",
        status: "passed",
        capturedAt: "2026-07-05T12:02:00.000Z",
        uri: "./receipts/rw_1.json",
      },
    ],
    timeline: [
      {
        sequence: 1,
        label: "Command finished",
        kind: "command_finished",
        timestamp: "2026-07-05T12:02:00.000Z",
        tone: "success",
        detail: "npm test",
      },
    ],
  };
}
