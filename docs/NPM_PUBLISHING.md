# npm Publishing Preparation

RunWitness is prepared for npm packaging checks, but real npm publishing still requires an explicit manual release step.

## Current Safety Rules

- The root package must stay `"private": true`; publishable workspace packages are intentionally public-ready.
- The manual GitHub Actions workflow at `.github/workflows/release.yml` performs verification and `npm pack --dry-run`; it does not publish.
- Scoped workspace packages use `publishConfig.access: "public"` so a future release is explicit about public access.
- Package `files` allowlists include built `dist` output and package-specific assets only.

## Local Checks

Run the metadata and package-visibility guard:

```sh
npm run release:check
```

Run the full build-aware guard:

```sh
npm run release:check:built
```

Run a complete local packaging dry run:

```sh
npm run release:pack
```

`release:pack` builds the repo, checks built package entrypoints, and runs:

```sh
npm pack --workspaces --dry-run --json
```

## Manual Workflow

Use **Release Dry Run** from GitHub Actions when validating release readiness in CI. The workflow is only available through `workflow_dispatch`.

The `release_npm` input sets `RELEASE_NPM` for the checks, but the workflow still stops at `npm pack --dry-run`. It has `id-token: write` permission so future npm provenance publishing can be added deliberately without changing the trust boundary of the existing dry-run job.

## Before Any Real Publish

Do not add an `npm publish` step until all of these are true:

- Package ownership, access, and npm org settings are confirmed.
- Release versioning and changelog policy are agreed.
- `RELEASE_NPM=true` is intentionally set for the release path.
- The publish workflow uses npm provenance, for example with `npm publish --provenance`, from a manual workflow.
- The dry-run package contents are reviewed for every workspace package.
