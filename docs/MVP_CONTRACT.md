# MVP Contract

RunWitness MVP promise:

> Run a task, observe each RunWitness-captured action, approve risky steps, and produce a receipt.

For the current MVP, "observe" means RunWitness records the local command, policy decisions, sandbox preflight signals, network preflight, rollback evidence when enabled, file snapshot diff, inferred test result, ledger timeline, adapter stream events when exposed, and exported receipt artifacts. File snapshots disclose ignored generated/runtime folders such as `.git`, `.runwitness`, `node_modules`, `dist`, `coverage`, and `receipts`. It does not yet inspect every nested process action or external API/browser/chat/deployment side effect.

The MVP is a witnessed local-command foundation with policy hierarchy, skill trust/runtime checks, brokered skill-runner primitives, sandbox primitives, generic streaming adapters, live cockpit, and scoped operator-access building blocks. It should not be described as a hard OS sandbox, a managed signed-skill execution runtime, or a hosted multi-user web control plane.

## Included

- TypeScript monorepo foundation.
- Local CLI command runner.
- SQLite-backed run ledger.
- Append-only event log.
- Timeline query.
- Command start and finish events.
- File-change tracking for a workspace.
- Test-result tracking for likely test commands.
- Basic risky-command policy classifier.
- YAML policy loading and command evaluation with shell allow/ask/deny rules.
- Command-text filesystem and network scope evaluation.
- Protected policy path checks.
- Layered policy loading with built-in, workspace, user, and run-override precedence through the CLI run/check/explain paths and policy package.
- Policy source and effective-policy digests plus explain output and receipt policy lineage.
- Signed policy bundle parsing, digesting, Ed25519 signing/verification, trust registry assessment, and conversion into policy hierarchy layers.
- Non-interactive approval recording, including blocked risky commands and `--yes` pre-approval.
- Local operator API for run inspection, pending approvals, approval recording, and receipt access.
- Optional bearer-token operator auth with roles and user/workspace scopes in the operator API.
- JSON receipt export.
- Markdown receipt export.
- YAML skill manifest parsing, canonical digesting, permission risk summaries, Ed25519 signature verification, trust registry checks, install/quarantine assessment, runtime permission checks, a non-executing broker that records allow/deny decisions, and a brokered skill-runner helper.
- Adapter registry with streamed `local-command`, `openclaw`, `hermes`, browser automation, MCP, CI, and deployment wrapper foundations plus adapter stream events in run ledgers.
- Static and live authenticated operator cockpit rendering foundations with policy lineage display and operator identity/session state.
- Sandbox write preflight, network command preflight, process isolation planning, path safety, protected path deny lists, filtered environments, temporary workspace copies, rollback bundle primitives, rollback apply/dry-run helpers, and opt-in rollback orchestration after failed commands.
- User/workspace filtering and secret-isolation primitives through the in-memory identity store, local secret broker, encrypted local vault, output redaction helper, `--redact-secret-env`, operator scopes, filtered environments, and skill secret permissions.

## Not Included Yet

- Hard OS/process/container sandboxing.
- Network egress enforcement beyond command-text preflight.
- Full nested-process tracing.
- Full multi-user RBAC.
- Hosted or fully packaged authenticated cockpit app.
- Desktop app shell.
- Direct OpenClaw or Hermes native protocol integrations beyond command-wrapper streaming and structured-event normalization.
- Native Codex, Claude Code, MCP, browser, CI, or deployment protocol adapters beyond generic wrappers.
- Browser automation receipts.
- Universal runtime secret brokering.
- Guaranteed automatic rollback across all failure modes.

## Acceptance Criteria

The MVP is complete when:

1. `npm run verify` passes.
2. A witnessed command writes a SQLite database under `.runwitness/`.
3. The ledger contains run, command, approval, file-change, and test-result events when applicable.
4. A final JSON receipt is exported.
5. A final Markdown receipt is exported.
6. The README explains why RunWitness exists and how to run it.
