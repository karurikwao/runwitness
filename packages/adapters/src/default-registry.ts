import { createHermesAdapter, type HermesAdapterConfig } from "./hermes.js";
import { createLocalCommandAdapter, type LocalCommandAdapterOptions } from "./local-command.js";
import { createOpenClawAdapter, type OpenClawAdapterConfig } from "./openclaw.js";
import { AgentAdapterRegistry } from "./registry.js";

export interface DefaultAdapterRegistryOptions {
  localCommand?: LocalCommandAdapterOptions | false;
  openClaw?: OpenClawAdapterConfig | false;
  hermes?: HermesAdapterConfig | false;
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

  return registry;
}
