import { CommandAgentAdapter, type CommandAgentAdapterConfig } from "./command-adapter.js";

export type McpAdapterConfig = Partial<Omit<CommandAgentAdapterConfig, "id" | "name">> & {
  id?: string;
  name?: string;
};

export function createMcpAdapter(config: McpAdapterConfig = {}): CommandAgentAdapter {
  return new CommandAgentAdapter({
    id: config.id ?? "mcp",
    name: config.name ?? "MCP",
    description:
      config.description ??
      "Runs a configured MCP command wrapper and normalizes JSONL adapter events when emitted.",
    executable: config.executable ?? "mcp",
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
