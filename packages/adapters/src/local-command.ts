import { spawn } from "node:child_process";
import { renderInvocation } from "./invocation.js";
import type { AgentAdapter, AgentAdapterRunInput, AgentAdapterRunResult } from "./types.js";

export interface LocalCommandInput {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
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
      localExecution: true
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
    }
  };
}

export async function runLocalCommand(input: LocalCommandInput): Promise<LocalCommandResult> {
  const started = performance.now();

  return new Promise((resolve, reject) => {
    const args = input.args ?? [];
    const child = spawn(input.command, args, {
      cwd: input.cwd,
      env: input.env ?? process.env,
      shell: args.length === 0,
      windowsHide: true
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolve({
        command: input.command,
        cwd: input.cwd,
        exitCode,
        signal,
        durationMs: Math.round(performance.now() - started),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
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
    env: mergeEnv(process.env, defaultEnv, input.env)
  };
}

function mergeEnv(...envs: Array<NodeJS.ProcessEnv | undefined>): NodeJS.ProcessEnv {
  return Object.assign({}, ...envs.filter((env): env is NodeJS.ProcessEnv => Boolean(env)));
}
