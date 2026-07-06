import { createInterface } from "node:readline";
import { access } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { RunLedger, runWitnessedCommand } from "@runwitness/core";
import { evaluateCommandPolicy, loadPolicyHierarchy } from "@runwitness/policy";
import {
  buildEnforcedSandboxInvocation,
  type EnforcedSandboxNetworkMode,
  type EnforcedSandboxRuntime
} from "@runwitness/sandbox";

export const RUNWITNESS_MCP_PROTOCOL_VERSION = "2025-06-18";

export interface RunWitnessMcpServerOptions {
  workspace?: string;
  dataDir?: string;
  now?: () => Date;
}

export interface RunWitnessMcpServerCliOptions extends RunWitnessMcpServerOptions {
  help?: boolean;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const tools: McpToolDefinition[] = [
  {
    name: "runwitness_policy_check",
    title: "RunWitness Policy Check",
    description: "Evaluate a shell command against the effective RunWitness policy hierarchy without executing it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", description: "Shell command to evaluate." },
        workspace: { type: "string", description: "Workspace root. Defaults to the server workspace." },
        policyPath: { type: "string", description: "Run-override YAML policy file." },
        workspacePolicyPath: { type: "string", description: "Workspace YAML policy file." },
        userPolicyPath: { type: "string", description: "User YAML policy file." }
      },
      required: ["command"]
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: "runwitness_sandbox_plan",
    title: "RunWitness Sandbox Plan",
    description: "Build a dry-run Docker/Podman sandbox invocation plan without spawning the runtime.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        workspaceRoot: { type: "string", description: "Host workspace to mount." },
        image: { type: "string", description: "Container image." },
        command: {
          oneOf: [
            { type: "string", description: "Command string for display." },
            { type: "array", items: { type: "string" }, description: "Command argv for the container." }
          ]
        },
        runtime: { type: "string", enum: ["docker", "podman"] },
        networkMode: { type: "string", enum: ["disabled", "bridge", "host"] },
        workspaceMountPath: { type: "string" },
        workdir: { type: "string" },
        readOnlyWorkspace: { type: "boolean" },
        envAllowlist: { type: "array", items: { type: "string" } }
      },
      required: ["image", "command"]
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: "runwitness_run_command",
    title: "RunWitness Witnessed Command",
    description:
      "Run a local command through RunWitness and return receipt paths. Risky commands still follow RunWitness policy/approval behavior.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: { type: "string", description: "Human-readable task." },
        command: { type: "string", description: "Command string recorded in the receipt." },
        commandParts: { type: "array", items: { type: "string" }, description: "Optional argv form to avoid shell parsing." },
        workspace: { type: "string", description: "Workspace root. Defaults to the server workspace." },
        dataDir: { type: "string", description: "RunWitness data directory." },
        policyPath: { type: "string", description: "Run-override YAML policy file." },
        workspacePolicyPath: { type: "string", description: "Workspace YAML policy file." },
        userPolicyPath: { type: "string", description: "User YAML policy file." },
        yes: { type: "boolean", description: "Pre-approve ask-level policy decisions only when the user explicitly approved it." }
      },
      required: ["task", "command"]
    },
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  {
    name: "runwitness_read_run",
    title: "RunWitness Read Run",
    description: "Read a run, timeline, receipt summaries, and latest receipt export from a local RunWitness ledger.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string" },
        workspace: { type: "string", description: "Workspace root used to locate .runwitness when dataDir is omitted." },
        dataDir: { type: "string", description: "RunWitness data directory." }
      },
      required: ["runId"]
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: "runwitness_list_runs",
    title: "RunWitness List Runs",
    description: "List recent runs from a local RunWitness ledger.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        workspace: { type: "string", description: "Workspace root used to locate .runwitness when dataDir is omitted." },
        dataDir: { type: "string", description: "RunWitness data directory." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        status: { type: "string", enum: ["running", "completed", "failed", "blocked"] },
        agent: { type: "string" }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }
];

export function listRunWitnessMcpTools(): McpToolDefinition[] {
  return tools.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } }));
}

export function parseRunWitnessMcpServerArgs(argv: readonly string[]): RunWitnessMcpServerCliOptions {
  const options: RunWitnessMcpServerCliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--workspace") {
      options.workspace = requiredArgValue(argv, (index += 1), arg);
      continue;
    }
    if (arg === "--data-dir") {
      options.dataDir = requiredArgValue(argv, (index += 1), arg);
      continue;
    }
    throw new Error(`Unknown runwitness-mcp-server option: ${arg}`);
  }
  return options;
}

export function renderRunWitnessMcpServerHelp(): string {
  return [
    "RunWitness MCP stdio server",
    "",
    "Usage:",
    "  runwitness-mcp-server [--workspace <path>] [--data-dir <path>]",
    "",
    "Options:",
    "  --workspace <path>  Default workspace for tools that omit workspace.",
    "  --data-dir <path>   Default RunWitness data directory.",
    "  -h, --help          Show this help."
  ].join("\n");
}

