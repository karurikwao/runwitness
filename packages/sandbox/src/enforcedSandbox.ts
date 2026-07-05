import { spawn } from "node:child_process";
import path from "node:path";
import { buildFilteredEnvironment } from "./environment.js";
import { resolveSafePath, SandboxPathError } from "./pathSafety.js";

export const ENFORCED_SANDBOX_PLAN_VERSION = 1 as const;

export const SUPPORTED_ENFORCED_SANDBOX_RUNTIMES = ["docker", "podman"] as const;
export const SUPPORTED_ENFORCED_SANDBOX_NETWORK_MODES = ["disabled", "host", "bridge"] as const;

export type EnforcedSandboxRuntime = (typeof SUPPORTED_ENFORCED_SANDBOX_RUNTIMES)[number];
export type EnforcedSandboxNetworkMode = (typeof SUPPORTED_ENFORCED_SANDBOX_NETWORK_MODES)[number];

export type EnforcedSandboxErrorCode =
  | "EMPTY_COMMAND"
  | "EMPTY_IMAGE"
  | "INVALID_CONTAINER_PATH"
  | "INVALID_ENV_KEY"
  | "INVALID_NETWORK_MODE"
  | "INVALID_MOUNT_SOURCE"
  | "INVALID_RUNTIME"
  | "READONLY_WORKSPACE_WRITE_MOUNT"
  | "WORKDIR_OUTSIDE_MOUNTS";

export class EnforcedSandboxError extends Error {
  readonly code: EnforcedSandboxErrorCode;

  constructor(code: EnforcedSandboxErrorCode, message: string) {
    super(message);
    this.name = "EnforcedSandboxError";
    this.code = code;
  }
}

export interface EnforcedSandboxMount {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface ResolvedEnforcedSandboxMount {
  kind: "workspace" | "additional";
  source: string;
  workspaceRelativePath: string;
  target: string;
  readOnly: boolean;
}

export interface EnforcedSandboxOptions {
  workspaceRoot: string;
  image: string;
  command: readonly string[];
  runtime?: EnforcedSandboxRuntime;
  networkMode?: EnforcedSandboxNetworkMode;
  workspaceMountPath?: string;
  workdir?: string;
  readOnlyWorkspace?: boolean;
  mounts?: readonly EnforcedSandboxMount[];
  envAllowlist?: readonly string[];
  baseEnv?: Record<string, string | undefined>;
  env?: Record<string, string | undefined>;
  removeContainer?: boolean;
}

export interface EnforcedSandboxPlan {
  kind: "runwitness.enforcedSandboxPlan";
  version: typeof ENFORCED_SANDBOX_PLAN_VERSION;
  runtime: EnforcedSandboxRuntime;
  image: string;
  command: string[];
  networkMode: EnforcedSandboxNetworkMode;
  networkArgument: "none" | "host" | "bridge";
  workspaceRoot: string;
  workspaceMount: ResolvedEnforcedSandboxMount;
  mounts: ResolvedEnforcedSandboxMount[];
  workdir: string;
  readOnlyWorkspace: boolean;
  containerEnvKeys: string[];
  omittedEnvKeys: string[];
  removeContainer: boolean;
  warnings: string[];
}

export interface EnforcedSandboxInvocation {
  executable: EnforcedSandboxRuntime;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  commandLine: string;
  plan: EnforcedSandboxPlan;
}

export interface EnforcedSandboxExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals;
}

export type EnforcedSandboxCommandRunner = (
  invocation: EnforcedSandboxInvocation,
) => Promise<EnforcedSandboxExecution>;

export interface RunEnforcedSandboxOptions extends EnforcedSandboxOptions {
  dryRun?: boolean;
  runner?: EnforcedSandboxCommandRunner;
}

export type EnforcedSandboxRunStatus = "dry-run" | "completed" | "failed";

export interface EnforcedSandboxRunResult {
  status: EnforcedSandboxRunStatus;
  dryRun: boolean;
  invocation: EnforcedSandboxInvocation;
  plan: EnforcedSandboxPlan;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals;
}

interface ResolvedEnvironment {
  hostEnv: Record<string, string>;
  containerEnvKeys: string[];
  omittedEnvKeys: string[];
}

