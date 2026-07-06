# Welcome to RunWitness

RunWitness is **autonomous agents with receipts**.

It is a local-first witness layer for agent work: agents can run tasks, while RunWitness records observable commands, policy decisions, approvals, file changes, test signals, timelines, and final receipts.

Good first things to try:

```bash
npm ci
npm run verify
npm run rw -- run --task "Example receipt" -- node -e "console.log('hello from RunWitness')"
```

What we are looking for during alpha:

- install friction
- confusing receipt output
- missing evidence in receipts
- policy defaults that feel too strict or too loose
- integration feedback from OpenClaw, Hermes, Codex, Claude-compatible, and other MCP host users

Please do not post secrets, private receipts, tokens, or private logs in public discussions.
