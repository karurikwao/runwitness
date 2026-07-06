import { callRunWitnessTool } from "@runwitness/mcp-server";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";

const configSchema = Type.Object({
  workspace: Type.Optional(Type.String({ description: "Default workspace root for RunWitness tools." })),
  dataDir: Type.Optional(Type.String({ description: "Default RunWitness data directory." }))
});

const commonPathOptions = {
  workspace: Type.Optional(Type.String({ description: "Workspace root. Defaults to plugin config or Gateway cwd." })),
  dataDir: Type.Optional(Type.String({ description: "RunWitness data directory." }))
};

export default defineToolPlugin({
  id: "runwitness",
  name: "RunWitness",
  description: "Expose RunWitness receipts, policy checks, sandbox plans, and run lookup as OpenClaw tools.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "runwitness_policy_check",
      label: "RunWitness Policy Check",
      description: "Evaluate a shell command against the effective RunWitness policy hierarchy without executing it.",
      parameters: Type.Object({
        command: Type.String({ description: "Shell command to evaluate." }),
        workspace: commonPathOptions.workspace,
        policyPath: Type.Optional(Type.String({ description: "Run-override YAML policy file." })),
        workspacePolicyPath: Type.Optional(Type.String({ description: "Workspace YAML policy file." })),
        userPolicyPath: Type.Optional(Type.String({ description: "User YAML policy file." }))
      }),
      execute: (params, config) => callSharedTool("runwitness_policy_check", params, config)
    }),
    tool({
      name: "runwitness_sandbox_plan",
      label: "RunWitness Sandbox Plan",
      description: "Build a dry-run Docker/Podman sandbox invocation plan without spawning the runtime.",
      parameters: Type.Object({
        workspaceRoot: Type.Optional(Type.String({ description: "Host workspace to mount." })),
        image: Type.String({ description: "Container image." }),
        command: Type.Array(Type.String(), { description: "Command argv for the container." }),
        runtime: Type.Optional(Type.Union([Type.Literal("docker"), Type.Literal("podman")])),
        networkMode: Type.Optional(Type.Union([Type.Literal("disabled"), Type.Literal("bridge"), Type.Literal("host")])),
        workspaceMountPath: Type.Optional(Type.String()),
        workdir: Type.Optional(Type.String()),
        readOnlyWorkspace: Type.Optional(Type.Boolean()),
        envAllowlist: Type.Optional(Type.Array(Type.String()))
      }),
      execute: (params, config) =>
        callSharedTool(
          "runwitness_sandbox_plan",
          {
            workspaceRoot: params.workspaceRoot ?? config.workspace,
            ...params
          },
          config
        )
    }),
    tool({
      name: "runwitness_run_command",
      label: "RunWitness Witnessed Command",
      description:
        "Run a local command through RunWitness and return receipt paths. Use only after the user explicitly requested command execution.",
      optional: true,
      parameters: Type.Object({
        task: Type.String({ description: "Human-readable task." }),
        command: Type.String({ description: "Command string recorded in the receipt." }),
        commandParts: Type.Optional(Type.Array(Type.String(), { description: "Optional argv form to avoid shell parsing." })),
        workspace: commonPathOptions.workspace,
        dataDir: commonPathOptions.dataDir,
        policyPath: Type.Optional(Type.String({ description: "Run-override YAML policy file." })),
        workspacePolicyPath: Type.Optional(Type.String({ description: "Workspace YAML policy file." })),
        userPolicyPath: Type.Optional(Type.String({ description: "User YAML policy file." })),
        yes: Type.Optional(Type.Boolean({ description: "Pre-approve ask-level policy decisions only after human approval." }))
      }),
      execute: (params, config) => callSharedTool("runwitness_run_command", params, config)
    }),
    tool({
      name: "runwitness_read_run",
      label: "RunWitness Read Run",
      description: "Read a RunWitness run, timeline, receipt summaries, and latest receipt export.",
      parameters: Type.Object({
        runId: Type.String(),
        workspace: commonPathOptions.workspace,
        dataDir: commonPathOptions.dataDir
      }),
      execute: (params, config) => callSharedTool("runwitness_read_run", params, config)
    }),
    tool({
      name: "runwitness_list_runs",
      label: "RunWitness List Runs",
      description: "List recent RunWitness runs from the local ledger.",
      parameters: Type.Object({
        workspace: commonPathOptions.workspace,
        dataDir: commonPathOptions.dataDir,
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        status: Type.Optional(Type.Union([
          Type.Literal("running"),
          Type.Literal("completed"),
          Type.Literal("failed"),
          Type.Literal("blocked")
        ])),
        agent: Type.Optional(Type.String())
      }),
      execute: (params, config) => callSharedTool("runwitness_list_runs", params, config)
    })
  ]
});

async function callSharedTool(
  name: string,
  params: Record<string, unknown>,
  config: { workspace?: string; dataDir?: string }
): Promise<unknown> {
  const result = await callRunWitnessTool(
    {
      name,
      arguments: {
        ...(config.workspace && params.workspace === undefined ? { workspace: config.workspace } : {}),
        ...(config.dataDir && params.dataDir === undefined ? { dataDir: config.dataDir } : {}),
        ...params
      }
    },
    {
      workspace: config.workspace,
      dataDir: config.dataDir
    }
  );

  if (result.isError) {
    throw new Error(result.content.map((item) => item.text).join("\n"));
  }

  return result.structuredContent ?? result.content.map((item) => item.text).join("\n");
}
