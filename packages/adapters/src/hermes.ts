import { CommandAgentAdapter, type CommandAgentAdapterConfig } from "./command-adapter.js";

export type HermesAdapterConfig = Partial<Omit<CommandAgentAdapterConfig, "id" | "name">> & {
  id?: string;
  name?: string;
};

export function createHermesAdapter(config: HermesAdapterConfig = {}): CommandAgentAdapter {
  return new CommandAgentAdapter({
    id: config.id ?? "hermes",
    name: config.name ?? "Hermes",
    description: config.description ?? "Runs tasks through a Hermes command-line adapter.",
    executable: config.executable ?? "hermes",
    baseArgs: config.baseArgs ?? ["run"],
    workspaceFlag: config.workspaceFlag ?? "--workspace",
    taskFlag: config.taskFlag ?? "--task",
    commandFlag: config.commandFlag ?? "--command",
    extraArgs: config.extraArgs,
    env: config.env,
    capabilities: config.capabilities
  });
}
