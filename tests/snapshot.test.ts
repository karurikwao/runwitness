import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffSnapshots, snapshotWorkspace } from "../packages/sandbox/src/index.js";

let root: string;

async function writeFile(relativePath: string, contents: string): Promise<void> {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "runwitness-snapshot-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("workspace snapshots", () => {
  it("ignores dependency, git, build, coverage, receipt, and runtime folders", async () => {
    await writeFile("src/app.ts", "tracked");
    await writeFile("node_modules/pkg/index.js", "ignored");
    await writeFile(".git/config", "ignored");
    await writeFile("dist/app.js", "ignored");
    await writeFile("coverage/report.json", "ignored");
    await writeFile(".runwitness/runwitness.sqlite", "ignored");
    await writeFile("receipts/latest.json", "ignored");

    const snapshot = await snapshotWorkspace(root);
    expect([...snapshot.keys()]).toEqual(["src/app.ts"]);
  });

  it("reports added, modified, and deleted files", async () => {
    await writeFile("delete.txt", "delete");
    await writeFile("modify.txt", "before");
    const before = await snapshotWorkspace(root);

    await fs.rm(path.join(root, "delete.txt"));
    await writeFile("modify.txt", "after");
    await writeFile("add.txt", "add");

    const after = await snapshotWorkspace(root);
    expect(diffSnapshots(before, after).map((change) => `${change.type}:${change.path}`)).toEqual([
      "added:add.txt",
      "deleted:delete.txt",
      "modified:modify.txt"
    ]);
  });
});
