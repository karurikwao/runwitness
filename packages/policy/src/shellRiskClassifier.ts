export type PolicyDecision = "allow" | "ask" | "deny";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type ShellCommandRiskCode =
  | "download_execute"
  | "env_print"
  | "git_push"
  | "network_exfil_tool"
  | "recursive_delete"
  | "secret_path";

export interface ShellCommandRiskReason {
  code: ShellCommandRiskCode;
  severity: RiskSeverity;
  summary: string;
  evidence: string;
}

export interface ShellCommandRiskClassification {
  actionType: "shell_command";
  command: string;
  normalizedCommand: string;
  decision: PolicyDecision;
  severity: RiskSeverity;
  isRisky: boolean;
  reasons: ShellCommandRiskReason[];
}

export interface ClassifyShellCommandOptions {
  denyHighImpactRecursiveDelete?: boolean;
  denySecretNetworkExfil?: boolean;
}

const severityRank: Record<RiskSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const recursiveDeletePatterns = [
  /\brm(?:\.exe)?\b(?=[\s\S]*\s(?:--recursive|-r)\b)(?=[\s\S]*\s(?:--force|-f)\b)/i,
  /\brm(?:\.exe)?\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*|-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*)\b/i,
  /\bremove-item\b(?=[\s\S]*\s-recurse\b)(?=[\s\S]*\s-force\b)/i,
  /\b(?:rd|rmdir)\b(?=[\s\S]*\s\/s\b)(?=[\s\S]*\s\/q\b)/i,
] as const;

const highImpactDeleteTargetPattern =
  /(?:^|\s)(?:\/(?:\*|\s|$)|~(?:[\\/]\S*)?|\$home(?:[\\/]\S*)?|%userprofile%(?:[\\/]\S*)?|\.{1,2}(?:\s|$)|\.{1,2}[\\/](?:\*|\s|$)|\*(?:\s|$)|[a-z]:[\\/](?:\*|\s|$))/i;

