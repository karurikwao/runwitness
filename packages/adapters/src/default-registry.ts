import { createBrowserAutomationAdapter, type BrowserAutomationAdapterConfig } from "./browser-automation.js";
import { createCiAdapter, type CiAdapterConfig } from "./ci.js";
import { createDeploymentAdapter, type DeploymentAdapterConfig } from "./deployment.js";
import { createHermesAdapter, type HermesAdapterConfig } from "./hermes.js";
import { createLocalCommandAdapter, type LocalCommandAdapterOptions } from "./local-command.js";
import { createMcpAdapter, type McpAdapterConfig } from "./mcp.js";
import { createOpenClawAdapter, type OpenClawAdapterConfig } from "./openclaw.js";
import { AgentAdapterRegistry } from "./registry.js";

export interface DefaultAdapterRegistryOptions {
  localCommand?: LocalCommandAdapterOptions | false;
  openClaw?: OpenClawAdapterConfig | false;
  hermes?: HermesAdapterConfig | false;
  browserAutomation?: BrowserAutomationAdapterConfig | false;
  mcp?: McpAdapterConfig | false;
  ci?: CiAdapterConfig | false;
  deployment?: DeploymentAdapterConfig | false;
}

export function createDefaultAdapterRegistry(options: DefaultAdapterRegistryOptions = {}): AgentAdapterRegistry {
  const registry = new AgentAdapterRegistry();

  if (options.localCommand !== false) {
    registry.register(createLocalCommandAdapter(options.localCommand));
  }
  if (options.openClaw !== false) {
    registry.register(createOpenClawAdapter(options.openClaw));
  }
  if (options.hermes !== false) {
    registry.register(createHermesAdapter(options.hermes));
  }
  if (options.browserAutomation !== false) {
    registry.register(createBrowserAutomationAdapter(options.browserAutomation));
  }
  if (options.mcp !== false) {
    registry.register(createMcpAdapter(options.mcp));
  }
  if (options.ci !== false) {
    registry.register(createCiAdapter(options.ci));
  }
  if (options.deployment !== false) {
    registry.register(createDeploymentAdapter(options.deployment));
  }

  return registry;
}
