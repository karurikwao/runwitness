import { describe, expect, it } from "vitest";
import {
  createSkillExecutionBroker,
  inspectSkillManifest,
  skillFileWriteAction,
  skillNetworkAction,
  skillSecretAction,
  skillShellAction,
  type SkillExecutionBrokerEvent,
  type SkillExecutionBrokerReceipt
} from "../src/index.js";

const fixedNow = new Date("2026-07-05T12:00:00.000Z");

describe("skill execution broker", () => {
  it("denies undeclared shell, network, and secret actions without executing them", () => {
    const inspected = inspectSkillManifest(`
name: broker-skill
permissions:
  shell:
    allow:
      - npm test
  network:
    allow:
      - api.example.invalid
  secrets:
    - DEPLOY_TOKEN
`);
    const events: SkillExecutionBrokerEvent[] = [];
    const receipts: SkillExecutionBrokerReceipt[] = [];
    const broker = createSkillExecutionBroker(inspected, {
      now: () => fixedNow,
      createId: sequentialIds(),
      onEvent: (event) => events.push(event),
      onReceipt: (receipt) => receipts.push(receipt)
    });

    const deniedShell = broker.requestAction(skillShellAction("npm install"));
    const deniedNetwork = broker.requestAction(skillNetworkAction("https://other.example.invalid/v1/run"));
    const deniedSecret = broker.requestAction(skillSecretAction("OTHER_TOKEN"));

    expect(deniedShell).toMatchObject({
      allowed: false,
      decision: "deny",
      permission: {
        decision: "deny",
        reason: { code: "shell_undeclared" }
      },
      receipt: { status: "denied" }
    });
    expect(deniedNetwork).toMatchObject({
      allowed: false,
      permission: {
        decision: "deny",
        reason: { code: "network_undeclared" }
      }
    });
    expect(deniedSecret).toMatchObject({
      allowed: false,
      permission: {
        decision: "deny",
        reason: { code: "secret_undeclared" }
      },
      event: {
        action: {
          kind: "secret",
          redacted: true
        }
      }
    });
    expect(events.map((event) => event.decision)).toEqual(["deny", "deny", "deny"]);
    expect(receipts.map((receipt) => receipt.status)).toEqual(["denied", "denied", "denied"]);
    expect(broker.getEvents()).toHaveLength(3);
    expect(broker.getReceipts()).toHaveLength(3);
  });

  it("allows declared brokered action requests", () => {
    const inspected = inspectSkillManifest(`
name: declared-action-skill
permissions:
  filesystem:
    write:
      - dist/**
  shell:
    allow:
      - npm test
`);
    const broker = createSkillExecutionBroker(inspected, {
      now: () => fixedNow,
      createId: sequentialIds()
    });

    const shell = broker.requestShell("npm   test");
    const file = broker.requestAction(skillFileWriteAction("dist/output.txt"));

    expect(shell).toMatchObject({
      allowed: true,
      decision: "allow",
      permission: {
        decision: "allow",
        matchedPermission: "npm test"
      },
      event: {
        decision: "allow",
        matchedPermission: "npm test"
      },
      receipt: {
        status: "allowed",
        matchedPermission: "npm test"
      }
    });
    expect(file).toMatchObject({
      allowed: true,
      decision: "allow",
      permission: {
        decision: "allow",
        matchedPermission: "dist/**"
      }
    });
  });

  it("links events and receipts to the manifest digest while redacting sensitive action material", () => {
    const sensitiveToken = "sk_live_super_secret_value_123456789";
    const inspected = inspectSkillManifest(`
name: redaction-skill
version: 1.0.0
permissions:
  shell:
    allow:
      - curl *
  network:
    allow:
      - api.example.invalid
  secrets:
    - DEPLOY_TOKEN
`);
    const broker = createSkillExecutionBroker(inspected, {
      now: () => fixedNow,
      createId: sequentialIds(),
      redactions: [sensitiveToken]
    });

    const shell = broker.requestShell(`curl https://api.example.invalid -H "Authorization: Bearer ${sensitiveToken}"`);
    const network = broker.requestNetwork(`https://${sensitiveToken}@api.example.invalid/v1/run?token=${sensitiveToken}`);
    const secret = broker.requestSecret(sensitiveToken);

    expect(shell.event.skill.digest).toEqual({
      algorithm: "sha256",
      value: inspected.digest.value
    });
    expect(shell.receipt.skill.digest).toEqual(shell.event.skill.digest);
    expect(shell.receipt.eventId).toBe(shell.event.id);
    expect(network.event.action).toMatchObject({
      kind: "network",
      host: "api.example.invalid",
      urlRedacted: true
    });
    expect(secret.event.action).toMatchObject({
      kind: "secret",
      redacted: true
    });

    const auditJson = JSON.stringify([
      shell.event,
      shell.receipt,
      network.event,
      network.receipt,
      secret.event,
      secret.receipt
    ]);
    expect(auditJson).not.toContain(sensitiveToken);
    expect(auditJson).toContain("[REDACTED]");
    expect(auditJson).toContain(`"value":"${inspected.digest.value}"`);
  });
});

function sequentialIds(): (kind: "event" | "receipt") => string {
  let sequence = 0;
  return (kind) => `test_${kind}_${++sequence}`;
}
