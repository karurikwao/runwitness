---
name: hermes-runwitness
version: 0.1.0
description: Wrap Hermes work in RunWitness receipts, policy checks, timelines, and optional operator review.
runwitness_manifest: ./runwitness-skill.yml
runwitness_policy: ./runwitness-policy.yml
required_env:
  - RUNWITNESS_WORKSPACE
optional_env:
  - RUNWITNESS_BIN
  - RUNWITNESS_POLICY
  - RUNWITNESS_DATA_DIR
  - RUNWITNESS_MCP_BIN
  - RUNWITNESS_OPERATOR_URL
  - RUNWITNESS_OPERATOR_TOKEN
---

# Hermes RunWitness

## When To Use

Use this skill when Hermes is asked to do work that should leave an auditable proof trail:

- editing files, running formatters, builds, tests, migrations, package scripts, or release commands
- touching secrets, deployment state, CI/CD, external services, or generated artifacts
- acting in a repo where the user asked for receipts, witnessed execution, policy checks, rollback evidence, or operator approval
- delegating to another local tool where nested activity may otherwise be opaque

Do not use it for read-only explanation or planning unless the user asks for a RunWitness receipt.

## Required Env Vars And Config

`RUNWITNESS_WORKSPACE` must be the absolute workspace path to witness.

`RUNWITNESS_BIN` is optional. If unset, use `npm run rw --` from a RunWitness checkout. If Hermes is running outside that checkout, set it to `runwitness` or to a built CLI path such as `node C:\path\to\runwitness\dist\apps\cli\src\bin.js`.

`RUNWITNESS_POLICY` is optional. Use `examples/hermes-runwitness-skill-pack/runwitness-policy.yml` when you want the example policy.

`RUNWITNESS_DATA_DIR` is optional. Default to `.runwitness` so receipts and ledgers stay in the witnessed workspace.

`RUNWITNESS_MCP_BIN` is optional. If unset, use `runwitness-mcp-server` after installing the package, or `node C:\path\to\runwitness\packages\mcp-server\dist\src\bin.js` after `npm run build`.

`RUNWITNESS_OPERATOR_URL` and `RUNWITNESS_OPERATOR_TOKEN` are optional for local operator API or MCP bridges. Never print the token.

## CLI Commands

Inspect this skill manifest before installing or changing it:

```powershell
npm run rw -- skill inspect --file examples/hermes-runwitness-skill-pack/runwitness-skill.yml
```

Check a command against policy before running it:

```powershell
npm run rw -- policy check --policy examples/hermes-runwitness-skill-pack/runwitness-policy.yml -- npm test
```

Run Hermes work through RunWitness:

```powershell
npm run rw -- run --task "Hermes: <task summary>" --workspace "$env:RUNWITNESS_WORKSPACE" --data-dir "$env:RUNWITNESS_DATA_DIR" --policy examples/hermes-runwitness-skill-pack/runwitness-policy.yml -- npm test
```

Inspect evidence after the run:

```powershell
npm run rw -- timeline --run <run-id> --data-dir "$env:RUNWITNESS_DATA_DIR"
```

Start a local operator API when approvals or timeline inspection should happen through a tool bridge:

```powershell
npm run rw -- serve --data-dir "$env:RUNWITNESS_DATA_DIR" --host 127.0.0.1 --port 8787 --auth-token-env RUNWITNESS_OPERATOR_TOKEN
```

## MCP Commands

RunWitness includes a stdio MCP server named `runwitness-mcp-server`. Configure Hermes or an MCP-capable host to start it with the witnessed workspace and data directory:

```powershell
runwitness-mcp-server --workspace "$env:RUNWITNESS_WORKSPACE" --data-dir "$env:RUNWITNESS_DATA_DIR"
```

From a source checkout after `npm run build`, use:

```powershell
node packages/mcp-server/dist/src/bin.js --workspace "$env:RUNWITNESS_WORKSPACE" --data-dir "$env:RUNWITNESS_DATA_DIR"
```

Prefer MCP tools in this order:

1. `runwitness_policy_check` before command execution.
2. `runwitness_sandbox_plan` before containerized execution.
3. `runwitness_run_command` only after the user asked for execution.
4. `runwitness_read_run` or `runwitness_list_runs` to report receipt evidence.

If Hermes is instead using the generic `mcp` command-wrapper adapter and that wrapper emits JSONL or SSE lines, prefer structured events RunWitness can normalize:

```jsonl
{"type":"tool_call","message":"Hermes invoked RunWitness for npm test"}
{"type":"artifact","path":".runwitness/receipts/<run-id>.md","label":"RunWitness receipt","mimeType":"text/markdown"}
```

## Verification

Before trusting the skill pack:

```powershell
npm run rw -- skill inspect --file examples/hermes-runwitness-skill-pack/runwitness-skill.yml
npm run rw -- policy check --policy examples/hermes-runwitness-skill-pack/runwitness-policy.yml -- npm test
npm run rw -- adapters list
node packages/mcp-server/dist/src/bin.js --help
```

After each witnessed run, report the RunWitness run ID, status, receipt paths, and any blocked or approval-required action. If the CLI returns `blocked` or a nonzero exit code, stop and surface the policy or command failure instead of continuing unwitnessed.
