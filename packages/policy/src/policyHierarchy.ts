import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  parsePolicy,
  type CommandPolicy,
  type ProtectedPathDeclaration,
} from "./policy.js";
import { normalizeShellCommand } from "./shellRiskClassifier.js";

export type PolicyLayerKind = "built-in" | "workspace" | "user" | "run-override";

export const POLICY_LAYER_PRECEDENCE = [
  "built-in",
  "workspace",
  "user",
  "run-override",
] as const satisfies readonly PolicyLayerKind[];

export interface PolicySourceDigest {
  algorithm: "sha256";
  value: string;
}

export interface CommandPolicyDigest extends PolicySourceDigest {
  canonical: string;
}

export interface PolicyLayerSource {
  kind: PolicyLayerKind;
  source: string;
  label?: string;
}

export interface PolicyLayerInput {
  kind: PolicyLayerKind;
  source?: string;
  path?: string;
  optional?: boolean;
  label?: string;
  protectPath?: boolean;
}

export interface LoadPolicyHierarchyInput {
  layers?: PolicyLayerInput[];
  builtinPolicy?: string;
  workspacePolicyPath?: string;
  userPolicyPath?: string;
  runOverridePolicyPath?: string;
  runOverrideSource?: string;
  workspaceRoot?: string;
}

export interface LoadedPolicyLayer {
  kind: PolicyLayerKind;
  label: string;
  precedence: number;
  path?: string;
  digest: PolicySourceDigest;
  sourceLength: number;
  protectedPaths: ProtectedPathDeclaration[];
}

export interface PolicyHierarchyLayerExplanation extends LoadedPolicyLayer {
  digest: PolicySourceDigest;
}

export interface PolicyHierarchyExplanation {
  precedence: PolicyLayerKind[];
  policyDigest: CommandPolicyDigest;
  layers: PolicyHierarchyLayerExplanation[];
  effective: {
    shell: {
      allow: string[];
      ask: string[];
      deny: string[];
    };
    filesystem: {
      read: string[];
      write: string[];
    };
    network: {
      allow: string[];
    };
    protected: {
      paths: string[];
    };
    defaults: CommandPolicy["defaults"];
    classifier: CommandPolicy["classifier"];
  };
  notes: string[];
}

export interface LoadedPolicyHierarchy {
  policy: CommandPolicy;
  layers: LoadedPolicyLayer[];
  digest: CommandPolicyDigest;
  precedence: PolicyLayerKind[];
  protectedSourcePaths: ProtectedPathDeclaration[];
  explanation: PolicyHierarchyExplanation;
}

type JsonScalar = string | number | boolean | null;
type CanonicalJson = JsonScalar | CanonicalJson[] | { [key: string]: CanonicalJson };
type RawPolicyLayer = Record<string, unknown>;

interface LoadedPolicyLayerWithRaw extends LoadedPolicyLayer {
  raw: RawPolicyLayer;
}

export async function loadPolicyHierarchy(input: LoadPolicyHierarchyInput = {}): Promise<LoadedPolicyHierarchy> {
  const layerInputs = normalizeLayerInputs(input);
  const loadedLayers: LoadedPolicyLayerWithRaw[] = [];

  for (const layerInput of sortPolicyLayers(layerInputs)) {
    const loaded = await loadPolicyLayer(layerInput, input.workspaceRoot);
    if (loaded !== undefined) {
      loadedLayers.push(loaded);
    }
  }

  const mergedRaw = mergeRawPolicyLayers(loadedLayers);
  const protectedSourcePaths = loadedLayers.flatMap((layer) => layer.protectedPaths);
  addProtectedPathsToRawPolicy(mergedRaw, protectedSourcePaths);

  const policy = parsePolicy(YAML.stringify(mergedRaw));
  const digest = digestCommandPolicy(policy);
  const hierarchyBase = {
    policy,
    layers: loadedLayers.map(({ raw: _raw, ...layer }) => layer),
    digest,
    precedence: [...POLICY_LAYER_PRECEDENCE],
    protectedSourcePaths,
  };

  return {
    ...hierarchyBase,
    explanation: explainPolicyHierarchy(hierarchyBase),
  };
}

export function mergePolicyLayers(layers: readonly PolicyLayerSource[]): CommandPolicy {
  const rawLayers = sortPolicyLayers(layers).map((layer) => ({
    kind: layer.kind,
    raw: parseRawPolicyLayer(layer.source, layer.label ?? layer.kind),
  }));
  return parsePolicy(YAML.stringify(mergeRawPolicyLayers(rawLayers)));
}

