# Integrations

RunWitness is not trying to replace agent runtimes. It wraps them with policy checks, witnessed execution, timelines, and receipts.

## OpenClaw

RunWitness includes a repo-official OpenClaw tool plugin package in `integrations/openclaw-runwitness-plugin`.

Validate it from the repository root:

```bash
npm --workspace @runwitness/openclaw-plugin run plugin:validate
```

## Hermes

RunWitness includes a Hermes skill pack example in `examples/hermes-runwitness-skill-pack`.

Inspect it:

```bash
npm run rw -- skill inspect --file examples/hermes-runwitness-skill-pack/runwitness-skill.yml
```

## MCP Hosts

RunWitness includes `@runwitness/mcp-server`, a stdio MCP server for Codex, Claude-compatible clients, Hermes MCP tooling, and other MCP-capable hosts.

After a build:

```bash
node packages/mcp-server/dist/src/bin.js --help
```

## Status Wording

Good wording:

- "RunWitness includes its repo-official OpenClaw plugin package."
- "RunWitness includes a Hermes skill pack example."
- "RunWitness includes an MCP server for Codex, Claude-compatible, and other MCP-capable hosts."
- "Compatible through documented extension points."

Avoid wording that implies upstream endorsement before it exists.
