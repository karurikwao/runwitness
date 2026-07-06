# GitHub Project: RunWitness Alpha Launch

Use this as the launch board plan once the GitHub repository and project are available.

## Views

- **Launch Board**: grouped by Status.
- **Risk Review**: filtered to Priority = P0 or Risk = Security/Release.
- **Integrations**: filtered to Area = Integrations.
- **Community**: filtered to Area = Discussions, Docs, or Support.

## Fields

- **Status**: Backlog, Ready, In Progress, Blocked, Done.
- **Priority**: P0, P1, P2, Later.
- **Area**: Release, Docs, Security, Integrations, Packaging, Community, Runtime.
- **Type**: Issue, Task, Discussion, External Submission.
- **Risk**: Security, Release, Adoption, Compatibility, None.

## Initial Items

| Title | Priority | Area | Type | Risk | Status |
| --- | --- | --- | --- | --- | --- |
| Confirm public repo remote and default branch protection | P0 | Release | Task | Release | Ready |
| Confirm GitHub Discussions is enabled and categories exist | P0 | Community | Task | Adoption | Ready |
| Publish wiki pages from `wiki/` | P0 | Docs | Task | Adoption | Ready |
| Run `npm ci` and `npm run verify` on a fresh clone | P0 | Release | Task | Release | Ready |
| Confirm GitHub Actions Verify passes on the launch branch | P0 | Release | Task | Release | Ready |
| Review package ownership before real npm publish | P0 | Packaging | Task | Release | Ready |
| Confirm private vulnerability reporting route | P0 | Security | Task | Security | Ready |
| Validate OpenClaw plugin with current OpenClaw CLI | P1 | Integrations | Task | Compatibility | Done |
| Publish starter Discussions from `docs/discussions` | P1 | Community | Discussion | Adoption | Ready |
| Open upstream-listing tracking issues for OpenClaw, Hermes, Codex, and Claude | P1 | Integrations | External Submission | Compatibility | Ready |
| Add receipt-flow GIF to README and launch page | P1 | Docs | Task | Adoption | Done |
| Verify launch GIF on desktop and mobile | P1 | Docs | Task | Adoption | Ready |
| Publish a visual walkthrough update in Discussions | P2 | Community | Discussion | Adoption | Backlog |
| Collect early receipt-flow examples for future GIFs | P2 | Community | Task | Adoption | Backlog |
| Add screenshots or short terminal GIFs for first receipt flow | P2 | Docs | Task | Adoption | Backlog |
| Add real-runtime compatibility reports from early OpenClaw/Hermes users | P2 | Integrations | Task | Compatibility | Backlog |

## Launch Definition Of Done

- README, wiki, and launch docs avoid upstream-official overclaims.
- Verify workflow passes on GitHub.
- Security reporting path is active.
- First three starter discussions are posted.
- At least one receipt-producing command is documented and tested on a clean checkout.