export function createEnforcedSandboxPlan(options: EnforcedSandboxOptions): EnforcedSandboxPlan {
  const runtime = options.runtime ?? "docker";
  if (!isSupportedRuntime(runtime)) {
    throw new EnforcedSandboxError("INVALID_RUNTIME", `Unsupported container runtime: ${runtime}`);
  }

  const image = normalizeImage(options.image);
  const command = normalizeCommand(options.command);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const workspaceMountPath = normalizeContainerPath(options.workspaceMountPath ?? "/workspace", "workspace mount path", {
    allowRoot: false,
  });
  const workdir = normalizeContainerPath(options.workdir ?? workspaceMountPath, "workdir", {
    allowRoot: true,
  });
  const readOnlyWorkspace = options.readOnlyWorkspace ?? true;
  const networkMode = options.networkMode ?? "disabled";
  if (!isSupportedNetworkMode(networkMode)) {
    throw new EnforcedSandboxError("INVALID_NETWORK_MODE", `Unsupported sandbox network mode: ${networkMode}`);
  }

  const workspaceMount: ResolvedEnforcedSandboxMount = {
    kind: "workspace",
    source: workspaceRoot,
    workspaceRelativePath: ".",
    target: workspaceMountPath,
    readOnly: readOnlyWorkspace,
  };

  validateMountSourceSyntax(workspaceMount.source);
  const additionalMounts = resolveAdditionalMounts(workspaceRoot, workspaceMountPath, readOnlyWorkspace, options.mounts ?? []);
  const mounts = [workspaceMount, ...additionalMounts];
  ensureUniqueMountTargets(mounts);

  if (!mounts.some((mount) => isContainerPathInsideOrEqual(mount.target, workdir))) {
    throw new EnforcedSandboxError(
      "WORKDIR_OUTSIDE_MOUNTS",
      `Container workdir must be inside a configured mount: ${workdir}`,
    );
  }

  const environment = resolveEnvironment(options);

  return {
    kind: "runwitness.enforcedSandboxPlan",
    version: ENFORCED_SANDBOX_PLAN_VERSION,
    runtime,
    image,
    command,
    networkMode,
    networkArgument: networkArgumentForMode(networkMode),
    workspaceRoot,
    workspaceMount,
    mounts,
    workdir,
    readOnlyWorkspace,
    containerEnvKeys: environment.containerEnvKeys,
    omittedEnvKeys: environment.omittedEnvKeys,
    removeContainer: options.removeContainer ?? true,
    warnings: warningsForPlan(readOnlyWorkspace, networkMode, environment.omittedEnvKeys),
  };
}

export function buildEnforcedSandboxInvocation(options: EnforcedSandboxOptions): EnforcedSandboxInvocation {
  const plan = createEnforcedSandboxPlan(options);
  const environment = resolveEnvironment(options);
  const args = buildContainerRunArgs(plan);
  const commandLine = formatCommandLine([plan.runtime, ...args]);

  return {
    executable: plan.runtime,
    args,
    cwd: plan.workspaceRoot,
    env: environment.hostEnv,
    commandLine,
    plan,
  };
}

export async function runEnforcedSandbox(options: RunEnforcedSandboxOptions): Promise<EnforcedSandboxRunResult> {
  const invocation = buildEnforcedSandboxInvocation(options);

  if (options.dryRun) {
    return {
      status: "dry-run",
      dryRun: true,
      invocation,
      plan: invocation.plan,
      exitCode: null,
      stdout: "",
      stderr: "",
    };
  }

  const execute = options.runner ?? spawnEnforcedSandboxInvocation;
  const execution = await execute(invocation);

  return {
    status: execution.exitCode === 0 ? "completed" : "failed",
    dryRun: false,
    invocation,
    plan: invocation.plan,
    exitCode: execution.exitCode,
    stdout: execution.stdout,
    stderr: execution.stderr,
    ...(execution.signal ? { signal: execution.signal } : {}),
  };
}

export function buildContainerRunArgs(plan: EnforcedSandboxPlan): string[] {
  const args = ["run"];

  if (plan.removeContainer) {
    args.push("--rm");
  }

  args.push("--network", plan.networkArgument, "--workdir", plan.workdir);

  for (const mount of plan.mounts) {
    args.push("--mount", formatBindMount(mount));
  }

  for (const key of plan.containerEnvKeys) {
    args.push("--env", key);
  }

  args.push(plan.image, ...plan.command);
  return args;
}

