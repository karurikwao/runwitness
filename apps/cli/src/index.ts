import { Command } from "commander";
import pc from "picocolors";
import { promises as fs } from "node:fs";
import { inspectSkillManifest } from "@runwitness/skills";
import { createDefaultAdapterRegistry } from "@runwitness/adapters";
import { runEnforcedSandbox, type EnforcedSandboxNetworkMode, type EnforcedSandboxRuntime } from "@runwitness/sandbox";
import {
  listenOperatorServer,
  loadHostedAuthConfig,
  RunLedger,
  runWitnessedCommand,
  type OperatorAuthOptions,
  type OperatorBearerCredential,
  type OperatorRole,
  type WitnessedRollbackMode
} from "@runwitness/core";
import { evaluateCommandPolicy, loadPolicyHierarchy } from "@runwitness/policy";

export const program = new Command();

const OPERATOR_ROLES = new Set<OperatorRole>(["viewer", "approver", "admin"]);

program
  .name("runwitness")
  .description("Autonomous agents with receipts.")
  .version("0.1.0");

program
  .command("run")
  .description("Run a local command with ledger events, file tracking, and receipt export.")
  .requiredOption("--task <task>", "human-readable task description")
  .option("--workspace <path>", "workspace to run in", process.cwd())
  .option("--data-dir <path>", "RunWitness data directory")
  .option("--agent <name>", "agent or adapter name", "local-command")
  .option("--policy <path>", "run-override YAML policy file to evaluate before running")
  .option("--workspace-policy <path>", "workspace YAML policy file")
  .option("--user-policy <path>", "user YAML policy file")
  .option("--sandbox", "run command in an isolated temporary workspace with filtered environment")
  .option("--sandbox-temp-root <path>", "parent directory for isolated sandbox workspaces")
  .option("--write-allow <path...>", "sandbox write allowlist paths relative to the workspace")
  .option("--protect <path...>", "sandbox protected paths relative to the workspace")
  .option("--network-allow <host>", "network preflight allowlist host or wildcard; repeatable", collectOption, [] as string[])
  .option("--network-deny <host>", "network preflight denylist host or wildcard; repeatable", collectOption, [] as string[])
  .option("--network-default <decision>", "network preflight default decision: allow, ask, or deny")
  .option("--rollback", "create a rollback baseline and bundle for the run")
  .option("--rollback-mode <mode>", "rollback behavior after failed commands: bundle, dry-run, or apply", "bundle")
  .option("--rollback-dir <path>", "directory for rollback baseline and bundle artifacts")
  .option("--redact-secret-env <name>", "environment variable whose value should be redacted from command output; repeatable", collectOption, [] as string[])
  .option("--yes", "auto-approve policy actions that would otherwise ask")
  .allowExcessArguments(true)
  .argument("<command...>", "command to run")
  .action(async (commandParts: string[], options: Record<string, unknown>) => {
    const command = formatCommand(commandParts);
    const workspace = String(options.workspace);
    const hierarchy =
      options.policy || options.workspacePolicy || options.userPolicy
        ? await loadPolicyHierarchy({
            workspaceRoot: workspace,
            workspacePolicyPath: options.workspacePolicy ? String(options.workspacePolicy) : undefined,
            userPolicyPath: options.userPolicy ? String(options.userPolicy) : undefined,
            runOverridePolicyPath: options.policy ? String(options.policy) : undefined
          })
        : undefined;
    const result = await runWitnessedCommand({
      task: String(options.task),
      command,
      commandParts,
      workspace,
      dataDir: options.dataDir ? String(options.dataDir) : undefined,
      agent: options.agent ? String(options.agent) : "local-command",
      yes: options.yes === true,
      policy: hierarchy?.policy,
      policyMetadata: hierarchy
        ? {
            digest: hierarchy.digest,
            layers: hierarchy.layers,
            precedence: hierarchy.precedence,
            protectedSourcePaths: hierarchy.protectedSourcePaths,
            explanation: hierarchy.explanation
          }
        : undefined,
      sandbox: buildRunSandboxOptions(options),
      rollback: buildRollbackOptions(options),
      secretRedactions: readSecretRedactionsFromEnvironment(splitStringList(toStringList(options.redactSecretEnv)))
    });

    console.log(pc.bold("RunWitness receipt generated"));
    console.log(`Run ID: ${result.run.id}`);
    console.log(`Status: ${result.run.status}`);
    console.log(`Database: ${result.dbPath}`);
    console.log(`JSON: ${result.receiptJsonPath}`);
    console.log(`Markdown: ${result.receiptMarkdownPath}`);
    process.exitCode = result.exitCode ?? (result.run.status === "blocked" ? 2 : 1);
  });

