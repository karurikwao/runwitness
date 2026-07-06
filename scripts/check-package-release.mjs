#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const requireBuiltFiles = args.has("--built");
const releaseNpm = process.env.RELEASE_NPM === "true";
const errors = [];

for (const arg of args) {
  if (arg !== "--built") {
    errors.push(`Unknown release check argument: ${arg}`);
  }
}

const rootPackage = await readPackage(root);
const workspaceDirs = await resolveWorkspaceDirs(rootPackage.manifest.workspaces ?? []);
const packages = [
  { ...rootPackage, workspace: false },
  ...(await Promise.all(workspaceDirs.map(async (workspaceDir) => ({ ...(await readPackage(workspaceDir)), workspace: true }))))
];
const workspaceVersions = new Map(
  packages.filter((pkg) => pkg.workspace).map((pkg) => [pkg.manifest.name, pkg.manifest.version])
);

for (const pkg of packages) {
  checkPackage(pkg);
}

if (errors.length > 0) {
  console.error("Release package checks failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Release package checks passed for ${packages.length} package manifests. RELEASE_NPM=${String(releaseNpm)} built=${String(
    requireBuiltFiles
  )}`
);

async function readPackage(directory) {
  const packagePath = path.join(directory, "package.json");
  const raw = await readFile(packagePath, "utf8");
  return {
    directory,
    manifest: JSON.parse(raw),
    relativeDirectory: path.relative(root, directory) || "."
  };
}

async function resolveWorkspaceDirs(workspaces) {
  const specs = Array.isArray(workspaces) ? workspaces : workspaces.packages ?? [];
  const directories = [];

  for (const spec of specs) {
    if (!spec.endsWith("/*")) {
      errors.push(`Unsupported workspace pattern "${spec}". Release checks only handle one-level workspace globs.`);
      continue;
    }

    const baseDirectory = path.join(root, spec.slice(0, -2));
    let entries;
    try {
      entries = await readdir(baseDirectory, { withFileTypes: true });
    } catch {
      errors.push(`Workspace base does not exist: ${spec}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(baseDirectory, entry.name);
      if (await exists(path.join(candidate, "package.json"))) {
        directories.push(candidate);
      }
    }
  }

  return directories.sort((left, right) => left.localeCompare(right));
}

function checkPackage(pkg) {
  const manifest = pkg.manifest;
  const label = pkg.relativeDirectory;

  requireString(manifest.name, `${label} name`);
  requireString(manifest.version, `${label} version`);
  requireString(manifest.license, `${label} license`);

  if (!pkg.workspace && manifest.private !== true) {
    errors.push(`${label} must keep "private": true.`);
  }

  if (pkg.workspace && releaseNpm && manifest.publishConfig?.access === "public" && manifest.private === true) {
    errors.push(`${label} is marked for public npm release but still has "private": true.`);
  }

  if (pkg.workspace) {
    requireString(manifest.description, `${label} description`);
    requireString(manifest.type, `${label} type`);
    requireString(manifest.main, `${label} main`);
    requireString(manifest.types, `${label} types`);
    requireString(manifest.engines?.node, `${label} engines.node`);
    checkPublishConfig(pkg);
    checkExports(pkg);
    checkFilesList(pkg);
    checkInternalDependencyVersions(pkg);
  }

  if (requireBuiltFiles) {
    checkReferencedFilesExist(pkg);
  }
}

function checkPublishConfig(pkg) {
  const { manifest, relativeDirectory } = pkg;

  if (manifest.name?.startsWith("@") && manifest.publishConfig?.access !== "public") {
    errors.push(`${relativeDirectory} should set publishConfig.access to "public" for scoped npm release prep.`);
  }
}

function checkExports(pkg) {
  const { manifest, relativeDirectory } = pkg;
  const dotExport = manifest.exports?.["."];

  if (dotExport === undefined) {
    errors.push(`${relativeDirectory} must export ".".`);
    return;
  }

  const defaultExport = readExportCondition(dotExport, "default");
  if (defaultExport !== manifest.main) {
    errors.push(`${relativeDirectory} exports["."].default must match main (${manifest.main}).`);
  }

  const typeExport = readExportCondition(dotExport, "types");
  if (typeExport !== manifest.types) {
    errors.push(`${relativeDirectory} exports["."].types must match types (${manifest.types}).`);
  }
}

