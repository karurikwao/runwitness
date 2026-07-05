# Contributing

RunWitness is a local-first witness layer for agent work. Contributions should keep the repository easy to audit: commands should be reproducible, safety claims should match the code, and changes that affect execution, policy, secrets, or receipts should include focused tests.

## Setup

Requirements:

- Node.js `>=22.19`
- npm `>=10`

Install dependencies from the lockfile:

```bash
npm ci
```

Use `npm ci` for normal contributor setup and CI parity. Use `npm install` only when you intentionally add, remove, or update dependencies and expect `package-lock.json` to change.

Common commands:

```bash
npm run check      # TypeScript typecheck
npm test           # Vitest test suite
npm run build      # Build TypeScript and sync package dist metadata
npm run verify     # check + test + build
```

Run the CLI during development with:

```bash
npm run rw -- --help
npm run rw -- run --task "Smoke test" -- node -e "console.log('ok')"
```

On Windows, if a command includes shell metacharacters such as `|`, `>`, `<`, or `&`, build first and invoke the generated CLI directly:

```bash
npm run build
node dist/apps/cli/src/bin.js run --task "Pipe-safe command" -- node -e "console.log('a|b')"
```

## Repository Layout

- `apps/cli`: command-line interface for witnessed runs.
- `apps/web`: operator cockpit rendering and related web surfaces.
- `packages/core`: run types, ledger, orchestration, identity, secrets, and operator API foundations.
- `packages/policy`: shell risk classification, policy loading, policy hierarchy, and approvals.
- `packages/receipts`: receipt and proof-bundle exporters.
- `packages/sandbox`: filesystem, environment, network preflight, isolation-plan, and rollback primitives.
- `packages/skills`: skill manifests, digesting, trust checks, and brokered runtime permission checks.
- `packages/adapters`: adapter contracts and command/stream wrappers for external tools.
- `packages/ui`: shared cockpit rendering helpers.
- `tests/`: cross-package integration and behavior tests.

## Coding Style

- Write TypeScript as ES modules using `NodeNext` resolution.
- Keep the code strict-type clean. Avoid `any`; prefer explicit interfaces, discriminated unions, and `unknown` plus narrowing for untrusted data.
- Use double quotes, semicolons, and existing import ordering patterns.
- Prefer type-only imports with `import type` when importing types.
- Keep public package exports intentional through each package `src/index.ts`.
- Keep path handling cross-platform. Use `node:path` helpers and avoid hard-coded path separators.
- Keep comments short and useful. Add them when they explain policy, security, audit, or non-obvious control flow.
- Keep changes scoped to the package or app that owns the behavior. Avoid unrelated refactors in feature or fix PRs.

## Tests

Run the full gate before opening a PR:

```bash
npm run verify
```

Add or update tests when changing behavior. Use the closest existing test location:

- Package behavior belongs under `packages/<name>/test/`.
- Cross-package or CLI-level behavior belongs under `tests/`.
- Web rendering behavior belongs under `apps/web/test/`.

Good tests for this repo usually assert observable witness behavior: policy decisions, ledger events, receipt contents, redaction, approval records, sandbox preflight results, adapter events, or rendered cockpit output. Avoid tests that only lock implementation details unless the detail is part of an audit or compatibility contract.

## Security-Sensitive Changes

Treat these areas as security-sensitive:

- Shell command classification and policy hierarchy.
- Approval, operator auth, identity, role, and workspace-scope logic.
- Secret vaults, secret grants, redaction, environment filtering, and receipt output.
- Sandbox preflight, path protection, network preflight, process isolation plans, and rollback.
- Adapter execution wrappers, structured event ingestion, and opaque nested activity reporting.
- Receipt schemas, ledger persistence, and proof-bundle exports.

For security-sensitive changes:

- Add focused tests for allow, ask, deny, redaction, and failure paths as applicable.
- Do not print, snapshot, or commit real secrets. Prefer environment variable names and redacted fixtures.
- Preserve auditability. If behavior changes what RunWitness records, update receipt or ledger tests.
- Be explicit about limits. Preflight checks, dry-run rollback, and isolation plans are not the same as guaranteed OS-level enforcement unless the code actually enforces that boundary.
- Update `docs/THREAT_MODEL.md`, `docs/ROADMAP.md`, or `docs/NEXT_PHASES.md` when the security model, guarantees, or remaining gaps change.

## Docs Truthfulness

Documentation is part of the product contract. Keep docs, examples, and README claims aligned with implemented behavior.

- Mark future work as planned, not implemented.
- Do not claim perfect sandboxing, network blocking, secret isolation, rollback coverage, or nested tool visibility unless tests and code support it.
- Keep command examples runnable from a fresh checkout after `npm ci`.
- Update docs in the same PR as behavior changes when user-facing commands, receipt fields, policy semantics, security posture, or repository layout change.
- Prefer concrete limitations over vague safety language.

## Pull Request Checklist

Before requesting review:

- [ ] Scope is focused and unrelated files are left alone.
- [ ] Dependencies were installed with `npm ci`; lockfile changes are intentional.
- [ ] `npm run verify` passes locally, or the PR clearly explains why it could not be run.
- [ ] New or changed behavior has focused tests.
- [ ] Security-sensitive paths include tests for failure and redaction paths where relevant.
- [ ] Docs and examples match the implemented behavior.
- [ ] Public claims distinguish implemented guarantees from planned hardening.
- [ ] No real secrets, tokens, local credentials, private receipts, or machine-specific artifacts are committed.
- [ ] Generated output under `dist/` is changed only when the build process requires it for the PR.
