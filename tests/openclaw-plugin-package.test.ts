import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "integrations", "openclaw-runwitness-plugin");

describe("OpenClaw RunWitness plugin package", () => {
  it("ships the metadata OpenClaw expects for a native tool plugin", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8")) as {
      openclaw?: { extensions?: string[] };
      peerDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
      files?: string[];
    };
    const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, "openclaw.plugin.json"), "utf8")) as {
      id?: string;
      contracts?: { tools?: string[] };
    };

    expect(packageJson.openclaw?.extensions).toEqual(["./dist/src/index.js"]);
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist", "openclaw.plugin.json"]));
    expect(packageJson.dependencies).toMatchObject({
      "@runwitness/mcp-server": "0.1.0",
      typebox: expect.any(String)
    });
    expect(packageJson.peerDependencies?.openclaw).toBe(">=2026.5.17");
    expect(manifest).toMatchObject({
      id: "runwitness",
      contracts: {
        tools: [
          "runwitness_policy_check",
          "runwitness_sandbox_plan",
          "runwitness_run_command",
          "runwitness_read_run",
          "runwitness_list_runs"
        ]
      }
    });
  });

  it("keeps source tool names aligned with the manifest", async () => {
    const source = await fs.readFile(path.join(pluginRoot, "src", "index.ts"), "utf8");
    const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, "openclaw.plugin.json"), "utf8")) as {
      contracts?: { tools?: string[] };
    };

    for (const toolName of manifest.contracts?.tools ?? []) {
      expect(source).toContain(`name: "${toolName}"`);
    }
    expect(source).toContain("defineToolPlugin");
    expect(source).toContain("callRunWitnessTool");
  });
});