function checkFilesList(pkg) {
  const { manifest, relativeDirectory } = pkg;
  const files = manifest.files;

  if (!Array.isArray(files) || files.length === 0) {
    errors.push(`${relativeDirectory} must define a non-empty files allowlist.`);
    return;
  }

  const referencedPaths = collectReferencedPackagePaths(manifest);
  for (const referencedPath of referencedPaths) {
    if (!isPackageRelativePath(referencedPath) || isAutoIncludedNpmFile(referencedPath)) {
      continue;
    }

    if (!isCoveredByFilesList(referencedPath, files)) {
      errors.push(`${relativeDirectory} files does not include ${referencedPath}.`);
    }
  }

  if (requireBuiltFiles) {
    for (const fileEntry of files) {
      const absolutePath = path.join(pkg.directory, normalizePackagePath(fileEntry));
      if (!existsSync(absolutePath)) {
        errors.push(`${relativeDirectory} files entry does not exist after build: ${fileEntry}`);
      }
    }
  }
}

function checkInternalDependencyVersions(pkg) {
  const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"];

  for (const field of dependencyFields) {
    const dependencies = pkg.manifest[field] ?? {};
    for (const [name, version] of Object.entries(dependencies)) {
      const workspaceVersion = workspaceVersions.get(name);
      if (workspaceVersion !== undefined && version !== workspaceVersion) {
        errors.push(
          `${pkg.relativeDirectory} ${field}.${name} should match the workspace version (${workspaceVersion}), not ${version}.`
        );
      }
    }
  }
}

function checkReferencedFilesExist(pkg) {
  for (const referencedPath of collectReferencedPackagePaths(pkg.manifest)) {
    if (!isPackageRelativePath(referencedPath) || referencedPath.includes("*")) {
      continue;
    }

    const absolutePath = path.join(pkg.directory, normalizePackagePath(referencedPath));
    if (!existsSync(absolutePath)) {
      errors.push(`${pkg.relativeDirectory} references a missing built/package file: ${referencedPath}`);
    }
  }
}

function collectReferencedPackagePaths(manifest) {
  const paths = new Set();

  for (const value of [manifest.main, manifest.types]) {
    if (typeof value === "string") {
      paths.add(value);
    }
  }

  if (manifest.bin && typeof manifest.bin === "object") {
    for (const value of Object.values(manifest.bin)) {
      if (typeof value === "string") {
        paths.add(value);
      }
    }
  }

  collectExportPaths(manifest.exports, paths);
  return [...paths].sort();
}

function collectExportPaths(value, paths) {
  if (typeof value === "string") {
    paths.add(value);
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const child of Object.values(value)) {
    collectExportPaths(child, paths);
  }
}

function readExportCondition(value, condition) {
  if (condition === "default" && typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const conditionValue = value[condition];
  return typeof conditionValue === "string" ? conditionValue : undefined;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string.`);
  }
}

function isPackageRelativePath(value) {
  const normalized = normalizePackagePath(value);
  return value.startsWith("./") && !path.isAbsolute(value) && !normalized.startsWith("../") && !normalized.includes("/../");
}

function isAutoIncludedNpmFile(value) {
  const normalized = normalizePackagePath(value);
  return normalized === "package.json" || /^readme(\.|$)/i.test(normalized) || /^licen[cs]e(\.|$)/i.test(normalized);
}

function normalizePackagePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isCoveredByFilesList(referencedPath, files) {
  const normalizedPath = normalizePackagePath(referencedPath);

  return files.some((entry) => {
    if (typeof entry !== "string") {
      return false;
    }

    const normalizedEntry = normalizePackagePath(entry).replace(/\/\*\*$/, "");
    return normalizedPath === normalizedEntry || normalizedPath.startsWith(`${normalizedEntry}/`);
  });
}

async function exists(absolutePath) {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}
