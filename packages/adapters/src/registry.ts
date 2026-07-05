import type { AgentAdapter } from "./types.js";

export interface RegisterAdapterOptions {
  replace?: boolean;
}

export class AgentAdapterRegistry {
  readonly #adapters = new Map<string, AgentAdapter>();

  constructor(adapters: AgentAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: AgentAdapter, options: RegisterAdapterOptions = {}): this {
    if (!options.replace && this.#adapters.has(adapter.id)) {
      throw new Error(`Adapter already registered: ${adapter.id}`);
    }
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  get(id: string): AgentAdapter | undefined {
    return this.#adapters.get(id);
  }

  require(id: string): AgentAdapter {
    const adapter = this.get(id);
    if (!adapter) {
      const available = this.list()
        .map((candidate) => candidate.id)
        .sort()
        .join(", ");
      throw new Error(`Unknown adapter: ${id}${available ? `. Available adapters: ${available}` : ""}`);
    }
    return adapter;
  }

  has(id: string): boolean {
    return this.#adapters.has(id);
  }

  list(): AgentAdapter[] {
    return [...this.#adapters.values()];
  }
}

export function createAgentAdapterRegistry(adapters: AgentAdapter[] = []): AgentAdapterRegistry {
  return new AgentAdapterRegistry(adapters);
}
