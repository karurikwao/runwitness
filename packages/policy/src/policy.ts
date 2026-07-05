import { readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  classifyShellCommand,
  normalizeShellCommand,
  type ClassifyShellCommandOptions,
  type PolicyDecision,
  type RiskSeverity,
  type ShellCommandRiskClassification,
  type ShellCommandRiskCode,
} from "./shellRiskClassifier.js";

export interface PolicyCommandRule {
  match: string;
  reason?: string;
}

export interface FilesystemScopeDeclaration {
  path: string;
  reason?: string;
}

export interface NetworkAllowDeclaration {
  host: string;
  reason?: string;
}

export interface CommandPolicyDefaults {
  undeclaredFileRead: PolicyDecision;
  undeclaredFileWrite: PolicyDecision;
  undeclaredNetwork: PolicyDecision;
}

export interface CommandPolicy {
  version: 1;
  shell: {
    allow: PolicyCommandRule[];
    ask: PolicyCommandRule[];
    deny: PolicyCommandRule[];
  };
  filesystem: {
    read: FilesystemScopeDeclaration[];
    write: FilesystemScopeDeclaration[];
  };
  network: {
    allow: NetworkAllowDeclaration[];
  };
  defaults: CommandPolicyDefaults;
  classifier: ClassifyShellCommandOptions;
}

export type CommandPolicyReasonCode =
  | ShellCommandRiskCode
  | "shell_override"
  | "filesystem_read_scope"
  | "filesystem_write_scope"
  | "network_scope";

export interface CommandPolicyEvaluationReason {
  code: CommandPolicyReasonCode;
  severity: RiskSeverity;
  summary: string;
  evidence: string;
  source: "classifier" | "policy";
  decision?: PolicyDecision;
}

export interface CommandPolicyMatch {
  kind: "shell";
  decision: PolicyDecision;
  pattern: string;
  reason?: string;
}

export interface FilesystemAccessCheck {
  path: string;
  access: "read" | "write";
  allowed: boolean;
  decision: PolicyDecision;
  matchedScope?: string;
}

export interface NetworkAccessCheck {
  host: string;
  allowed: boolean;
  decision: PolicyDecision;
  matchedAllow?: string;
}

export interface CommandPolicyEvaluation {
  actionType: "shell_command";
  command: string;
  normalizedCommand: string;
  decision: PolicyDecision;
  severity: RiskSeverity;
  isRisky: boolean;
  classifier: ShellCommandRiskClassification;
  reasons: CommandPolicyEvaluationReason[];
  matches: CommandPolicyMatch[];
  access: {
    filesystem: {
      read: FilesystemAccessCheck[];
      write: FilesystemAccessCheck[];
    };
    network: NetworkAccessCheck[];
  };
}

type PolicyCommandRuleInput = string | { match?: unknown; pattern?: unknown; command?: unknown; reason?: unknown };
type FilesystemScopeInput = string | { path?: unknown; reason?: unknown };
type NetworkAllowInput = string | { host?: unknown; domain?: unknown; url?: unknown; reason?: unknown };

interface RawPolicy {
  version?: unknown;
  shell?: unknown;
  filesystem?: unknown;
  network?: unknown;
  defaults?: unknown;
  classifier?: unknown;
}

const defaultFilesystemScopes = [{ path: ".", reason: "Current workspace" }] as const;
const defaultNetworkAllow = [
  { host: "localhost", reason: "Local development" },
  { host: "127.0.0.1", reason: "Local development" },
  { host: "::1", reason: "Local development" },
] as const;

const defaultPolicyDefaults: CommandPolicyDefaults = {
  undeclaredFileRead: "ask",
  undeclaredFileWrite: "ask",
  undeclaredNetwork: "ask",
};

const decisionRank: Record<PolicyDecision, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

const severityRank: Record<RiskSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export async function loadPolicyFromFile(filePath: string): Promise<CommandPolicy> {
  return parsePolicy(await readFile(filePath, "utf8"));
}

export function parsePolicy(source: string): CommandPolicy {
  const parsed = YAML.parse(source) as unknown;
  if (parsed === null || parsed === undefined) {
    return createDefaultPolicy();
  }

  if (!isRecord(parsed)) {
    throw new Error("Policy must be a YAML mapping");
  }

  return normalizePolicy(parsed as RawPolicy);
}