async function spawnEnforcedSandboxInvocation(invocation: EnforcedSandboxInvocation): Promise<EnforcedSandboxExecution> {
  return await new Promise<EnforcedSandboxExecution>((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolve({
        exitCode: exitCode ?? (signal ? 1 : 0),
        stdout,
        stderr,
        ...(signal ? { signal } : {}),
      });
    });
  });
}

function resolveAdditionalMounts(
  workspaceRoot: string,
  workspaceMountPath: string,
  readOnlyWorkspace: boolean,
  mounts: readonly EnforcedSandboxMount[],
): ResolvedEnforcedSandboxMount[] {
  return mounts.map((mount) => {
    const source = resolveMountSource(workspaceRoot, mount.source);
    const target = normalizeContainerPath(mount.target, "mount target", { allowRoot: false });
    const readOnly = mount.readOnly ?? true;

    validateMountSourceSyntax(source.absolutePath);
    if (readOnlyWorkspace && !readOnly) {
      throw new EnforcedSandboxError(
        "READONLY_WORKSPACE_WRITE_MOUNT",
        `Read-write mount would bypass the read-only workspace policy: ${mount.source}`,
      );
    }

    if (readOnlyWorkspace && isContainerPathInsideOrEqual(workspaceMountPath, target) && !readOnly) {
      throw new EnforcedSandboxError(
        "READONLY_WORKSPACE_WRITE_MOUNT",
        `Read-write mount overlaps the read-only workspace mount: ${target}`,
      );
    }

    return {
      kind: "additional",
      source: source.absolutePath,
      workspaceRelativePath: source.relativePath,
      target,
      readOnly,
    };
  });
}

function resolveMountSource(
  workspaceRoot: string,
  requestedSource: string,
): { absolutePath: string; relativePath: string } {
  try {
    const resolved = resolveSafePath(workspaceRoot, requestedSource, { allowRoot: false });
    return {
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
    };
  } catch (error) {
    if (error instanceof SandboxPathError) {
      throw new EnforcedSandboxError(
        "INVALID_MOUNT_SOURCE",
        `Mount source must resolve inside the workspace and cannot be the workspace root: ${requestedSource}`,
      );
    }

    throw error;
  }
}

function resolveEnvironment(options: EnforcedSandboxOptions): ResolvedEnvironment {
  const baseEnv = options.baseEnv ?? process.env;
  const explicitEnv = options.env ?? {};
  const envAllowlist = uniqueEnvKeys(options.envAllowlist ?? []);
  const allowedKeyLookup = new Set(envAllowlist.map((key) => key.toLowerCase()));
  const omittedEnvKeys = Object.keys(explicitEnv)
    .filter((key) => explicitEnv[key] !== undefined && !allowedKeyLookup.has(key.toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
  const filteredHostEnvironment = buildFilteredEnvironment({
    baseEnv,
    extraEnv: explicitEnv,
    allowKeys: envAllowlist,
    preserveSystemEnv: true,
  });
  const hostEnv = { ...filteredHostEnvironment.env };
  const containerEnvKeys: string[] = [];

  for (const key of envAllowlist) {
    const value = findEnvironmentValue(explicitEnv, key) ?? findEnvironmentValue(baseEnv, key);
    if (value === undefined) {
      continue;
    }

    hostEnv[key] = value;
    containerEnvKeys.push(key);
  }

  return {
    hostEnv,
    containerEnvKeys,
    omittedEnvKeys,
  };
}

function normalizeImage(image: string): string {
  const normalized = image.trim();
  if (!normalized) {
    throw new EnforcedSandboxError("EMPTY_IMAGE", "Container image is required.");
  }

  if (/[\s\0]/u.test(normalized)) {
    throw new EnforcedSandboxError("EMPTY_IMAGE", `Container image contains invalid whitespace: ${image}`);
  }

  return normalized;
}

function normalizeCommand(command: readonly string[]): string[] {
  if (command.length === 0) {
    throw new EnforcedSandboxError("EMPTY_COMMAND", "Sandbox command must include at least one argv entry.");
  }

  return command.map((entry, index) => {
    if (entry.length === 0 || entry.includes("\0")) {
      throw new EnforcedSandboxError("EMPTY_COMMAND", `Sandbox command argv entry is invalid at index ${index}.`);
    }

    return entry;
  });
}

function normalizeContainerPath(value: string, field: string, options: { allowRoot: boolean }): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0") || trimmed.includes("\\") || !trimmed.startsWith("/")) {
    throw new EnforcedSandboxError("INVALID_CONTAINER_PATH", `Container ${field} must be an absolute POSIX path.`);
  }

  if (trimmed.split("/").includes("..")) {
    throw new EnforcedSandboxError("INVALID_CONTAINER_PATH", `Container ${field} cannot contain parent segments.`);
  }

  const normalized = path.posix.normalize(trimmed);
  if (normalized === "/" && !options.allowRoot) {
    throw new EnforcedSandboxError("INVALID_CONTAINER_PATH", `Container ${field} cannot be the filesystem root.`);
  }

  return normalized;
}

function uniqueEnvKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      throw new EnforcedSandboxError("INVALID_ENV_KEY", `Invalid environment key in sandbox allowlist: ${rawKey}`);
    }

    const lookup = key.toLowerCase();
    if (!seen.has(lookup)) {
      seen.add(lookup);
      output.push(key);
    }
  }

  return output;
}

function findEnvironmentValue(env: Record<string, string | undefined>, requestedKey: string): string | undefined {
  const actualKey = Object.keys(env).find((key) => key.toLowerCase() === requestedKey.toLowerCase());
  return actualKey ? env[actualKey] : undefined;
}

function networkArgumentForMode(mode: EnforcedSandboxNetworkMode): "none" | "host" | "bridge" {
  switch (mode) {
    case "disabled":
      return "none";
    case "host":
      return "host";
    case "bridge":
      return "bridge";
  }
}

function formatBindMount(mount: ResolvedEnforcedSandboxMount): string {
  return [
    "type=bind",
    `source=${mount.source}`,
    `target=${mount.target}`,
    ...(mount.readOnly ? ["readonly"] : []),
  ].join(",");
}

function ensureUniqueMountTargets(mounts: readonly ResolvedEnforcedSandboxMount[]): void {
  const seen = new Set<string>();
  for (const mount of mounts) {
    if (seen.has(mount.target)) {
      throw new EnforcedSandboxError("INVALID_CONTAINER_PATH", `Duplicate container mount target: ${mount.target}`);
    }

    seen.add(mount.target);
  }
}

function validateMountSourceSyntax(source: string): void {
  if (source.includes("\0") || source.includes(",")) {
    throw new EnforcedSandboxError(
      "INVALID_MOUNT_SOURCE",
      `Mount source contains a character that cannot be represented safely in --mount: ${source}`,
    );
  }
}

function isContainerPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const parent = path.posix.normalize(parentPath);
  const candidate = path.posix.normalize(candidatePath);
  if (parent === candidate) {
    return true;
  }

  const relative = path.posix.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.posix.isAbsolute(relative);
}

function warningsForPlan(
  readOnlyWorkspace: boolean,
  networkMode: EnforcedSandboxNetworkMode,
  omittedEnvKeys: readonly string[],
): string[] {
  const warnings: string[] = [];

  if (!readOnlyWorkspace) {
    warnings.push("Workspace is mounted read-write.");
  }

  if (networkMode !== "disabled") {
    warnings.push(`Container network mode is ${networkMode}.`);
  }

  if (omittedEnvKeys.length > 0) {
    warnings.push(`Environment keys omitted because they are not allowlisted: ${omittedEnvKeys.join(", ")}`);
  }

  return warnings;
}

function formatCommandLine(argv: readonly string[]): string {
  return argv.map(quoteArg).join(" ");
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/u.test(value)) {
    return value;
  }

  return `"${value.replace(/(["\\$`])/gu, "\\$1")}"`;
}

function isSupportedRuntime(value: string): value is EnforcedSandboxRuntime {
  return (SUPPORTED_ENFORCED_SANDBOX_RUNTIMES as readonly string[]).includes(value);
}

function isSupportedNetworkMode(value: string): value is EnforcedSandboxNetworkMode {
  return (SUPPORTED_ENFORCED_SANDBOX_NETWORK_MODES as readonly string[]).includes(value);
}
