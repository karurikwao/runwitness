import { Command } from "commander";
import pc from "picocolors";
import { RunLedger, runWitnessedCommand } from "@runwitness/core";

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
  .option("--yes", "auto-approve policy actions that would otherwise ask")
  .allowExcessArguments(true)
  .argument("<command...>", "command to run")
  .action(async (commandParts: string[], options: Record<string, string | boolean | undefined>) => {
    const command = formatCommand(commandParts);
    const result = await runWitnessedCommand({
      task: String(options.task),
      command,
      commandParts,
      workspace: String(options.workspace),
      dataDir: options.dataDir ? String(options.dataDir) : undefined,
      agent: options.agent ? String(options.agent) : "local-command",
      yes: options.yes === true
    });

    console.log(pc.bold("RunWitness receipt generated"));
    console.log(`Run ID: ${result.run.id}`);
    console.log(`Status: ${result.run.status}`);
    console.log(`Database: ${result.dbPath}`);
    console.log(`JSON: ${result.receiptJsonPath}`);
    console.log(`Markdown: ${result.receiptMarkdownPath}`);
    process.exitCode = result.exitCode ?? (result.run.status === "blocked" ? 2 : 1);
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
