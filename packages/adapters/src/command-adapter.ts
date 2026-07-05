import type { LocalCommandInput } from "./local-command.js";
import { runLocalCommand } from "./local-command.js";
import { renderInvocation } from "./invocation.js";
import { parseStructuredAdapterEvents } from "./structured-events.js";
import type {
  AgentAdapter,
  AgentAdapterCapabilities,
  AgentAdapterEvent,
  AgentAdapterRunInput,
  AgentAdapterRunResult,
  AgentAdapterStreamHandler
} from "./types.js";

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
  structuredEvents?: boolean;
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
      eventStream: true,
      opaqueActions: true,
      artifacts: config.structuredEvents === true ? true : config.capabilities?.artifacts,
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

  async runStream(input: AgentAdapterRunInput, onEvent: AgentAdapterStreamHandler): Promise<AgentAdapterRunResult> {
    await onEvent(createOpaqueActionEvent(this.id, 1, {
      tool: this.id,
      task: input.task,
      command: input.command,
      message: `${this.name} is an external tool adapter. Nested tool activity is marked opaque unless the tool emits structured events.`
    }));
    const invocation = this.buildInvocation(input);
    const streamHandler = this.#config.structuredEvents === true
      ? structuredEventStream(this.id, offsetStream(onEvent, 1))
      : offsetStream(onEvent, 1);
    const result = await runLocalCommand({
      ...invocation,
      adapterId: this.id,
      onEvent: streamHandler
    });
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
        opaqueNestedActions: true,
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

function createOpaqueActionEvent(
  adapterId: string,
  sequence: number,
  payload: Record<string, unknown>
): AgentAdapterEvent {
  return {
    kind: "adapter_opaque_action",
    adapterId,
    sequence,
    timestamp: new Date().toISOString(),
    message: typeof payload.message === "string" ? payload.message : "Opaque adapter action.",
    payload
  };
}

function offsetStream(onEvent: AgentAdapterStreamHandler, offset: number): AgentAdapterStreamHandler {
  return (event) =>
    onEvent({
      ...event,
      sequence: event.sequence + offset
    });
}

function structuredEventStream(adapterId: string, onEvent: AgentAdapterStreamHandler): AgentAdapterStreamHandler {
  let nextStructuredSequence = 10_000;
  return async (event) => {
    await onEvent(event);
    if (event.kind !== "adapter_stdout" && event.kind !== "adapter_stderr") {
      return;
    }

    const structuredEvents = parseStructuredAdapterEvents(event.message ?? "", {
      adapterId,
      sequence: nextStructuredSequence,
      fallbackTimestamp: event.timestamp
    });
    nextStructuredSequence += structuredEvents.length;

    for (const structuredEvent of structuredEvents) {
      await onEvent(structuredEvent);
    }
  };
}
