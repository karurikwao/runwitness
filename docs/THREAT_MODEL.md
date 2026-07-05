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

### Network Access

An agent may send local files or secrets to external hosts.

MVP posture:

- classify common exfiltration tools and commands as risky

Future posture:

- network allowlists
- per-run egress logging
- domain and IP policy

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

- define a skill manifest foundation
- treat undeclared permissions as suspicious in future phases

Future posture:

- signed skills
- registry trust metadata
- install-time risk cards
- quarantine mode

## Non-Goals In The MVP

The MVP is not a hard security sandbox. It is an observability, approval, and receipt layer. It makes work visible and auditable first, then later phases can turn policies into stronger enforcement.
