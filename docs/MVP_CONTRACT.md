# MVP Contract

RunWitness MVP promise:

> Run a task, observe every action, approve risky steps, and produce a receipt.

For the current MVP, "observe" means RunWitness records the local command, policy decisions, file snapshot diff, inferred test result, ledger timeline, and exported receipt artifacts. File snapshots disclose ignored generated/runtime folders such as `.git`, `.runwitness`, `node_modules`, `dist`, `coverage`, and `receipts`. It does not yet inspect every nested process action or external API/browser/chat/deployment side effect.

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
- Non-interactive approval recording, including blocked risky commands and `--yes` pre-approval.
- JSON receipt export.
- Markdown receipt export.

## Not Included Yet

- Hard sandboxing.
- Signed skill registry.
- Multi-user RBAC.
- Web control cockpit.
- Desktop app shell.
- Native OpenClaw or Hermes adapters.
- Browser automation receipts.
- Network egress enforcement.

## Acceptance Criteria

The MVP is complete when:

1. `npm run verify` passes.
2. A witnessed command writes a SQLite database under `.runwitness/`.
3. The ledger contains run, command, approval, file-change, and test-result events when applicable.
4. A final JSON receipt is exported.
5. A final Markdown receipt is exported.
6. The README explains why RunWitness exists and how to run it.
