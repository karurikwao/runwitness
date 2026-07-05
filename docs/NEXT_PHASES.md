# Next Phase Design Notes

This document describes the next hardening phases from the code that exists now. It separates implemented foundations from planned controls so product, docs, and future UI do not overclaim the current security boundary.

## Current Implemented Foundation

RunWitness currently provides:

- A local CLI command runner in `apps/cli`.
- A local command adapter in `packages/adapters`.
- A SQLite-backed run ledger in `packages/core`.
- Append-only database triggers for runs, steps, and events.
- Before/after workspace snapshots and file-change diffs in `packages/sandbox`.
- A shell-command risk classifier, YAML policy loader, command-text policy evaluator, and approval record helper in `packages/policy`.
- JSON and Markdown receipt export in `packages/receipts`.
- YAML skill manifest parsing, canonical digesting, permission risk summaries, and Ed25519 signature verification in `packages/skills`.
- Adapter contract and registry, including `local-command`, `openclaw`, and `hermes` command-wrapper adapters.
- A local operator API for runs, timelines, approvals, and receipts.
- A static operator cockpit renderer in `apps/web` and shared UI rendering helpers in `packages/ui`.

RunWitness does not currently provide:

- Hard process sandboxing.
- Protected persistent policy hierarchy with workspace, user, and run precedence.
- Skill trust registry, install quarantine, or runtime skill permission enforcement.
- Deep native OpenClaw, Hermes, Codex, Claude Code, MCP, browser, CI, or deployment adapters.
- A bundled browser cockpit app or desktop shell.
- Secret brokering, output redaction, or multi-user RBAC.

## Policy Files

Goal: make policy explicit, versioned, reviewable, and explainable before turning policy into stronger enforcement.

Current state:

- RunWitness can load a YAML policy file from the CLI.
- `policy check` explains shell, filesystem, and network command-text decisions.
- `run --policy` records policy evaluation in approval events.
- The operator API can list and record approvals for existing runs.

Proposed policy layers:

1. Built-in defaults.
2. Workspace policy committed with the project.
3. User policy stored outside the project.
4. Run override supplied by CLI or approval service.

Initial policy areas:

- Shell command allow, ask, and deny rules.
- Filesystem read/write scopes.
- Protected paths that cannot be modified by normal runs.
- Network egress allowlists and upload restrictions.
- Secret scopes and redaction rules.
- Adapter permissions.
- Skill permissions.

Next required behavior:

- Record the policy source and digest in the ledger.
- Define precedence and conflict handling across policy layers.
- Keep a conservative default when policy files are missing or invalid.
- Add authenticated operator identity and durable approval queue semantics.

Out of scope for the first policy-file pass:

- Perfect nested-process tracing.
- Full network isolation.
- Centralized enterprise policy distribution.
- Protected policy-file storage.

## Signed Skill Manifests

Goal: make reusable capabilities inspectable before they are trusted.

Current state:

- RunWitness can parse a YAML manifest, canonicalize it, compute a digest, summarize permission risk, and verify an optional Ed25519 signature.
- The manifest type has an optional `signature` shape.

Next manifest fields should remain explicit:

- `name`
- `version`
- `description`
- `permissions`
- `entrypoints`
- `author`
- `signature`

Next required behavior:

- Validate manifests with a stricter schema.
- Verify signatures against a local trust registry.
- Record signature status in receipts.
- Refuse or quarantine skills with undeclared permissions, revoked signatures, or invalid manifests.

Security boundary:

- A parsed manifest is not a trusted skill.
- A signature only proves the manifest identity and integrity. Runtime permission enforcement still depends on policy and sandbox work.

## Adapter Roadmap

Goal: let RunWitness supervise different agent runtimes while keeping the ledger format stable.

Current adapters:

- `local-command` runs one local command and records stdout, stderr, exit code, duration, file changes, tests, and receipts.
- `openclaw` and `hermes` are command-wrapper adapter foundations that require configured external tools.

Adapter contract should include:

- Run start and stop.
- Event streaming.
- Artifact capture.
- Cancellation.
- Cleanup.
- Adapter capability declaration.
- Opaque-action markers when the adapter cannot expose nested details.

Recommended order:

1. Harden the local command adapter.
2. Add Codex or Claude Code adapter support.
3. Replace OpenClaw and Hermes command wrappers with richer native adapters where those tools expose events and artifacts.
4. Add MCP server run supervision.
5. Add browser automation receipts.
6. Add CI and deployment job adapters.

Adapter receipts should avoid flattening everything into one final summary. Keep raw adapter evidence available and link it from the RunWitness receipt.

## Web Operator Cockpit

Goal: make witnessed runs inspectable and approveable without starting with a broad admin surface.

Current state:

- `apps/web` renders a static operator cockpit document.
- `packages/ui` contains shared cockpit rendering helpers.
- `packages/core` exposes a local operator API.
- `apps/cli` exposes `runwitness serve`.

Recommended build order:

1. Read-only run list.
2. Timeline and receipt viewer.
3. File-change and command detail pages.
4. Live run monitor.
5. Approval inbox.
6. Policy explain and editor.
7. Authenticated operator actions.

The first cockpit release should not allow edits to policies, approvals, or runs until authentication and audit identity are in place.

## Sandbox Limits

Current sandbox package name means snapshot and diff utilities, not process isolation.

Implemented:

- Hash workspace files.
- Ignore common generated/runtime folders.
- Diff added, modified, and deleted files.
- Skip symlinks in the snapshot walker.

Limits:

- Commands run on the host.
- Child processes inherit the normal process environment unless the adapter changes it.
- Network access is not blocked.
- Writes are observed after the command finishes, not prevented before they happen.
- Nested tool activity is only visible if it affects captured command output, exit code, files, or receipts.
- Ignored folders are excluded from file-change evidence by design.

Next hardening:

- Environment filtering.
- Writable path allowlists.
- Protected path barriers.
- Network egress logging and allowlists.
- Output redaction.
- Rollback bundle creation.
- OS-specific isolation documentation and tests.
