# Security Model

RunWitness starts with observation, local policy decisions, approval records, sandbox preflight, scoped operator access, and receipts.

Current foundations include:

- opt-in Docker/Podman sandbox execution
- command and network preflight checks
- protected path handling
- rollback evidence
- hashed operator auth
- local secret vault and redaction primitives
- skill trust and permission checks

Current limits:

- normal witnessed commands still execute through host processes unless the operator chooses a container sandbox path
- network egress is not universally blocked outside container runtime modes
- nested agent activity is visible only when the adapter exposes it
- rollback is opt-in and not guaranteed across every failure mode
- hosted multi-user authorization is a foundation, not a complete SaaS trust boundary

Report vulnerabilities privately. Do not post exploit details, secrets, private receipts, or private logs in public discussions.
