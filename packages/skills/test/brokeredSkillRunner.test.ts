import { describe, expect, it } from "vitest";
import {
  inspectSkillManifest,
  runBrokeredSkill,
  skillFileWriteAction,
  skillNetworkAction,
  skillSecretAction,
  skillShellAction,
  type BrokeredSkillRunContext
} from "../src/index.js";

const fixedNow = new Date("2026-07-05T12:00:00.000Z");

describe("brokered skill runner", () => {
  it("brokers every requested runtime action before invoking the executor", async () => {
    const inspected = inspectSkillManifest(`
name: brokered-runner-skill
version: 1.0.0
permissions:
  filesystem:
    write:
      - dist/**
  network:
    allow:
      - api.example.invalid
  shell:
    allow:
      - curl *
  secrets:
    - DEPLOY_TOKEN
`);
    const sensitiveToken = "sk_live_runner_secret_123456789";
    const order: string[] = [];
    let executorContext: BrokeredSkillRunContext | undefined;

    const result = await runBrokeredSkill(
      inspected,
      [
        skillShellAction(`curl https://api.example.invalid -H "Authorization: Bearer ${sensitiveToken}"`),
        skillFileWriteAction("dist/output.txt"),
        skillNetworkAction(`https://${sensitiveToken}@api.example.invalid/v1/run`),
        skillSecretAction("DEPLOY_TOKEN")
      ],
      (context) => {
        order.push("executor");
        executorContext = context;
        return { ok: true };
      },
      {
        now: () => fixedNow,
        createId: (kind) => {
          order.push(kind);
          return `${kind}_${order.length}`;
        },
        redactions: [sensitiveToken]
      }
    );

    expect(result).toMatchObject({
      executed: true,
      status: "executed",
      output: { ok: true }
    });
    expect(result.decisions).toHaveLength(4);
    expect(result.decisions.every((decision) => decision.allowed)).toBe(true);
    expect(result.events).toEqual(result.decisions.map((decision) => decision.event));
    expect(result.receipts).toEqual(result.decisions.map((decision) => decision.receipt));
    expect(executorContext?.decisions).toEqual(result.decisions);
    expect(order.at(-1)).toBe("executor");

    const receiptJson = JSON.stringify({
      decisions: result.decisions,
      events: result.events,
      receipts: result.receipts
    });
    expect(receiptJson).not.toContain(sensitiveToken);
    expect(receiptJson).not.toContain("DEPLOY_TOKEN");
    expect(receiptJson).toContain("[REDACTED]");
    expect(result.decisions[0]?.receipt.skill).toMatchObject({
      name: "brokered-runner-skill",
      version: "1.0.0",
      digest: {
        algorithm: "sha256",
        value: inspected.digest.value
      },
      signatureStatus: "unsigned"
    });
  });

  it("blocks the executor when any broker decision denies a requested action", async () => {
    const inspected = inspectSkillManifest(`
name: blocked-runner-skill
permissions:
  shell:
    allow:
      - npm test
`);
    let executed = false;

    const result = await runBrokeredSkill(
      inspected,
      [skillShellAction("npm test"), skillShellAction("npm install")],
      () => {
        executed = true;
        return "should not run";
      },
      {
        now: () => fixedNow,
        createId: sequentialIds()
      }
    );

    expect(executed).toBe(false);
    expect(result).toMatchObject({
      executed: false,
      status: "blocked"
    });
    expect(result.output).toBeUndefined();
    expect(result.decisions.map((decision) => decision.decision)).toEqual(["allow", "deny"]);
    expect(result.receipts.map((receipt) => receipt.status)).toEqual(["allowed", "denied"]);
    expect(result.decisions[1]?.receipt).toMatchObject({
      decision: "deny",
      permissionDecision: "deny",
      reason: {
        code: "shell_undeclared"
      }
    });
  });
});

function sequentialIds(): (kind: "event" | "receipt") => string {
  let sequence = 0;
  return (kind) => `runner_${kind}_${++sequence}`;
}
