# RunWitness

Autonomous agents with receipts.

RunWitness is a local-first control plane for agent work. It lets an agent run a task, records the important actions RunWitness can observe in an append-only ledger, tracks file changes and command results, and exports a proof bundle that a human can inspect later.

The first milestone is intentionally small:

1. Run a task.
2. Observe the command, ledger events, file changes, inferred test results, and receipt export.
3. Block or pre-approve risky steps.
4. Produce a receipt.

RunWitness is not trying to replace OpenClaw, Hermes, Codex, Claude Code, local agents, or MCP tools. It is the witness layer around them: policy, event history, receipts, and verification.

## Alpha Status

RunWitness is ready for a GitHub alpha launch. It is useful today for local witnessed commands, policy decisions, receipts, sandbox preflight, rollback evidence, and adapter event capture. It is not a hard OS sandbox, hosted multi-user control plane, or universal secret boundary.

Launch and trust docs:

- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Launch checklist](docs/LAUNCH_CHECKLIST.md)
- [Alpha release notes](docs/ALPHA_RELEASE_NOTES.md)
- [Examples](examples/README.md)

## Why It Exists

Autonomous agents are useful because they can touch real systems: files, shells, browsers, APIs, chat tools, and deployments. That is also what makes them risky. A confident final message is not enough when a task touched source code, secrets, CI, or production.

RunWitness makes witnessed work inspectable:

- What did the agent run?
- Which files changed?
- Which risky actions required approval?
- Did tests pass?
- Where is the receipt?
- Is there enough evidence to audit or recover the run later?

## Core Concepts

- **Run**: one user-requested task with a unique id, workspace, agent name, status, timeline, and final receipt.
- **Step**: a discrete observed action inside a run, such as a command, file snapshot, approval, or test result.
- **Receipt**: the final JSON and Markdown proof bundle for a run.
- **Policy**: local rules that classify actions as allowed, denied, or approval-required.
- **Skill**: a reusable capability with declared permissions, canonical digesting, and optional signature verification.
- **Approval**: a recorded human or non-interactive decision for a risky action.
- **Adapter**: a bridge between RunWitness and the thing doing work, starting with local shell commands, command-wrapper foundations for OpenClaw and Hermes, and generic wrappers for browser automation, MCP, CI, and deployment systems.

## Quick Start

Install dependencies from the lockfile:

```bash
npm ci
```

Run a witnessed command:

```bash
npm run rw -- run --task "List files" -- node -e "console.log('hello from RunWitness')"
```

Check a YAML policy before a run:

```bash
npm run rw -- policy check --policy examples/quickstart-policy.yml -- node -e "console.log('ok')"
```

Run with that policy:

```bash
npm run rw -- run --policy examples/quickstart-policy.yml --task "Policy checked task" -- node -e "console.log('ok')"
```

Inspect other foundations:

```bash
npm run rw -- adapters list
npm run rw -- skill inspect --file examples/quickstart-skill.yml
npm run rw -- serve --data-dir .runwitness --host 127.0.0.1 --port 8787
```

Start the operator API with bearer auth without printing the token:

```bash
RUNWITNESS_OPERATOR_TOKEN=change-me npm run rw -- serve --auth-token-env RUNWITNESS_OPERATOR_TOKEN --operator-role approver
```

Run with the local sandbox primitives enabled:

```bash
npm run rw -- run --sandbox --write-allow src --protect .env --task "Sandbox smoke" -- node -e "console.log('sandboxed cwd')"
```

Run with network preflight and rollback evidence:

```bash
npm run rw -- run --network-allow example.com --rollback --rollback-mode dry-run --task "Guarded command" -- node -e "console.log('https://example.com'); process.exit(1)"
```

Redact a secret value from command output by passing the environment variable name, not the secret literal:

```bash
API_TOKEN=secret npm run rw -- run --redact-secret-env API_TOKEN --task "Redacted output" -- node -e "console.log(process.env.API_TOKEN)"
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
- Phase 4 foundation: YAML skill manifest parsing, canonical digesting, permission risk summaries, Ed25519 signature verification, local trust registry checks, install/quarantine assessment, runtime permission check helpers for shell, filesystem, network, and named secrets, and a brokered skill-runner helper that blocks execution unless requested actions are allowed.
- Phase 5 foundation: hardened local sandbox primitives, including write preflight, network preflight, path safety checks, protected path deny lists, filtered environment and PATH construction, isolated temporary workspaces, auditable process isolation plans, rollback baseline/bundle creation, and opt-in rollback dry-run/apply orchestration for failed commands.
- Phase 6 foundation: streaming adapter contract, registry, local-command adapter streaming, OpenClaw/Hermes command-wrapper adapters, and generic browser automation, MCP, CI, and deployment command/JSONL wrapper adapters that normalize structured events when available while marking unexposed nested activity as opaque.
- Phase 7 foundation: static and live operator cockpit renderers plus a local operator API for runs, timelines, approvals, receipts, authenticated Server-Sent Events snapshots, approval actions, operator identity/session display, and policy-lineage views.
- Phase 8 foundation: identity and secret isolation primitives, including workspace roles, explicit secret grants, local secret broker descriptors, encrypted local vault storage, command-output redaction hooks, `--redact-secret-env`, redacted access audit/receipt records, user/workspace scoped operator views, scoped operator principals, secret-like environment filtering, and skill secret permission declarations/checks.

Planned hardening:

- Turn process isolation plans into OS-backed runners and add network egress enforcement around local execution.
- Add richer direct native adapters for agent runtimes beyond command/JSONL wrappers.
- Package the live cockpit as a fuller browser/desktop app and keep policy writes disabled until authenticated validation/auditing is complete.
- Integrate vault/broker credential handoff across more runtime paths and add stronger hosted multi-user authorization.

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/NEXT_PHASES.md](docs/NEXT_PHASES.md) for the current hardening plan.

## Repository Layout

```txt
apps/
  cli/        Command-line interface for witnessed runs.
  web/        Static and live operator cockpit renderer.
  desktop/    Planned desktop shell.
packages/
  adapters/   Adapter contract, registry, local bridge, OpenClaw/Hermes and generic tool wrappers.
  core/       Run types, ids, event ledger, orchestration, and operator API.
  policy/     Shell risk classification, YAML policies, and approval record helpers.
  receipts/   Receipt and proof-bundle exporters.
  sandbox/    Snapshots, preflight, filtered envs, temp workspaces, path safety, rollback, isolation plans.
  skills/     Skill manifests, digests, trust checks, brokered runtime permission checks.
  ui/         Shared operator cockpit rendering helpers.
docs/
examples/
tests/
```

## Safety Posture

RunWitness starts with observation, policy decisions, local approvals, sandbox preflight primitives, scoped local operator access, and receipt generation. It now has foundations for policy hierarchy, skill trust and broker checks, sandboxed temporary workspaces, auditable isolation plans, rollback workflows, streaming adapters, live cockpit rendering, and user/secret isolation primitives.

Those foundations are not the same as OS-level perfect isolation. Commands still execute through host processes unless a future runner enforces a stronger boundary, network egress is preflighted but not blocked at the OS layer by RunWitness, nested tool activity is only visible when an adapter exposes it, rollback is opt-in and not guaranteed across all failure modes, and vault/broker primitives are not yet a universal runtime credential boundary.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the security model and current limits.
