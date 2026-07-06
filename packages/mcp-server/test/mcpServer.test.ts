import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callRunWitnessTool,
  handleRunWitnessMcpRequest,
  listRunWitnessMcpTools,
  parseRunWitnessMcpServerArgs,
  RUNWITNESS_MCP_PROTOCOL_VERSION
} from "../src/index.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-mcp-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("RunWitness MCP server", () => {
  it("parses stdio server CLI options", () => {
    expect(parseRunWitnessMcpServerArgs(["--workspace", root, "--data-dir", ".runwitness"])).toEqual({
      workspace: root,
      dataDir: ".runwitness"
    });
    expect(parseRunWitnessMcpServerArgs(["--help"])).toEqual({ help: true });
    expect(() => parseRunWitnessMcpServerArgs(["--workspace"])).toThrow("--workspace requires a value");
  });

  it("negotiates MCP initialization and lists RunWitness tools", async () => {
    const initialized = await handleRunWitnessMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: RUNWITNESS_MCP_PROTOCOL_VERSION }
    });
    expect(initialized).toMatchObject({
      result: {
        protocolVersion: RUNWITNESS_MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "runwitness-mcp-server" }
      }
    });

    const listed = await handleRunWitnessMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((listed?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual(
      listRunWitnessMcpTools().map((tool) => tool.name)
    );
  });

  it("evaluates policy without executing a command", async () => {
    const result = await callRunWitnessTool(
      {
        name: "runwitness_policy_check",
        arguments: {
          workspace: root,
          command: "rm -rf node_modules"
        }
      },
      { workspace: root }
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.evaluation).toMatchObject({
      command: "rm -rf node_modules",
      actionType: "shell_command",
      isRisky: true
    });
  });

  it("builds a secret-safe container sandbox plan", async () => {
    const result = await callRunWitnessTool(
      {
        name: "runwitness_sandbox_plan",
        arguments: {
          workspaceRoot: root,
          image: "node:22-alpine",
          command: ["node", "--version"],
          envAllowlist: ["VISIBLE_TOKEN"]
        }
      },
      { workspace: root }
    );

    expect(result.structuredContent?.invocation).toMatchObject({
      executable: "docker",
      cwd: path.resolve(root)
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain(process.env.VISIBLE_TOKEN ?? "unreachable-secret");
  });

  it("runs a witnessed command and then reads its receipt timeline", async () => {
    const run = await callRunWitnessTool(
      {
        name: "runwitness_run_command",
        arguments: {
          workspace: root,
          task: "MCP witnessed smoke",
          command: "node smoke",
          commandParts: [process.execPath, "-e", "console.log('mcp smoke')"]
        }
      },
      { workspace: root }
    );

    expect(run.isError).toBeUndefined();
    expect(run.structuredContent?.run).toMatchObject({
      task: "MCP witnessed smoke",
      status: "completed"
    });
    const runId = (run.structuredContent?.run as { id: string }).id;
    await expect(fs.stat(String(run.structuredContent?.receiptJsonPath))).resolves.toBeDefined();

    const read = await callRunWitnessTool(
      {
        name: "runwitness_read_run",
        arguments: {
          workspace: root,
          runId
        }
      },
      { workspace: root }
    );

    expect(read.structuredContent?.run).toMatchObject({ id: runId });
    expect((read.structuredContent?.timeline as Array<{ kind: string }>).map((event) => event.kind)).toContain(
      "receipt_exported"
    );

    const listed = await callRunWitnessTool(
      {
        name: "runwitness_list_runs",
        arguments: { workspace: root, limit: 5 }
      },
      { workspace: root }
    );
    expect(listed.structuredContent?.runs).toEqual([expect.objectContaining({ id: runId })]);
  });

  it("does not create a ledger when read-only tools inspect a missing database", async () => {
    const missingDb = path.join(root, ".runwitness", "runwitness.sqlite");

    const read = await callRunWitnessTool(
      {
        name: "runwitness_read_run",
        arguments: {
          workspace: root,
          runId: "rw_missing"
        }
      },
      { workspace: root }
    );
    const listed = await callRunWitnessTool(
      {
        name: "runwitness_list_runs",
        arguments: { workspace: root }
      },
      { workspace: root }
    );

    expect(read.isError).toBe(true);
    expect(listed.isError).toBe(true);
    expect(read.structuredContent?.error).toContain("RunWitness ledger not found");
    await expect(fs.stat(missingDb)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
