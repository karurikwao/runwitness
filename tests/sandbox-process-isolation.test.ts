import { describe, expect, it } from "vitest";
import {
  assessProcessIsolationCapabilities,
  createProcessIsolationPlan,
  PROCESS_ISOLATION_STRATEGY_DOCUMENTATION,
  SUPPORTED_PROCESS_ISOLATION_STRATEGIES,
} from "../packages/sandbox/src/index.js";

describe("process isolation planning", () => {
  it("documents every supported strategy", () => {
    expect(PROCESS_ISOLATION_STRATEGY_DOCUMENTATION.map((entry) => entry.strategy)).toEqual(
      SUPPORTED_PROCESS_ISOLATION_STRATEGIES,
    );

    for (const entry of PROCESS_ISOLATION_STRATEGY_DOCUMENTATION) {
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.boundary.length).toBeGreaterThan(0);
      expect(entry.provides.length).toBeGreaterThan(0);
      expect(entry.limitations.length).toBeGreaterThan(0);
    }
  });

  it("assesses Windows-native and Linux-native strategies against the declared platform", () => {
    const windowsCapabilities = assessProcessIsolationCapabilities({ platform: "win32", arch: "x64" });

    expect(windowsCapabilities.find((entry) => entry.strategy === "temp-workspace")).toMatchObject({
      status: "available",
      available: true,
      platformSupported: true,
    });
    expect(windowsCapabilities.find((entry) => entry.strategy === "job-object/windows")).toMatchObject({
      status: "requires_runner",
      available: false,
      platformSupported: true,
    });
    expect(windowsCapabilities.find((entry) => entry.strategy === "namespace/linux")).toMatchObject({
      status: "not_applicable",
      available: false,
      platformSupported: false,
    });
  });

  it("falls back to temp-workspace when a requested strategy is not ready", () => {
    const plan = createProcessIsolationPlan({
      platform: "win32",
      arch: "x64",
      requestedStrategy: "namespace/linux",
    });

    expect(plan).toMatchObject({
      kind: "runwitness.processIsolationPlan",
      version: 1,
      requestedStrategy: "namespace/linux",
      selectedStrategy: "temp-workspace",
      status: "ready",
      executable: true,
      fallbackUsed: true,
    });
    expect(plan.fallbackReason).toContain("namespace/linux is not_applicable");
    expect(plan.guarantees.processTree).toBe("host process tree");
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        "Temporary workspace isolation does not contain host process trees or network access.",
      ]),
    );
  });

  it("returns a non-executable requested plan when fallback is disabled", () => {
    const plan = createProcessIsolationPlan({
      platform: "linux",
      arch: "x64",
      requestedStrategy: "container",
      allowFallback: false,
    });

    expect(plan).toMatchObject({
      selectedStrategy: "container",
      status: "requires_setup",
      executable: false,
      fallbackUsed: false,
    });
    expect(plan.selectedCapability.status).toBe("requires_runtime");
    expect(plan.steps.every((step) => step.status === "requires_setup")).toBe(true);
  });

  it("selects the strongest declared ready platform strategy for auto plans", () => {
    expect(
      createProcessIsolationPlan({
        platform: "win32",
        arch: "x64",
        requestedStrategy: "auto",
        containerRuntime: "docker",
        windowsJobObjectRunnerAvailable: true,
      }),
    ).toMatchObject({
      selectedStrategy: "job-object/windows",
      executable: true,
      guarantees: {
        processTree: "Windows Job Object process tree",
      },
    });

    expect(
      createProcessIsolationPlan({
        platform: "linux",
        arch: "x64",
        requestedStrategy: "auto",
        containerRuntime: "podman",
      }),
    ).toMatchObject({
      selectedStrategy: "container",
      executable: true,
      selectedCapability: {
        reasons: ["Container runtime declared by caller: podman."],
      },
    });
  });
});