const policy = program.command("policy").description("Inspect and evaluate RunWitness policy files.");

policy
  .command("check")
  .description("Evaluate a shell command against a YAML policy hierarchy.")
  .requiredOption("--policy <path>", "run-override YAML policy file")
  .option("--workspace <path>", "workspace root for protected policy source paths", process.cwd())
  .option("--workspace-policy <path>", "workspace YAML policy file")
  .option("--user-policy <path>", "user YAML policy file")
  .allowExcessArguments(true)
  .argument("<command...>", "command to evaluate")
  .action(async (commandParts: string[], options: Record<string, string | undefined>) => {
    const policyFile = options.policy;
    if (!policyFile) {
      throw new Error("Missing required --policy option");
    }
    const hierarchy = await loadPolicyHierarchy({
      workspaceRoot: options.workspace ?? process.cwd(),
      workspacePolicyPath: options.workspacePolicy,
      userPolicyPath: options.userPolicy,
      runOverridePolicyPath: policyFile
    });
    const command = formatCommand(commandParts);
    const evaluation = evaluateCommandPolicy(command, hierarchy.policy);
    printJson({ evaluation, policy: hierarchy.explanation });
    process.exitCode = evaluation.decision === "deny" ? 2 : evaluation.decision === "ask" ? 1 : 0;
  });

policy
  .command("explain")
  .description("Print the effective policy hierarchy, precedence, source digests, and protected paths.")
  .option("--workspace <path>", "workspace root for protected policy source paths", process.cwd())
  .option("--workspace-policy <path>", "workspace YAML policy file")
  .option("--user-policy <path>", "user YAML policy file")
  .option("--policy <path>", "run-override YAML policy file")
  .action(async (options: Record<string, string | undefined>) => {
    const hierarchy = await loadPolicyHierarchy({
      workspaceRoot: options.workspace ?? process.cwd(),
      workspacePolicyPath: options.workspacePolicy,
      userPolicyPath: options.userPolicy,
      runOverridePolicyPath: options.policy
    });
    printJson(hierarchy.explanation);
  });

program
  .command("skill")
  .description("Inspect RunWitness skill manifests.")
  .command("inspect")
  .description("Inspect a skill manifest for permissions, digest, and signature status.")
  .requiredOption("--file <path>", "skill manifest YAML file")
  .action(async (options: Record<string, string | undefined>) => {
    const file = options.file;
    if (!file) {
      throw new Error("Missing required --file option");
    }
    printJson(inspectSkillManifest(await fs.readFile(file, "utf8")));
  });

program
  .command("adapters")
  .description("Inspect configured agent adapters.")
  .command("list")
  .description("List built-in adapters.")
  .action(() => {
    const registry = createDefaultAdapterRegistry();
    printJson({
      adapters: registry.list().map((adapter) => ({
        id: adapter.id,
        name: adapter.name,
        description: adapter.description,
        capabilities: adapter.capabilities
      }))
    });
  });

const sandbox = program.command("sandbox").description("Inspect and run enforced sandbox boundaries.");

