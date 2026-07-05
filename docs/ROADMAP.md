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

## Completed Foundations Through Phase 8

The codebase now has a working foundation for local witnessed commands: a CLI, SQLite ledger, append-only event trail, before/after file snapshots, shell-command risk classification, approval records, receipt export, sandbox preflight events, streaming adapter events, and local operator APIs. The phases below describe implemented foundations and remaining limits. They should not be read as a claim of full OS isolation, hosted multi-user security, or complete nested-agent observability.

## Phase 3: Protected Policy and Approval Foundations

Implemented:

- `packages/policy` classifies risky shell commands.
- YAML policies support shell allow/ask/deny rules plus command-text filesystem, network, and protected-path checks.
- `loadPolicyHierarchy` applies built-in, workspace, user, and run-override precedence.
- Policy layers and effective policies have SHA-256 digests and explain output.
- Loaded policy source paths are added to protected paths by default.
- `apps/cli` exposes layered `run`, `policy check`, and `policy explain` inputs for workspace, user, and run-override policy files.
- Receipts include policy lineage from `policy_loaded` events, including effective digest, layer precedence, source layer digests, and protected policy source paths.
- The orchestrator records `approval_requested` and `approval_recorded` events.
- Non-interactive runs block risky actions unless `--yes` is supplied for ask-level risks.
- `packages/core` exposes durable pending approvals, approval recording, receipt access, and optional bearer-token operator auth with viewer/approver/admin roles plus user/workspace scopes.

Current limits:

- Policy lineage is recorded for CLI-loaded policies, but signed policy bundles and richer cockpit policy views remain future work.
- Policy source and effective-policy digests are not yet attached to every adapter-specific or non-CLI policy path.
- Filesystem, network, and secret controls are still mostly command-text evaluation and sandbox preflight, not kernel-level enforcement.

## Phase 4: Skill Trust and Runtime Permission Checks

Implemented:

- `packages/skills` parses YAML skill manifests.
- Manifests include name, version, permissions, entrypoints, author, and optional signature metadata.
- Manifests are canonicalized and digested before signature verification.
- Optional Ed25519 signatures can be verified.
- A local trust registry distinguishes unsigned, self-signed, trusted, revoked, invalid, and unsupported signatures.
- Install assessment returns install or quarantine with reasons.
- Runtime permission checks evaluate shell, filesystem, network, and named-secret actions against declared manifest permissions.

Current limits:

- Runtime permission checks are library primitives; there is not yet a complete signed-skill execution broker.
- Skill identity, grants, signature status, and runtime check outcomes are not yet threaded through every orchestrated run receipt.

## Phase 5: Hardened Local Sandbox Primitives

Implemented:

- `packages/sandbox` creates workspace snapshots and diffs.
- `apps/cli run --sandbox` can execute in an isolated temporary workspace copy.
- Command write preflight detects common write/delete/move/copy/redirection targets.
- Path safety checks keep resolved paths inside the workspace, apply write allowlists, and deny protected paths such as `.git`, `.runwitness`, `.env`, dependency, build, coverage, and receipt folders.
- Environment filtering removes secret-like variables unless explicitly allowed and filters PATH entries by allowed/blocked roots.
- Rollback baseline and rollback bundle builders capture before-file content for added, modified, and deleted file changes.
- Generated and runtime folders such as `.git`, `.runwitness`, `node_modules`, `dist`, `coverage`, and `receipts` are ignored by default in snapshots.

Current limits:

- This is a local hardening layer, not an OS sandbox or container boundary.
- Network access is not blocked.
- Command write preflight is heuristic and does not trace every nested process.
- Rollback bundles are generated primitives; automatic guaranteed rollback is not complete.

## Phase 6: Streaming Command-Wrapper Adapters

Implemented:

- `packages/adapters` contains a formal adapter contract, capability metadata, and registry.
- `local-command` runs local commands and supports streamed lifecycle/stdout/stderr/finish events.
- `openclaw` and `hermes` command-wrapper adapters can invoke configured external tools.
- Command-wrapper adapters stream output, normalize structured JSONL/SSE artifact/action events when emitted by the tool, and emit an `adapter_opaque_action` marker for nested activity they cannot inspect.
- `apps/cli` can list built-in adapter foundations.

Current limits:

- OpenClaw and Hermes integrations normalize structured wrapper streams but are not direct native protocol adapters.
- Browser automation, CI, deployment, Codex, Claude Code, MCP, cancellation, and cleanup adapters remain future work.
- Adapter events are not yet normalized into every orchestrated ledger path.

## Phase 7: Live Authenticated Operator Cockpit Foundations

Implemented:

- `apps/web` renders static cockpit HTML from run, timeline, approval, policy, and receipt view models.
- `apps/web` can render a live cockpit shell that polls the operator API, uses EventSource snapshots, reads a bearer token from local storage, and posts approval decisions.
- `packages/ui` contains shared cockpit rendering helpers.
- `packages/core` exposes local operator API routes for runs, timelines, steps, receipts, receipt artifacts, pending approvals, approval writes, and authenticated event snapshots.
- Operator auth supports bearer tokens, viewer/approver/admin roles, timing-safe token comparison, and user/workspace scopes.
- `apps/cli` exposes `runwitness serve` for the local operator API.

Current limits:

- The CLI `serve` command starts the local API but does not yet expose auth-token flags.
- The live cockpit is an HTML renderer with client-side fetch/EventSource wiring, not a fully bundled browser application.
- Policy editing and broader admin surfaces should remain gated until authentication, audit identity, and validation are more complete.

## Phase 8: User and Secret Isolation Primitives

Implemented:

- Runs can carry user metadata such as `user` or `userId`.
- `InMemoryIdentityStore` models users, workspace roles, workspace grants, secret grants, access decisions, and denied-access errors.
- `LocalSecretBroker` stores local in-memory secret values, returns redacted descriptors, checks workspace/secret grants, and emits redacted audit events plus receipt-shaped records.
- Pending approvals and run lists can be filtered by user and workspace.
- Authenticated operator principals can be scoped to allowed users and workspaces.
- Approval writes record authenticated operator identity and reject actor spoofing.
- Sandbox environment filtering removes secret-like environment variables by default unless explicitly allowed.
- Skill manifests can declare named secret scopes, and runtime permission checks deny undeclared secret access.

Current limits:

- There is no full multi-user RBAC product yet.
- The secret broker is local and in-memory; it is not a durable encrypted per-user vault or universal runtime credential boundary.
- Command output redaction is not complete.
- User/workspace scoping is enforced in the local operator API, not across every adapter, CLI command, receipt, or filesystem path.

## Remaining Hardening Queue

- Add signed policy bundles and richer policy lineage views in the cockpit.
- Enforce skill runtime permission checks inside an execution broker.
- Add stronger process isolation and network controls with OS-specific documentation.
- Add automatic rollback application and failure handling around rollback bundles.
- Normalize adapter stream events into the ledger and add cancellation/cleanup.
- Package the live cockpit as a fuller app with authenticated configuration and policy editing.
- Add durable encrypted secret storage, command-output redaction, broker integration across runtime paths, and stronger multi-user authorization.
