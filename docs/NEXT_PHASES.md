# Current Hardening Notes

This document tracks what exists now and what still needs hardening. It separates implemented foundations from remaining controls so product, docs, and future UI do not overclaim the current security boundary.

## Current Implemented Foundation

RunWitness currently provides:

- A local CLI command runner in `apps/cli`.
- A local command adapter in `packages/adapters`.
- A SQLite-backed run ledger in `packages/core`.
- Append-only database triggers for runs, steps, and events.
- Before/after workspace snapshots and file-change diffs in `packages/sandbox`.
- A shell-command risk classifier, YAML policy loader, command-text policy evaluator, policy hierarchy loader, policy digests, protected policy-source paths, and approval record helper in `packages/policy`.
- JSON and Markdown receipt export in `packages/receipts`.
- YAML skill manifest parsing, canonical digesting, permission risk summaries, Ed25519 signature verification, trust registry checks, install/quarantine assessment, and runtime permission checks in `packages/skills`.
- Adapter contract and registry, including streamed `local-command`, `openclaw`, and `hermes` command-wrapper adapters.
- Sandbox primitives for write preflight, path safety, filtered environments, isolated temporary workspaces, and rollback bundles.
- A local operator API for runs, timelines, approvals, receipts, authenticated event snapshots, and scoped operator access.
- Static and live operator cockpit renderers in `apps/web` plus shared UI rendering helpers in `packages/ui`.
- User/workspace filtering and secret-isolation primitives through an in-memory identity store, local secret broker, operator scopes, environment filtering, and skill secret permissions.

RunWitness does not currently provide:

- A hard OS process sandbox, container, VM, or kernel-level isolation boundary.
- Network egress blocking.
- Full nested-process or nested-agent tracing.
- A complete signed-skill execution broker.
- Deep native OpenClaw, Hermes, Codex, Claude Code, MCP, browser, CI, or deployment adapters.
- A fully bundled hosted cockpit app with configuration, auth setup, and policy editing.
- Durable encrypted per-user vaults, universal runtime secret brokering, command-output redaction, or full multi-user RBAC.
- Guaranteed automatic rollback.

## Policy Files and Approvals

Implemented:

- RunWitness can load workspace, user, and run-override YAML policy files from CLI run/check/explain commands.
- `policy check` explains shell, filesystem, and network command-text decisions.
- `run --policy`, `--workspace-policy`, and `--user-policy` record policy evaluation in approval events.
- `loadPolicyHierarchy` supports built-in, workspace, user, and run-override layers.
- Policy layers and effective policy objects are digested with SHA-256.
- Explain output summarizes precedence, active rules, protected paths, defaults, and classifier options.
- Loaded policy source files are added to protected paths by default.
- Receipts include policy lineage from `policy_loaded` events.
- The operator API can list and record durable pending approvals.
- Optional bearer auth can identify operators, enforce viewer/approver/admin roles, and scope access by user and workspace.

Current limits:

- Signed policy bundles and managed policy distribution are not implemented yet.
- Policy digests are attached to CLI-loaded policy events and receipts, but not yet consistently surfaced in every UI and adapter-specific view.
- Filesystem and network decisions are mostly command-text checks, not comprehensive runtime enforcement.
- Secret, adapter, and skill policy fields need broader integration with the orchestrator.

## Skill Trust and Runtime Checks

Implemented:

- RunWitness can parse a YAML manifest, canonicalize it, compute a digest, summarize permission risk, and verify an optional Ed25519 signature.
- Signature status distinguishes unsigned, self-signed, trusted, revoked, invalid, and unsupported manifests.
- A local trust registry normalizes trusted and revoked key fingerprints.
- Install assessment returns install or quarantine with concrete reasons.
- Runtime permission checks cover shell commands, filesystem read/write paths, network hosts/URLs, and named secrets.

Security boundary:

- A parsed manifest is not a trusted skill.
- A trusted signature proves manifest identity and integrity for a local key, not safety of all runtime behavior.
- Runtime permission checks are available as primitives, but there is not yet a complete skill execution broker that forces every skill action through them.

## Sandbox Limits

Implemented:

- Hash workspace files.
- Ignore common generated/runtime folders.
- Diff added, modified, and deleted files.
- Skip symlinks in the snapshot walker.
- Detect common command write targets before execution.
- Keep resolved paths inside the workspace root.
- Apply write allowlists and protected path deny lists.
- Filter secret-like environment variables and PATH entries.
- Copy a workspace into a disposable temporary workspace for `run --sandbox`.
- Create rollback baselines and rollback bundles.

Limits:

- Commands still run as host processes.
- The temporary workspace reduces direct writes to the source workspace but is not an OS sandbox.
- Network access is not blocked.
- Preflight detection is heuristic and cannot see every nested process or dynamic path.
- Rollback bundles capture evidence and restore material, but automatic guaranteed rollback is not complete.
- Ignored folders are excluded from file-change evidence by design.

## Adapter Roadmap

Implemented:

- `local-command` can run a command normally or stream adapter lifecycle, stdout, stderr, and finish events.
- `openclaw` and `hermes` wrappers build configurable command invocations without requiring those tools to be installed for registry/tests.
- Command-wrapper adapters emit an opaque nested-action marker, stream external tool output, and normalize structured JSONL/SSE artifact/action events when emitted by the wrapped tool.
- Adapter capabilities declare local execution, external tool usage, event streaming, artifacts, and opaque actions.

Remaining:

- Add direct native protocol adapters where runtimes expose richer structured events and artifacts.
- Normalize adapter stream events into RunWitness ledger events.
- Add cancellation and cleanup semantics.
- Add browser automation, MCP, CI, deployment, Codex, and Claude Code adapters.

## Web Operator Cockpit

Implemented:

- `apps/web` renders static cockpit HTML.
- `apps/web` renders a live cockpit shell with API polling, EventSource snapshots, approval buttons, and bearer-token headers from local storage.
- `packages/core` exposes runs, timelines, steps, receipts, receipt artifacts, pending approvals, approval writes, and `/events` snapshots.
- Operator auth supports bearer tokens, timing-safe comparison, scoped principals, and role checks for approval writes.

Remaining:

- Add CLI flags or config for authenticated `runwitness serve`.
- Package the live cockpit as a fuller browser app or desktop surface.
- Add policy explain/edit views only after auth and audit identity are complete.
- Improve operator session handling beyond local-storage bearer tokens.

## User and Secret Isolation

Implemented:

- Runs can include user metadata.
- `InMemoryIdentityStore` models users, workspace roles, workspace grants, secret grants, and access decisions.
- `LocalSecretBroker` stores local in-memory secrets, returns redacted descriptors, checks grants, and emits redacted audit events plus receipt-shaped records.
- Operator API list endpoints and pending approvals can be filtered by user and workspace.
- Authenticated operator principals can be scoped to allowed users and workspaces.
- Approval writes record authenticated operator identity and reject actor spoofing.
- Sandbox environment filtering removes common secret-like env vars unless explicitly allowed.
- Skill manifests can declare named secret scopes, and runtime checks deny undeclared secret access.

Remaining:

- Add durable encrypted per-user/workspace/run secret storage.
- Integrate the local secret broker across runtime paths.
- Redact secret values from command output and non-secret receipts.
- Carry user/workspace/secret scopes through every adapter and orchestrator path.
- Add stronger RBAC and audit views for hosted or shared use.
