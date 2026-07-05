import { spawn } from "node:child_process";

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

export function isLikelyTestCommand(command: string): boolean {
  return /\b(test|vitest|jest|pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test)\b/i.test(command);
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
