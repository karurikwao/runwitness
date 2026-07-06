# Launch Readiness Gaps

This document tracks what is still missing before a public GitHub alpha launch.

## Blockers

- **Final launch commit is missing.** The worktree contains modified and untracked launch assets. Review, stage, and commit before launch.
- **No GitHub remote is configured in this checkout.** Live repository state, Actions, Discussions, Wiki, Projects, vulnerability reporting, branch protection, and releases cannot be verified until a remote exists.
- **GitHub CLI is not authenticated in this checkout.** Live GitHub resources cannot be created or inspected until `gh auth login` is complete.
- **Security reporting route must be confirmed.** Enable GitHub private vulnerability reporting or confirm `security@runwitness.dev` works before inviting vulnerability reports.
- **GitHub Actions must pass on the launch branch.** Local `npm run verify` is strong evidence, but not a substitute for remote CI.

## High-Priority Prelaunch Tasks

- Publish the wiki pages from `wiki/`.
- Enable GitHub Discussions and publish starter posts from `docs/discussions/`.
- Create the `RunWitness Alpha Launch` project using `docs/GITHUB_PROJECT.md`.
- Run a clean clone verification after the repo is pushed.
- Add `repository`, `homepage`, and `bugs` fields to package manifests after the final GitHub URL exists.
- Create `v0.1.0-alpha.1` only after the launch commit is final.

## Not Launch-Blocking

- Real npm publishing can wait. The repo has package dry-run checks and publishable workspace scopes, but final package-page metadata and real publish should wait for ownership, provenance, and release automation review.
- More screenshots or terminal GIFs would help adoption, but the text quick start and examples are enough for alpha.
- Upstream-official listing can wait. RunWitness integrations are repo-official now; upstream-official status requires OpenClaw, Hermes/Nous, OpenAI, Anthropic, or another upstream to accept, list, or ship the integration.
