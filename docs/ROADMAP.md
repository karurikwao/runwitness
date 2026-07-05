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

## Completed Foundations And Current Limits

The codebase now has a working foundation for local witnessed commands: a CLI, SQLite ledger, append-only event trail, before/after file snapshots, shell-command risk classification, approval records, receipt export, sandbox preflight events, opt-in rollback evidence, streaming adapter events, and local operator APIs. The phases below describe implemented foundations and remaining limits. They should not be read as a claim of full OS isolation, hosted multi-user security, or complete nested-agent observability.

## Phase 3: Protected Policy and Approval Foundations

Implemented:

- `packages/policy` classifies risky shell commands.
- YAML policies support shell allow/ask/deny rules plus command-text filesystem, network, and protected-path checks.
- `loadPolicyHierarchy` applies built-in, workspace, user, and run-override precedence.
- Policy layers and effective policies have SHA-256 digests and explain output.
- Loaded policy source paths are added to protected paths by default.
- `apps/cli` exposes layered `run`, `policy check`, and `policy explain` inputs for workspace, user, and run-override policy files.
- Receipts include policy lineage from `policy_loaded` events, including effective digest, layer precedence, source layer digests, and protected policy source paths.
- Signed policy bundle primitives can wrap policy layers, compute canonical digests, verify Ed25519 signatures, assess trust, and feed accepted layers into the hierarchy.
- The orchestrator records `approval_requested` and `approval_recorded` events.
- Non-interactive runs block risky actions unless `--yes` is supplied for ask-level risks.
- `packages/core` exposes durable pending approvals, approval recording, receipt access, and optional bearer-token operator auth with viewer/approver/admin roles plus user/workspace scopes.

Current limits:

- Signed policy bundles are local primitives; managed distribution and hosted policy administration remain future work.
- Policy lineage is recorded for CLI-loaded policies and surfaced in the cockpit, but not every adapter-specific or non-CLI policy path.
- Filesystem, network, and secret controls are still mostly command-text evaluation, broker checks, and sandbox preflight, not kernel-level enforcement.

## Phase 4: Skill Trust and Runtime Permission Checks

Implemented:

- `packages/skills` parses YAML skill manifests.
- Manifests include name, version, permissions, entrypoints, author, and optional signature metadata.
- Manifests are canonicalized and digested before signature verification.
- Optional Ed25519 signatures can be verified.
- A local trust registry distinguishes unsigned, self-signed, trusted, revoked, invalid, and unsupported signatures.
- Install assessment returns install or quarantine with reasons.
- Runtime permission checks evaluate shell, filesystem, network, and named-secret actions against declared manifest permissions.
- `SkillExecutionBroker` records allow/deny decisions for requested shell, filesystem, network, and secret actions with manifest digest linkage and redacted receipts.
- `runBrokeredSkill` forces a set of requested runtime actions through the broker before invoking a skill executor callback.

Current limits:

- Real skill execution paths must call the brokered runner before this becomes universal enforcement.
- Skill grants and runtime check outcomes are not yet threaded through every orchestrated run receipt.

## Phase 5: Hardened Local Sandbox Primitives

Implemented:

- `packages/sandbox` creates workspace snapshots and diffs.
- `apps/cli run --sandbox` can execute in an isolated temporary workspace copy.
- Command write preflight detects common write/delete/move/copy/redirection targets.
- Path safety checks keep resolved paths inside the workspace, apply write allowlists, and deny protected paths such as `.git`, `.runwitness`, `.env`, dependency, build, coverage, and receipt folders.
- Environment filtering removes secret-like variables unless explicitly allowed and filters PATH entries by allowed/blocked roots.
- Rollback baseline and rollback bundle builders capture before-file content for added, modified, and deleted file changes.
- Rollback apply/dry-run helpers restore modified/deleted files, delete added files, verify before-file hashes, and reject unsafe paths.
- Network command preflight detects URL and SSH-style hosts and applies host allow/deny/default decisions.
- `runWitnessedCommand` can block denied network preflight before execution and can pre-approve ask-level network preflight with `--yes`.
- `runWitnessedCommand` can create rollback baselines/bundles and, when enabled, dry-run or apply rollback after failed commands.
- Process isolation planning documents `none`, `temp-workspace`, `container`, `job-object/windows`, and `namespace/linux` strategies with platform capability and fallback evidence.
- Generated and runtime folders such as `.git`, `.runwitness`, `node_modules`, `dist`, `coverage`, and `receipts` are ignored by default in snapshots.

Current limits:

- This is a local hardening layer, not an OS sandbox or container boundary.
- Network access is preflighted from command text but not blocked at the OS boundary.
- Command write preflight is heuristic and does not trace every nested process.
- Rollback orchestration is opt-in and does not guarantee recovery across every failure mode.
- Process isolation planning does not spawn containers or OS-specific runners.

