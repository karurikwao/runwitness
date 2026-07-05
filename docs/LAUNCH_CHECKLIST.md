# Launch Checklist

Use this checklist for the public GitHub alpha launch.

## Before Release

- [ ] Confirm the worktree is clean with `git status --short`.
- [ ] Run `npm ci` on a fresh checkout or clean install.
- [ ] Run `npm run verify`.
- [ ] Run `node dist/apps/cli/src/bin.js adapters list`.
- [ ] Run `node dist/apps/cli/src/bin.js sandbox container --image node:22-alpine --dry-run -- node --version`.
- [ ] Run one witnessed command and confirm JSON and Markdown receipts are written.
- [ ] Confirm README and docs say RunWitness has opt-in container sandbox execution but is not a universal OS sandbox for every run path.
- [ ] Confirm GitHub private vulnerability reporting or `security@runwitness.dev` is active before inviting security reports.
- [ ] Confirm no secrets, real tokens, private paths, or local receipt databases are committed.
- [ ] Confirm GitHub Actions `Verify` passes on the launch branch.

## Release Notes

- [ ] Copy the current alpha release notes from `docs/ALPHA_RELEASE_NOTES.md`.
- [ ] Include the demo command from README.
- [ ] Include the current safety limitations.
- [ ] Link to `SECURITY.md` for vulnerability reporting.

## Publishing Scope

- [ ] GitHub alpha launch is ready when CI, docs, examples, and security files are present.
- [ ] Do not publish npm packages until package metadata, `files`, access settings, provenance, and release automation are reviewed; use `npm run release:pack` for dry-run proof.
- [ ] Keep every workspace package `"private": true` until npm publishing is intentionally enabled.

## Post Launch

- [ ] Create a `v0.1.0-alpha.1` tag if the launch commit is final.
- [ ] Open issues for native adapter runtime validation, sandbox/orchestrator wiring, hosted RBAC views, and universal skill broker integration.
- [ ] Watch Discussions and issues for install friction in the first day.
