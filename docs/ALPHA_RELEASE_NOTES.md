# RunWitness Alpha Release Notes

RunWitness is launching as an alpha foundation for autonomous agents with receipts.

## What Works Today

- Local witnessed command runs with a SQLite ledger.
- Append-only run timelines with command, approval, file-change, test-result, adapter, and receipt events.
- JSON and Markdown proof bundles under `.runwitness/receipts`.
- YAML policy loading with layered workspace, user, and run-override precedence.
- Signed policy bundle primitives and policy lineage in receipts.
- Skill manifest parsing, digesting, signature verification, trust checks, runtime permission checks, and brokered skill-runner primitives.
- Sandbox primitives for write preflight, network preflight, filtered environments, temporary workspaces, process isolation planning, and rollback bundles.
- Opt-in rollback dry-run/apply behavior after failed commands.
- Streaming local, OpenClaw, Hermes, browser automation, MCP, CI, and deployment wrapper adapters.
- Local operator API and live cockpit renderer with scoped bearer-token auth.
- Local identity, secret broker, encrypted vault, and output redaction primitives.

## Try It

```bash
npm ci
npm run verify
npm run rw -- run --task "Hello receipt" -- node -e "console.log('hello from RunWitness')"
```

Receipts are written to `.runwitness/receipts`.

## Current Limits

- RunWitness is not a hard OS sandbox, container, VM, or kernel isolation boundary.
- Network access is preflighted from command text, not blocked at the OS layer.
- Nested process and nested-agent activity is only visible when an adapter exposes it.
- Rollback is opt-in and cannot guarantee recovery across every failure mode.
- The cockpit is local-first, not a hosted multi-user product or fully bundled app.
- Policy write controls remain disabled while validation and audit identity mature.
- Secret brokering and skill enforcement are primitives, not a universal runtime boundary yet.

## Recommended Launch Tag

`v0.1.0-alpha.1`
