# MVP Contract

RunWitness MVP promise:

> Run a task, observe every action, approve risky steps, and produce a receipt.

For the current MVP, "observe" means RunWitness records the local command, policy decisions, file snapshot diff, inferred test result, ledger timeline, and exported receipt artifacts. File snapshots disclose ignored generated/runtime folders such as `.git`, `.runwitness`, `node_modules`, `dist`, `coverage`, and `receipts`. It does not yet inspect every nested process action or external API/browser/chat/deployment side effect.

The MVP is a witnessed local-command foundation with early policy, skill, adapter, and operator API building blocks. It should not be described as a hard sandbox, a managed signed-skill runtime, or a hosted multi-user web control plane.

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
- Non-interactive approval recording, including blocked risky commands and `--yes` pre-approval.
- Local operator API for run inspection, pending approvals, approval recording, and receipt access.
- JSON receipt export.
- Markdown receipt export.
- YAML skill manifest parsing, canonical digesting, permission risk summaries, and Ed25519 signature verification.
- Adapter registry with `local-command`, `openclaw`, and `hermes` command-wrapper foundations.
- Static operator cockpit rendering foundation.

## Not Included Yet

- Hard sandboxing.
- Protected persistent policy hierarchy with workspace, user, and run precedence.
- Authenticated interactive approval service.
- Signed skill registry.
- Runtime skill permission enforcement.
- Multi-user RBAC.
- Live authenticated web control cockpit.
- Desktop app shell.
- Deep native OpenClaw or Hermes event streaming beyond command-wrapper invocation.
- Native Codex, Claude Code, MCP, browser, CI, or deployment adapters.
- Browser automation receipts.
- Network egress enforcement.
- Secret brokering or output redaction.

## Acceptance Criteria

The MVP is complete when:

1. `npm run verify` passes.
2. A witnessed command writes a SQLite database under `.runwitness/`.
3. The ledger contains run, command, approval, file-change, and test-result events when applicable.
4. A final JSON receipt is exported.
5. A final Markdown receipt is exported.
6. The README explains why RunWitness exists and how to run it.