sandbox
  .command("container")
  .description("Run a command through an opt-in Docker/Podman-backed sandbox.")
  .requiredOption("--image <image>", "container image to run")
  .option("--workspace <path>", "host workspace to mount", process.cwd())
  .option("--runtime <runtime>", "container runtime: docker or podman", "docker")
  .option("--network <mode>", "network mode: disabled, bridge, or host", "disabled")
  .option("--workspace-mount <path>", "container workspace mount path", "/workspace")
  .option("--workdir <path>", "container working directory")
  .option("--read-write", "mount the workspace read-write; default is read-only")
  .option("--env-allow <name>", "environment variable name to pass by reference; repeatable", collectOption, [] as string[])
  .option("--keep-container", "do not pass --rm to the container runtime")
  .option("--dry-run", "print the invocation plan without spawning the runtime")
  .allowExcessArguments(true)
  .argument("<command...>", "command to run inside the container")
  .action(async (commandParts: string[], options: Record<string, unknown>) => {
    const result = await runEnforcedSandbox({
      runtime: parseEnforcedSandboxRuntime(String(options.runtime ?? "docker")),
      workspaceRoot: String(options.workspace ?? process.cwd()),
      image: String(options.image),
      command: commandParts,
      networkMode: parseEnforcedSandboxNetworkMode(String(options.network ?? "disabled")),
      workspaceMountPath: String(options.workspaceMount ?? "/workspace"),
      workdir: options.workdir ? String(options.workdir) : undefined,
      readOnlyWorkspace: options.readWrite !== true,
      envAllowlist: splitStringList(toStringList(options.envAllow)),
      baseEnv: process.env,
      removeContainer: options.keepContainer !== true,
      dryRun: options.dryRun === true
    });

    printJson({
      status: result.status,
      exitCode: result.exitCode,
      signal: result.signal,
      invocation: {
        executable: result.invocation.executable,
        args: result.invocation.args,
        cwd: result.invocation.cwd,
        commandLine: result.invocation.commandLine
      },
      plan: result.plan,
      stdout: result.stdout,
      stderr: result.stderr
    });

    if (!result.dryRun) {
      process.exitCode = result.exitCode ?? (result.status === "completed" ? 0 : 1);
    }
  });

program
  .command("serve")
  .description("Start the local operator API server.")
  .option("--data-dir <path>", "RunWitness data directory", ".runwitness")
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--port <port>", "port to bind", "8787")
  .option("--auth-token <token>", "bearer token for operator API auth; repeatable", collectOption, [] as string[])
  .option("--auth-token-env <name>", "environment variable containing a bearer token; repeatable", collectOption, [] as string[])
  .option("--auth-config <path>", "legacy JSON auth config with plaintext bearerTokens/tokenEnv entries")
  .option("--hosted-auth-config <path>", "hosted JSON auth config with bearerCredentials token hashes")
  .option("--operator-id <id>", "operator id for token flags")
  .option("--operator-role <role>", "role for token flags: viewer, approver, or admin; repeatable or comma-separated", collectOption, [] as string[])
  .option("--operator-user-scope <user>", "allowed user/userId for token flags; repeatable or comma-separated", collectOption, [] as string[])
  .option("--operator-workspace-scope <path>", "allowed workspace path for token flags; repeatable or comma-separated", collectOption, [] as string[])
  .action(async (options: Record<string, unknown>) => {
    const dataDir = String(options.dataDir ?? ".runwitness");
    const host = String(options.host ?? "127.0.0.1");
    const port = Number(options.port ?? "8787");
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("--port must be an integer between 0 and 65535");
    }
    const auth = await resolveServeAuthOptions(options);
    const ledger = await RunLedger.open(`${dataDir}/runwitness.sqlite`);
    const server = await listenOperatorServer({ ledger, host, port, auth });
    console.log(pc.bold("RunWitness operator server listening"));
    console.log(server.url);
    console.log(`Auth: ${describeServeAuth(auth)}`);
    const shutdown = async () => {
      await server.close();
      ledger.close();
    };
    process.once("SIGINT", () => {
      void shutdown().then(() => {
        process.exitCode = 0;
      });
    });
    process.once("SIGTERM", () => {
      void shutdown().then(() => {
        process.exitCode = 0;
      });
    });
  });

program
  .command("timeline")
  .description("Print the event timeline for a run.")
  .requiredOption("--run <id>", "run id")
  .option("--data-dir <path>", "RunWitness data directory", ".runwitness")
  .action(async (options: Record<string, string>) => {
    const dataDir = options.dataDir ?? ".runwitness";
    const runId = options.run;
    if (!runId) {
      throw new Error("Missing required --run option");
    }
    const ledger = await RunLedger.open(`${dataDir}/runwitness.sqlite`);
    try {
      for (const event of ledger.timeline(runId)) {
        console.log(`${String(event.sequence).padStart(4, "0")} ${event.timestamp} ${event.kind}`);
      }
    } finally {
      ledger.close();
    }
  });

export async function main(): Promise<void> {
  await program.parseAsync();
}

