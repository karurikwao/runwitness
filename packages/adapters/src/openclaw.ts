import { CommandAgentAdapter, type CommandAgentAdapterConfig } from "./command-adapter.js";

export type OpenClawAdapterConfig = Partial<Omit<CommandAgentAdapterConfig, "id" | "name">> & {
  id?: string;
  name?: string;
};

export function createOpenClawAdapter(config: OpenClawAdapterConfig = {}): CommandAgentAdapter {
  return new CommandAgentAdapter({
    id: config.id ?? "openclaw",
    name: config.name ?? "OpenClaw",
    description: config.description ?? "Runs tasks through an OpenClaw command-line adapter.",
    executable: config.executable ?? "openclaw",
    baseArgs: config.baseArgs ?? ["run"],
    workspaceFlag: config.workspaceFlag ?? "--workspace",
    taskFlag: config.taskFlag ?? "--task",
    commandFlag: config.commandFlag ?? "--command",
    extraArgs: config.extraArgs,
    env: config.env,
    capabilities: config.capabilities
  });
}