export async function handleRunWitnessMcpRequest(
  request: JsonRpcRequest,
  options: RunWitnessMcpServerOptions = {}
): Promise<JsonRpcResponse | undefined> {
  if (request.id === undefined) {
    return undefined;
  }

  try {
    if (request.method === "initialize") {
      return jsonRpcResult(request.id, {
        protocolVersion: requestedProtocolVersion(request.params) ?? RUNWITNESS_MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "runwitness-mcp-server",
          version: "0.1.0"
        },
        instructions:
          "Use RunWitness tools when agent work needs policy checks, sandbox plans, witnessed execution, or receipt lookup."
      });
    }

    if (request.method === "tools/list") {
      return jsonRpcResult(request.id, { tools: listRunWitnessMcpTools() });
    }

    if (request.method === "tools/call") {
      const result = await callRunWitnessTool(readToolCallParams(request.params), options);
      return jsonRpcResult(request.id, result);
    }

    if (request.method === "ping") {
      return jsonRpcResult(request.id, {});
    }

    return jsonRpcError(request.id, -32601, `Unsupported MCP method: ${request.method}`);
  } catch (error) {
    return jsonRpcError(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

export async function callRunWitnessTool(
  call: { name: string; arguments?: Record<string, unknown> },
  options: RunWitnessMcpServerOptions = {}
): Promise<ToolResult> {
  try {
    const args = call.arguments ?? {};
    switch (call.name) {
      case "runwitness_policy_check":
        return toolResult(await runPolicyCheck(args, options));
      case "runwitness_sandbox_plan":
        return toolResult(runSandboxPlan(args, options));
      case "runwitness_run_command":
        return toolResult(await runCommand(args, options));
      case "runwitness_read_run":
        return toolResult(await readRun(args, options));
      case "runwitness_list_runs":
        return toolResult(await listRuns(args, options));
      default:
        throw new Error(`Unknown RunWitness tool: ${call.name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: message }],
      structuredContent: { error: message },
      isError: true
    };
  }
}

export async function runRunWitnessMcpStdioServer(
  options: RunWitnessMcpServerOptions & { input?: Readable; output?: Writable } = {}
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const reader = createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    if (line.trim().length === 0) {
      continue;
    }
    const response = await handleJsonRpcLine(line, options);
    if (response) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  }
}

export async function handleJsonRpcLine(
  line: string,
  options: RunWitnessMcpServerOptions = {}
): Promise<JsonRpcResponse | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return jsonRpcError(null, -32700, error instanceof Error ? error.message : "Invalid JSON");
  }

  if (!isRecord(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
    return jsonRpcError(readJsonRpcId(parsed), -32600, "Invalid JSON-RPC request");
  }

  return await handleRunWitnessMcpRequest(parsed as unknown as JsonRpcRequest, options);
}

async function runPolicyCheck(
  args: Record<string, unknown>,
  options: RunWitnessMcpServerOptions
): Promise<Record<string, unknown>> {
  const command = requiredString(args.command, "command");
  const workspace = resolveWorkspace(args.workspace, options);
  const hierarchy = await loadPolicyHierarchy({
    workspaceRoot: workspace,
    workspacePolicyPath: optionalString(args.workspacePolicyPath),
    userPolicyPath: optionalString(args.userPolicyPath),
    runOverridePolicyPath: optionalString(args.policyPath)
  });
  return {
    evaluation: evaluateCommandPolicy(command, hierarchy.policy),
    policy: hierarchy.explanation
  };
}

function runSandboxPlan(args: Record<string, unknown>, options: RunWitnessMcpServerOptions): Record<string, unknown> {
  const workspaceRoot = resolveWorkspace(args.workspaceRoot, options);
  const invocation = buildEnforcedSandboxInvocation({
    workspaceRoot,
    image: requiredString(args.image, "image"),
    command: readCommandArray(args.command),
    runtime: optionalSandboxRuntime(args.runtime),
    networkMode: optionalNetworkMode(args.networkMode),
    workspaceMountPath: optionalString(args.workspaceMountPath),
    workdir: optionalString(args.workdir),
    readOnlyWorkspace: typeof args.readOnlyWorkspace === "boolean" ? args.readOnlyWorkspace : undefined,
    envAllowlist: optionalStringArray(args.envAllowlist),
    baseEnv: process.env
  });
  return {
    invocation: {
      executable: invocation.executable,
      args: invocation.args,
      cwd: invocation.cwd,
      commandLine: invocation.commandLine
    },
    plan: invocation.plan
  };
}

async function runCommand(args: Record<string, unknown>, options: RunWitnessMcpServerOptions): Promise<Record<string, unknown>> {
  const workspace = resolveWorkspace(args.workspace, options);
  const hierarchy =
    args.policyPath || args.workspacePolicyPath || args.userPolicyPath
      ? await loadPolicyHierarchy({
          workspaceRoot: workspace,
          workspacePolicyPath: optionalString(args.workspacePolicyPath),
          userPolicyPath: optionalString(args.userPolicyPath),
          runOverridePolicyPath: optionalString(args.policyPath)
        })
      : undefined;
  const result = await runWitnessedCommand({
    task: requiredString(args.task, "task"),
    command: requiredString(args.command, "command"),
    commandParts: optionalStringArray(args.commandParts),
    workspace,
    dataDir: resolveOptionalDataDir(args.dataDir, workspace, options),
    yes: args.yes === true,
    policy: hierarchy?.policy,
    policyMetadata: hierarchy
      ? {
          digest: hierarchy.digest,
          layers: hierarchy.layers,
          precedence: hierarchy.precedence,
          protectedSourcePaths: hierarchy.protectedSourcePaths,
          explanation: hierarchy.explanation
        }
      : undefined
  });
  return {
    run: result.run,
    exitCode: result.exitCode,
    receiptJsonPath: result.receiptJsonPath,
    receiptMarkdownPath: result.receiptMarkdownPath,
    dbPath: result.dbPath
  };
}

async function readRun(args: Record<string, unknown>, options: RunWitnessMcpServerOptions): Promise<Record<string, unknown>> {
  const runId = requiredString(args.runId, "runId");
  const workspace = resolveWorkspace(args.workspace, options);
  const ledger = await openExistingLedger(resolveDbPath(args.dataDir, workspace, options));
  try {
    return {
      run: ledger.getRun(runId),
      timeline: ledger.timeline(runId),
      receipts: ledger.listReceipts(runId),
      latestReceiptExport: ledger.readLatestReceiptExport(runId)
    };
  } finally {
    ledger.close();
  }
}

async function listRuns(args: Record<string, unknown>, options: RunWitnessMcpServerOptions): Promise<Record<string, unknown>> {
  const workspace = resolveWorkspace(args.workspace, options);
  const ledger = await openExistingLedger(resolveDbPath(args.dataDir, workspace, options));
  try {
    return {
      runs: ledger.listRuns({
        limit: optionalLimit(args.limit),
        status: optionalRunStatus(args.status),
        agent: optionalString(args.agent)
      })
    };
  } finally {
    ledger.close();
  }
}

function toolResult(value: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function readToolCallParams(value: unknown): { name: string; arguments?: Record<string, unknown> } {
  if (!isRecord(value)) {
    throw new Error("tools/call params must be an object");
  }
  const name = requiredString(value.name, "name");
  const args = value.arguments === undefined ? undefined : readRecord(value.arguments, "arguments");
  return { name, arguments: args };
}

function resolveWorkspace(value: unknown, options: RunWitnessMcpServerOptions): string {
  return path.resolve(optionalString(value) ?? options.workspace ?? process.cwd());
}

function resolveDbPath(value: unknown, workspace: string, options: RunWitnessMcpServerOptions): string {
  const dataDir = resolveOptionalDataDir(value, workspace, options);
  return path.join(dataDir ?? path.join(workspace, ".runwitness"), "runwitness.sqlite");
}

async function openExistingLedger(dbPath: string): Promise<RunLedger> {
  try {
    await access(dbPath);
  } catch {
    throw new Error(`RunWitness ledger not found: ${dbPath}`);
  }
  return RunLedger.open(dbPath);
}

function resolveOptionalDataDir(value: unknown, workspace: string, options: RunWitnessMcpServerOptions): string | undefined {
  const dataDir = optionalString(value) ?? options.dataDir;
  return dataDir ? path.resolve(workspace, dataDir) : undefined;
}

function readCommandArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => requiredString(item, `command[${index}]`));
  }
  return [requiredString(value, "command")];
}

function requiredArgValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Expected a string array");
  }
  return value.map((item, index) => requiredString(item, `array[${index}]`));
}

function optionalSandboxRuntime(value: unknown): EnforcedSandboxRuntime | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "docker" || value === "podman") {
    return value;
  }
  throw new Error("runtime must be docker or podman");
}

function optionalNetworkMode(value: unknown): EnforcedSandboxNetworkMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "disabled" || value === "bridge" || value === "host") {
    return value;
  }
  throw new Error("networkMode must be disabled, bridge, or host");
}

function optionalLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return 20;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("limit must be an integer from 1 to 100");
  }
  return value;
}

function optionalRunStatus(value: unknown): "running" | "completed" | "failed" | "blocked" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "running" || value === "completed" || value === "failed" || value === "blocked") {
    return value;
  }
  throw new Error("status must be running, completed, failed, or blocked");
}

function requestedProtocolVersion(value: unknown): string | undefined {
  return isRecord(value) ? optionalString(value.protocolVersion) : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, "value");
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function readJsonRpcId(value: unknown): string | number | null {
  return isRecord(value) && (typeof value.id === "string" || typeof value.id === "number" || value.id === null)
    ? value.id
    : null;
}

function jsonRpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
