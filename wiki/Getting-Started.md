# Getting Started

## Install

```bash
npm ci
npm run verify
```

## First Receipt

```bash
npm run rw -- run --task "Example receipt" -- node -e "console.log('hello from RunWitness')"
```

Receipts are written under `.runwitness/receipts` by default.

## Policy Check

```bash
npm run rw -- policy check --policy examples/quickstart-policy.yml -- node -e "console.log('ok')"
```

## Operator API

```bash
npm run rw -- serve --data-dir .runwitness --host 127.0.0.1 --port 8787
```

Use bearer auth for any shared or non-local operator surface. Do not paste private receipts, tokens, or secret-bearing logs into public issues or discussions.