function formatCommand(parts: string[]): string {
  return parts.map((part) => (isShellOperator(part) || !needsQuoting(part) ? part : JSON.stringify(part))).join(" ");
}

function needsQuoting(value: string): boolean {
  return value.length === 0 || /[\s"'`|&<>()[\]{};]/.test(value);
}

function isShellOperator(value: string): boolean {
  return [">", ">>", "<", "<<", "|", "||", "&&", ";"].includes(value);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function toStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value.map(String).filter((item) => item.length > 0);
    return list.length > 0 ? list : undefined;
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return undefined;
}

function collectOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function buildRunSandboxOptions(options: Record<string, unknown>) {
  const networkAllowedHosts = splitStringList(toStringList(options.networkAllow));
  const networkDeniedHosts = splitStringList(toStringList(options.networkDeny));
  const hasNetworkOptions =
    networkAllowedHosts.length > 0 ||
    networkDeniedHosts.length > 0 ||
    typeof options.networkDefault === "string";
  const network = hasNetworkOptions
    ? {
        allowedHosts: networkAllowedHosts,
        deniedHosts: networkDeniedHosts,
        defaultDecision: parseNetworkDefault(String(options.networkDefault ?? "ask"))
      }
    : undefined;

  if (options.sandbox !== true && !network) {
    return undefined;
  }

  return {
    enabled: options.sandbox === true,
    tempRoot: options.sandboxTempRoot ? String(options.sandboxTempRoot) : undefined,
    allowedWritePaths: toStringList(options.writeAllow),
    protectedPaths: toStringList(options.protect),
    ...(network ? { network } : {})
  };
}

function buildRollbackOptions(options: Record<string, unknown>) {
  if (options.rollback !== true) {
    return undefined;
  }

  return {
    enabled: true,
    mode: parseRollbackMode(String(options.rollbackMode ?? "bundle")),
    outputDirectory: options.rollbackDir ? String(options.rollbackDir) : undefined
  };
}

function parseNetworkDefault(value: string): "allow" | "ask" | "deny" {
  if (value === "allow" || value === "ask" || value === "deny") {
    return value;
  }

  throw new Error("--network-default must be one of: allow, ask, deny");
}

function parseRollbackMode(value: string): WitnessedRollbackMode {
  if (value === "bundle" || value === "dry-run" || value === "apply") {
    return value;
  }

  throw new Error("--rollback-mode must be one of: bundle, dry-run, apply");
}

function parseEnforcedSandboxRuntime(value: string): EnforcedSandboxRuntime {
  if (value === "docker" || value === "podman") {
    return value;
  }

  throw new Error("--runtime must be one of: docker, podman");
}

function parseEnforcedSandboxNetworkMode(value: string): EnforcedSandboxNetworkMode {
  if (value === "disabled" || value === "bridge" || value === "host") {
    return value;
  }

  throw new Error("--network must be one of: disabled, bridge, host");
}

function readSecretRedactionsFromEnvironment(names: string[]): string[] {
  return names.map((name) => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Environment variable ${name} is not set or empty`);
    }
    return value;
  });
}

async function resolveServeAuthOptions(options: Record<string, unknown>): Promise<OperatorAuthOptions | undefined> {
  const configuredCredentials = options.authConfig
    ? await readServeAuthConfig(String(options.authConfig))
    : [];
  const hostedAuthConfig = options.hostedAuthConfig
    ? await loadHostedAuthConfig(String(options.hostedAuthConfig))
    : undefined;
  const inlineTokens = [
    ...splitStringList(toStringList(options.authToken)),
    ...readTokensFromEnvironment(splitStringList(toStringList(options.authTokenEnv)))
  ];
  const inlineCredentials = inlineTokens.map((token) =>
    createInlineBearerCredential(token, {
      operatorId: typeof options.operatorId === "string" && options.operatorId.length > 0 ? options.operatorId : undefined,
      roles: parseOperatorRoles(splitStringList(toStringList(options.operatorRole)), "--operator-role"),
      allowedUsers: splitStringList(toStringList(options.operatorUserScope)),
      allowedWorkspaces: splitStringList(toStringList(options.operatorWorkspaceScope))
    })
  );
  const bearerTokens = [...configuredCredentials, ...inlineCredentials];

  return bearerTokens.length > 0 || hostedAuthConfig
    ? {
        bearerTokens,
        hostedAuthConfig
      }
    : undefined;
}

function describeServeAuth(auth: OperatorAuthOptions | undefined): string {
  if (!auth) {
    return "disabled";
  }

  const bearerCount = auth.bearerTokens?.length ?? 0;
  const hostedCount = auth.hostedAuthConfig?.bearerCredentials.length ?? 0;
  const total = bearerCount + hostedCount;
  const parts = [];
  if (bearerCount > 0) {
    parts.push(`${bearerCount} local`);
  }
  if (hostedCount > 0) {
    parts.push(`${hostedCount} hosted-hash`);
  }
  return `bearer (${total} credential${total === 1 ? "" : "s"}${parts.length > 0 ? `: ${parts.join(", ")}` : ""})`;
}

async function readServeAuthConfig(filePath: string): Promise<Array<string | OperatorBearerCredential>> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  const bearerTokens = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.bearerTokens : undefined;
  if (!Array.isArray(bearerTokens)) {
    throw new Error("--auth-config must be a JSON object with bearerTokens or a bearer token array");
  }

  return bearerTokens.map((credential, index) => parseConfiguredCredential(credential, `bearerTokens[${index}]`));
}

function parseConfiguredCredential(value: unknown, label: string): string | OperatorBearerCredential {
  if (typeof value === "string") {
    return requireNonEmptySecret(value, label);
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be a token string or credential object`);
  }

  const token =
    typeof value.token === "string"
      ? value.token
      : typeof value.tokenEnv === "string"
        ? readTokenFromEnvironment(value.tokenEnv)
        : undefined;
  if (!token) {
    throw new Error(`${label} must include token or tokenEnv`);
  }

  const credential: OperatorBearerCredential = {
    token: requireNonEmptySecret(token, `${label}.token`)
  };
  if (typeof value.operatorId === "string" && value.operatorId.length > 0) {
    credential.operatorId = value.operatorId;
  }
  const roles = parseOperatorRoles(readStringList(value.roles), `${label}.roles`);
  if (roles) {
    credential.roles = roles;
  }
  const allowedUsers = readStringList(value.allowedUsers);
  if (allowedUsers.length > 0) {
    credential.allowedUsers = allowedUsers;
  }
  const allowedWorkspaces = readStringList(value.allowedWorkspaces);
  if (allowedWorkspaces.length > 0) {
    credential.allowedWorkspaces = allowedWorkspaces;
  }
  return credential;
}

