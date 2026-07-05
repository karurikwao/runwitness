# Threat Model

RunWitness assumes autonomous agents can be useful and dangerous for the same reason: they can act on real systems.

## Assets

RunWitness should protect:

- source code
- secrets and credentials
- shell access
- local filesystem content
- network access
- user identity in connected tools
- run history and receipts
- policy configuration
- skill manifests and installed skills

## Threats

### Secret Exposure

An agent or skill may try to read or print credentials from paths such as `~/.ssh`, `~/.aws`, `.env`, browser profiles, shell history, or token stores.

MVP posture:

- classify common secret-reading commands as risky
- record approval decisions
- remove secret-like environment variables from sandboxed command environments unless explicitly allowed
- deny undeclared named-secret access in skill runtime permission checks
- check local secret access through workspace roles and explicit secret grants
- emit redacted secret broker descriptors, audit events, and receipt-shaped records
- keep command output in local receipts only

Future posture:

- durable encrypted secret vault
- broker integration across runtime paths
- output redaction
- deny-by-default secret scopes
- per-user secret isolation

Current limit:

- the local secret broker is in-memory and not a durable encrypted vault
- brokered credential handoff is not yet integrated across every runtime path
- command output redaction is not complete
- environment filtering covers launched command environments, not every possible host secret store

### Filesystem Writes

An agent may overwrite important files, delete a workspace, alter policy, or modify its own instructions.

MVP posture:

- track added, modified, and deleted files
- ignore generated dependency/build folders
- preflight common write/delete/move/copy/redirection command targets
- apply workspace path safety, write allowlists, and protected path deny lists when sandbox preflight is enabled
- optionally run commands in an isolated temporary workspace copy with a filtered environment
- create rollback baselines and rollback bundles
- preserve file-change evidence in receipts

Future posture:

- stronger process containment around writes
- automatic rollback application and recovery workflows
- broader nested-process tracing

Current limit:

- write preflight is heuristic and cannot detect every dynamic or nested write
- commands still run as host processes even when pointed at a temporary workspace
- ignored generated/runtime folders are intentionally excluded from file-change evidence
- rollback bundles are evidence and restore material, not a guaranteed automatic rollback system

### Shell Commands

Shell access can delete data, exfiltrate files, install malware, push broken code, or change machine state.

MVP posture:

- classify risky commands such as `rm -rf`, `git push`, env dumps, secret path access, and network upload tools
- block risky commands in non-interactive mode unless `--yes` pre-approval is supplied
- filter secret-like environment variables and PATH entries for sandboxed execution
- support `run --sandbox` to execute from a disposable temporary workspace copy
- record approvals in the ledger

Future posture:

- stronger sandboxed process runner
- command allowlists enforced across adapters and nested actions
- OS-specific process containment
- richer cancellation and cleanup

Current limit:

- the local command adapter runs commands on the host
- child processes inherit the filtered launched environment only when the sandbox path supplies one
- nested process behavior is not fully traced
- the temporary workspace is not a VM, container, or kernel isolation boundary

### Network Access

An agent may send local files or secrets to external hosts.

MVP posture:

- classify common exfiltration tools and commands as risky
- evaluate command-text network hosts against declared policy allow rules
- deny undeclared network hosts in skill runtime permission checks

Future posture:

- network allowlists
- per-run egress logging
- domain and IP policy

Current limit:

- network use is not blocked by RunWitness
- command-text host detection and skill checks do not provide OS-level network isolation

### Prompt Injection

A page, document, issue, pull request, or skill can contain instructions that try to override user intent or extract secrets.

MVP posture:

- document the risk
- keep receipts so injected behavior is visible after the fact

Future posture:

- untrusted-content boundaries
- promptware scanning
- model-facing policy reminders

### Bad Skills

Skills can hide malicious instructions or scripts.

MVP posture:

- parse, canonicalize, and digest YAML skill manifests
- summarize declared permission risk
- verify optional Ed25519 signatures over canonical manifests
- classify signatures as unsigned, self-signed, trusted, revoked, invalid, or unsupported against a local trust registry
- assess install versus quarantine decisions with concrete reasons
- check runtime shell, filesystem, network, and secret actions against declared permissions

Future posture:

- full skill execution broker that forces every action through permission checks
- install-time risk cards in the operator UI
- receipt linkage for skill identity, grants, signature status, and runtime permission outcomes

Current limit:

- signature verification proves manifest integrity only when a trusted key is supplied
- trust and runtime permission checks are primitives; they do not yet guarantee that every skill execution path is brokered

### Policy Tampering

An agent may try to weaken local policy, alter approval rules, or edit trust configuration before taking a risky action.

MVP posture:

- YAML policies can be loaded explicitly for CLI runs and policy checks
- policy hierarchy loading supports built-in, workspace, user, and run-override precedence through CLI run/check/explain paths and the policy package
- policy source and effective policy digests are available
- loaded policy source files are automatically added to protected paths by default
- policy decisions and approvals are recorded in the run ledger
- CLI-loaded policy lineage is recorded in receipts
- policy evaluation is explainable in command-line output and approval payloads
- optional operator auth records authenticated approval identity and rejects actor spoofing

Future posture:

- signed policy bundles for shared or managed environments
- policy lineage in every relevant UI, adapter, and managed runtime path

Current limit:

- policy-file digests are recorded for CLI-loaded policy events and receipts, but not every adapter-specific or non-CLI policy path
- protected policy paths are policy/sandbox checks, not tamper-proof filesystem storage

### Adapter Blind Spots

An adapter may hide nested actions or only expose a coarse final result.

MVP posture:

- the local command adapter records command text, exit code, stdout, stderr, duration, and workspace file diffs
- streamed local-command runs emit lifecycle, stdout, stderr, and finished events
- OpenClaw and Hermes command-wrapper adapters stream output and mark nested external activity as opaque

Future posture:

- adapter stream events normalized into ledger receipts
- richer native adapters for agent runtimes, browser automation, CI, and deployments
- cross-adapter cancellation and cleanup

## Non-Goals In The MVP

The MVP is not a hard security sandbox. It is an observability, approval, sandbox primitive, and receipt layer. It makes work visible and auditable first, then later phases can turn policies into stronger enforcement.

## Sandbox Limits

The current `packages/sandbox` package provides snapshot/diff utilities, write preflight, path safety, filtered environments, temporary workspace copies, and rollback bundle primitives. It does not provide OS-level process isolation.

Current limits:

- commands execute on the host
- filesystem writes are preflighted heuristically and detected after completion
- network access is not blocked
- secrets are filtered from command environments in common cases, and local broker audit/receipt records are redacted, but command output redaction is not complete
- process trees are not contained
- ignored folders are omitted from file-change receipts
- temporary workspaces reduce source-workspace writes but do not stop a process from using host capabilities

Future sandbox work should add stronger process containment, network egress controls, output redaction, automatic rollback workflows, and OS-specific isolation notes.
