# GitHub Remote Setup

This checkout is currently prepared with repo-local launch assets, but live GitHub resources require a remote repository and authenticated GitHub CLI session.

## Current Local Constraint

At the time this guide was added:

- `git remote -v` returned no configured remote.
- `gh auth status` reported no authenticated GitHub host.

Because of that, Wiki, Discussions, Projects, Actions, releases, private vulnerability reporting, and branch protection cannot be verified from this checkout yet.

## Create Or Attach The Repository

Authenticate first:

```powershell
gh auth login
gh auth refresh -s project
```

Create a new GitHub repo from this local checkout:

```powershell
gh repo create OWNER/REPO --source . --private --push
```

Or attach an existing empty remote:

```powershell
git remote add origin https://github.com/OWNER/REPO.git
git push -u origin main
```

Replace `main` if the launch branch uses a different name.

## Enable Launch Surfaces

```powershell
gh repo edit OWNER/REPO --enable-wiki --enable-discussions --enable-projects --enable-issues
```

Then confirm:

- GitHub Actions `Verify` passes on the launch branch.
- Wiki pages from `wiki/` are published.
- Discussion categories exist for the forms under `.github/DISCUSSION_TEMPLATE/`.
- Private vulnerability reporting or `security@runwitness.dev` is active.

## Create Project

```powershell
gh project create --owner OWNER --title "RunWitness Alpha Launch"
gh project link PROJECT_NUMBER --owner OWNER --repo REPO
```

Use `docs/GITHUB_PROJECT.md` and `docs/project-launch-items.csv` as the board definition and initial item list.

## Publish Discussions

Use the starter posts in `docs/discussions/`.

If the GitHub CLI discussion extension is available after auth:

```powershell
gh discussion create --repo OWNER/REPO --category "Announcements" --title "Welcome to RunWitness Alpha" --body-file docs/discussions/000-welcome-to-runwitness.md
```

Repeat for the other starter posts after confirming category names.
