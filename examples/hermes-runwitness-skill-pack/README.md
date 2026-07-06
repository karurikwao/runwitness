# Hermes RunWitness Skill Pack

This example pack gives Hermes a small, auditable way to route risky work through RunWitness. It includes a Hermes-facing `SKILL.md`, a RunWitness skill manifest for inspection, a policy example for witnessed runs, and MCP setup notes for the shared `runwitness-mcp-server`.

## Files

- `SKILL.md`: Hermes skill instructions with frontmatter, usage rules, CLI/MCP command shapes, and verification steps.
- `runwitness-skill.yml`: RunWitness skill manifest that can be inspected with `runwitness skill inspect`.
- `runwitness-policy.yml`: Optional run policy for the commands in the skill.

## Install

From a RunWitness checkout:

```powershell
npm install
npm run build
npm run rw -- skill inspect --file examples/hermes-runwitness-skill-pack/runwitness-skill.yml
```

Then make this folder available to Hermes as a skill directory. Hermes distributions use different skill-path or install commands, so the important invariant is that Hermes loads `SKILL.md` and keeps the two YAML files next to it.

Set these environment variables for Hermes sessions that should produce receipts:

```powershell
$env:RUNWITNESS_WORKSPACE = "C:\path\to\workspace"
$env:RUNWITNESS_BIN = "npm run rw --"
$env:RUNWITNESS_POLICY = "examples/hermes-runwitness-skill-pack/runwitness-policy.yml"
$env:RUNWITNESS_DATA_DIR = ".runwitness"
$env:RUNWITNESS_MCP_BIN = "runwitness-mcp-server"
```

If Hermes runs outside this repository after `npm run build`, use the packaged binary instead:

```powershell
$env:RUNWITNESS_BIN = "node C:\path\to\runwitness\dist\apps\cli\src\bin.js"
```

## Verify

```powershell
npm run rw -- skill inspect --file examples/hermes-runwitness-skill-pack/runwitness-skill.yml
npm run rw -- policy check --policy examples/hermes-runwitness-skill-pack/runwitness-policy.yml -- npm test
npm run rw -- adapters list
node packages/mcp-server/dist/src/bin.js --help
```

`adapters list` should include `hermes` and `mcp`. After `npm run build`, the MCP stdio server is available at `packages/mcp-server/dist/src/bin.js`; after package installation, use the `runwitness-mcp-server` binary.
