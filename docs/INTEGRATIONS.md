# Integrations

RunWitness now ships three integration surfaces:

1. **OpenClaw native tool plugin package** in `integrations/openclaw-runwitness-plugin`.
2. **Hermes skill pack** in `examples/hermes-runwitness-skill-pack`.
3. **Shared stdio MCP server** in `packages/mcp-server`.

These make RunWitness usable from agent runtimes without positioning it as a replacement for those runtimes. The integration promise is:

> Let the agent do the work; let RunWitness supply policy checks, witnessed execution, sandbox plans, timelines, and receipts.

## OpenClaw

The OpenClaw package is the repo-official native tool plugin for RunWitness. It uses OpenClaw's tool-plugin shape and exposes:

- `runwitness_policy_check`
- `runwitness_sandbox_plan`
- `runwitness_run_command`
- `runwitness_read_run`
- `runwitness_list_runs`

Build and validate it from the repository root:

```bash
npm --workspace @runwitness/openclaw-plugin run plugin:build
npm --workspace @runwitness/openclaw-plugin run plugin:validate
npm --workspace @runwitness/openclaw-plugin pack --dry-run --json
```

Or from its folder:

```bash
cd integrations/openclaw-runwitness-plugin
npm install
npm run build
npm run plugin:build
npm run plugin:validate
```

`plugin:build` and `plugin:validate` require `openclaw >=2026.5.17`. The workspace dev dependency pins a current OpenClaw CLI for local validation.

## Hermes

The Hermes pack is an installable skill folder example. It teaches Hermes when to route work through RunWitness and how to report run IDs, blocked actions, and receipt paths.

Verify the pack from the repo root:

```bash
npm run rw -- skill inspect --file examples/hermes-runwitness-skill-pack/runwitness-skill.yml
npm run rw -- policy check --policy examples/hermes-runwitness-skill-pack/runwitness-policy.yml -- npm test
```

## MCP Hosts

`@runwitness/mcp-server` is the shared stdio MCP server. It is useful for Hermes MCP tooling, Claude-compatible clients, Codex MCP configuration, and any other host that can start a local stdio MCP server.

After building this repo:

```bash
node packages/mcp-server/dist/src/bin.js --workspace /path/to/workspace --data-dir /path/to/workspace/.runwitness
```

After package installation:

```bash
runwitness-mcp-server --workspace /path/to/workspace --data-dir /path/to/workspace/.runwitness
```

Host snippets live in `docs/examples/integrations`.

## Status Language

Use this wording publicly:

- "RunWitness includes a repo-official OpenClaw plugin package."
- "RunWitness includes a Hermes skill pack example."
- "RunWitness includes an MCP server for MCP-capable hosts such as Codex/Claude-compatible clients."
- "Compatible through documented extension points."

Avoid saying these are upstream-official integrations until OpenClaw, Nous/Hermes, OpenAI, or Anthropic accept, list, or ship them from their own channels.

## Upstream-Official Path

Later, to make an integration upstream-official, submit or list it through each ecosystem:

- OpenClaw plugin marketplace or ClawHub if applicable.
- Hermes skill or catalog route if available.
- Codex MCP docs or examples only if OpenAI accepts them.
- Claude MCP docs or examples only if Anthropic accepts them.
