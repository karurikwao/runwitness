# RunWitness Concepts

RunWitness uses a small vocabulary so receipts, policies, adapters, and user interfaces can describe the same thing without translation.

## Run

A Run is one unit of user intent. It has:

- a stable `runId`
- a task description
- an agent or adapter name
- a workspace path
- a status
- a timeline of append-only events
- a final receipt

Example:

```txt
run-id: rw_20260704_001
task: Fix failing deploy
agent: local-command
status: completed
```

## Step

A Step is an observed action or milestone inside a run. Commands, approvals, test results, and file changes are all represented as events in the ledger.

## Receipt

A Receipt is the final proof object. It summarizes the run and points to the detailed event trail.

Receipts should answer:

- What was requested?
- What ran?
- What changed?
- What needed approval?
- What verification happened?
- Where can the evidence be found?

## Policy

A Policy determines whether an action is allowed, denied, or approval-required. The current foundation includes shell-command risk classification, YAML policy loading, shell allow/ask/deny overrides, and command-text checks for declared filesystem and network scopes.

Policy files are explicit, versioned, and explainable. Future hardening should add protected policy storage, workspace/user/run precedence, policy digests in ledger events, secret policy, adapter policy, skill policy, and enforcement that goes beyond command-text analysis.

## Skill

A Skill is a reusable capability. In RunWitness, skills must become declarative and inspectable:

- name
- version
- description
- permissions
- entrypoints
- author
- optional signature metadata

The current code parses manifests, canonicalizes them, computes a digest, summarizes permission risk, and verifies optional Ed25519 signatures. Trust registry checks, install quarantine, and runtime permission enforcement are future hardening work.

## Approval

An Approval is a recorded decision for a risky action. It is not a vague memory. It should include:

- action type
- requested action
- risk reasons
- decision
- timestamp
- actor or mode

## Adapter

An Adapter connects RunWitness to something that can do work. The current adapter registry includes `local-command` plus OpenClaw and Hermes command-wrapper foundations that require configured external tools. Future native adapters can supervise Codex, Claude Code, MCP servers, CI jobs, browser automation, and deployment systems.

Adapters should declare what they can expose. If an adapter cannot report nested actions, RunWitness should mark that portion of the run as opaque rather than implying full observability.
