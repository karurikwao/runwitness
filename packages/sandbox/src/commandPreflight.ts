import { checkWritePath, type WritePathCheck, type WritePathPolicy } from "./pathSafety.js";

export type CommandWriteIntent = "copy" | "create" | "delete" | "move" | "redirect" | "write";

export interface DetectedCommandWrite {
  path: string;
  intent: CommandWriteIntent;
  command?: string;
  tokenIndex: number;
  check: WritePathCheck;
}

export interface CommandWritePreflightResult {
  allowed: boolean;
  detectedWrites: DetectedCommandWrite[];
  violations: DetectedCommandWrite[];
  warnings: string[];
}

interface ShellToken {
  value: string;
  index: number;
}

const COMMAND_SEPARATORS = new Set(["&&", "||", ";", "|"]);
const DELETE_COMMANDS = new Set(["clear-content", "clc", "del", "erase", "rd", "remove-item", "ri", "rmdir", "rm"]);
const CREATE_COMMANDS = new Set(["md", "mkdir", "new-item", "ni", "touch"]);
const COPY_COMMANDS = new Set(["copy", "cp", "robocopy", "xcopy"]);
const MOVE_COMMANDS = new Set(["move", "mv", "ren", "rename"]);
const WRITE_COMMANDS = new Set(["add-content", "out-file", "set-content"]);
const PATH_FLAG_NAMES = new Set(["-destination", "-filepath", "-literalpath", "-path"]);
const NON_PATH_FLAG_NAMES = new Set(["-encoding", "-itemtype", "-name", "-value"]);

export function preflightCommandWrites(commandText: string, policy: WritePathPolicy): CommandWritePreflightResult {
  const tokens = tokenizeCommand(commandText);
  const detectedWrites: DetectedCommandWrite[] = [];
  const warnings: string[] = [];

  for (const redirectTarget of detectRedirectionTargets(tokens)) {
    addDetectedWrite(detectedWrites, warnings, redirectTarget.path, "redirect", policy, redirectTarget.tokenIndex);
  }

  for (const segment of commandSegments(tokens)) {
    if (segment.length === 0) {
      continue;
    }

    const commandToken = segment[0];
    if (!commandToken) {
      continue;
    }

    const command = normalizeCommandName(commandToken.value);
    const operands = pathOperands(segment.slice(1));

    if (DELETE_COMMANDS.has(command)) {
      for (const operand of operands) {
        addDetectedWrite(detectedWrites, warnings, operand.value, "delete", policy, operand.index, command);
      }
      continue;
    }

    if (CREATE_COMMANDS.has(command)) {
      for (const operand of powershellPathOperands(segment.slice(1), operands)) {
        addDetectedWrite(detectedWrites, warnings, operand.value, "create", policy, operand.index, command);
      }
      continue;
    }

    if (COPY_COMMANDS.has(command)) {
      for (const operand of copyDestinationOperands(command, operands)) {
        addDetectedWrite(detectedWrites, warnings, operand.value, "copy", policy, operand.index, command);
      }
      continue;
    }

    if (MOVE_COMMANDS.has(command)) {
      for (const operand of operands) {
        addDetectedWrite(detectedWrites, warnings, operand.value, "move", policy, operand.index, command);
      }
      continue;
    }

    if (WRITE_COMMANDS.has(command)) {
      for (const operand of powershellPathOperands(segment.slice(1), operands)) {
        addDetectedWrite(detectedWrites, warnings, operand.value, "write", policy, operand.index, command);
      }
    }
  }

  const violations = detectedWrites.filter((write) => !write.check.allowed);
  return {
    allowed: violations.length === 0,
    detectedWrites,
    violations,
    warnings: [...new Set(warnings)],
  };
}

function addDetectedWrite(
  detectedWrites: DetectedCommandWrite[],
  warnings: string[],
  targetPath: string,
  intent: CommandWriteIntent,
  policy: WritePathPolicy,
  tokenIndex: number,
  command?: string,
): void {
  if (!isLiteralFilesystemTarget(targetPath)) {
    warnings.push(`Skipped non-literal write target: ${targetPath}`);
    return;
  }

  if (hasExpansion(targetPath)) {
    warnings.push(`Write target contains shell expansion or wildcard syntax: ${targetPath}`);
  }

  detectedWrites.push({
    path: targetPath,
    intent,
    command,
    tokenIndex,
    check: checkWritePath(targetPath, policy),
  });
}

