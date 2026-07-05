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

A Policy determines whether an action is allowed, denied, or approval-required. The current foundation includes shell-command risk classification, YAML policy loading, shell allow/ask/deny overrides, command-text checks for declared filesystem and network scopes, protected path checks, policy hierarchy loading, source/effective-policy digests, signed policy bundle primitives, and explain output.

Policy files are explicit, versioned, and explainable. The policy package can merge built-in, workspace, user, and run-override layers, and the CLI can carry that lineage into run events and receipts. Policy bundles add signed, digestible layer envelopes for managed distribution. Future hardening should add broader secret/adapter/skill policy integration and controls beyond command-text analysis.

## Skill

A Skill is a reusable capability. In RunWitness, skills must become declarative and inspectable:

- name
- version
- description
- permissions
- entrypoints
- author
- optional signature metadata

The current code parses manifests, canonicalizes them, computes a digest, summarizes permission risk, verifies optional Ed25519 signatures, checks a local trust registry, assesses install versus quarantine, and checks runtime shell, filesystem, network, and named-secret actions against declared permissions.

The skill execution broker records allow/deny decisions for requested shell, filesystem, network, and secret actions without executing untrusted code. Future hardening should connect every real skill runtime path to that broker.

## Approval

An Approval is a recorded decision for a risky action. It is not a vague memory. It should include:

- action type
- requested action
- risk reasons
- decision
- timestamp
- actor or mode

## Adapter

An Adapter connects RunWitness to something that can do work. The current adapter registry includes streamed `local-command` plus OpenClaw and Hermes command-wrapper foundations that require configured external tools.

Adapters should declare what they can expose. If an adapter cannot report nested actions, RunWitness marks that portion of the run as opaque rather than implying full observability. Future native adapters can supervise Codex, Claude Code, MCP servers, CI jobs, browser automation, and deployment systems.

## Sandbox

The Sandbox package is a local hardening toolkit, not a perfect isolation boundary. It provides workspace snapshots, diffs, command write preflight, network command preflight, safe path resolution, protected path checks, filtered environments, isolated temporary workspace copies, rollback bundle primitives, and rollback apply/dry-run helpers.

Commands still run as host processes. Network access is detected from command text but not blocked at the OS boundary, nested process tracing is incomplete, and rollback helpers are not the same as guaranteed automatic rollback.

## Operator

An Operator is a human or service principal inspecting runs and deciding approvals. The local operator API can list runs, timelines, receipts, and pending approvals. It can optionally require bearer tokens with viewer, approver, or admin roles and user/workspace scopes.

The live cockpit renderer can poll the API, subscribe to event snapshots, and post approval decisions. It is still a local cockpit foundation rather than a complete hosted multi-user control plane.

## Identity And Secrets

The identity primitives model users, workspace roles, workspace grants, secret grants, and access decisions. They are currently in-memory building blocks for checking whether a user can read, write, or administer a workspace or named secret.

The local secret broker stores local in-memory secret values, returns redacted descriptors, checks identity grants before describe/read/write/delete actions, and emits redacted audit events plus receipt-shaped records. The encrypted local secret vault persists redacted descriptors plus AES-GCM encrypted values on disk, and redaction helpers can scrub configured secrets from command output. These are still not a universal runtime credential boundary.