## Phase 6: Streaming Command-Wrapper Adapters

Implemented:

- `packages/adapters` contains a formal adapter contract, capability metadata, and registry.
- `local-command` runs local commands and supports streamed lifecycle/stdout/stderr/finish events.
- `openclaw` and `hermes` command-wrapper adapters can invoke configured external tools.
- Generic browser automation, MCP, CI, and deployment command/JSONL wrapper adapters are registered by default and can be disabled per registry option.
- Command-wrapper adapters stream output, normalize structured JSONL/SSE artifact/action events when emitted by the tool, and emit an `adapter_opaque_action` marker for nested activity they cannot inspect.
- Orchestrated non-local adapters write streamed adapter events into the run ledger and receipt timeline.
- Adapter runs accept `AbortSignal` cancellation primitives.
- `apps/cli` can list built-in adapter foundations.

Current limits:

- OpenClaw and Hermes integrations normalize structured wrapper streams but are not direct native protocol adapters.
- Browser automation, MCP, CI, and deployment integrations are generic wrapper foundations, not native protocol integrations.
- Codex, Claude Code, direct native protocol adapters, and richer cleanup semantics remain future work.

## Phase 7: Live Authenticated Operator Cockpit Foundations

Implemented:

- `apps/web` renders static cockpit HTML from run, timeline, approval, policy, and receipt view models.
- `apps/web` can render a live cockpit shell that polls the operator API, uses EventSource snapshots, reads a bearer token from local storage, and posts approval decisions.
- `packages/ui` contains shared cockpit rendering helpers.
- `packages/core` exposes local operator API routes for runs, timelines, steps, receipts, receipt artifacts, pending approvals, approval writes, and authenticated event snapshots.
- Operator auth supports bearer tokens, viewer/approver/admin roles, timing-safe token comparison, and user/workspace scopes.
- `apps/cli` exposes `runwitness serve` for the local operator API.
- `runwitness serve` supports token, token-env, JSON auth config, role, user-scope, and workspace-scope flags without printing token values.
- The live cockpit renders policy lineage/digests from receipt and timeline data, and exposes a gated policy explain/edit placeholder while policy writes remain disabled.
- The live cockpit renders `/operator/me` identity, role, scope, capability, and policy-write state so authenticated sessions are visible to operators.

Current limits:

- The live cockpit is an HTML renderer with client-side fetch/EventSource wiring, not a fully bundled browser application.
- Policy editing writes remain disabled until validation and auditing are more complete.

## Phase 8: User and Secret Isolation Primitives

Implemented:

- Runs can carry user metadata such as `user` or `userId`.
- `InMemoryIdentityStore` models users, workspace roles, workspace grants, secret grants, access decisions, and denied-access errors.
- `LocalSecretBroker` stores local in-memory secret values, returns redacted descriptors, checks workspace/secret grants, and emits redacted audit events plus receipt-shaped records.
- `EncryptedLocalSecretVault` persists AES-256-GCM encrypted secrets using per-secret scrypt salts and redacted descriptors.
- `redactKnownSecrets` scrubs configured secret values from strings, records, arrays, object keys, URL-encoded variants, and JSON-escaped variants.
- `runWitnessedCommand` can redact configured secrets from command stdout/stderr event payloads.
- `apps/cli run --redact-secret-env` reads secret values from named environment variables for output redaction without putting the literal secret in CLI arguments.
- Pending approvals and run lists can be filtered by user and workspace.
- Authenticated operator principals can be scoped to allowed users and workspaces.
- Approval writes record authenticated operator identity and reject actor spoofing.
- Sandbox environment filtering removes secret-like environment variables by default unless explicitly allowed.
- Skill manifests can declare named secret scopes, and runtime permission checks deny undeclared secret access.

Current limits:

- There is no full multi-user RBAC product yet.
- The local broker is in-memory, and the encrypted vault is local; together they are not yet a universal runtime credential boundary.
- Command output redaction requires explicit configured or environment-sourced redaction values and is not automatic for every possible secret source.
- User/workspace scoping is enforced in the local operator API, not across every adapter, CLI command, receipt, or filesystem path.

## Remaining Hardening Queue

- Turn process isolation plans into enforced OS/container runners and add real network egress controls.
- Connect every real skill runtime path to `runBrokeredSkill`.
- Broaden rollback recovery beyond opt-in command failure orchestration.
- Upgrade generic wrappers into direct native adapters for agent runtimes and add richer cleanup semantics.
- Package the live cockpit as a fuller app while keeping policy writes audited and gated.
- Integrate vault/broker credential handoff across more runtime paths and add stronger hosted multi-user authorization.