export function evaluateCommandPolicy(command: string, policy: CommandPolicy): CommandPolicyEvaluation {
  const classifier = classifyShellCommand(command, policy.classifier);
  const normalizedCommand = normalizeShellCommand(command);
  const shellMatches = collectShellMatches(normalizedCommand, policy);
  const shellDecision = resolveShellOverride(shellMatches);
  const access = analyzeCommandAccess(command, policy);
  const policyReasons = [
    ...shellMatches.map(toShellOverrideReason),
    ...access.filesystem.read.filter(isUndeclaredCheck).map(toFilesystemReason),
    ...access.filesystem.write.filter(isUndeclaredCheck).map(toFilesystemReason),
    ...access.network.filter(isUndeclaredNetworkCheck).map(toNetworkReason),
  ];
  const reasons: CommandPolicyEvaluationReason[] = [
    ...classifier.reasons.map((reason) => ({
      ...reason,
      source: "classifier" as const,
    })),
    ...policyReasons,
  ];

  const classifierAdjustedDecision = applyShellDecision(classifier.decision, shellDecision);
  const decision = strongestDecision([
    classifierAdjustedDecision,
    ...policyReasons.map((reason) => reason.decision ?? "allow"),
  ]);
  const severity = maxSeverity(
    reasons.map((reason) => reason.severity),
    decision === "deny" ? "high" : classifier.severity,
  );

  return {
    actionType: "shell_command",
    command,
    normalizedCommand,
    decision,
    severity,
    isRisky: decision !== "allow" || classifier.isRisky || policyReasons.length > 0,
    classifier,
    reasons,
    matches: shellMatches,
    access,
  };
}

function createDefaultPolicy(): CommandPolicy {
  return {
    version: 1,
    shell: {
      allow: [],
      ask: [],
      deny: [],
    },
    filesystem: {
      read: defaultFilesystemScopes.map((scope) => ({ ...scope })),
      write: defaultFilesystemScopes.map((scope) => ({ ...scope })),
    },
    network: {
      allow: defaultNetworkAllow.map((allow) => ({ ...allow })),
    },
    defaults: { ...defaultPolicyDefaults },
    classifier: {},
  };
}

function normalizePolicy(raw: RawPolicy): CommandPolicy {
  if (raw.version !== undefined && raw.version !== 1) {
    throw new Error("Policy version must be 1");
  }

  const shell = asOptionalRecord(raw.shell, "shell");
  const filesystem = asOptionalRecord(raw.filesystem, "filesystem");
  const network = asOptionalRecord(raw.network, "network");
  const defaults = asOptionalRecord(raw.defaults, "defaults");
  const classifier = asOptionalRecord(raw.classifier, "classifier");

  return {
    version: 1,
    shell: {
      allow: normalizeCommandRules(shell?.allow, "shell.allow"),
      ask: normalizeCommandRules(shell?.ask, "shell.ask"),
      deny: normalizeCommandRules(shell?.deny, "shell.deny"),
    },
    filesystem: {
      read: normalizeFilesystemScopes(filesystem?.read, "filesystem.read", defaultFilesystemScopes),
      write: normalizeFilesystemScopes(filesystem?.write, "filesystem.write", defaultFilesystemScopes),
    },
    network: {
      allow: normalizeNetworkAllows(network?.allow, "network.allow", defaultNetworkAllow),
    },
    defaults: {
      undeclaredFileRead: normalizeDecision(
        defaults?.undeclaredFileRead,
        "defaults.undeclaredFileRead",
        defaultPolicyDefaults.undeclaredFileRead,
      ),
      undeclaredFileWrite: normalizeDecision(
        defaults?.undeclaredFileWrite,
        "defaults.undeclaredFileWrite",
        defaultPolicyDefaults.undeclaredFileWrite,
      ),
      undeclaredNetwork: normalizeDecision(
        defaults?.undeclaredNetwork,
        "defaults.undeclaredNetwork",
        defaultPolicyDefaults.undeclaredNetwork,
      ),
    },
    classifier: normalizeClassifierOptions(classifier),
  };
}

