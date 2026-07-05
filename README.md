# RunWitness

Autonomous agents with receipts.

RunWitness is a local-first control plane for agent work. It lets an agent run a task, records every important action in an append-only ledger, tracks file changes and command results, and exports a proof bundle that a human can inspect later.

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
- Phase 3 foundation: YAML policy loading, shell allow/ask/deny rules, filesystem and network scope evaluation for command text, and a local operator approval API.
- Phase 4 foundation: YAML skill manifest parsing, canonical digesting, permission risk summaries, and Ed25519 signature verification.
- Phase 6 foundation: adapter contract, registry, local-command adapter, and OpenClaw/Hermes command-wrapper adapters.
- Phase 7 foundation: static operator cockpit renderer and local operator API for runs, timelines, approvals, and receipts.

Planned hardening:

- Protected project, user, and run-level policy hierarchy.
- Skill trust registry, install quarantine, and runtime permission enforcement.
- Stronger sandbox boundaries for processes, filesystem writes, environment variables, and network access.
- Rich native adapters for agent runtimes beyond command wrappers.
- Authenticated live web cockpit for monitoring, approvals, receipts, and policy editing.

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/NEXT_PHASES.md](docs/NEXT_PHASES.md) for the current next-phase plan.

## Repository Layout

```txt
apps/
  cli/        Command-line interface for witnessed runs.
  web/        Static operator cockpit renderer.
  desktop/    Planned desktop shell.
packages/
  adapters/   Adapter contract, registry, local command bridge, OpenClaw/Hermes wrappers.
  core/       Run types, ids, event ledger, orchestration, and operator API.
  policy/     Shell risk classification, YAML policies, and approval record helpers.
  receipts/   Receipt and proof-bundle exporters.
  sandbox/    Workspace snapshots and file diffs, not hard isolation.
  skills/     Skill manifest parsing, digesting, risk summaries, and signature verification.
  ui/         Shared operator cockpit rendering helpers.
docs/
examples/
tests/
```

## Safety Posture

RunWitness starts with observation, policy decisions, local approvals, and receipt generation. It does not yet provide a hard security sandbox, skill trust registry, runtime skill permission enforcement, secret brokering, network enforcement, or multi-user authorization.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the security model and current limits.
