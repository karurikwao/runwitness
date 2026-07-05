import path from "node:path";
import {
  createDefaultAdapterRegistry,
  isLikelyTestCommand,
  runLocalCommand,
  type AgentAdapter,
  type AgentAdapterEvent,
  type AgentAdapterRunInput,
  type AgentAdapterRunResult
} from "@runwitness/adapters";
import { classifyShellCommand, createApprovalRecord, evaluateCommandPolicy, type CommandPolicy } from "@runwitness/policy";
import { buildReceipt, writeProofBundle } from "@runwitness/receipts";
import {
  buildFilteredEnvironment,
  applyRollbackBundle,
  createIsolatedTempWorkspace,
  createRollbackBaseline,
  createRollbackBundle,
  createWorkspaceSnapshot,
  DEFAULT_IGNORED_NAMES,
  diffSnapshots,
  preflightCommandNetwork,
  preflightCommandWrites,
  snapshotWorkspace,
  type FilteredEnvironmentOptions,
  type IsolatedTempWorkspace,
  type NetworkPreflightPolicy,
  type RollbackApplyResult,
  type RollbackBaseline
} from "@runwitness/sandbox";
import { createStepId } from "./ids.js";
import { RunLedger } from "./ledger.js";
import { redactKnownSecrets, type SecretRedactionSource } from "./secretVault.js";
import type { RunRecord } from "./types.js";

export interface WitnessedCommandOptions {
  task: string;
  command: string;
  commandParts?: string[];
  workspace: string;
  dataDir?: string;
  agent?: string;
  adapter?: AgentAdapter;
  yes?: boolean;
  receiptDir?: string;
  policy?: CommandPolicy;
  policyMetadata?: Record<string, unknown>;
  sandbox?: WitnessedSandboxOptions;
  rollback?: WitnessedRollbackOptions;
  signal?: AbortSignal;
  secretRedactions?: Iterable<string | SecretRedactionSource>;
}

export interface WitnessedSandboxOptions {
  enabled?: boolean;
  tempRoot?: string;
  allowedWritePaths?: string[];
  protectedPaths?: string[];
  environment?: FilteredEnvironmentOptions;
  network?: NetworkPreflightPolicy;
}

export type WitnessedRollbackMode = "bundle" | "dry-run" | "apply";

export interface WitnessedRollbackOptions {
  enabled?: boolean;
  mode?: WitnessedRollbackMode;
  outputDirectory?: string;
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
  const adapter = resolveRunAdapter(options);
  const runAgent = adapter?.id ?? options.agent ?? "local-command";