function normalizeCommandRules(value: unknown, field: string): PolicyCommandRule[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be a list`);
  }

  return value.map((entry, index) => normalizeCommandRule(entry as PolicyCommandRuleInput, `${field}[${index}]`));
}

function normalizeCommandRule(entry: PolicyCommandRuleInput, field: string): PolicyCommandRule {
  if (typeof entry === "string") {
    return { match: normalizeNonEmptyString(entry, field) };
  }

  if (!isRecord(entry)) {
    throw new Error(`${field} must be a string or mapping`);
  }

  const match = entry.match ?? entry.pattern ?? entry.command;
  const reason = normalizeOptionalString(entry.reason, `${field}.reason`);
  return {
    match: normalizeNonEmptyString(match, `${field}.match`),
    ...(reason ? { reason } : {}),
  };
}

function normalizeFilesystemScopes(
  value: unknown,
  field: string,
  defaults: readonly FilesystemScopeDeclaration[],
): FilesystemScopeDeclaration[] {
  if (value === undefined) {
    return defaults.map((scope) => ({ ...scope }));
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be a list`);
  }

  return value.map((entry, index) => normalizeFilesystemScope(entry as FilesystemScopeInput, `${field}[${index}]`));
}

function normalizeFilesystemScope(entry: FilesystemScopeInput, field: string): FilesystemScopeDeclaration {
  if (typeof entry === "string") {
    return { path: normalizeNonEmptyString(entry, field) };
  }

  if (!isRecord(entry)) {
    throw new Error(`${field} must be a string or mapping`);
  }

  const reason = normalizeOptionalString(entry.reason, `${field}.reason`);
  return {
    path: normalizeNonEmptyString(entry.path, `${field}.path`),
    ...(reason ? { reason } : {}),
  };
}

