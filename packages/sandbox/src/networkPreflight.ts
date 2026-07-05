export type NetworkPreflightDecision = "allow" | "ask" | "deny";

export interface NetworkPreflightPolicy {
  allowedHosts?: readonly string[];
  deniedHosts?: readonly string[];
  defaultDecision?: NetworkPreflightDecision;
}

export interface DetectedNetworkAccess {
  host: string;
  url?: string;
  decision: NetworkPreflightDecision;
  matchedRule?: string;
}

export interface NetworkPreflightResult {
  allowed: boolean;
  decision: NetworkPreflightDecision;
  detectedHosts: DetectedNetworkAccess[];
  violations: DetectedNetworkAccess[];
}

export function preflightCommandNetwork(
  commandText: string,
  policy: NetworkPreflightPolicy = {}
): NetworkPreflightResult {
  const defaultDecision = policy.defaultDecision ?? "ask";
  const detectedHosts = detectNetworkAccess(commandText).map((access) => decideNetworkAccess(access, policy, defaultDecision));
  const violations = detectedHosts.filter((access) => access.decision !== "allow");
  return {
    allowed: violations.length === 0,
    decision: strongestDecision(detectedHosts.map((access) => access.decision), detectedHosts.length === 0 ? "allow" : "allow"),
    detectedHosts,
    violations
  };
}

function detectNetworkAccess(commandText: string): Array<{ host: string; url?: string }> {
  const accesses = new Map<string, { host: string; url?: string }>();
  const urlPattern = /\bhttps?:\/\/[^\s"'`<>|)]+/giu;
  const sshStylePattern = /(?:^|\s)(?:[a-z_][a-z0-9_-]*@)?([a-z0-9.-]+\.[a-z]{2,})(?::[^\s]+)(?:\s|$)/giu;

  for (const match of commandText.matchAll(urlPattern)) {
    const rawUrl = trimTrailingPunctuation(match[0]);
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase();
      accesses.set(host, { host, url: rawUrl });
    } catch {
      // Ignore malformed URLs; ssh-style parsing may still catch a host-like token.
    }
  }

  for (const match of commandText.matchAll(sshStylePattern)) {
    const host = match[1]?.toLowerCase();
    if (host && !accesses.has(host)) {
      accesses.set(host, { host });
    }
  }

  return [...accesses.values()].sort((left, right) => left.host.localeCompare(right.host));
}

function decideNetworkAccess(
  access: { host: string; url?: string },
  policy: NetworkPreflightPolicy,
  defaultDecision: NetworkPreflightDecision
): DetectedNetworkAccess {
  const deniedRule = (policy.deniedHosts ?? []).find((rule) => hostMatchesRule(access.host, rule));
  if (deniedRule) {
    return { ...access, decision: "deny", matchedRule: deniedRule };
  }

  const allowedRule = (policy.allowedHosts ?? []).find((rule) => hostMatchesRule(access.host, rule));
  if (allowedRule) {
    return { ...access, decision: "allow", matchedRule: allowedRule };
  }

  return { ...access, decision: defaultDecision };
}

function hostMatchesRule(host: string, rule: string): boolean {
  const normalizedRule = normalizeHostRule(rule);
  if (normalizedRule === "*") {
    return true;
  }

  if (normalizedRule.startsWith("*.")) {
    const suffix = normalizedRule.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  return host === normalizedRule;
}

function normalizeHostRule(rule: string): string {
  const trimmed = rule.trim().toLowerCase();
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/\/.*$/u, "");
  }
}

function strongestDecision(
  decisions: readonly NetworkPreflightDecision[],
  fallback: NetworkPreflightDecision
): NetworkPreflightDecision {
  const rank: Record<NetworkPreflightDecision, number> = { allow: 0, ask: 1, deny: 2 };
  return decisions.reduce(
    (current, decision) => (rank[decision] > rank[current] ? decision : current),
    fallback
  );
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;:]+$/u, "");
}
