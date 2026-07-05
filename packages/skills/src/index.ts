import YAML from "yaml";

export interface SkillManifest {
  name: string;
  version?: string;
  description?: string;
  permissions?: {
    filesystem?: {
      read?: string[];
      write?: string[];
    };
    network?: {
      allow?: string[];
    };
    shell?: {
      allow?: string[];
      ask?: string[];
      deny?: string[];
    };
    secrets?: string[];
  };
  entrypoints?: Record<string, string>;
  author?: string;
  signature?: {
    algorithm?: string;
    value?: string;
  };
}

export function parseSkillManifest(source: string): SkillManifest {
  const parsed = YAML.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Skill manifest must be a mapping");
  }

  const manifest = parsed as Partial<SkillManifest>;
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new Error("Skill manifest requires a non-empty name");
  }

  return {
    ...manifest,
    name: manifest.name.trim()
  };
}
