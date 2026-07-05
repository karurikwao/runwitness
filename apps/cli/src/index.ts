import { Command } from "commander";
import pc from "picocolors";
import { promises as fs } from "node:fs";
import { inspectSkillManifest } from "@runwitness/skills";
import { createDefaultAdapterRegistry } from "@runwitness/adapters";
import { listenOperatorServer, RunLedger, runWitnessedCommand } from "@runwitness/core";
import { evaluateCommandPolicy, loadPolicyFromFile } from "@runwitness/policy";

export const program = new Command();

program
  .name("runwitness")
  .description("Autonomous agents with receipts.")
  .version("0.1.0");

program
  .command("run")
  .description("Run a local command with ledger events, file tracking, and receipt export.")
  .requiredOption("--task <task>", "human-readable task description")
  .option("--workspace <path>", "workspace to run in", process.cwd())
  .option("--data-dir <path>", "RunWitness data directory")
  .option("--agent <name>", "agent or adapter name", "local-command")
  .option("--policy <path>", "YAML policy file to evaluate before running")
  .option("--yes", "auto-approve policy actions that would otherwise ask")
  .allowExcessArguments(true)
  .argument("<command...>", "command to run")
  .action(async (commandParts: string[], options: Record<string, string | boolean | undefined>) => {
    const command = formatCommand(commandParts);
    const policy = options.policy ? await loadPolicyFromFile(String(options.policy)) : undefined;
    const result = await runWitnessedCommand({
      task: String(options.task),
      command,
      commandParts,
      workspace: String(options.workspace),
      dataDir: options.dataDir ? String(options.dataDir) : undefined,
      agent: options.agent ? String(options.agent) : "local-command",
      yes: options.yes === true,
      policy
    });

    console.log(pc.bold("RunWitness receipt generated"));
    console.log(`Run ID: ${result.run.id}`);
    console.log(`Status: ${result.run.status}`);
    console.log(`Database: ${result.dbPath}`);
    console.log(`JSON: ${result.receiptJsonPath}`);
    console.log(`Markdown: ${result.receiptMarkdownPath}`);
    process.exitCode = result.exitCode ?? (result.run.status === "blocked" ? 2 : 1);
  });

const policy = program.command("policy").description("Inspect and evaluate RunWitness policy files.");

policy
  .command("check")
  .description("Evaluate a shell command against a YAML policy.")
  .requiredOption("--policy <path>", "YAML policy file")
  .allowExcessArguments(true)
  .argument("<command...>", "command to evaluate")
  .action(async (commandParts: string[], options: Record<string, string | undefined>) => {
    const policyFile = options.policy;
    if (!policyFile) {
      throw new Error("Missing required --policy option");
    }
    const loadedPolicy = await loadPolicyFromFile(policyFile);
    const command = formatCommand(commandParts);
    const evaluation = evaluateCommandPolicy(command, loadedPolicy);
    printJson(evaluation);
    process.exitCode = evaluation.decision === "deny" ? 2 : evaluation.decision === "ask" ? 1 : 0;
  });

program
  .command("skill")
  .description("Inspect RunWitness skill manifests.")
  .command("inspect")
  .description("Inspect a skill manifest for permissions, digest, and signature status.")
  .requiredOption("--file <path>", "skill manifest YAML file")
  .action(async (options: Record<string, string | undefined>) => {
    const file = options.file;
    if (!file) {
      throw new Error("Missing required --file option");
    }
    printJson(inspectSkillManifest(await fs.readFile(file, "utf8")));
  });

program
  .command("adapters")
  .description("Inspect configured agent adapters.")
  .command("list")
  .description("List built-in adapters.")
  .action(() => {
    const registry = createDefaultAdapterRegistry();
    printJson({
      adapters: registry.list().map((adapter) => ({
        id: adapter.id,
        name: adapter.name,
        description: adapter.description,
        capabilities: adapter.capabilities
      }))
    });
  });

program
  .command("serve")
  .description("Start the local operator API server.")
  .option("--data-dir <path>", "RunWitness data directory", ".runwitness")
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--port <port>", "port to bind", "8787")
  .action(async (options: Record<string, string | undefined>) => {
    const dataDir = options.dataDir ?? ".runwitness";
    const host = options.host ?? "127.0.0.1";
    const port = Number(options.port ?? "8787");
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("--port must be an integer between 0 and 65535");
    }
    const ledger = await RunLedger.open(`${dataDir}/runwitness.sqlite`);
    const server = await listenOperatorServer({ ledger, host, port });
    console.log(pc.bold("RunWitness operator server listening"));
    console.log(server.url);
    const shutdown = async () => {
      await server.close();
      ledger.close();
    };
    process.once("SIGINT", () => {
      void shutdown().then(() => {
        process.exitCode = 0;
      });
    });
    process.once("SIGTERM", () => {
      void shutdown().then(() => {
        process.exitCode = 0;
      });
    });
  });

program
  .command("timeline")
  .description("Print the event timeline for a run.")
  .requiredOption("--run <id>", "run id")
  .option("--data-dir <path>", "RunWitness data directory", ".runwitness")
  .action(async (options: Record<string, string>) => {
    const dataDir = options.dataDir ?? ".runwitness";
    const runId = options.run;
    if (!runId) {
      throw new Error("Missing required --run option");
    }
    const ledger = await RunLedger.open(`${dataDir}/runwitness.sqlite`);
    try {
      for (const event of ledger.timeline(runId)) {
        console.log(`${String(event.sequence).padStart(4, "0")} ${event.timestamp} ${event.kind}`);
      }
    } finally {
      ledger.close();
    }
  });

export async function main(): Promise<void> {
  await program.parseAsync();
}

function formatCommand(parts: string[]): string {
  return parts.map((part) => (needsQuoting(part) ? JSON.stringify(part) : part)).join(" ");
}

function needsQuoting(value: string): boolean {
  return value.length === 0 || /[\s"'`|&<>()[\]{};]/.test(value);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