function normalizeNetworkAllows(
  value: unknown,
  field: string,
  defaults: readonly NetworkAllowDeclaration[],
): NetworkAllowDeclaration[] {
  if (value === undefined) {
    return defaults.map((allow) => ({ ...allow }));
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be a list`);
  }

  return value.map((entry, index) => normalizeNetworkAllow(entry as NetworkAllowInput, `${field}[${index}]`));
}

function normalizeNetworkAllow(entry: NetworkAllowInput, field: string): NetworkAllowDeclaration {
  if (typeof entry === "string") {
    return { host: normalizeNetworkHost(entry, field) };
  }

  if (!isRecord(entry)) {
    throw new Error(`${field} must be a string or mapping`);
  }

  const host = entry.host ?? entry.domain ?? entry.url;
  const reason = normalizeOptionalString(entry.reason, `${field}.reason`);
  return {
    host: normalizeNetworkHost(host, `${field}.host`),
    ...(reason ? { reason } : {}),
  };
}

function normalizeClassifierOptions(value: Record<string, unknown> | undefined): ClassifyShellCommandOptions {
  if (value === undefined) {
    return {};
  }

  const options: ClassifyShellCommandOptions = {};
  if (value.denyHighImpactRecursiveDelete !== undefined) {
    options.denyHighImpactRecursiveDelete = normalizeBoolean(
      value.denyHighImpactRecursiveDelete,
      "classifier.denyHighImpactRecursiveDelete",
    );
  }

  if (value.denySecretNetworkExfil !== undefined) {
    options.denySecretNetworkExfil = normalizeBoolean(
      value.denySecretNetworkExfil,
      "classifier.denySecretNetworkExfil",
    );
  }

  return options;
}

function normalizeDecision(value: unknown, field: string, fallback: PolicyDecision): PolicyDecision {
  if (value === undefined) {
    return fallback;
  }

  if (value === "allow" || value === "ask" || value === "deny") {
    return value;
  }

  throw new Error(`${field} must be allow, ask, or deny`);
}

function collectShellMatches(normalizedCommand: string, policy: CommandPolicy): CommandPolicyMatch[] {
  return [
    ...collectDecisionMatches(normalizedCommand, policy.shell.allow, "allow"),
    ...collectDecisionMatches(normalizedCommand, policy.shell.ask, "ask"),
    ...collectDecisionMatches(normalizedCommand, policy.shell.deny, "deny"),
  ];
}

function collectDecisionMatches(
  normalizedCommand: string,
  rules: PolicyCommandRule[],
  decision: PolicyDecision,
): CommandPolicyMatch[] {
  return rules
    .filter((rule) => commandPatternMatches(normalizedCommand, rule.match))
    .map((rule) => ({
      kind: "shell" as const,
      decision,
      pattern: rule.match,
      ...(rule.reason ? { reason: rule.reason } : {}),
    }));
}

function resolveShellOverride(matches: CommandPolicyMatch[]): PolicyDecision | undefined {
  return matches.reduce<PolicyDecision | undefined>(
    (current, match) => (current === undefined || decisionRank[match.decision] > decisionRank[current] ? match.decision : current),
    undefined,
  );
}

function applyShellDecision(classifierDecision: PolicyDecision, shellDecision: PolicyDecision | undefined): PolicyDecision {
  if (classifierDecision === "deny") {
    return "deny";
  }

  return shellDecision ?? classifierDecision;
}

function analyzeCommandAccess(
  command: string,
  policy: CommandPolicy,
): CommandPolicyEvaluation["access"] {
  const accesses = detectFilesystemAccess(command);
  const hosts = detectNetworkHosts(command);

  return {
    filesystem: {
      read: accesses.read.map((path) => checkFilesystemAccess(path, "read", policy)),
      write: accesses.write.map((path) => checkFilesystemAccess(path, "write", policy)),
    },
    network: hosts.map((host) => checkNetworkAccess(host, policy)),
  };
}

function checkFilesystemAccess(
  path: string,
  access: "read" | "write",
  policy: CommandPolicy,
): FilesystemAccessCheck {
  const scopes = access === "read" ? policy.filesystem.read : policy.filesystem.write;
  const matchedScope = scopes.find((scope) => pathMatchesScope(path, scope.path))?.path;
  const decision = access === "read" ? policy.defaults.undeclaredFileRead : policy.defaults.undeclaredFileWrite;
  return {
    path,
    access,
    allowed: matchedScope !== undefined,
    decision: matchedScope === undefined ? decision : "allow",
    ...(matchedScope ? { matchedScope } : {}),
  };
}

function checkNetworkAccess(host: string, policy: CommandPolicy): NetworkAccessCheck {
  const matchedAllow = policy.network.allow.find((allow) => networkHostMatches(host, allow.host))?.host;
  return {
    host,
    allowed: matchedAllow !== undefined,
    decision: matchedAllow === undefined ? policy.defaults.undeclaredNetwork : "allow",
    ...(matchedAllow ? { matchedAllow } : {}),
  };
}

function detectFilesystemAccess(command: string): { read: string[]; write: string[] } {
  const tokens = tokenizeShell(command);
  const read = new Set<string>();
  const write = new Set<string>();
  const commandName = normalizeCommandName(tokens[0]);

  for (const path of detectRedirectWrites(command)) {
    write.add(path);
  }

  if (commandName !== undefined) {
    collectCommandFilesystemAccess(commandName, tokens.slice(1), read, write);
  }

  return {
    read: [...read],
    write: [...write],
  };
}

function collectCommandFilesystemAccess(
  commandName: string,
  args: string[],
  read: Set<string>,
  write: Set<string>,
): void {
  const pathArgs = args.filter(isLikelyPathToken);

  if (["cat", "type", "get-content", "gc", "less", "more", "head", "tail"].includes(commandName)) {
    pathArgs.forEach((path) => read.add(path));
    return;
  }

  if (["rm", "rm.exe", "remove-item", "rd", "rmdir", "del", "erase"].includes(commandName)) {
    pathArgs.forEach((path) => write.add(path));
    return;
  }

  if (["mkdir", "md", "touch", "new-item"].includes(commandName)) {
    pathArgs.forEach((path) => write.add(path));
    return;
  }

  if (["cp", "copy", "copy-item", "mv", "move", "move-item"].includes(commandName)) {
    const source = pathArgs[0];
    const destination = pathArgs.at(-1);
    if (source !== undefined) {
      read.add(source);
    }
    if (destination !== undefined && destination !== source) {
      write.add(destination);
    }
    return;
  }

  if (["curl", "curl.exe", "wget", "wget.exe", "invoke-webrequest", "iwr"].includes(commandName)) {
    collectNetworkToolFilesystemAccess(args, read, write);
  }
}

function collectNetworkToolFilesystemAccess(args: string[], read: Set<string>, write: Set<string>): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === undefined) {
      continue;
    }

    if (arg.startsWith("@") && isLikelyPathToken(arg.slice(1))) {
      read.add(arg.slice(1));
      continue;
    }

    if ((arg === "--upload-file" || arg === "-T" || arg === "--body-file" || arg === "--post-file" || arg === "-InFile") && next !== undefined) {
      read.add(stripAtPrefix(next));
      continue;
    }

    if ((arg === "--data-binary" || arg === "--data-raw" || arg === "--form" || arg === "-F") && next?.startsWith("@")) {
      read.add(stripAtPrefix(next));
      continue;
    }

    if ((arg === "--output" || arg === "-o" || arg === "--output-document") && next !== undefined) {
      write.add(next);
    }
  }
}

function detectRedirectWrites(command: string): string[] {
  const paths: string[] = [];
  const redirectPattern = /(?:^|\s)(?:\d?>{1,2})\s*("[^"]+"|'[^']+'|[^\s|&;]+)/g;

  for (const match of command.matchAll(redirectPattern)) {
    const path = match[1];
    if (path !== undefined) {
      paths.push(stripShellQuotes(path));
    }
  }

  return paths;
}

function detectNetworkHosts(command: string): string[] {
  const hosts = new Set<string>();
  const urlPattern = /\bhttps?:\/\/[^\s"'`<>|)]+/gi;
  const sshStylePattern = /(?:^|\s)(?:[a-z_][a-z0-9_-]*@)?([a-z0-9.-]+\.[a-z]{2,})(?::[^\s]+)(?:\s|$)/gi;

  for (const match of command.matchAll(urlPattern)) {
    const rawUrl = trimTrailingPunctuation(match[0]);
    try {
      hosts.add(new URL(rawUrl).hostname.toLowerCase());
    } catch {
      // Ignore malformed URLs; the classifier still handles risky syntax.
    }
  }

  for (const match of command.matchAll(sshStylePattern)) {
    const host = match[1];
    if (host !== undefined) {
      hosts.add(host.toLowerCase());
    }
  }

  return [...hosts];
}