  let run: RunRecord | undefined;
  try {
    run = await ledger.createRun({
      task: options.task,
      agent: runAgent,
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

    const networkPreflightEnabled = sandboxEnabled || options.sandbox?.network !== undefined;
    if (networkPreflightEnabled) {
      const networkPreflight = preflightCommandNetwork(options.command, options.sandbox?.network);
      await ledger.appendEvent(run.id, "network_preflight", {
        enabled: true,
        allowed: networkPreflight.allowed,
        decision: networkPreflight.decision,
        detectedHosts: networkPreflight.detectedHosts,
        violations: networkPreflight.violations
      });

      if (!networkPreflight.allowed) {
        const reasons = networkPreflight.violations.map((access) =>
          access.decision === "deny"
            ? `Network host denied: ${access.host}`
            : `Network host requires approval: ${access.host}`
        );
        await ledger.appendEvent(run.id, "approval_requested", {
          action: options.command,
          reasons,
          riskLevel: "high",
          policyDecision: networkPreflight.decision,
          network: {
            violations: networkPreflight.violations
          }
        });
        const approved = networkPreflight.decision === "ask" && options.yes;
        const approval = createApprovalRecord({
          runId: run.id,
          actionType: "network",
          action: options.command,
          actionSummary: `Network access for ${networkPreflight.violations.map((access) => access.host).join(", ")}`,
          policyDecision: networkPreflight.decision,
          decision: approved ? "allow" : "deny",
          mode: approved ? "preapproved" : "non_interactive",
          rationale: reasons.join(", "),
          metadata: {
            detectedHosts: networkPreflight.detectedHosts,
            violations: networkPreflight.violations
          }
        });
        await ledger.appendEvent(run.id, "approval_recorded", {
          ...approval,
          reasons
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

    const rollbackBaseline = await createRollbackBaselineForRun({
      options,
      dataDir,
      commandWorkspace,
      ledger,
      runId: run.id
    });
    const before = await snapshotWorkspace(commandWorkspace);
    const stepId = createStepId("cmd");
    const useAdapter = isNonLocalAdapter(adapter);
    await ledger.appendEvent(
      run.id,
      "command_started",
      {
        command: options.command,
        cwd: commandWorkspace,
        adapterId: useAdapter ? adapter.id : undefined,
        adapterName: useAdapter ? adapter.name : undefined
      },
      stepId
    );
    const commandResult = useAdapter
      ? await runAdapterCommand({
          adapter,
          commandWorkspace,
          commandEnvironment,
          options,
          ledger,
          runId: run.id,
          stepId,
          sandboxEnabled,
          sourceWorkspace: workspace
        })
      : await runLocalCommand({
          ...buildLocalCommandInput(options, commandWorkspace, commandEnvironment),
          signal: options.signal
        });
    await ledger.appendEvent(
      run.id,
      "command_finished",
      {
        command: options.command,
        witnessedCommand: options.command,
        adapterCommand: useAdapter ? commandResult.command : undefined,
        cwd: commandResult.cwd,
        exitCode: commandResult.exitCode,
        signal: commandResult.signal,
        durationMs: commandResult.durationMs,
        stdout: redactAndTruncate(commandResult.stdout, options.secretRedactions),
        stderr: redactAndTruncate(commandResult.stderr, options.secretRedactions),
        adapterId: "adapterId" in commandResult ? commandResult.adapterId : undefined,
        adapterStatus: "status" in commandResult ? commandResult.status : undefined,
        adapterMetadata: "metadata" in commandResult ? commandResult.metadata : undefined,
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

    await finalizeRollbackForRun({
      options,
      dataDir,
      commandWorkspace,
      ledger,
      runId: run.id,
      commandExitCode: commandResult.exitCode,
      rollbackBaseline
    });

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

function redactAndTruncate(value: string, redactions: WitnessedCommandOptions["secretRedactions"]): string {
  const redacted = redactions ? redactKnownSecrets(value, redactions) : value;
  return truncate(redacted);
}

function resolveRunAdapter(options: WitnessedCommandOptions): AgentAdapter | undefined {
  if (options.adapter) {
    return options.adapter;
  }
  if (!options.agent || options.agent === "local-command") {
    return undefined;
  }

  return createDefaultAdapterRegistry().get(options.agent);
}

function isNonLocalAdapter(adapter: AgentAdapter | undefined): adapter is AgentAdapter {
  return adapter !== undefined && adapter.id !== "local-command";
}

function buildLocalCommandInput(
  options: WitnessedCommandOptions,
  commandWorkspace: string,
  commandEnvironment: NodeJS.ProcessEnv
): Pick<Parameters<typeof runLocalCommand>[0], "command" | "args" | "cwd" | "env"> {
  const [executable, ...args] = options.commandParts ?? [];
  return {
    command: executable ?? options.command,
    args: executable ? args : undefined,
    cwd: commandWorkspace,
    env: commandEnvironment
  };
}

interface AdapterCommandOptions {
  adapter: AgentAdapter;
  commandWorkspace: string;
  commandEnvironment: NodeJS.ProcessEnv;
  options: WitnessedCommandOptions;
  ledger: RunLedger;
  runId: string;
  stepId: string;
  sandboxEnabled: boolean;
  sourceWorkspace: string;
}

async function runAdapterCommand({
  adapter,
  commandWorkspace,
  commandEnvironment,
  options,
  ledger,
  runId,
  stepId,
  sandboxEnabled,
  sourceWorkspace
}: AdapterCommandOptions): Promise<AgentAdapterRunResult> {
  const input: AgentAdapterRunInput = {
    task: options.task,
    workspace: commandWorkspace,
    command: options.command,
    commandParts: options.commandParts,
    env: commandEnvironment,
    signal: options.signal,
    metadata: {
      sandboxed: sandboxEnabled,
      sourceWorkspace
    }
  };

  if (!adapter.runStream) {
    return adapter.run(input);
  }

  return adapter.runStream(input, (event) => appendAdapterLedgerEvent(ledger, runId, event, stepId));
}

async function appendAdapterLedgerEvent(
  ledger: RunLedger,
  runId: string,
  event: AgentAdapterEvent,
  stepId: string
): Promise<void> {
  const payload: Record<string, unknown> = {
    adapterId: event.adapterId,
    adapterSequence: event.sequence,
    adapterTimestamp: event.timestamp
  };

  if (event.message !== undefined) {
    payload.message = event.message;
  }
  if (event.stream !== undefined) {
    payload.stream = event.stream;
  }
  if (event.artifact !== undefined) {
    payload.artifact = event.artifact;
  }
  if (event.payload !== undefined) {
    payload.adapterPayload = event.payload;
  }

  await ledger.appendEvent(runId, event.kind, payload, stepId);
}

interface RollbackBaselineForRunOptions {
  options: WitnessedCommandOptions;
  dataDir: string;
  commandWorkspace: string;
  ledger: RunLedger;
  runId: string;
}

async function createRollbackBaselineForRun({
  options,
  dataDir,
  commandWorkspace,
  ledger,
  runId
}: RollbackBaselineForRunOptions): Promise<RollbackBaseline | undefined> {
  if (options.rollback?.enabled !== true) {
    return undefined;
  }

  const outputDirectory = rollbackOutputDirectory(options, dataDir);
  const baseline = await createRollbackBaseline(commandWorkspace, {
    outputDirectory,
    baselineName: `${runId}-baseline`
  });
  await ledger.appendEvent(runId, "rollback_baseline_created", {
    enabled: true,
    mode: rollbackMode(options),
    workspaceRoot: commandWorkspace,
    outputDirectory,
    directory: baseline.directory,
    manifestPath: baseline.manifestPath,
    fileCount: baseline.snapshot.files.length
  });
  return baseline;
}

interface FinalizeRollbackForRunOptions {
  options: WitnessedCommandOptions;
  dataDir: string;
  commandWorkspace: string;
  ledger: RunLedger;
  runId: string;
  commandExitCode: number | null;
  rollbackBaseline?: RollbackBaseline;
}

async function finalizeRollbackForRun({
  options,
  dataDir,
  commandWorkspace,
  ledger,
  runId,
  commandExitCode,
  rollbackBaseline
}: FinalizeRollbackForRunOptions): Promise<void> {
  if (!rollbackBaseline) {
    return;
  }

  const mode = rollbackMode(options);
  const outputDirectory = rollbackOutputDirectory(options, dataDir);

  try {
    const afterSnapshot = await createWorkspaceSnapshot(commandWorkspace);
    const rollbackBundle = await createRollbackBundle({
      beforeSnapshot: rollbackBaseline.snapshot,
      afterSnapshot,
      beforeFilesRoot: rollbackBaseline.filesRoot,
      outputDirectory,
      workspaceRoot: commandWorkspace,
      bundleName: `${runId}-rollback`
    });

    await ledger.appendEvent(runId, "rollback_bundle_created", {
      enabled: true,
      mode,
      workspaceRoot: commandWorkspace,
      outputDirectory,
      directory: rollbackBundle.directory,
      manifestPath: rollbackBundle.manifestPath,
      entryCount: rollbackBundle.manifest.entries.length,
      changed: rollbackBundle.manifest.changes
    });

    if (commandExitCode !== 0 && mode !== "bundle") {
      const applyResult = await applyRollbackBundle({
        workspaceRoot: commandWorkspace,
        manifest: rollbackBundle.manifest,
        bundleDirectory: rollbackBundle.directory,
        dryRun: mode === "dry-run"
      });
      await ledger.appendEvent(runId, "rollback_apply_result", summarizeRollbackApplyResult(applyResult));
    }
  } catch (error) {
    await ledger.appendEvent(runId, "rollback_error", {
      mode,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function rollbackMode(options: WitnessedCommandOptions): WitnessedRollbackMode {
  return options.rollback?.mode ?? "bundle";
}

function rollbackOutputDirectory(options: WitnessedCommandOptions, dataDir: string): string {
  return path.resolve(options.rollback?.outputDirectory ?? path.join(dataDir, "rollback"));
}

function summarizeRollbackApplyResult(result: RollbackApplyResult): Record<string, unknown> {
  return {
    dryRun: result.dryRun,
    workspaceRoot: result.workspaceRoot,
    bundleDirectory: result.bundleDirectory,
    manifestPath: result.manifestPath,
    entries: result.entries.length,
    applied: result.applied.length,
    wouldApply: result.wouldApply.length,
    skipped: result.skipped.length,
    errors: result.errors.length,
    details: result.entries.map((entry) => ({
      path: entry.path,
      action: entry.action,
      changeType: entry.changeType,
      status: entry.status,
      reason: entry.reason,
      message: entry.message
    }))
  };
}
