import { CommandAgentAdapter, type CommandAgentAdapterConfig } from "./command-adapter.js";

export type BrowserAutomationAdapterConfig = Partial<Omit<CommandAgentAdapterConfig, "id" | "name">> & {
  id?: string;
  name?: string;
};

export function createBrowserAutomationAdapter(
  config: BrowserAutomationAdapterConfig = {}
): CommandAgentAdapter {
  return new CommandAgentAdapter({
    id: config.id ?? "browser-automation",
    name: config.name ?? "Browser Automation",
    description:
      config.description ??
      "Runs a configured browser automation command wrapper and normalizes JSONL adapter events when emitted.",
    executable: config.executable ?? "browser-automation",
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
