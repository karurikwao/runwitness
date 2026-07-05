import type { LocalCommandInput } from "./local-command.js";
import { runLocalCommand } from "./local-command.js";
import { renderInvocation } from "./invocation.js";
import type { AgentAdapter, AgentAdapterCapabilities, AgentAdapterRunInput, AgentAdapterRunResult } from "./types.js";

export interface CommandAgentAdapterConfig {
  id: string;
  name: string;
  executable: string;
  description?: string;
  baseArgs?: string[];
  workspaceFlag?: string | false;
  taskFlag?: string | false;
  commandFlag?: string | false;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  capabilities?: AgentAdapterCapabilities;
}

export class CommandAgentAdapter implements AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly capabilities: AgentAdapterCapabilities;
  readonly #config: Required<Pick<CommandAgentAdapterConfig, "baseArgs" | "extraArgs">> &
    Omit<CommandAgentAdapterConfig, "baseArgs" | "extraArgs">;

  constructor(config: CommandAgentAdapterConfig) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.capabilities = {
      externalTool: true,
      requiresConfiguredTool: true,
      ...config.capabilities
    };
    this.#config = {
      ...config,
      baseArgs: config.baseArgs ?? [],
      extraArgs: config.extraArgs ?? []
    };
  }

  buildInvocation(input: AgentAdapterRunInput): LocalCommandInput {
    const args = [...this.#config.baseArgs];
    appendFlaggedValue(args, this.#config.workspaceFlag ?? "--workspace", input.workspace);
    appendFlaggedValue(args, this.#config.taskFlag ?? "--task", input.task);
    if (input.command) {
      appendFlaggedValue(args, this.#config.commandFlag ?? "--command", input.command);
    }
    args.push(...this.#config.extraArgs);

    return {
      command: this.#config.executable,
      args,
      cwd: input.workspace,
      env: mergeEnv(process.env, this.#config.env, input.env)
    };
  }

  async run(input: AgentAdapterRunInput): Promise<AgentAdapterRunResult> {
    const invocation = this.buildInvocation(input);
    const result = await runLocalCommand(invocation);
    return {
      adapterId: this.id,
      status: result.exitCode === 0 ? "completed" : "failed",
      command: renderInvocation(invocation),
      cwd: result.cwd,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      metadata: {
        executable: this.#config.executable,
        tool: this.id,
        ...input.metadata
      }
    };
  }
}

export function createCommandAgentAdapter(config: CommandAgentAdapterConfig): CommandAgentAdapter {
  return new CommandAgentAdapter(config);
}

function appendFlaggedValue(args: string[], flag: string | false, value: string): void {
  if (flag === false) {
    return;
  }
  if (flag) {
    args.push(flag);
  }
  args.push(value);
}

function mergeEnv(...envs: Array<NodeJS.ProcessEnv | undefined>): NodeJS.ProcessEnv {
  return Object.assign({}, ...envs.filter((env): env is NodeJS.ProcessEnv => Boolean(env)));
}