function tokenizeCommand(commandText: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let current = "";
  let currentIndex = -1;
  let quote: "'" | '"' | undefined;

  const push = (index: number): void => {
    if (current.length === 0) {
      return;
    }

    tokens.push({ value: current, index: currentIndex >= 0 ? currentIndex : index });
    current = "";
    currentIndex = -1;
  };

  for (let index = 0; index < commandText.length; index += 1) {
    const char = commandText[index];
    if (!char) {
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
        continue;
      }

      if (currentIndex < 0) {
        currentIndex = index;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      if (currentIndex < 0) {
        currentIndex = index;
      }
      continue;
    }

    if (/\s/.test(char)) {
      push(index);
      continue;
    }

    if (char === "&" || char === "|") {
      push(index);
      const next = commandText[index + 1];
      if (next === char) {
        tokens.push({ value: `${char}${char}`, index });
        index += 1;
      } else {
        tokens.push({ value: char, index });
      }
      continue;
    }

    if (char === ";") {
      push(index);
      tokens.push({ value: char, index });
      continue;
    }

    if (char === ">") {
      push(index);
      const next = commandText[index + 1];
      if (next === ">") {
        tokens.push({ value: ">>", index });
        index += 1;
      } else {
        tokens.push({ value: ">", index });
      }
      continue;
    }

    if (currentIndex < 0) {
      currentIndex = index;
    }
    current += char;
  }

  push(commandText.length);
  return tokens;
}

function detectRedirectionTargets(tokens: readonly ShellToken[]): Array<{ path: string; tokenIndex: number }> {
  const targets: Array<{ path: string; tokenIndex: number }> = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || (token.value !== ">" && token.value !== ">>")) {
      continue;
    }

    const nextToken = tokens[index + 1];
    if (nextToken) {
      targets.push({ path: nextToken.value, tokenIndex: nextToken.index });
    }
  }

  return targets;
}

function commandSegments(tokens: readonly ShellToken[]): ShellToken[][] {
  const segments: ShellToken[][] = [];
  let current: ShellToken[] = [];

  for (const token of tokens) {
    if (COMMAND_SEPARATORS.has(token.value)) {
      segments.push(current);
      current = [];
      continue;
    }

    current.push(token);
  }

  segments.push(current);
  return segments;
}

function pathOperands(tokens: readonly ShellToken[]): ShellToken[] {
  const operands: ShellToken[] = [];
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (token.value === ">" || token.value === ">>") {
      skipNext = true;
      continue;
    }

    const lower = token.value.toLowerCase();
    if (PATH_FLAG_NAMES.has(lower)) {
      skipNext = false;
      continue;
    }

    if (NON_PATH_FLAG_NAMES.has(lower)) {
      skipNext = true;
      continue;
    }

    if (looksLikeOption(token.value)) {
      continue;
    }

    operands.push(token);
  }

  return operands;
}

function powershellPathOperands(tokens: readonly ShellToken[], fallbackOperands: readonly ShellToken[]): ShellToken[] {
  const explicitPathOperands: ShellToken[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || !PATH_FLAG_NAMES.has(token.value.toLowerCase())) {
      continue;
    }

    const nextToken = tokens[index + 1];
    if (nextToken) {
      explicitPathOperands.push(nextToken);
    }
  }

  return explicitPathOperands.length > 0 ? explicitPathOperands : [...fallbackOperands];
}

function copyDestinationOperands(command: string, operands: readonly ShellToken[]): ShellToken[] {
  if (operands.length === 0) {
    return [];
  }

  if (command === "robocopy" && operands.length >= 2) {
    const destination = operands[1];
    return destination ? [destination] : [];
  }

  const destination = operands[operands.length - 1];
  return destination ? [destination] : [];
}

function normalizeCommandName(value: string): string {
  const normalized = value.replace(/^.*[\\/]/, "").toLowerCase();
  return normalized.replace(/\.(?:bat|cmd|exe|ps1)$/i, "");
}

function isLiteralFilesystemTarget(value: string): boolean {
  const lower = value.toLowerCase();
  return value !== "-" && !value.startsWith("&") && lower !== "nul" && lower !== "/dev/null" && !/^[a-z]+:\/\//i.test(value);
}

function hasExpansion(value: string): boolean {
  return /[$%*?{}]/.test(value);
}

function looksLikeOption(value: string): boolean {
  if (value.startsWith("-")) {
    return true;
  }

  return /^\/[a-z?]+$/i.test(value);
}
