import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const workspaces = [
  ["apps", "cli"],
  ["apps", "desktop"],
  ["apps", "web"],
  ["packages", "adapters"],
  ["packages", "core"],
  ["packages", "policy"],
  ["packages", "receipts"],
  ["packages", "sandbox"],
  ["packages", "skills"],
  ["packages", "mcp-server"],
  ["packages", "ui"],
  ["integrations", "openclaw-runwitness-plugin"]
];

for (const [group, name] of workspaces) {
  const source = path.join(root, "dist", group, name, "src");
  const target = path.join(root, group, name, "dist", "src");
  await rm(path.dirname(target), { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}
