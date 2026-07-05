import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileChange, RunEvent, RunRecord } from "@runwitness/core";

export const RECEIPT_SCHEMA_VERSION = "1.0.0";

export interface CountSummary {
  total: number;
  [key: string]: number;
}

export interface ReceiptSummary {
  files: CountSummary;
  commands: CountSummary;
  tests: CountSummary;
  approvals: CountSummary;
}

export interface ReceiptFileRecord {
  path: string;
  action: "created" | "modified" | "deleted";
  sha256?: string;
  bytes?: number;
}

export interface ReceiptCommandRecord {
  command: string;
  cwd?: string;
  exitCode: number | null;
  status: "passed" | "failed" | "blocked";
  durationMs?: number;
}

export interface ReceiptTestRecord {
  name: string;
  command: string;
  status: "passed" | "failed" | "blocked";
  durationMs?: number;
}

export interface ReceiptApprovalRecord {
  name: string;
  status: "granted" | "denied" | "not_required" | "pending";
  at?: string;
  note?: string;
}

export interface ReceiptArtifact {
  path: string;
  kind: string;
  sha256?: string;
  bytes?: number;
}

export interface RunReceipt {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  runId: string;
  generatedAt: string;
  task: {
    title: string;
    workspace: string;
  };
  agent: {
    name: string;
  };
  run: {
    status: RunRecord["status"];
    startedAt: string;
    endedAt?: string;
  };
  files: ReceiptFileRecord[];
  commands: ReceiptCommandRecord[];
  tests: ReceiptTestRecord[];
  approvals: ReceiptApprovalRecord[];
  artifacts: ReceiptArtifact[];
  fileTracking: {
    ignoredNames: string[];
  };
  summary: ReceiptSummary;
  timeline: Array<Pick<RunEvent, "sequence" | "kind" | "timestamp" | "stepId">>;
}

export interface ProofBundleResult {
  jsonPath: string;
  markdownPath: string;
  summary: ReceiptSummary;
}

export function buildReceipt(run: RunRecord, events: RunEvent[]): RunReceipt {
  const files: ReceiptFileRecord[] = [];
  const commands: ReceiptCommandRecord[] = [];
  const tests: ReceiptTestRecord[] = [];
  const approvals: ReceiptApprovalRecord[] = [];
  const ignoredNames = new Set<string>();

  for (const event of events) {
    if (event.kind === "file_changes") {
      const changes = Array.isArray(event.payload.changes) ? (event.payload.changes as FileChange[]) : [];
      const eventIgnoredNames = Array.isArray(event.payload.ignoredNames)
        ? event.payload.ignoredNames.map((name) => String(name))
        : [];
      for (const name of eventIgnoredNames) {
        ignoredNames.add(name);
      }
      for (const change of changes) {
        files.push({
          path: change.path,
          action: change.type === "added" ? "created" : change.type,
          sha256: change.afterHash ?? change.beforeHash,
          bytes: change.sizeBytes
        });
      }
    }

    if (event.kind === "command_finished") {
      commands.push({
        command: String(event.payload.command ?? ""),
        cwd: typeof event.payload.cwd === "string" ? event.payload.cwd : undefined,
        exitCode: typeof event.payload.exitCode === "number" ? event.payload.exitCode : null,
        status: event.payload.exitCode === 0 ? "passed" : "failed",
        durationMs: typeof event.payload.durationMs === "number" ? event.payload.durationMs : undefined
      });
    }

    if (event.kind === "test_result") {
      tests.push({
        name: String(event.payload.command ?? "test command"),
        command: String(event.payload.command ?? ""),
        status: event.payload.passed === true ? "passed" : "failed",
        durationMs: typeof event.payload.durationMs === "number" ? event.payload.durationMs : undefined
      });
    }

    if (event.kind === "approval_recorded") {
      const decision = String(event.payload.decision ?? "skipped");
      approvals.push({
        name: String(event.payload.action ?? "approval"),
        status:
          decision === "approved" || decision === "allow"
            ? "granted"
            : decision === "denied" || decision === "deny"
              ? "denied"
              : decision === "ask"
                ? "pending"
                : "not_required",
        at: event.timestamp,
        note:
          Array.isArray(event.payload.reasons)
            ? event.payload.reasons.map((reason) => String(reason)).join(", ")
            : typeof event.payload.rationale === "string"
              ? event.payload.rationale
              : undefined
      });
    }
  }

  const receipt: RunReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    runId: run.id,
    generatedAt: new Date().toISOString(),
    task: {
      title: run.task,
      workspace: run.workspace
    },
    agent: {
      name: run.agent
    },
    run: {
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt
    },
    files,
    commands,
    tests,
    approvals,
    artifacts: [],
    fileTracking: {
      ignoredNames: [...ignoredNames].sort((left, right) => left.localeCompare(right))
    },
    summary: {
      files: countBy(files, "action", ["created", "modified", "deleted"]),
      commands: countBy(commands, "status", ["passed", "failed", "blocked"]),
      tests: countBy(tests, "status", ["passed", "failed", "blocked"]),
      approvals: countBy(approvals, "status", ["granted", "denied", "not_required", "pending"])
    },
    timeline: events.map((event) => ({
      sequence: event.sequence,
      kind: event.kind,
      timestamp: event.timestamp,
      stepId: event.stepId
    }))
  };

  return receipt;
}

