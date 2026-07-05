# RunWitness Receipts

`@runwitness/receipts` owns the portable proof artifacts for a RunWitness run.

It provides:

- `schemas/receipt.schema.json`: draft 2020-12 JSON Schema for exported receipt JSON.
- `buildReceipt(run, events)`: builds a receipt from a run record and ledger timeline.
- `renderReceiptMarkdown(receipt)`: renders a receipt as a Markdown proof report.
- `writeProofBundle(receipt, outDir)`: writes `<runId>.json` and `<runId>.md`.
- `sha256File(filePath)`: returns a SHA-256 digest for artifact metadata.

## Minimal Receipt Flow

```ts
import { buildReceipt, writeProofBundle } from "@runwitness/receipts";

const receipt = buildReceipt(run, events);
await writeProofBundle(receipt, ".runwitness/receipts");
```

The generated JSON uses camelCase fields such as `schemaVersion`, `runId`,
`generatedAt`, `exitCode`, and `durationMs`, matching
`schemas/receipt.schema.json`.

## Output

For a run id of `rw_20260705_010000_abc123`, `writeProofBundle()` creates:

```txt
.runwitness/receipts/
  rw_20260705_010000_abc123.json
  rw_20260705_010000_abc123.md
```

Receipts include summary counts for files, commands, tests, and approvals, plus
file-tracking disclosure for ignored snapshot folders.
