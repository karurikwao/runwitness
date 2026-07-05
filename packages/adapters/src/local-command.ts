import { spawn } from "node:child_process";
import { renderInvocation } from "./invocation.js";
import type {
  AgentAdapter,
  AgentAdapterEvent,
  AgentAdapterRunInput,
  AgentAdapterRunResult,
  AgentAdapterStreamHandler
} from "./types.js";

export interface LocalCommandInput {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  adapterId?: string;
  onEvent?: AgentAdapterStreamHandler;
  signal?: AbortSignal;
  killSignal?: NodeJS.Signals;
}

export interface LocalCommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface LocalCommandAdapterOptions {
  id?: string;
  name?: string;
  description?: string;
  env?: NodeJS.ProcessEnv;
}

export function isLikelyTestCommand(command: string): boolean {
  return /\b(test|vitest|jest|pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test)\b/i.test(command);
}

export function createLocalCommandAdapter(options: LocalCommandAdapterOptions = {}): AgentAdapter {
  const id = options.id ?? "local-command";
  return {
    id,
    name: options.name ?? "Local Command",
    description: options.description ?? "Runs a configured command in the local workspace.",
    capabilities: {
      localExecution: true,
      eventStream: true,
      artifacts: true
    },
    async run(input: AgentAdapterRunInput): Promise<AgentAdapterRunResult> {
      const invocation = createLocalInvocation(input, options.env);
      const result = await runLocalCommand(invocation);
      return {
        adapterId: id,
        status: result.exitCode === 0 ? "completed" : "failed",
        command: renderInvocation(invocation),
        cwd: result.cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        metadata: input.metadata
      };
    },
    async runStream(input: AgentAdapterRunInput, onEvent: AgentAdapterStreamHandler): Promise<AgentAdapterRunResult> {
      const invocation = createLocalInvocation(input, options.env);
      const result = await runLocalCommand({
        ...invocation,
        adapterId: id,
        onEvent
      });
      return {
        adapterId: id,
        status: result.exitCode === 0 ? "completed" : "failed",
        command: renderInvocation(invocation),
        cwd: result.cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        metadata: input.metadata
      };
    }
  };
}

export async function runLocalCommand(input: LocalCommandInput): Promise<LocalCommandResult> {
  const started = performance.now();
  let sequence = 0;
  const adapterId = input.adapterId ?? "local-command";
  let pendingEmits = Promise.resolve();
  const emitNow = async (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp">): Promise<void> => {
    if (!input.onEvent) {
      return;
    }
    sequence += 1;
    await input.onEvent({
      ...event,
      adapterId,
      sequence,
      timestamp: new Date().toISOString()
    });
  };
  const queueEmit = (event: Omit<AgentAdapterEvent, "adapterId" | "sequence" | "timestamp">): void => {
    pendingEmits = pendingEmits.then(() => emitNow(event));
  };

  return new Promise((resolve, reject) => {
    const args = input.args ?? [];
    const killSignal = input.killSignal ?? "SIGTERM";
    let aborted = input.signal?.aborted === true;
    queueEmit({
      kind: "adapter_started",
      message: renderInvocation(input),
      payload: {
        command: input.command,
        args,
        cwd: input.cwd
      }
    });
    if (aborted) {
      const durationMs = Math.round(performance.now() - started);
      queueEmit({
        kind: "adapter_finished",
        message: "Adapter cancelled.",
        payload: { exitCode: null, signal: killSignal, durationMs, aborted: true }
      });
      void pendingEmits.then(() => {
        resolve({
          command: input.command,
          cwd: input.cwd,
          exitCode: null,
          signal: killSignal,
          durationMs,
          stdout: "",
          stderr: ""
        });
      }, reject);
      return;
    }

    const child = spawn(input.command, args, {
      cwd: input.cwd,
      env: input.env ?? process.env,
      shell: args.length === 0,
      windowsHide: true
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const abort = (): void => {
      aborted = true;
      if (!child.killed) {
        child.kill(killSignal);
      }
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    const removeAbortListener = (): void => {
      input.signal?.removeEventListener("abort", abort);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      queueEmit({ kind: "adapter_stdout", stream: "stdout", message: chunk.toString("utf8") });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      queueEmit({ kind: "adapter_stderr", stream: "stderr", message: chunk.toString("utf8") });
    });
    child.on("error", (error) => {
      removeAbortListener();
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      removeAbortListener();
      const durationMs = Math.round(performance.now() - started);
      const finalSignal = signal ?? (aborted ? killSignal : null);
      queueEmit({
        kind: "adapter_finished",
        message: aborted ? "Adapter cancelled." : exitCode === 0 ? "Adapter completed." : "Adapter failed.",
        payload: { exitCode, signal: finalSignal, durationMs, aborted }
      });
      void pendingEmits.then(() => {
        resolve({
          command: input.command,
          cwd: input.cwd,
          exitCode,
          signal: finalSignal,
          durationMs,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        });
      }, reject);
    });
  });
}

function createLocalInvocation(input: AgentAdapterRunInput, defaultEnv?: NodeJS.ProcessEnv): LocalCommandInput {
  const [executable, ...args] = input.commandParts ?? [];
  const command = executable ?? input.command;
  if (!command) {
    throw new Error("Local command adapter requires command or commandParts.");
  }

  return {
    command,
    args: executable ? args : undefined,
    cwd: input.workspace,
    env: mergeEnv(process.env, defaultEnv, input.env),
    signal: input.signal
  };
}

function mergeEnv(...envs: Array<NodeJS.ProcessEnv | undefined>): NodeJS.ProcessEnv {
  return Object.assign({}, ...envs.filter((env): env is NodeJS.ProcessEnv => Boolean(env)));
}
