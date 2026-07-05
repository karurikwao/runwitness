import path from "node:path";
import { normalizeRelativePath } from "./workspaceSnapshot.js";

export const DEFAULT_ALLOWED_WRITE_PATHS = ["."] as const;

export const DEFAULT_PROTECTED_PATHS = [
  ".git",
  ".runwitness",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  "node_modules",
  "dist",
  "coverage",
  "receipts",
] as const;

export type SandboxPathErrorCode = "PATH_OUTSIDE_ROOT" | "PATH_ROOT_NOT_ALLOWED";

export class SandboxPathError extends Error {
  readonly code: SandboxPathErrorCode;
  readonly root: string;
  readonly requestedPath: string;
  readonly resolvedPath: string;

  constructor(code: SandboxPathErrorCode, message: string, root: string, requestedPath: string, resolvedPath: string) {
    super(message);
    this.name = "SandboxPathError";
    this.code = code;
    this.root = root;
    this.requestedPath = requestedPath;
    this.resolvedPath = resolvedPath;
  }
}

export interface SafePathResolutionOptions {
  allowRoot?: boolean;
}

export interface SafeResolvedPath {
  root: string;
  requestedPath: string;
  absolutePath: string;
  relativePath: string;
}

export interface WritePathPolicy {
  workspaceRoot: string;
  allowedWritePaths?: readonly string[];
  protectedPaths?: readonly string[];
  allowWorkspaceRoot?: boolean;
}

export interface WritePathCheck {
  allowed: boolean;
  requestedPath: string;
  absolutePath?: string;
  relativePath?: string;
  reason?: string;
  code?: "outside_workspace" | "protected_path" | "not_allowlisted" | "workspace_root";
}

export function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const parent = stripTrailingSeparators(path.resolve(parentPath));
  const candidate = stripTrailingSeparators(path.resolve(candidatePath));
  const parentKey = comparisonKey(parent);
  const candidateKey = comparisonKey(candidate);

  if (candidateKey === parentKey) {
    return true;
  }

  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolveSafePath(
  workspaceRoot: string,
  requestedPath: string,
  options: SafePathResolutionOptions = {},
): SafeResolvedPath {
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, requestedPath);

  if (!isPathInsideOrEqual(root, absolutePath)) {
    throw new SandboxPathError(
      "PATH_OUTSIDE_ROOT",
      `Path resolves outside the workspace root: ${requestedPath}`,
      root,
      requestedPath,
      absolutePath,
    );
  }

  const relativePath = normalizeRelativePath(path.relative(root, absolutePath)) || ".";
  if (relativePath === "." && !options.allowRoot) {
    throw new SandboxPathError(
      "PATH_ROOT_NOT_ALLOWED",
      `Path resolves to the workspace root: ${requestedPath}`,
      root,
      requestedPath,
      absolutePath,
    );
  }

  return {
    root,
    requestedPath,
    absolutePath,
    relativePath,
  };
}

export function checkWritePath(requestedPath: string, policy: WritePathPolicy): WritePathCheck {
  const allowWorkspaceRoot = policy.allowWorkspaceRoot ?? false;
  let resolved: SafeResolvedPath;

  try {
    resolved = resolveSafePath(policy.workspaceRoot, requestedPath, { allowRoot: allowWorkspaceRoot });
  } catch (error) {
    if (error instanceof SandboxPathError) {
      return {
        allowed: false,
        requestedPath,
        reason: error.message,
        code: error.code === "PATH_ROOT_NOT_ALLOWED" ? "workspace_root" : "outside_workspace",
      };
    }

    throw error;
  }

  const protectedPaths = policy.protectedPaths ?? DEFAULT_PROTECTED_PATHS;
  const protectedPath = protectedPaths.find((protectedCandidate) =>
    matchesPolicyPath(resolved.root, resolved.relativePath, protectedCandidate),
  );

  if (protectedPath) {
    return {
      allowed: false,
      requestedPath,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      reason: `Path is protected by sandbox policy: ${protectedPath}`,
      code: "protected_path",
    };
  }

  const allowedWritePaths = policy.allowedWritePaths ?? DEFAULT_ALLOWED_WRITE_PATHS;
  const allowed = allowedWritePaths.some((allowedCandidate) =>
    matchesPolicyPath(resolved.root, resolved.relativePath, allowedCandidate),
  );

  if (!allowed) {
    return {
      allowed: false,
      requestedPath,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      reason: `Path is outside the write allowlist: ${requestedPath}`,
      code: "not_allowlisted",
    };
  }

  return {
    allowed: true,
    requestedPath,
    absolutePath: resolved.absolutePath,
    relativePath: resolved.relativePath,
  };
}

export function normalizePolicyPath(workspaceRoot: string, policyPath: string): string {
  if (path.isAbsolute(policyPath)) {
    return normalizeRelativePath(path.relative(path.resolve(workspaceRoot), path.resolve(policyPath))) || ".";
  }

  return normalizeRelativePath(policyPath).replace(/^\.\/+/, "") || ".";
}

export function isRelativePathEqualOrDescendant(relativePath: string, possibleParent: string): boolean {
  const candidate = normalizeRelativePath(relativePath).replace(/\/+$/, "") || ".";
  const parent = normalizeRelativePath(possibleParent).replace(/\/+$/, "") || ".";

  if (parent === ".") {
    return true;
  }

  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function matchesPolicyPath(workspaceRoot: string, relativePath: string, policyPath: string): boolean {
  const normalizedPolicyPath = normalizePolicyPath(workspaceRoot, policyPath);

  if (normalizedPolicyPath.endsWith("/**")) {
    return isRelativePathEqualOrDescendant(relativePath, normalizedPolicyPath.slice(0, -3));
  }

  if (normalizedPolicyPath.endsWith("*")) {
    const prefix = normalizedPolicyPath.slice(0, -1);
    const directoryPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return relativePath === directoryPrefix || relativePath.startsWith(prefix);
  }

  return isRelativePathEqualOrDescendant(relativePath, normalizedPolicyPath);
}

function comparisonKey(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function stripTrailingSeparators(value: string): string {
  const root = path.parse(value).root;
  let output = value;

  while (output.length > root.length && /[\\/]+$/.test(output)) {
    output = output.slice(0, -1);
  }

  return output;
}
