# Roadmap

## Phase 0: Product Contract

- README positioning.
- Threat model.
- Core concepts.
- MVP promise.

## Phase 1: Repo Foundation

- TypeScript monorepo.
- CLI, web, desktop app folders.
- Core package boundaries.
- Verification scripts.

## Phase 2: Run Ledger MVP

- SQLite run database.
- Append-only event log.
- Run timeline.
- Receipt JSON format.
- File-change tracking.
- Command tracking.
- Test-result tracking.
- Proof bundle export.

## Next Phases

The codebase now has a working foundation for local witnessed commands: a CLI, SQLite ledger, append-only event trail, before/after file snapshots, shell-command risk classification, approval records, and receipt export. The next phases should build on that foundation without presenting future controls as already enforced.

## Phase 3: Policy Files and Approval Service

Current foundation:

- `packages/policy` classifies risky shell commands.
- `packages/policy` loads YAML policy files and evaluates shell allow/ask/deny rules.
- Policy evaluation checks command text for declared filesystem and network scopes.
- `apps/cli` exposes `run --policy` and `policy check`.
- The orchestrator records `approval_requested` and `approval_recorded` events.
- Non-interactive runs block risky actions unless `--yes` is supplied for ask-level risks.
- `packages/core` exposes a local operator API for run inspection, pending approvals, approval recording, and receipts.

Next work:

- Define precedence for default policy, workspace policy, user overrides, and one-run overrides.
- Cover shell, filesystem, network, secrets, adapters, and skills in the policy schema.
- Record policy source and digest in relevant ledger events.
- Add policy tests for conflict handling across policy layers.
- Add authenticated approval identity and durable approval queue semantics.
- Keep policy decisions recorded in the ledger with the policy file version or digest that produced them.

Not done yet:

- Protected persistent policy hierarchy.
- Authenticated interactive approval service.
- Runtime filesystem, network, or secret enforcement beyond command-text evaluation and shell-risk classification.

## Phase 4: Signed Skill Manifests

Current foundation:

- `packages/skills` parses YAML skill manifests.
- The manifest type includes name, version, permissions, entrypoints, author, and optional signature metadata.
- Manifests are canonicalized and digested before signature verification.
- Optional Ed25519 signatures can be verified.
- Permission risk summaries distinguish unsigned/risky manifests from trusted runtime execution.

Next work:

- Distinguish unsigned, self-signed, trusted, revoked, and incompatible skills.
- Add a local trust registry and revocation metadata.
- Show install-time risk cards based on declared permissions.
- Record skill identity, permission grant, and signature status in receipts when a skill participates in a run.

Not done yet:

- Trust registry.
- Install quarantine.
- Runtime permission checks for skills.

## Phase 5: Strong Sandbox Enforcement

Current foundation:

- `packages/sandbox` can create workspace snapshots and diffs.
- The orchestrator snapshots files before and after a local command.
- Generated and runtime folders such as `.git`, `.runwitness`, `node_modules`, `dist`, `coverage`, and `receipts` are ignored by default.

Next work:

- Add an execution boundary around local commands instead of only observing after the fact.
- Filter environment variables and PATH entries before spawning child processes.
- Enforce writable path allowlists and protected path deny lists.
- Add rollback bundle creation for changed workspace files.
- Add network egress logging first, then deny or allowlist enforcement.
- Document OS-specific limits, especially for Windows process isolation.

Not done yet:

- Process containment.
- Network isolation.
- Secret redaction.
- Guaranteed rollback.
- Full nested-process tracing.

## Phase 6: Adapter Roadmap

Current foundation:

- `packages/adapters` contains a formal adapter contract and registry.
- `local-command` runs local commands.
- `openclaw` and `hermes` command-wrapper adapters can invoke configured external tools.
- `apps/cli` can list the built-in adapter foundations.

Next work:

- Define a stable adapter contract for start, event streaming, artifact capture, cancellation, and cleanup.
- Add adapters in this order: local shell hardening, Codex or Claude Code, OpenClaw, Hermes, MCP server runs, browser automation, CI and deployment jobs.
- Normalize adapter events into RunWitness ledger events.
- Capture adapter-native artifacts without hiding raw evidence.
- Make nested tool calls visible where the adapter can expose them, and mark them as opaque where it cannot.

Not done yet:

- Deep native agent adapters with event streaming.
- Browser automation receipts.
- CI or deployment adapters.
- Cross-adapter cancellation and cleanup.

## Phase 7: Web Operator Cockpit

Current foundation:

- `apps/web` renders a static operator cockpit document from run, timeline, approval, policy, and receipt view models.
- `packages/ui` contains shared cockpit rendering helpers.
- `packages/core` exposes a local operator API used by future cockpit integration.
- `apps/cli` exposes `runwitness serve` for the local operator API.

Next work:

- Start read-only: list runs, inspect timelines, open JSON and Markdown receipts, and filter by status.
- Add live run monitoring over the ledger or an event stream.
- Add approval inbox views after the approval service exists.
- Add policy editing after policy files have validation and explain output.
- Add operator authentication before exposing write actions.

Not done yet:

- Bundled browser app shell.
- Live event transport.
- Authenticated operator actions and multi-user authorization.

## Phase 8: Multi-User Access and Secret Isolation

Current foundation:

- Runs include an agent name and workspace.
- Approvals record mode and rationale.

Next work:

- Add users, roles, workspaces, and audit identities.
- Isolate secrets by user, workspace, and run.
- Require explicit grants for deployment, messaging, and production credentials.
- Preserve receipt usefulness without leaking secret material.
