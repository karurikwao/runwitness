import path from "node:path";
import { isLikelyTestCommand, runLocalCommand } from "@runwitness/adapters";
import { classifyShellCommand, createApprovalRecord } from "@runwitness/policy";
import { buildReceipt, writeProofBundle } from "@runwitness/receipts";
import { DEFAULT_IGNORED_NAMES, diffSnapshots, snapshotWorkspace } from "@runwitness/sandbox";
import { createStepId } from "./ids.js";
import { RunLedger } from "./ledger.js";
import type { RunRecord } from "./types.js";

export interface WitnessedCommandOptions {
  task: string;
  command: string;
  commandParts?: string[];
  workspace: string;
  dataDir?: string;
  agent?: string;
  yes?: boolean;
  receiptDir?: string;
}

export interface WitnessedCommandResult {
  run: RunRecord;
  exitCode: number | null;
  receiptJsonPath: string;
  receiptMarkdownPath: string;
  dbPath: string;
}

export async function runWitnessedCommand(options: WitnessedCommandOptions): Promise<WitnessedCommandResult> {
  const workspace = path.resolve(options.workspace);
  const dataDir = path.resolve(options.dataDir ?? path.join(workspace, ".runwitness"));
  const dbPath = path.join(dataDir, "runwitness.sqlite");
  const receiptDir = path.resolve(options.receiptDir ?? path.join(dataDir, "receipts"));
  const ledger = await RunLedger.open(dbPath);

  let run: RunRecord | undefined;
  try {
    run = await ledger.createRun({
      task: options.task,
      agent: options.agent ?? "local-command",
      workspace
    });

    const risk = classifyShellCommand(options.command);
    const riskReasons = risk.reasons.map((reason) => reason.summary);
    if (risk.decision === "ask" || risk.decision === "deny") {
      await ledger.appendEvent(run.id, "approval_requested", {
        action: options.command,
        reasons: riskReasons,
        riskLevel: risk.severity,
        policyDecision: risk.decision
      });

      const approved = risk.decision === "ask" && options.yes;
      const approval = createApprovalRecord({
        runId: run.id,
        action: options.command,
        risk,
        decision: approved ? "allow" : "deny",
        mode: approved ? "preapproved" : "non_interactive",
        rationale: riskReasons.join(", ")
      });
      await ledger.appendEvent(run.id, "approval_recorded", {
        ...approval,
        reasons: riskReasons
      });

      if (!approved) {
        const blockedRun = await ledger.finishRun(run.id, "blocked");
        const receipt = buildReceipt(blockedRun, ledger.timeline(run.id));
        const bundle = await writeProofBundle(receipt, receiptDir);
        await ledger.appendEvent(run.id, "receipt_exported", {
          jsonPath: bundle.jsonPath,
          markdownPath: bundle.markdownPath
        });
        const finalReceipt = buildReceipt(blockedRun, ledger.timeline(run.id));
        await writeProofBundle(finalReceipt, receiptDir);
        return {
          run: blockedRun,
          exitCode: null,
          receiptJsonPath: bundle.jsonPath,
          receiptMarkdownPath: bundle.markdownPath,
          dbPath
        };
      }
    }

    const before = await snapshotWorkspace(workspace);
    const stepId = createStepId("cmd");
    await ledger.appendEvent(run.id, "command_started", { command: options.command, cwd: workspace }, stepId);
    const [executable, ...args] = options.commandParts ?? [];
    const commandResult = await runLocalCommand({
      command: executable ?? options.command,
      args: executable ? args : undefined,
      cwd: workspace
    });
    await ledger.appendEvent(
      run.id,
      "command_finished",
      {
        command: options.command,
        cwd: commandResult.cwd,
        exitCode: commandResult.exitCode,
        signal: commandResult.signal,
        durationMs: commandResult.durationMs,
        stdout: truncate(commandResult.stdout),
        stderr: truncate(commandResult.stderr)
      },
      stepId
    );

    const after = await snapshotWorkspace(workspace);
    const changes = diffSnapshots(before, after);
    await ledger.appendEvent(run.id, "file_changes", {
      changes,
      ignoredNames: [...DEFAULT_IGNORED_NAMES]
    });

    if (isLikelyTestCommand(options.command)) {
      await ledger.appendEvent(run.id, "test_result", {
        command: options.command,
        passed: commandResult.exitCode === 0,
        exitCode: commandResult.exitCode,
        inferred: true,
        durationMs: commandResult.durationMs
      });
    }

    const finishedRun = await ledger.finishRun(run.id, commandResult.exitCode === 0 ? "completed" : "failed");
    const receipt = buildReceipt(finishedRun, ledger.timeline(run.id));
    const bundle = await writeProofBundle(receipt, receiptDir);
    await ledger.appendEvent(run.id, "receipt_exported", {
      jsonPath: bundle.jsonPath,
      markdownPath: bundle.markdownPath
    });
    const finalReceipt = buildReceipt(finishedRun, ledger.timeline(run.id));
    await writeProofBundle(finalReceipt, receiptDir);

    return {
      run: finishedRun,
      exitCode: commandResult.exitCode,
      receiptJsonPath: bundle.jsonPath,
      receiptMarkdownPath: bundle.markdownPath,
      dbPath
    };
  } catch (error) {
    if (run) {
      await ledger.finishRun(run.id, "failed");
    }
    throw error;
  } finally {
    ledger.close();
  }
}

function truncate(value: string, maxLength = 10000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`;
}
