# Wiki Publishing Guide

The launch wiki source lives in `wiki/` so the content can be reviewed with the repo before it is copied or pushed to GitHub Wiki.

GitHub wikis are separate documentation spaces from the README and are intended for longer-form project material. The source pages here mirror GitHub Wiki page names:

- `wiki/Home.md`
- `wiki/Getting-Started.md`
- `wiki/Core-Concepts.md`
- `wiki/Integrations.md`
- `wiki/Receipts-and-Policy.md`
- `wiki/Security-Model.md`
- `wiki/Launch-FAQ.md`
- `wiki/Upstream-Official-Path.md`
- `wiki/_Sidebar.md`

## Publish Steps

After the GitHub repository exists and Wiki is enabled:

1. Create the first wiki page in the GitHub UI, or clone the wiki repository if it already exists.
2. Copy the files from `wiki/` into the wiki repository.
3. Commit and push the wiki repository.
4. Confirm the sidebar renders and every wiki link resolves.

Do not call integrations upstream-official in the wiki until the upstream project accepts, lists, or ships the integration.
