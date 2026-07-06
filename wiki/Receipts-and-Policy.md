# Receipts and Policy

RunWitness records a local SQLite run ledger and exports JSON and Markdown receipts.

Receipts summarize:

- run id, task, agent, status, and timestamps
- commands and exit codes
- file changes observed by RunWitness
- inferred test results
- approvals and policy decisions
- receipt export paths

Policies classify commands and other actions as allowed, denied, or approval-required. Use policy checks before risky runs:

```bash
npm run rw -- policy check --policy examples/quickstart-policy.yml -- npm publish --access public
```

Receipts are evidence, not magic. They prove what RunWitness could observe through the selected adapter and execution path.