function createInlineBearerCredential(
  token: string,
  options: Pick<OperatorBearerCredential, "operatorId" | "roles" | "allowedUsers" | "allowedWorkspaces">
): OperatorBearerCredential {
  const credential: OperatorBearerCredential = {
    token: requireNonEmptySecret(token, "--auth-token")
  };
  if (options.operatorId) {
    credential.operatorId = options.operatorId;
  }
  if (options.roles && options.roles.length > 0) {
    credential.roles = options.roles;
  }
  if (options.allowedUsers && options.allowedUsers.length > 0) {
    credential.allowedUsers = options.allowedUsers;
  }
  if (options.allowedWorkspaces && options.allowedWorkspaces.length > 0) {
    credential.allowedWorkspaces = options.allowedWorkspaces;
  }
  return credential;
}

function parseOperatorRoles(values: string[], label: string): OperatorRole[] | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const roles = uniqueStrings(values).map((role) => {
    if (!OPERATOR_ROLES.has(role as OperatorRole)) {
      throw new Error(`${label} must be one of: viewer, approver, admin`);
    }
    return role as OperatorRole;
  });
  return roles.length > 0 ? roles : undefined;
}

function readTokensFromEnvironment(names: string[]): string[] {
  return names.map(readTokenFromEnvironment);
}

function readTokenFromEnvironment(name: string): string {
  const token = process.env[name];
  if (!token) {
    throw new Error(`Environment variable ${name} is not set or empty`);
  }
  return token;
}

function requireNonEmptySecret(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return value;
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return splitStringList(value.map(String));
  }
  if (typeof value === "string") {
    return splitStringList([value]);
  }
  return [];
}

function splitStringList(values: string[] | undefined): string[] {
  return uniqueStrings(
    (values ?? [])
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
