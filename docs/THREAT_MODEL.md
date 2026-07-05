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

Current posture:

- classify common secret-reading commands as risky
- record approval decisions
- remove secret-like environment variables from sandboxed command environments unless explicitly allowed
- deny undeclared named-secret access in skill runtime permission checks
- check local secret access through workspace roles and explicit secret grants
- emit redacted secret broker descriptors, audit events, and receipt-shaped records
- store encrypted local vault secrets with redacted descriptors
- redact configured secret values from command output event payloads

Future posture:

- broker integration across runtime paths
- automatic output redaction for brokered secrets
- deny-by-default secret scopes
- per-user secret isolation

Current limit:

- the local secret broker is in-memory; the encrypted vault is local storage, not a hosted per-user service
- hosted operator auth configs store token hashes and scopes, but they are not a full hosted RBAC administration product
- brokered credential handoff is not yet integrated across every runtime path
- command output redaction requires configured or brokered secret values
- environment filtering covers launched command environments, not every possible host secret store

### Filesystem Writes

An agent may overwrite important files, delete a workspace, alter policy, or modify its own instructions.

Current posture:

- track added, modified, and deleted files
- ignore generated dependency/build folders
- preflight common write/delete/move/copy/redirection command targets
- apply workspace path safety, write allowlists, and protected path deny lists when sandbox preflight is enabled
- optionally run commands in an isolated temporary workspace copy with a filtered environment
- create rollback baselines and rollback bundles
- apply rollback bundles in dry-run or real mode with path safety and before-file verification
- optionally create rollback evidence and dry-run/apply rollback after failed commands
- create auditable process-isolation plans for host, temp-workspace, container, Windows Job Object, and Linux namespace strategies
- preserve file-change evidence in receipts

Future posture:

- enforced process containment around writes
- broader rollback recovery workflows
- broader nested-process tracing

Current limit:

- write preflight is heuristic and cannot detect every dynamic or nested write
- commands still run as host processes even when pointed at a temporary workspace
- ignored generated/runtime folders are intentionally excluded from file-change evidence
- rollback orchestration is opt-in and not a guaranteed automatic rollback system
- process isolation planning records intent and capability; it does not enforce an OS boundary

### Shell Commands

Shell access can delete data, exfiltrate files, install malware, push broken code, or change machine state.

Current posture:

- classify risky commands such as `rm -rf`, `git push`, env dumps, secret path access, and network upload tools
- block risky commands in non-interactive mode unless `--yes` pre-approval is supplied
- filter secret-like environment variables and PATH entries for sandboxed execution
- support `run --sandbox` to execute from a disposable temporary workspace copy
- support command cancellation primitives through adapter abort signals
- support opt-in rollback bundles plus dry-run/apply behavior after failed commands
- record approvals in the ledger

Future posture:

- stronger sandboxed process runner
- command allowlists enforced across adapters and nested actions
- OS-specific process containment
- richer cleanup

Current limit:

- the local command adapter runs commands on the host
- child processes inherit the filtered launched environment only when the sandbox path supplies one
- nested process behavior is not fully traced
- the temporary workspace is not a VM, container, or kernel isolation boundary

### Network Access

An agent may send local files or secrets to external hosts.

Current posture:

- classify common exfiltration tools and commands as risky
- evaluate command-text network hosts against declared policy allow rules
- preflight command-text hosts through sandbox network allow/deny/default rules
- block denied network preflight before execution and allow ask-level network preflight only when pre-approved
- deny undeclared network hosts in skill runtime permission checks

Future posture:

- OS or runner-enforced network allowlists
- per-run egress logging
- domain and IP policy

Current limit:

- network use is not blocked by RunWitness
- command-text host detection and skill checks do not provide OS-level network isolation

### Prompt Injection

A page, document, issue, pull request, or skill can contain instructions that try to override user intent or extract secrets.

Current posture:

- document the risk
- keep receipts so injected behavior is visible after the fact

Future posture:

- untrusted-content boundaries
- promptware scanning
- model-facing policy reminders

### Bad Skills

Skills can hide malicious instructions or scripts.

Current posture:

- parse, canonicalize, and digest YAML skill manifests
- summarize declared permission risk
- verify optional Ed25519 signatures over canonical manifests
- classify signatures as unsigned, self-signed, trusted, revoked, invalid, or unsupported against a local trust registry
- assess install versus quarantine decisions with concrete reasons
- check runtime shell, filesystem, network, and secret actions against declared permissions
- record brokered allow/deny decisions for requested skill actions without executing untrusted code
- provide `runBrokeredSkill` so callers can require broker allow decisions before invoking a skill executor

Future posture:

- connect every real skill runner to the brokered-runner helper so actions must pass permission checks
- install-time risk cards in the operator UI
- receipt linkage for skill identity, grants, signature status, and runtime permission outcomes

Current limit:

- signature verification proves manifest integrity only when a trusted key is supplied
- trust and runtime permission checks plus the brokered-runner helper are primitives; they do not yet guarantee that every real skill execution path is brokered

### Policy Tampering

An agent may try to weaken local policy, alter approval rules, or edit trust configuration before taking a risky action.

Current posture:

- YAML policies can be loaded explicitly for CLI runs and policy checks
- policy hierarchy loading supports built-in, workspace, user, and run-override precedence through CLI run/check/explain paths and the policy package
- policy source and effective policy digests are available
- loaded policy source files are automatically added to protected paths by default
- policy decisions and approvals are recorded in the run ledger
- CLI-loaded policy lineage is recorded in receipts
- policy evaluation is explainable in command-line output and approval payloads
- optional operator auth records authenticated approval identity and rejects actor spoofing
- signed policy bundles can be verified against trusted/revoked local key fingerprints
- cockpit views surface loaded policy lineage and digests

Future posture:

- managed signed policy distribution
- policy lineage in every adapter and managed runtime path

Current limit:

- policy-file digests are recorded for CLI-loaded policy events, receipts, and cockpit views, but not every adapter-specific or non-CLI policy path
- protected policy paths are policy/sandbox checks, not tamper-proof filesystem storage

### Adapter Blind Spots

An adapter may hide nested actions or only expose a coarse final result.

Current posture:

- the local command adapter records command text, exit code, stdout, stderr, duration, and workspace file diffs
- streamed local-command runs emit lifecycle, stdout, stderr, and finished events
- OpenClaw and Hermes command-wrapper adapters stream output, normalize structured JSONL/SSE artifact/action events, and mark nested external activity as opaque
- OpenClaw and Hermes native HTTP/SSE adapters can consume configured start/event/cancel endpoints and normalize exposed runtime events
- generic browser automation, MCP, CI, and deployment command/JSONL wrapper adapters normalize structured events when emitted by the wrapped tool
- orchestrated non-local adapter stream events are recorded in the run ledger

Future posture:

- deeper runtime-validated native adapters for agent runtimes, browser automation, MCP, CI, and deployments
- cross-adapter cancellation and cleanup

## Non-Goals In The Current Foundation

The current foundation is not a hard security sandbox. It is an observability, approval, sandbox primitive, and receipt layer. It makes work visible and auditable first, then later phases can turn policies into stronger enforcement.

## Sandbox Limits

The current `packages/sandbox` package provides snapshot/diff utilities, write preflight, network command preflight, path safety, filtered environments, temporary workspace copies, process isolation planning, Docker/Podman sandbox invocation/execution helpers, rollback bundle primitives, and rollback apply helpers. The orchestrator can opt into rollback bundle creation and dry-run/apply behavior after failed commands. Normal witnessed runs do not use OS-level process isolation unless the operator chooses an enforced sandbox path.

Current limits:

- normal witnessed commands execute on the host
- filesystem writes are preflighted heuristically and detected after completion
- network access is preflighted from command text for normal runs and delegated to Docker/Podman network modes for container sandbox runs
- secrets are filtered from command environments in common cases, local broker/vault audit records are redacted, and configured command-output redaction is available
- process trees are not contained for normal runs
- ignored folders are omitted from file-change receipts
- temporary workspaces reduce source-workspace writes but do not stop a process from using host capabilities
- container sandbox execution depends on the selected runtime, image, mounts, and network mode
- rollback orchestration is opt-in and cannot guarantee recovery from every failure mode

Future sandbox work should wire enforced runners into more orchestrated paths, add network egress controls beyond container runtime modes, and broaden rollback workflows.
