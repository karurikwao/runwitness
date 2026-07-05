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
- keep command output in local receipts only

Future posture:

- secret broker
- output redaction
- deny-by-default secret scopes
- per-user secret isolation

### Filesystem Writes

An agent may overwrite important files, delete a workspace, alter policy, or modify its own instructions.

MVP posture:

- track added, modified, and deleted files
- ignore generated dependency/build folders
- preserve file-change evidence in receipts

Future posture:

- write allowlists
- protected path barriers
- rollback bundles
- workspace snapshots

Current limit:

- file changes are observed after command execution, not prevented before writes happen
- ignored generated/runtime folders are intentionally excluded from file-change evidence

### Shell Commands

Shell access can delete data, exfiltrate files, install malware, push broken code, or change machine state.

MVP posture:

- classify risky commands such as `rm -rf`, `git push`, env dumps, secret path access, and network upload tools
- block risky commands in non-interactive mode unless `--yes` pre-approval is supplied
- record approvals in the ledger

Future posture:

- sandboxed process runner
- command allowlists
- environment filtering
- restricted PATH

Current limit:

- the local command adapter runs commands on the host
- child processes inherit the normal environment unless a future adapter or sandbox layer filters it
- nested process behavior is not fully traced

### Network Access

An agent may send local files or secrets to external hosts.

MVP posture:

- classify common exfiltration tools and commands as risky

Future posture:

- network allowlists
- per-run egress logging
- domain and IP policy

Current limit:

- network use is not blocked by RunWitness
- only command text patterns are classified today

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

Future posture:

- registry trust metadata
- install-time risk cards
- quarantine mode
- runtime skill permission enforcement

Current limit:

- signature verification proves manifest integrity only when a trusted key is supplied
- no trust registry, revocation list, install quarantine, or runtime permission enforcement exists yet

### Policy Tampering

An agent may try to weaken local policy, alter approval rules, or edit trust configuration before taking a risky action.

MVP posture:

- YAML policies can be loaded explicitly for CLI runs and policy checks
- policy decisions and approvals are recorded in the run ledger
- policy evaluation is explainable in command-line output and approval payloads

Future posture:

- policy file digests in every relevant ledger event
- protected policy paths
- signed policy bundles for shared or managed environments

Current limit:

- RunWitness does not yet provide protected policy storage, a precedence hierarchy, or policy-file digest recording

### Adapter Blind Spots

An adapter may hide nested actions or only expose a coarse final result.

MVP posture:

- the local command adapter records command text, exit code, stdout, stderr, duration, and workspace file diffs

Future posture:

- adapter capability declarations
- opaque-action markers in receipts
- richer native adapters for agent runtimes, browser automation, CI, and deployments

## Non-Goals In The MVP

The MVP is not a hard security sandbox. It is an observability, approval, and receipt layer. It makes work visible and auditable first, then later phases can turn policies into stronger enforcement.

## Sandbox Limits

The current `packages/sandbox` package provides snapshot and diff utilities. It does not isolate processes.

Current limits:

- commands execute on the host
- filesystem writes are detected after completion
- network access is not blocked
- secrets are not brokered or redacted
- process trees are not contained
- ignored folders are omitted from file-change receipts

Future sandbox work should add environment filtering, writable path allowlists, protected path barriers, network egress controls, output redaction, rollback bundles, and OS-specific isolation notes.