export function digestPolicySource(source: string): PolicySourceDigest {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(source, "utf8").digest("hex"),
  };
}

export function digestCommandPolicy(policy: CommandPolicy): CommandPolicyDigest {
  const canonical = canonicalizeCommandPolicy(policy);
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(canonical, "utf8").digest("hex"),
    canonical,
  };
}

export function canonicalizeCommandPolicy(policy: CommandPolicy): string {
  return stableStringify(toCanonicalJson(policy));
}

export function explainPolicyHierarchy(hierarchy: {
  policy: CommandPolicy;
  layers: readonly LoadedPolicyLayer[];
  digest: CommandPolicyDigest;
  precedence: readonly PolicyLayerKind[];
}): PolicyHierarchyExplanation {
  const policy = hierarchy.policy;
  return {
    precedence: [...hierarchy.precedence],
    policyDigest: hierarchy.digest,
    layers: hierarchy.layers.map((layer) => ({
      ...layer,
      protectedPaths: layer.protectedPaths.map((protectedPath) => ({ ...protectedPath })),
    })),
    effective: {
      shell: {
        allow: policy.shell.allow.map((rule) => rule.match),
        ask: policy.shell.ask.map((rule) => rule.match),
        deny: policy.shell.deny.map((rule) => rule.match),
      },
      filesystem: {
        read: policy.filesystem.read.map((scope) => scope.path),
        write: policy.filesystem.write.map((scope) => scope.path),
      },
      network: {
        allow: policy.network.allow.map((allow) => allow.host),
      },
      protected: {
        paths: (policy.protected?.paths ?? []).map((scope) => scope.path),
      },
      defaults: { ...policy.defaults },
      classifier: { ...policy.classifier },
    },
    notes: [
      "Layers are applied in built-in, workspace, user, then run-override precedence.",
      "Scalar policy fields and filesystem/network lists use the highest-precedence layer that declares the field.",
      "Shell rules are additive; exact command pattern conflicts are resolved by the highest-precedence layer.",
      "Protected paths accumulate across layers and include loaded policy source files.",
    ],
  };
}

function normalizeLayerInputs(input: LoadPolicyHierarchyInput): PolicyLayerInput[] {
  const configuredLayers = input.layers ?? [
    ...(input.workspacePolicyPath
      ? [{ kind: "workspace" as const, path: input.workspacePolicyPath, label: "Workspace policy" }]
      : []),
    ...(input.userPolicyPath ? [{ kind: "user" as const, path: input.userPolicyPath, label: "User policy" }] : []),
    ...(input.runOverridePolicyPath
      ? [{ kind: "run-override" as const, path: input.runOverridePolicyPath, label: "Run override policy" }]
      : []),
    ...(input.runOverrideSource
      ? [{ kind: "run-override" as const, source: input.runOverrideSource, label: "Run override policy" }]
      : []),
  ];

  if (configuredLayers.some((layer) => layer.kind === "built-in")) {
    return configuredLayers;
  }

  return [
    {
      kind: "built-in",
      source: input.builtinPolicy ?? "",
      label: "Built-in defaults",
      protectPath: false,
    },
    ...configuredLayers,
  ];
}

function sortPolicyLayers<T extends { kind: PolicyLayerKind }>(layers: readonly T[]): T[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => {
      const precedenceDelta = policyLayerPrecedence(left.layer.kind) - policyLayerPrecedence(right.layer.kind);
      return precedenceDelta === 0 ? left.index - right.index : precedenceDelta;
    })
    .map((entry) => entry.layer);
}

async function loadPolicyLayer(
  layer: PolicyLayerInput,
  workspaceRoot: string | undefined,
): Promise<LoadedPolicyLayerWithRaw | undefined> {
  if (layer.source !== undefined && layer.path !== undefined) {
    throw new Error(`Policy layer ${layer.kind} cannot specify both source and path`);
  }

  const resolvedPath = layer.path ? path.resolve(layer.path) : undefined;
  const source = layer.source ?? (resolvedPath ? await readLayerFile(resolvedPath, layer) : "");
  if (source === undefined) {
    return undefined;
  }

  const label = layer.label ?? layer.kind;
  const raw = parseRawPolicyLayer(source, label);
  const protectedPaths =
    resolvedPath && layer.protectPath !== false
      ? createProtectedSourcePathDeclarations({
          resolvedPath,
          originalPath: layer.path,
          workspaceRoot,
          kind: layer.kind,
        })
      : [];

  return {
    kind: layer.kind,
    label,
    precedence: policyLayerPrecedence(layer.kind),
    ...(resolvedPath ? { path: resolvedPath } : {}),
    digest: digestPolicySource(source),
    sourceLength: source.length,
    protectedPaths,
    raw,
  };
}

