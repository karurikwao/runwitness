# RunWitness Examples

These examples are safe to run in a local checkout and are designed for the alpha launch.

## Quick Receipt

```bash
npm run rw -- run --task "Example receipt" -- node -e "console.log('hello from RunWitness')"
```

Then inspect:

```bash
npm run rw -- timeline --run <run-id>
```

Receipts are written under `.runwitness/receipts`.

## Policy Check

Use `examples/quickstart-policy.yml` to deny publishing commands, protect sensitive local paths, and allow localhost-style network examples. Other network hosts still require approval by default.

```bash
npm run rw -- policy check --policy examples/quickstart-policy.yml -- npm publish --access public
npm run rw -- policy check --policy examples/quickstart-policy.yml -- node -e "console.log('safe')"
```

## Guarded Run

```bash
npm run rw -- run --policy examples/quickstart-policy.yml --task "Guarded example" -- node -e "console.log('safe')"
```

On Windows, build first and call `node dist/apps/cli/src/bin.js` directly for commands containing shell metacharacters such as `|`, `>`, `<`, or `&`.