export async function writeProofBundle(receipt: RunReceipt, outDir: string): Promise<ProofBundleResult> {
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${receipt.runId}.json`);
  const markdownPath = path.join(outDir, `${receipt.runId}.md`);

  await fs.writeFile(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, renderReceiptMarkdown(receipt), "utf8");

  return {
    jsonPath,
    markdownPath,
    summary: receipt.summary
  };
}

export function renderReceiptMarkdown(receipt: RunReceipt): string {
  const lines = [
    "# RunWitness Receipt",
    "",
    `- Run ID: ${receipt.runId}`,
    `- Task: ${receipt.task.title}`,
    `- Agent: ${receipt.agent.name}`,
    `- Status: ${receipt.run.status}`,
    `- Workspace: ${receipt.task.workspace}`,
    `- Generated: ${receipt.generatedAt}`,
    "",
    "## Summary",
    "",
    "| Area | Total | Details |",
    "| --- | ---: | --- |",
    summaryRow("Files", receipt.summary.files),
    summaryRow("Commands", receipt.summary.commands),
    summaryRow("Tests", receipt.summary.tests),
    summaryRow("Approvals", receipt.summary.approvals),
    "",
    "## Commands",
    "",
    table(
      ["Command", "Status", "Exit", "Duration"],
      receipt.commands.map((command) => [
        command.command,
        command.status,
        command.exitCode ?? "",
        command.durationMs === undefined ? "" : `${command.durationMs} ms`
      ])
    ),
    "",
    "## File Changes",
    "",
    receipt.fileTracking.ignoredNames.length > 0
      ? `Ignored snapshot names: ${receipt.fileTracking.ignoredNames.join(", ")}`
      : "Ignored snapshot names: none",
    "",
    table(
      ["Path", "Action", "SHA-256"],
      receipt.files.map((file) => [file.path, file.action, file.sha256 ?? ""])
    ),
    "",
    "## Tests",
    "",
    table(
      ["Name", "Status", "Command"],
      receipt.tests.map((test) => [test.name, test.status, test.command])
    ),
    "",
    "## Approvals",
    "",
    table(
      ["Name", "Status", "At", "Note"],
      receipt.approvals.map((approval) => [approval.name, approval.status, approval.at ?? "", approval.note ?? ""])
    )
  ];

  return `${lines.join("\n")}\n`;
}

export async function sha256File(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function countBy<T extends object>(items: T[], field: keyof T, knownValues: string[]): CountSummary {
  const summary: CountSummary = { total: 0 };
  for (const value of knownValues) {
    summary[value] = 0;
  }
  for (const item of items) {
    summary.total += 1;
    const key = String(item[field] ?? "unknown");
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

function summaryRow(label: string, summary: CountSummary): string {
  const details = Object.entries(summary)
    .filter(([key]) => key !== "total")
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

  return `| ${escapeCell(label)} | ${summary.total} | ${escapeCell(details || "none")} |`;
}

function table(headers: string[], rows: Array<Array<string | number | null>>): string {
  const safeRows = rows.length > 0 ? rows : [headers.map(() => "")];
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...safeRows.map((row) => `| ${row.map((cell) => escapeCell(cell ?? "")).join(" | ")} |`)
  ].join("\n");
}

function escapeCell(value: string | number): string {
  return String(value).replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
}