async function readLayerFile(filePath: string, layer: PolicyLayerInput): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (layer.optional && isFileNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

function parseRawPolicyLayer(source: string, label: string): RawPolicyLayer {
  const parsed = YAML.parse(source) as unknown;
  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (!isRecord(parsed)) {
    throw new Error(`Policy layer ${label} must be a YAML mapping`);
  }

  return parsed;
}

function mergeRawPolicyLayers(layers: readonly { kind: PolicyLayerKind; raw: RawPolicyLayer }[]): RawPolicyLayer {
  const merged: RawPolicyLayer = { version: 1 };
  const protectedPaths: unknown[] = [];

  for (const layer of sortPolicyLayers(layers)) {
    const raw = layer.raw;
    if (raw.version !== undefined) {
      merged.version = raw.version;
    }

    mergeShellPolicy(merged, raw.shell, layer.kind);
    mergeFilesystemPolicy(merged, raw.filesystem, protectedPaths, layer.kind);
    mergeNetworkPolicy(merged, raw.network, layer.kind);
    mergeRecordPolicy(merged, "defaults", raw.defaults, layer.kind);
    mergeRecordPolicy(merged, "classifier", raw.classifier, layer.kind);
    mergeProtectedPolicy(raw.protected, protectedPaths, layer.kind);
  }

  addProtectedPathsToRawPolicy(merged, protectedPaths);
  return merged;
}

function mergeShellPolicy(merged: RawPolicyLayer, value: unknown, kind: PolicyLayerKind): void {
  if (value === undefined) {
    return;
  }

  const source = requireRecord(value, `${kind}.shell`);
  const target = ensureRecord(merged, "shell");
  mergeShellRuleList(target, "allow", source.allow, kind);
  mergeShellRuleList(target, "ask", source.ask, kind);
  mergeShellRuleList(target, "deny", source.deny, kind);
}

function mergeShellRuleList(
  target: Record<string, unknown>,
  decision: "allow" | "ask" | "deny",
  value: unknown,
  kind: PolicyLayerKind,
): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${kind}.shell.${decision} must be a list`);
  }

  for (const entry of value) {
    const key = commandRuleMergeKey(entry);
    if (key !== undefined) {
      removeShellRuleByKey(target, key);
    }
    const targetRules = ensureArray(target, decision);
    targetRules.push(clonePlain(entry));
  }
}

function removeShellRuleByKey(shell: Record<string, unknown>, key: string): void {
  for (const decision of ["allow", "ask", "deny"] as const) {
    const rules = shell[decision];
    if (!Array.isArray(rules)) {
      continue;
    }
    shell[decision] = rules.filter((entry) => commandRuleMergeKey(entry) !== key);
  }
}

function mergeFilesystemPolicy(
  merged: RawPolicyLayer,
  value: unknown,
  protectedPaths: unknown[],
  kind: PolicyLayerKind,
): void {
  if (value === undefined) {
    return;
  }

  const source = requireRecord(value, `${kind}.filesystem`);
  const target = ensureRecord(merged, "filesystem");
  setArrayPolicyField(target, "read", source.read, `${kind}.filesystem.read`);
  setArrayPolicyField(target, "write", source.write, `${kind}.filesystem.write`);
  mergeProtectedPathList(protectedPaths, source.protected, `${kind}.filesystem.protected`);
}

function mergeNetworkPolicy(merged: RawPolicyLayer, value: unknown, kind: PolicyLayerKind): void {
  if (value === undefined) {
    return;
  }

  const source = requireRecord(value, `${kind}.network`);
  const target = ensureRecord(merged, "network");
  setArrayPolicyField(target, "allow", source.allow, `${kind}.network.allow`);
}

function mergeRecordPolicy(
  merged: RawPolicyLayer,
  key: "defaults" | "classifier",
  value: unknown,
  kind: PolicyLayerKind,
): void {
  if (value === undefined) {
    return;
  }

  const source = requireRecord(value, `${kind}.${key}`);
  const target = ensureRecord(merged, key);
  for (const [field, fieldValue] of Object.entries(source)) {
    target[field] = clonePlain(fieldValue);
  }
}

function mergeProtectedPolicy(value: unknown, protectedPaths: unknown[], kind: PolicyLayerKind): void {
  if (value === undefined) {
    return;
  }

  const source = requireRecord(value, `${kind}.protected`);
  mergeProtectedPathList(protectedPaths, source.paths, `${kind}.protected.paths`);
}

function addProtectedPathsToRawPolicy(merged: RawPolicyLayer, protectedPaths: readonly unknown[]): void {
  if (protectedPaths.length === 0) {
    return;
  }

  const protectedPolicy = ensureRecord(merged, "protected");
  const targetPaths = ensureArray(protectedPolicy, "paths");
  mergeProtectedPathList(targetPaths, protectedPaths, "protected.paths");
}

function mergeProtectedPathList(target: unknown[], value: unknown, field: string): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be a list`);
  }

  for (const entry of value) {
    const key = pathDeclarationMergeKey(entry);
    if (key !== undefined) {
      const existingIndex = target.findIndex((candidate) => pathDeclarationMergeKey(candidate) === key);
      if (existingIndex >= 0) {
        target.splice(existingIndex, 1);
      }
    }
    target.push(clonePlain(entry));
  }
}

