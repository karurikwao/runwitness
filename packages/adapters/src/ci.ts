import { CommandAgentAdapter, type CommandAgentAdapterConfig } from "./command-adapter.js";

export type CiAdapterConfig = Partial<Omit<CommandAgentAdapterConfig, "id" | "name">> & {
  id?: string;
  name?: string;
};

export function createCiAdapter(config: CiAdapterConfig = {}): CommandAgentAdapter {
  return new CommandAgentAdapter({
    id: config.id ?? "ci",
    name: config.name ?? "CI",
    description:
      config.description ??
      "Runs a configured CI command wrapper and normalizes JSONL adapter events when emitted.",
    executable: config.executable ?? "ci",
    baseArgs: config.baseArgs ?? ["run"],
    workspaceFlag: config.workspaceFlag ?? "--workspace",
    taskFlag: config.taskFlag ?? "--task",
    commandFlag: config.commandFlag ?? "--command",
    extraArgs: config.extraArgs,
    env: config.env,
    structuredEvents: config.structuredEvents ?? true,
    capabilities: config.capabilities
  });
}
