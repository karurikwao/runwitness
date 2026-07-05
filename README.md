# RunWitness

Autonomous agents with receipts.

RunWitness is a local-first control plane for agent work. It lets an agent run a task, records the important actions RunWitness can observe in an append-only ledger, tracks file changes and command results, and exports a proof bundle that a human can inspect later.

The first milestone is intentionally small:

1. Run a task.
2. Observe the command, ledger events, file changes, inferred test results, and receipt export.
3. Block or pre-approve risky steps.
4. Produce a receipt.

RunWitness is not trying to replace OpenClaw, Hermes, Codex, Claude Code, local agents, or MCP tools. It is the witness layer around them: policy, event history, receipts, and verification.

## Why It Exists

Autonomous agents are useful because they can touch real systems: files, shells, browsers, APIs, chat tools, and deployments. That is also what makes them risky. A confident final message is not enough when a task touched source code, secrets, CI, or production.

RunWitness makes witnessed work inspectable:

- What did the agent run?
- Which files changed?
- Which risky actions required approval?
- Did tests pass?
- Where is the receipt?
- Can the run be replayed or audited later?

## Core Concepts

- **Run**: one user-requested task with a unique id, workspace, agent name, status, timeline, and final receipt.
- **Step**: a discrete observed action inside a run, such as a command, file snapshot, approval, or test result.
- **Receipt**: the final JSON and Markdown proof bundle for a run.
- **Policy**: local rules that classify actions as allowed, denied, or approval-required.
- **Skill**: a reusable capability with declared permissions, canonical digesting, and optional signature verification.
- **Approval**: a recorded human or non-interactive decision for a risky action.
- **Adapter**: a bridge between RunWitness and the thing doing work, starting with local shell commands and command-wrapper foundations for OpenClaw and Hermes.

## Quick Start

Install dependencies:

```bash
npm install
```

Run a witnessed command:

```bash
npm run rw -- run --task "List files" -- node -e "console.log('hello from RunWitness')"
```

Check a YAML policy before a run:

```bash
npm run rw -- policy check --policy runwitness.policy.yml -- node -e "console.log('ok')"
```

Run with that policy:

```bash
npm run rw -- run --policy runwitness.policy.yml --task "Policy checked task" -- node -e "console.log('ok')"
```

Inspect other foundations:

```bash
npm run rw -- adapters list
npm run rw -- skill inspect --file skill.yml
npm run rw -- serve --data-dir .runwitness --host 127.0.0.1 --port 8787
```

Run with the local sandbox primitives enabled:

```bash
npm run rw -- run --sandbox --write-allow src --protect .env --task "Sandbox smoke" -- node -e "console.log('sandboxed cwd')"
```

On Windows, commands containing shell metacharacters such as `|`, `>`, `<`, or
`&` can be reinterpreted by `npm run` before RunWitness sees them. For those
commands, build first and call the generated bin directly:

```bash
npm run build
node dist/apps/cli/src/bin.js run --task "Pipe-safe command" -- node -e "console.log('a|b')"
```

Exported artifacts are written under `.runwitness/` by default:

```txt
.runwitness/
  runwitness.sqlite
  receipts/
    rw_...json
    rw_...md
```

Run verification:

```bash
npm run verify
```

## Current Phase

Implemented foundation:

- Phase 0: product contract, threat model, concept vocabulary, MVP promise.
- Phase 1: TypeScript monorepo foundation.
- Phase 2: run ledger MVP with SQLite, append-only events, command tracking, file-change tracking, test-result tracking, and receipt export.
- Phase 3 foundation: protected policy/auth approval foundations, including layered policy loading through CLI run/check/explain paths, source and effective-policy digests, protected policy-source paths, receipt policy lineage, durable pending approvals, and optional bearer-token operator auth with roles plus user/workspace scopes.
- Phase 4 foundation: YAML skill manifest parsing, canonical digesting, permission risk summaries, Ed25519 signature verification, local trust registry checks, install/quarantine assessment, and runtime permission check helpers for shell, filesystem, network, and named secrets.
- Phase 5 foundation: hardened local sandbox primitives, including write preflight, path safety checks, protected path deny lists, filtered environment and PATH construction, isolated temporary workspaces, and rollback baseline/bundle creation.
- Phase 6 foundation: streaming adapter contract, registry, local-command adapter streaming, and OpenClaw/Hermes command-wrapper adapters that normalize structured JSONL/SSE events when available while marking unexposed nested activity as opaque.
- Phase 7 foundation: static and live operator cockpit renderers plus a local operator API for runs, timelines, approvals, receipts, authenticated Server-Sent Events snapshots, and approval actions.
- Phase 8 foundation: in-memory identity and secret isolation primitives, including workspace roles, explicit secret grants, local secret broker descriptors, redacted secret access audit/receipt records, user/workspace scoped operator views, scoped operator principals, secret-like environment filtering, and skill secret permission declarations/checks.

Planned hardening:

- Add signed policy bundles and richer policy lineage views in the cockpit.
- Turn skill runtime permission checks into an enforced execution broker instead of standalone checks.
- Add stronger process and network boundaries around local execution.
- Add richer native adapters for agent runtimes beyond command wrappers.
- Package the live cockpit as a fuller browser app and add policy editing only after authentication and audit identity are complete.
- Add durable encrypted secret storage, command-output redaction, broker integration across runtime paths, and stronger multi-user authorization.

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/NEXT_PHASES.md](docs/NEXT_PHASES.md) for the current hardening plan.

## Repository Layout

```txt
apps/
  cli/        Command-line interface for witnessed runs.
  web/        Static and live operator cockpit renderer.
  desktop/    Planned desktop shell.
packages/
  adapters/   Adapter contract, registry, local command bridge, OpenClaw/Hermes wrappers.
  core/       Run types, ids, event ledger, orchestration, and operator API.
  policy/     Shell risk classification, YAML policies, and approval record helpers.
  receipts/   Receipt and proof-bundle exporters.
  sandbox/    Snapshots, write preflight, filtered envs, temp workspaces, path safety, rollback bundles.
  skills/     Skill manifests, digests, trust checks, install assessment, runtime permission checks.
  ui/         Shared operator cockpit rendering helpers.
docs/
examples/
tests/
```

## Safety Posture

RunWitness starts with observation, policy decisions, local approvals, sandbox preflight primitives, scoped local operator access, and receipt generation. It now has foundations for policy hierarchy, skill trust checks, sandboxed temporary workspaces, streaming adapters, live cockpit rendering, and user/secret isolation primitives.

Those foundations are not the same as OS-level perfect isolation. Commands still execute through host processes, network egress is not blocked by RunWitness, nested tool activity is only visible when an adapter exposes it, and the local secret broker is not yet a durable encrypted vault or universal runtime credential boundary.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the security model and current limits.
