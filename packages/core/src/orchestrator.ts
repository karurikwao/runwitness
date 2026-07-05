import path from "node:path";
import { isLikelyTestCommand, runLocalCommand } from "@runwitness/adapters";
import { classifyShellCommand, createApprovalRecord, evaluateCommandPolicy, type CommandPolicy } from "@runwitness/policy";
import { buildReceipt, writeProofBundle } from "@runwitness/receipts";
import {
  buildFilteredEnvironment,
  createIsolatedTempWorkspace,
  DEFAULT_IGNORED_NAMES,
  diffSnapshots,
  preflightCommandWrites,
  snapshotWorkspace,
  type FilteredEnvironmentOptions,
  type IsolatedTempWorkspace
} from "@runwitness/sandbox";
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
  policy?: CommandPolicy;
  policyMetadata?: Record<string, unknown>;
  sandbox?: WitnessedSandboxOptions;
}

export interface WitnessedSandboxOptions {
  enabled?: boolean;
  tempRoot?: string;
  allowedWritePaths?: string[];
  protectedPaths?: string[];
  environment?: FilteredEnvironmentOptions;
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
  let isolatedWorkspace: IsolatedTempWorkspace | undefined;

  let run: RunRecord | undefined;
  try {
    run = await ledger.createRun({
      task: options.task,
      agent: options.agent ?? "local-command",
      workspace
    });

    if (options.policyMetadata) {
      await ledger.appendEvent(run.id, "policy_loaded", options.policyMetadata);
    }

    const risk = classifyShellCommand(options.command);
    const policyEvaluation = options.policy ? evaluateCommandPolicy(options.command, options.policy) : undefined;
    const decision = policyEvaluation?.decision ?? risk.decision;
    const riskReasons = policyEvaluation
      ? policyEvaluation.reasons.map((reason) => reason.summary)
      : risk.reasons.map((reason) => reason.summary);
    const riskLevel = policyEvaluation?.severity ?? risk.severity;
    if (decision === "ask" || decision === "deny") {
      await ledger.appendEvent(run.id, "approval_requested", {
        action: options.command,
        reasons: riskReasons,
        riskLevel,
        policyDecision: decision,
        policyEvaluation,
        policy: options.policyMetadata
      });

      const approved = decision === "ask" && options.yes;
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

    const sandboxEnabled = options.sandbox?.enabled === true;
    const writePreflight = preflightCommandWrites(options.command, {
      workspaceRoot: workspace,
      allowedWritePaths: options.sandbox?.allowedWritePaths,
      protectedPaths: options.sandbox?.protectedPaths
    });
    await ledger.appendEvent(run.id, "sandbox_preflight", {
      enabled: sandboxEnabled,
      allowed: writePreflight.allowed,
      detectedWrites: writePreflight.detectedWrites.map((write) => ({
        path: write.path,
        intent: write.intent,
        command: write.command,
        allowed: write.check.allowed,
        reason: write.check.reason,
        code: write.check.code
      })),
      warnings: writePreflight.warnings
    });

    if (sandboxEnabled && !writePreflight.allowed) {
      await ledger.appendEvent(run.id, "approval_requested", {
        action: options.command,
        reasons: writePreflight.violations.map((write) => write.check.reason ?? `Write blocked: ${write.path}`),
        riskLevel: "high",
        policyDecision: "deny",
        sandbox: { violations: writePreflight.violations }
      });
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

    const filteredEnvironment = buildFilteredEnvironment(options.sandbox?.environment);
    await ledger.appendEvent(run.id, "sandbox_environment", {
      enabled: sandboxEnabled,
      removedKeys: filteredEnvironment.removedKeys,
      removedPathEntries: filteredEnvironment.removedPathEntries,
      pathKey: filteredEnvironment.pathKey
    });

    const executionWorkspace = sandboxEnabled
      ? await createIsolatedTempWorkspace({
          sourceWorkspace: workspace,
          tempRoot: options.sandbox?.tempRoot,
          environment: {
            ...options.sandbox?.environment,
            extraEnv: {
              ...options.sandbox?.environment?.extraEnv,
              RUNWITNESS_SOURCE_WORKSPACE: workspace
            }
          }
        })
      : undefined;
    isolatedWorkspace = executionWorkspace;
    const commandWorkspace = executionWorkspace?.workspaceRoot ?? workspace;
    const commandEnvironment = executionWorkspace?.environment.env ?? filteredEnvironment.env;

    if (executionWorkspace) {
      await ledger.appendEvent(run.id, "sandbox_workspace_created", {
        sourceWorkspace: workspace,
        sandboxWorkspace: executionWorkspace.workspaceRoot,
        tempRoot: executionWorkspace.tempRoot,
        ignoredNames: executionWorkspace.ignoredNames
      });
    }

    const before = await snapshotWorkspace(commandWorkspace);
    const stepId = createStepId("cmd");
    await ledger.appendEvent(run.id, "command_started", { command: options.command, cwd: commandWorkspace }, stepId);
    const [executable, ...args] = options.commandParts ?? [];
    const commandResult = await runLocalCommand({
      command: executable ?? options.command,
      args: executable ? args : undefined,
      cwd: commandWorkspace,
      env: commandEnvironment
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
        stderr: truncate(commandResult.stderr),
        sandboxed: sandboxEnabled,
        sourceWorkspace: workspace
      },
      stepId
    );

    const after = await snapshotWorkspace(commandWorkspace);
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
    await isolatedWorkspace?.cleanup();
    ledger.close();
  }
}

function truncate(value: string, maxLength = 10000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`;
}