function setArrayPolicyField(target: Record<string, unknown>, key: string, value: unknown, field: string): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be a list`);
  }

  target[key] = clonePlain(value);
}

function createProtectedSourcePathDeclarations(input: {
  resolvedPath: string;
  originalPath: string | undefined;
  workspaceRoot: string | undefined;
  kind: PolicyLayerKind;
}): ProtectedPathDeclaration[] {
  const reason = `Policy source path (${input.kind})`;
  const paths = new Map<string, ProtectedPathDeclaration>();
  const addPath = (policyPath: string | undefined) => {
    if (!policyPath || policyPath.trim().length === 0) {
      return;
    }
    const normalized = toPolicyPath(policyPath);
    paths.set(normalized.toLowerCase(), { path: normalized, reason });
  };

  addPath(input.resolvedPath);
  if (input.originalPath && !path.isAbsolute(input.originalPath)) {
    addPath(input.originalPath);
  }

  if (input.workspaceRoot) {
    const relativePath = path.relative(path.resolve(input.workspaceRoot), input.resolvedPath);
    if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      addPath(relativePath);
    }
  }

  return [...paths.values()];
}

function commandRuleMergeKey(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return normalizeShellCommand(entry).toLowerCase();
  }

  if (!isRecord(entry)) {
    return undefined;
  }

  const match = entry.match ?? entry.pattern ?? entry.command;
  return typeof match === "string" ? normalizeShellCommand(match).toLowerCase() : undefined;
}

function pathDeclarationMergeKey(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return toPolicyPath(entry).toLowerCase();
  }

  if (!isRecord(entry) || typeof entry.path !== "string") {
    return undefined;
  }

  return toPolicyPath(entry.path).toLowerCase();
}

function policyLayerPrecedence(kind: PolicyLayerKind): number {
  return POLICY_LAYER_PRECEDENCE.indexOf(kind);
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (existing === undefined) {
    const created: Record<string, unknown> = {};
    parent[key] = created;
    return created;
  }

  if (!isRecord(existing)) {
    throw new Error(`${key} must be a mapping`);
  }

  return existing;
}

function ensureArray(parent: Record<string, unknown>, key: string): unknown[] {
  const existing = parent[key];
  if (existing === undefined) {
    const created: unknown[] = [];
    parent[key] = created;
    return created;
  }

  if (!Array.isArray(existing)) {
    throw new Error(`${key} must be a list`);
  }

  return existing;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }

  return value;
}

function toPolicyPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function toCanonicalJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalJson(item));
  }

  if (typeof value === "object") {
    const result: { [key: string]: CanonicalJson } = {};
    for (const key of Object.keys(value).sort()) {
      const propertyValue = (value as Record<string, unknown>)[key];
      if (propertyValue !== undefined) {
        result[key] = toCanonicalJson(propertyValue);
      }
    }
    return result;
  }

  throw new Error(`Unsupported policy value type: ${typeof value}`);
}

function stableStringify(value: CanonicalJson): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`)
    .join(",")}}`;
}

function clonePlain(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlain(item));
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, propertyValue] of Object.entries(value)) {
      result[key] = clonePlain(propertyValue);
    }
    return result;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
