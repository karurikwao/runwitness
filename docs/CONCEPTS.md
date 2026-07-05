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

A Policy determines whether an action is allowed, denied, or approval-required. The MVP includes shell-command risk classification. Later phases should add filesystem, network, secret, skill, schedule, and message policies.

## Skill

A Skill is a reusable capability. In RunWitness, skills must become declarative and inspectable:

- name
- version
- description
- permissions
- entrypoints
- author
- optional signature metadata

## Approval

An Approval is a recorded decision for a risky action. It is not a vague memory. It should include:

- action type
- requested action
- risk reasons
- decision
- timestamp
- actor or mode

## Adapter

An Adapter connects RunWitness to something that can do work. The first adapter runs local shell commands. Future adapters can supervise OpenClaw, Hermes, Codex, Claude Code, MCP servers, CI jobs, browser automation, and deployment systems.