function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  const tokenPattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|`([^`]*)`|[^\s]+/g;

  for (const match of command.matchAll(tokenPattern)) {
    tokens.push(stripShellQuotes(match[0]));
  }

  return tokens;
}

function normalizeCommandName(token: string | undefined): string | undefined {
  if (token === undefined) {
    return undefined;
  }

  return token.toLowerCase().replace(/(?:^|.*[\\/])([^\\/]+)$/u, "$1");
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function stripAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function isLikelyPathToken(token: string): boolean {
  const stripped = stripAtPrefix(stripShellQuotes(token));
  return (
    stripped.length > 0 &&
    !stripped.startsWith("-") &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(stripped) &&
    !["|", "&&", "||", ";", ">", ">>"].includes(stripped)
  );
}

function isUndeclaredCheck(check: FilesystemAccessCheck): boolean {
  return !check.allowed && check.decision !== "allow";
}

function isUndeclaredNetworkCheck(check: NetworkAccessCheck): boolean {
  return !check.allowed && check.decision !== "allow";
}

function toShellOverrideReason(match: CommandPolicyMatch): CommandPolicyEvaluationReason {
  return {
    code: "shell_override",
    severity: match.decision === "deny" ? "high" : match.decision === "ask" ? "medium" : "low",
    summary: `Shell policy override matched ${match.decision}.`,
    evidence: match.pattern,
    source: "policy",
    decision: match.decision,
  };
}

function toFilesystemReason(check: FilesystemAccessCheck): CommandPolicyEvaluationReason {
  return {
    code: check.access === "read" ? "filesystem_read_scope" : "filesystem_write_scope",
    severity: check.decision === "deny" ? "high" : "medium",
    summary: `Command ${check.access}s a filesystem path outside declared ${check.access} scopes.`,
    evidence: check.path,
    source: "policy",
    decision: check.decision,
  };
}

function toNetworkReason(check: NetworkAccessCheck): CommandPolicyEvaluationReason {
  return {
    code: "network_scope",
    severity: check.decision === "deny" ? "high" : "medium",
    summary: "Command contacts a network host outside declared allow rules.",
    evidence: check.host,
    source: "policy",
    decision: check.decision,
  };
}

function commandPatternMatches(normalizedCommand: string, pattern: string): boolean {
  const normalizedPattern = normalizeShellCommand(pattern);
  if (normalizedPattern.startsWith("/") && normalizedPattern.lastIndexOf("/") > 0) {
    const lastSlash = normalizedPattern.lastIndexOf("/");
    const expression = normalizedPattern.slice(1, lastSlash);
    const flags = normalizedPattern.slice(lastSlash + 1) || "i";
    return new RegExp(expression, flags).test(normalizedCommand);
  }

  if (hasWildcard(normalizedPattern)) {
    return wildcardToRegExp(normalizedPattern, false).test(normalizedCommand);
  }

  return normalizedCommand === normalizedPattern;
}

function pathMatchesScope(path: string, scope: string): boolean {
  const normalizedPath = normalizePathLike(path);
  const normalizedScope = normalizePathLike(scope);

  if (normalizedScope === "." || normalizedScope === "./**" || normalizedScope === "**") {
    return isWorkspaceRelativePath(normalizedPath);
  }

  if (isWorkspaceRelativePath(normalizedScope) && !isWorkspaceRelativePath(normalizedPath)) {
    return false;
  }

  if (hasWildcard(normalizedScope)) {
    return wildcardToRegExp(normalizedScope, true).test(normalizedPath);
  }

  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function networkHostMatches(host: string, allow: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedAllow = normalizeNetworkHost(allow, "network.allow");

  if (hasWildcard(normalizedAllow)) {
    return wildcardToRegExp(normalizedAllow, true).test(normalizedHost);
  }

  return normalizedHost === normalizedAllow;
}

function normalizePathLike(path: string): string {
  const stripped = stripShellQuotes(path).replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  if (stripped === "" || stripped === "." || stripped === "./") {
    return ".";
  }

  const driveMatch = stripped.match(/^([a-z]:)(?:\/|$)(.*)$/i);
  const prefix = driveMatch?.[1]?.toLowerCase();
  const body = driveMatch ? driveMatch[2] ?? "" : stripped;
  const isAbsolute = prefix !== undefined || body.startsWith("/");
  const rawSegments = body.split("/");
  const segments: string[] = [];

  for (const segment of rawSegments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      const previous = segments.at(-1);
      if (previous !== undefined && previous !== "..") {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push("..");
      }
      continue;
    }

    segments.push(segment);
  }

  const normalizedBody = segments.join("/");
  if (prefix !== undefined) {
    return normalizedBody ? `${prefix}/${normalizedBody}` : `${prefix}/`;
  }

  if (isAbsolute) {
    return normalizedBody ? `/${normalizedBody}` : "/";
  }

  return normalizedBody.length > 0 ? normalizedBody : ".";
}

function isWorkspaceRelativePath(path: string): boolean {
  return !/^(?:[a-z]:\/|\/|~|\$home(?:\/|$)|%userprofile%(?:\/|$)|\.\.(?:\/|$))/i.test(path);
}

function normalizeNetworkHost(value: unknown, field: string): string {
  const raw = normalizeNonEmptyString(value, field);
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/^\*?\.+/u, raw.startsWith("*.") ? "*." : "").replace(/\/.*$/u, "");
  }
}

function wildcardToRegExp(pattern: string, pathMode: boolean): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += pathMode ? "[^/]*" : ".*";
      continue;
    }

    if (char === "?") {
      source += pathMode ? "[^/]" : ".";
      continue;
    }

    source += escapeRegExp(char ?? "");
  }

  return new RegExp(`^${source}$`, "i");
}

function hasWildcard(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function strongestDecision(decisions: PolicyDecision[]): PolicyDecision {
  return decisions.reduce((current, decision) => (decisionRank[decision] > decisionRank[current] ? decision : current), "allow");
}

function maxSeverity(severities: RiskSeverity[], minimum: RiskSeverity): RiskSeverity {
  return severities.reduce(
    (max, severity) => (severityRank[severity] > severityRank[max] ? severity : max),
    minimum,
  );
}

function normalizeNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value.trim();
}

function normalizeOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeNonEmptyString(value, field);
}

function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }

  return value;
}

function asOptionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;]+$/u, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
