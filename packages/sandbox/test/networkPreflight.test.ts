import { describe, expect, it } from "vitest";
import { preflightCommandNetwork } from "../src/index.js";

describe("network command preflight", () => {
  it("detects URL and ssh-style hosts and applies host allow rules", () => {
    const result = preflightCommandNetwork(
      "curl https://api.example.com/v1 && git clone git@github.com:owner/repo.git",
      {
        allowedHosts: ["*.example.com"],
        defaultDecision: "ask",
      },
    );

    expect(result.detectedHosts).toEqual([
      expect.objectContaining({ host: "api.example.com", decision: "allow", matchedRule: "*.example.com" }),
      expect.objectContaining({ host: "github.com", decision: "ask" }),
    ]);
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe("ask");
  });

  it("lets explicit denied hosts win over wildcard allows", () => {
    const result = preflightCommandNetwork("curl https://evil.example.com/upload", {
      allowedHosts: ["*.example.com"],
      deniedHosts: ["evil.example.com"],
      defaultDecision: "allow",
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe("deny");
    expect(result.violations).toEqual([
      expect.objectContaining({ host: "evil.example.com", decision: "deny", matchedRule: "evil.example.com" }),
    ]);
  });

  it("allows commands with no detected network hosts", () => {
    expect(preflightCommandNetwork("npm test", { defaultDecision: "deny" })).toMatchObject({
      allowed: true,
      decision: "allow",
      detectedHosts: [],
    });
  });
});
