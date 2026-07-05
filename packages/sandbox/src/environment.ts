import path from "node:path";
import { isPathInsideOrEqual } from "./pathSafety.js";

export const DEFAULT_ALLOWED_ENV_KEYS = [
  "CI",
  "COMSPEC",
  "HOME",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "SHELL",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "USERNAME",
  "WINDIR",
] as const;

const SECRET_ENV_PATTERNS = [
  /(?:^|_)(?:APIKEY|AUTHORIZATION|PRIVATEKEY)(?:_|$)/i,
  /API_?KEY/i,
  /AUTHORIZATION/i,
  /PRIVATE_?KEY/i,
  /(?:^|_)(?:AUTH|COOKIE|CREDENTIAL|KEY|PASS|PASSWORD|SECRET|SESSION|TOKEN)(?:_|$)/i,
  /^AWS_/i,
  /^AZURE_/i,
  /^GCP_/i,
  /^GOOGLE_APPLICATION_CREDENTIALS$/i,
  /^GH_TOKEN$/i,
  /^GITHUB_TOKEN$/i,
  /^NPM_TOKEN$/i,
  /^SSH_AUTH_SOCK$/i,
];

export interface FilteredEnvironmentOptions {
  baseEnv?: Record<string, string | undefined>;
  allowKeys?: readonly string[];
  denyKeys?: readonly string[];
  extraEnv?: Record<string, string | undefined>;
  includePath?: boolean;
  pathEntries?: readonly string[];
  allowedPathRoots?: readonly string[];
  blockedPathRoots?: readonly string[];
  preserveSystemEnv?: boolean;
}

export interface FilteredEnvironment {
  env: Record<string, string>;
  removedKeys: string[];
  removedPathEntries: string[];
  pathKey?: string;
}

export function buildFilteredEnvironment(options: FilteredEnvironmentOptions = {}): FilteredEnvironment {
  const baseEnv = options.baseEnv ?? process.env;
  const preserveSystemEnv = options.preserveSystemEnv ?? true;
  const allowedKeys = toCaseInsensitiveSet(options.allowKeys);
  const deniedKeys = toCaseInsensitiveSet(options.denyKeys);
  const defaultAllowedKeys = toCaseInsensitiveSet(DEFAULT_ALLOWED_ENV_KEYS);
  const pathKey = findEnvKey(baseEnv, "PATH") ?? defaultPathKey();
  const env: Record<string, string> = {};
  const removedKeys: string[] = [];

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined || equalsIgnoreCase(key, pathKey)) {
      continue;
    }

    const explicitlyAllowed = allowedKeys.has(key.toLowerCase());
    const allowedByDefault = preserveSystemEnv && defaultAllowedKeys.has(key.toLowerCase());
    const denied = deniedKeys.has(key.toLowerCase()) || (isSecretEnvKey(key) && !explicitlyAllowed);

    if (!denied && (explicitlyAllowed || allowedByDefault)) {
      env[key] = value;
      continue;
    }

    removedKeys.push(key);
  }

  for (const [key, value] of Object.entries(options.extraEnv ?? {})) {
    if (value === undefined) {
      continue;
    }

    const explicitlyAllowed = allowedKeys.has(key.toLowerCase());
    const denied = deniedKeys.has(key.toLowerCase()) || (isSecretEnvKey(key) && !explicitlyAllowed);

    if (denied) {
      removedKeys.push(key);
      continue;
    }

    env[key] = value;
  }

  const removedPathEntries: string[] = [];
  if (options.includePath ?? true) {
    const sourcePathEntries =
      options.pathEntries ?? (baseEnv[pathKey] ? splitPathEntries(baseEnv[pathKey] as string) : []);
    const filteredPathEntries = filterPathEntries(sourcePathEntries, options, removedPathEntries);

    if (filteredPathEntries.length > 0) {
      env[pathKey] = filteredPathEntries.join(path.delimiter);
    }
  }

  return {
    env,
    removedKeys: [...new Set(removedKeys)].sort((left, right) => left.localeCompare(right)),
    removedPathEntries,
    pathKey,
  };
}

export function filterPathEntries(
  entries: readonly string[],
  options: Pick<FilteredEnvironmentOptions, "allowedPathRoots" | "blockedPathRoots"> = {},
  removedEntries: string[] = [],
): string[] {
  const allowedRoots = options.allowedPathRoots?.map((entry) => path.resolve(entry));
  const blockedRoots = options.blockedPathRoots?.map((entry) => path.resolve(entry)) ?? [];
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const rawEntry of entries) {
    const entry = stripWrappingQuotes(rawEntry.trim());

    if (!entry || !path.isAbsolute(entry)) {
      removedEntries.push(rawEntry);
      continue;
    }

    const resolvedEntry = path.resolve(entry);
    const key = process.platform === "win32" ? resolvedEntry.toLowerCase() : resolvedEntry;

    if (seen.has(key)) {
      removedEntries.push(rawEntry);
      continue;
    }

    const blocked = blockedRoots.some((blockedRoot) => isPathInsideOrEqual(blockedRoot, resolvedEntry));
    const allowed =
      !allowedRoots || allowedRoots.some((allowedRoot) => isPathInsideOrEqual(allowedRoot, resolvedEntry));

    if (blocked || !allowed) {
      removedEntries.push(rawEntry);
      continue;
    }

    seen.add(key);
    filtered.push(resolvedEntry);
  }

  return filtered;
}

function splitPathEntries(value: string): string[] {
  return value.split(path.delimiter);
}

function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_PATTERNS.some((pattern) => pattern.test(key));
}

function toCaseInsensitiveSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
}

function findEnvKey(env: Record<string, string | undefined>, requestedKey: string): string | undefined {
  return Object.keys(env).find((key) => equalsIgnoreCase(key, requestedKey));
}

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function defaultPathKey(): string {
  return process.platform === "win32" ? "Path" : "PATH";
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
