import { CommandAgentAdapter, type CommandAgentAdapterConfig } from "./command-adapter.js";

export type DeploymentAdapterConfig = Partial<Omit<CommandAgentAdapterConfig, "id" | "name">> & {
  id?: string;
  name?: string;
};

export function createDeploymentAdapter(config: DeploymentAdapterConfig = {}): CommandAgentAdapter {
  return new CommandAgentAdapter({
    id: config.id ?? "deployment",
    name: config.name ?? "Deployment",
    description:
      config.description ??
      "Runs a configured deployment command wrapper and normalizes JSONL adapter events when emitted.",
    executable: config.executable ?? "deployment",
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
