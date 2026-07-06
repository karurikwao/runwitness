# RunWitness OpenClaw Plugin

This is the repo-official OpenClaw tool plugin for RunWitness.

It exposes the same RunWitness tool contract as `@runwitness/mcp-server` inside OpenClaw:

- `runwitness_policy_check`
- `runwitness_sandbox_plan`
- `runwitness_run_command`
- `runwitness_read_run`
- `runwitness_list_runs`

The plugin is intentionally thin. It uses OpenClaw's native tool plugin SDK for discovery and delegates behavior to the shared RunWitness MCP server package so OpenClaw, Hermes, Claude, Codex, and other MCP-capable hosts can share one integration contract.

## Build

From the repository root:

```bash
npm --workspace @runwitness/openclaw-plugin run plugin:build
npm --workspace @runwitness/openclaw-plugin run plugin:validate
npm --workspace @runwitness/openclaw-plugin pack --dry-run --json
```

Or from this folder:

```bash
npm install
npm run build
npm run plugin:build
npm run plugin:validate
```

`plugin:build` and `plugin:validate` require `openclaw >=2026.5.17`.
From the repository root, `npm run verify` also typechecks and builds this workspace integration.

## Install Into OpenClaw

For local development:

```bash
npm pack
openclaw plugins install npm-pack:./runwitness-openclaw-plugin-0.1.0.tgz
openclaw plugins inspect runwitness --runtime --json
```

Configure optional defaults in the OpenClaw Gateway config:

```json
{
  "plugins": {
    "runwitness": {
      "workspace": "/absolute/path/to/workspace",
      "dataDir": ".runwitness"
    }
  }
}
```

## Safety

`runwitness_run_command` can execute a local command through RunWitness. Risky commands still go through RunWitness policy and approval behavior; do not pass `yes: true` unless a human explicitly approved the action.

Native OpenClaw plugins run in the Gateway process. Treat this plugin as trusted local code and install it from a reviewed source.