const secretPathPatterns = [
  /(?:^|[\s"'`=@])(?:~[\\/])?\.ssh(?:[\\/]\S*|\s|$)/i,
  /(?:^|[\s"'`=@])(?:~[\\/])?\.aws(?:[\\/]\S*|\s|$)/i,
  /(?:^|[\s"'`=@])(?:~[\\/])?\.azure(?:[\\/]\S*|\s|$)/i,
  /(?:^|[\s"'`=@])(?:~[\\/])?\.gcp(?:[\\/]\S*|\s|$)/i,
  /(?:^|[\s"'`=@])(?:~[\\/])?\.config[\\/]gh(?:[\\/]\S*|\s|$)/i,
  /(?:^|[\s"'`=@])(?:~[\\/])?\.docker[\\/]config\.json\b/i,
  /(?:^|[\s"'`=@])\.env(?:\.[a-z0-9_-]+)?\b/i,
  /(?:^|[\s"'`=@])(?:~[\\/])?\.(?:npmrc|pypirc|netrc)\b/i,
  /\b(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)\b/i,
  /\b(?:aws_access_key_id|aws_secret_access_key|github_token|openai_api_key|anthropic_api_key)\b/i,
  /\b(?:appdata|application support)\b[\s\S]*\b(?:credential|credentials|token|tokens|keychain|profile)\b/i,
] as const;

const envPrintPatterns = [
  /^\s*(?:env|printenv)\b/i,
  /^\s*set\s*(?:[|>;&]|$)/i,
  /\bcmd(?:\.exe)?\s+\/c\s+set\b/i,
  /\b(?:get-childitem|gci|dir|ls|get-item)\s+env:/i,
  /\becho\s+(?:\$env:[a-z_][a-z0-9_]*|\$[a-z_][a-z0-9_]*|%[a-z_][a-z0-9_]*%)/i,
] as const;

const gitPushPattern = /\bgit(?:\s+-[^\s]+)*\s+push\b/i;

const networkExfilPatterns = [
  /\b(?:curl|curl\.exe)\b[\s\S]*(?:--data(?:-binary|-raw)?\b|--form\b|--upload-file\b|--request\s+post\b|@\S+)/i,
  /\b(?:curl|curl\.exe)\b[\s\S]*(?:\s-d\b|\s-F\b|\s-T\b|\s-X\s+POST\b)/,
  /\b(?:wget|wget\.exe)\b[\s\S]*(?:--post-file\b|--post-data\b|--body-file\b|--method[=\s]+post\b)/i,
  /\b(?:http|https)\b[\s\S]*(?:--form\b|--raw\b|--multipart\b|@\S+)/i,
  /\b(?:scp|sftp|rsync|nc|netcat|ncat|ftp)\b/i,
  /\b(?:invoke-webrequest|iwr|invoke-restmethod|irm)\b[\s\S]*(?:-body\b|-infile\b|-method\s+(?:post|put)\b)/i,
  /\b(?:cat|tar|type|get-content)\b[\s\S]*\|\s*(?:curl|nc|netcat|ncat|scp|sftp|rsync)\b/i,
] as const;

const downloadExecutePatterns = [
  /\b(?:curl|curl\.exe|wget|wget\.exe|iwr|irm|invoke-webrequest|invoke-restmethod)\b[\s\S]*\|\s*(?:sh|bash|zsh|pwsh|powershell|python|node|ruby|perl|iex|invoke-expression)\b/i,
  /\b(?:powershell|pwsh)\b[\s\S]*(?:iwr|irm|invoke-webrequest|invoke-restmethod)[\s\S]*\|\s*(?:iex|invoke-expression)\b/i,
] as const;

export function classifyShellCommand(
  command: string,
  options: ClassifyShellCommandOptions = {},
): ShellCommandRiskClassification {
  const normalizedCommand = normalizeShellCommand(command);
  const reasons: ShellCommandRiskReason[] = [];

  const recursiveDeleteEvidence = firstMatch(normalizedCommand, recursiveDeletePatterns);
  const hasHighImpactDeleteTarget = Boolean(
    recursiveDeleteEvidence && highImpactDeleteTargetPattern.test(normalizedCommand),
  );

  if (recursiveDeleteEvidence) {
    reasons.push({
      code: "recursive_delete",
      severity: hasHighImpactDeleteTarget ? "critical" : "high",
      summary: hasHighImpactDeleteTarget
        ? "Recursive forced delete targets a broad or high-impact path."
        : "Recursive forced delete can permanently remove workspace data.",
      evidence: recursiveDeleteEvidence,
    });
  }

  const secretPathEvidence = firstMatch(normalizedCommand, secretPathPatterns);
  if (secretPathEvidence) {
    reasons.push({
      code: "secret_path",
      severity: "high",
      summary: "Command references a common secret or credential location.",
      evidence: secretPathEvidence,
    });
  }

  const gitPushEvidence = normalizedCommand.match(gitPushPattern)?.[0];
  if (gitPushEvidence) {
    reasons.push({
      code: "git_push",
      severity: /\s--force(?:-with-lease)?\b/i.test(normalizedCommand) ? "critical" : "high",
      summary: "Command can publish local changes to a remote repository.",
      evidence: compactEvidence(gitPushEvidence),
    });
  }

  const envPrintEvidence = firstMatch(normalizedCommand, envPrintPatterns);
  if (envPrintEvidence) {
    reasons.push({
      code: "env_print",
      severity: "medium",
      summary: "Command can print environment variables that may include secrets.",
      evidence: envPrintEvidence,
    });
  }

  const networkExfilEvidence = firstMatch(normalizedCommand, networkExfilPatterns);
  if (networkExfilEvidence) {
    reasons.push({
      code: "network_exfil_tool",
      severity: "high",
      summary: "Command uses a tool or upload mode commonly used to move data over the network.",
      evidence: networkExfilEvidence,
    });
  }

  const downloadExecuteEvidence = firstMatch(normalizedCommand, downloadExecutePatterns);
  if (downloadExecuteEvidence) {
    reasons.push({
      code: "download_execute",
      severity: "high",
      summary: "Command downloads remote content and pipes it into an interpreter.",
      evidence: downloadExecuteEvidence,
    });
  }

  const hasSecretNetworkExfil = hasReason(reasons, "secret_path") && hasReason(reasons, "network_exfil_tool");
  const denyHighImpactRecursiveDelete = options.denyHighImpactRecursiveDelete ?? true;
  const denySecretNetworkExfil = options.denySecretNetworkExfil ?? true;

  const decision =
    (denyHighImpactRecursiveDelete && hasHighImpactDeleteTarget) ||
    (denySecretNetworkExfil && hasSecretNetworkExfil)
      ? "deny"
      : reasons.length > 0
        ? "ask"
        : "allow";

  return {
    actionType: "shell_command",
    command,
    normalizedCommand,
    decision,
    severity: maxSeverity(reasons, hasSecretNetworkExfil ? "critical" : "low"),
    isRisky: reasons.length > 0,
    reasons,
  };
}

export function normalizeShellCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function firstMatch(command: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[0]) {
      return compactEvidence(match[0]);
    }
  }

  return undefined;
}

function compactEvidence(evidence: string): string {
  const compacted = evidence.trim().replace(/\s+/g, " ");
  return compacted.length > 160 ? `${compacted.slice(0, 157)}...` : compacted;
}

function hasReason(reasons: ShellCommandRiskReason[], code: ShellCommandRiskCode): boolean {
  return reasons.some((reason) => reason.code === code);
}

function maxSeverity(reasons: ShellCommandRiskReason[], minimum: RiskSeverity): RiskSeverity {
  return reasons.reduce(
    (max, reason) => (severityRank[reason.severity] > severityRank[max] ? reason.severity : max),
    minimum,
  );
}
