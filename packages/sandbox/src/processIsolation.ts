export const PROCESS_ISOLATION_PLAN_VERSION = 1 as const;

export const SUPPORTED_PROCESS_ISOLATION_STRATEGIES = [
  "none",
  "temp-workspace",
  "container",
  "job-object/windows",
  "namespace/linux",
] as const;

export type ProcessIsolationStrategy = (typeof SUPPORTED_PROCESS_ISOLATION_STRATEGIES)[number];
export type ProcessIsolationRequest = ProcessIsolationStrategy | "auto";

export type ProcessIsolationCapabilityStatus =
  | "available"
  | "requires_runtime"
  | "requires_runner"
  | "not_applicable";

export type ProcessIsolationPlanStatus = "ready" | "requires_setup" | "not_applicable";
export type ProcessIsolationPlanStepStatus = "ready" | "requires_setup" | "not_applicable";

export interface ProcessIsolationPlatform {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
}

export interface ProcessIsolationStrategyDocumentation {
  strategy: ProcessIsolationStrategy;
  summary: string;
  boundary: string;
  provides: string[];
  limitations: string[];
  requirements: string[];
}

export interface ProcessIsolationCapabilityOptions {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  containerRuntime?: string;
  windowsJobObjectRunnerAvailable?: boolean;
  linuxNamespaceRunnerAvailable?: boolean;
}

export interface ProcessIsolationCapabilityAssessment extends ProcessIsolationStrategyDocumentation {
  platform: ProcessIsolationPlatform;
  status: ProcessIsolationCapabilityStatus;
  available: boolean;
  platformSupported: boolean;
  reasons: string[];
  evidence: string[];
}

export interface ProcessIsolationPlanOptions extends ProcessIsolationCapabilityOptions {
  requestedStrategy?: ProcessIsolationRequest;
  allowFallback?: boolean;
  reason?: string;
}

export interface ProcessIsolationGuarantees {
  workspace: string;
  filesystem: string;
  processTree: string;
  network: string;
  cleanup: string;
}

export interface ProcessIsolationPlanStep {
  name: string;
  action: string;
  status: ProcessIsolationPlanStepStatus;
}

export interface ProcessIsolationPlan {
  kind: "runwitness.processIsolationPlan";
  version: typeof PROCESS_ISOLATION_PLAN_VERSION;
  requestedStrategy: ProcessIsolationRequest;
  selectedStrategy: ProcessIsolationStrategy;
  status: ProcessIsolationPlanStatus;
  executable: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  reason?: string;
  platform: ProcessIsolationPlatform;
  guarantees: ProcessIsolationGuarantees;
  steps: ProcessIsolationPlanStep[];
  warnings: string[];
  limitations: string[];
  selectedCapability: ProcessIsolationCapabilityAssessment;
  capabilityAssessments: ProcessIsolationCapabilityAssessment[];
}

export const PROCESS_ISOLATION_STRATEGY_DOCUMENTATION: readonly ProcessIsolationStrategyDocumentation[] = [
  {
    strategy: "none",
    summary: "Run directly on the host with no process isolation.",
    boundary: "host-process",
    provides: ["No sandbox setup overhead", "Fully compatible host execution"],
    limitations: [
      "No filesystem isolation",
      "No process-tree containment",
      "No network isolation",
      "No cleanup beyond normal process exit",
    ],
    requirements: [],
  },
  {
    strategy: "temp-workspace",
    summary: "Copy the workspace into a disposable temporary directory and run from that copy.",
    boundary: "workspace-copy",
    provides: [
      "Reduces accidental writes to the source workspace",
      "Pairs with filtered command environments",
      "Produces auditable snapshots and cleanup points",
    ],
    limitations: [
      "Host process permissions still apply",
      "Child processes are not contained",
      "Network access is not blocked",
      "Host paths outside the temp workspace can still be touched by a malicious command",
    ],
    requirements: ["Writable temporary directory"],
  },
  {
    strategy: "container",
    summary: "Run inside a caller-provided container runtime such as Docker or Podman.",
    boundary: "container-runtime",
    provides: [
      "Runtime-level filesystem mounts",
      "Runtime-level process namespace controls",
      "Runtime-level network policy options",
    ],
    limitations: [
      "Guarantees depend on the runtime, image, mount flags, and network flags",
      "Container escape and privileged-runner risks are outside this package",
      "This package plans container use but does not spawn containers",
    ],
    requirements: ["Configured container runtime", "Approved image and mount policy"],
  },
  {
    strategy: "job-object/windows",
    summary: "Use Windows Job Objects through a dedicated runner to constrain and clean up process trees.",
    boundary: "windows-job-object",
    provides: [
      "Windows process-tree lifetime control",
      "Kill-on-close cleanup semantics when the runner supports them",
      "Optional resource limits when the runner supports them",
    ],
    limitations: [
      "Windows-only",
      "Does not create a filesystem namespace",
      "Does not block network access by itself",
      "Requires a runner outside this pure planning module",
    ],
    requirements: ["Windows host", "Job Object capable runner"],
  },
  {
    strategy: "namespace/linux",
    summary: "Use Linux namespaces through a dedicated runner to isolate process, mount, and optional network views.",
    boundary: "linux-namespaces",
    provides: [
      "Linux process namespace isolation when configured by the runner",
      "Mount namespace isolation when configured by the runner",
      "Optional user and network namespace controls",
    ],
    limitations: [
      "Linux-only",
      "Availability depends on kernel, distribution, user namespace policy, and runner privileges",
      "Requires a runner outside this pure planning module",
    ],
    requirements: ["Linux host", "Namespace-capable runner"],
  },
];

export function assessProcessIsolationCapabilities(
  options: ProcessIsolationCapabilityOptions = {},
): ProcessIsolationCapabilityAssessment[] {
  const platform = currentProcessIsolationPlatform(options);
  return PROCESS_ISOLATION_STRATEGY_DOCUMENTATION.map((documentation) =>
    assessProcessIsolationStrategy(documentation, platform, options),
  );
}

export function createProcessIsolationPlan(options: ProcessIsolationPlanOptions = {}): ProcessIsolationPlan {
  const platform = currentProcessIsolationPlatform(options);
  const requestedStrategy = options.requestedStrategy ?? "auto";
  const allowFallback = options.allowFallback ?? true;
  const capabilityAssessments = assessProcessIsolationCapabilities(options);

  let selectedCapability: ProcessIsolationCapabilityAssessment;
  let fallbackUsed = false;
  let fallbackReason: string | undefined;

  if (requestedStrategy === "auto") {
    selectedCapability = firstAvailableCapability(capabilityAssessments, defaultStrategyPreference(platform));
  } else {
    const requestedCapability = requireCapability(capabilityAssessments, requestedStrategy);

    if (requestedCapability.available || !allowFallback) {
      selectedCapability = requestedCapability;
    } else {
      selectedCapability = firstAvailableCapability(capabilityAssessments, defaultStrategyPreference(platform));
      fallbackUsed = selectedCapability.strategy !== requestedCapability.strategy;
      if (fallbackUsed) {
        fallbackReason = `${requestedCapability.strategy} is ${requestedCapability.status}; selected ${selectedCapability.strategy} instead.`;
      }
    }
  }

  const status = planStatusForCapability(selectedCapability);
  const warnings = planWarnings(selectedCapability, fallbackReason);

  return {
    kind: "runwitness.processIsolationPlan",
    version: PROCESS_ISOLATION_PLAN_VERSION,
    requestedStrategy,
    selectedStrategy: selectedCapability.strategy,
    status,
    executable: selectedCapability.available,
    fallbackUsed,
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
    platform,
    guarantees: guaranteesForStrategy(selectedCapability.strategy),
    steps: planStepsForStrategy(selectedCapability.strategy, status),
    warnings,
    limitations: selectedCapability.limitations,
    selectedCapability,
    capabilityAssessments,
  };
}

function assessProcessIsolationStrategy(
  documentation: ProcessIsolationStrategyDocumentation,
  platform: ProcessIsolationPlatform,
  options: ProcessIsolationCapabilityOptions,
): ProcessIsolationCapabilityAssessment {
  switch (documentation.strategy) {
    case "none":
      return {
        ...documentation,
        platform,
        status: "available",
        available: true,
        platformSupported: true,
        reasons: ["Host execution is always available."],
        evidence: ["No OS isolation runner is required."],
      };

    case "temp-workspace":
      return {
        ...documentation,
        platform,
        status: "available",
        available: true,
        platformSupported: true,
        reasons: ["The sandbox package includes temporary workspace primitives."],
        evidence: ["createIsolatedTempWorkspace can prepare and clean up disposable workspace copies."],
      };

    case "container": {
      const runtime = normalizeOptionalValue(options.containerRuntime);
      return {
        ...documentation,
        platform,
        status: runtime ? "available" : "requires_runtime",
        available: Boolean(runtime),
        platformSupported: true,
        reasons: runtime
          ? [`Container runtime declared by caller: ${runtime}.`]
          : ["No container runtime was declared to the planner."],
        evidence: [
          "Runtime availability is caller-supplied; this pure planner does not probe or spawn host tools.",
        ],
      };
    }

    case "job-object/windows":
      if (platform.platform !== "win32") {
        return {
          ...documentation,
          platform,
          status: "not_applicable",
          available: false,
          platformSupported: false,
          reasons: [`Current platform is ${platform.platform}, not win32.`],
          evidence: ["Windows Job Objects are only available on Windows hosts."],
        };
      }

      return {
        ...documentation,
        platform,
        status: options.windowsJobObjectRunnerAvailable ? "available" : "requires_runner",
        available: Boolean(options.windowsJobObjectRunnerAvailable),
        platformSupported: true,
        reasons: options.windowsJobObjectRunnerAvailable
          ? ["A Job Object capable runner was declared by the caller."]
          : ["No Job Object capable runner was declared to the planner."],
        evidence: [
          "Runner availability is caller-supplied; this pure planner does not call Windows APIs directly.",
        ],
      };

    case "namespace/linux":
      if (platform.platform !== "linux") {
        return {
          ...documentation,
          platform,
          status: "not_applicable",
          available: false,
          platformSupported: false,
          reasons: [`Current platform is ${platform.platform}, not linux.`],
          evidence: ["Linux namespaces are only available on Linux hosts."],
        };
      }

      return {
        ...documentation,
        platform,
        status: options.linuxNamespaceRunnerAvailable ? "available" : "requires_runner",
        available: Boolean(options.linuxNamespaceRunnerAvailable),
        platformSupported: true,
        reasons: options.linuxNamespaceRunnerAvailable
          ? ["A namespace-capable runner was declared by the caller."]
          : ["No namespace-capable runner was declared to the planner."],
        evidence: [
          "Runner availability is caller-supplied; this pure planner does not call unshare, bubblewrap, or kernel APIs.",
        ],
      };
  }
}

function currentProcessIsolationPlatform(options: ProcessIsolationCapabilityOptions): ProcessIsolationPlatform {
  return {
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
  };
}

function defaultStrategyPreference(platform: ProcessIsolationPlatform): readonly ProcessIsolationStrategy[] {
  if (platform.platform === "win32") {
    return ["job-object/windows", "container", "temp-workspace", "none"];
  }

  if (platform.platform === "linux") {
    return ["namespace/linux", "container", "temp-workspace", "none"];
  }

  return ["container", "temp-workspace", "none"];
}

function firstAvailableCapability(
  capabilities: readonly ProcessIsolationCapabilityAssessment[],
  strategyOrder: readonly ProcessIsolationStrategy[],
): ProcessIsolationCapabilityAssessment {
  for (const strategy of strategyOrder) {
    const capability = capabilities.find((candidate) => candidate.strategy === strategy);
    if (capability?.available) {
      return capability;
    }
  }

  return requireCapability(capabilities, "none");
}

function requireCapability(
  capabilities: readonly ProcessIsolationCapabilityAssessment[],
  strategy: ProcessIsolationStrategy,
): ProcessIsolationCapabilityAssessment {
  const capability = capabilities.find((candidate) => candidate.strategy === strategy);
  if (!capability) {
    throw new Error(`Unsupported process isolation strategy: ${strategy}`);
  }

  return capability;
}

function planStatusForCapability(capability: ProcessIsolationCapabilityAssessment): ProcessIsolationPlanStatus {
  if (capability.available) {
    return "ready";
  }

  return capability.status === "not_applicable" ? "not_applicable" : "requires_setup";
}

function planWarnings(
  selectedCapability: ProcessIsolationCapabilityAssessment,
  fallbackReason: string | undefined,
): string[] {
  const warnings: string[] = [];

  if (fallbackReason) {
    warnings.push(fallbackReason);
  }

  if (selectedCapability.strategy === "none") {
    warnings.push("No filesystem, process-tree, or network isolation is applied.");
  }

  if (selectedCapability.strategy === "temp-workspace") {
    warnings.push("Temporary workspace isolation does not contain host process trees or network access.");
  }

  if (!selectedCapability.available) {
    warnings.push(`${selectedCapability.strategy} is not ready: ${selectedCapability.status}.`);
  }

  return warnings;
}

function planStepsForStrategy(
  strategy: ProcessIsolationStrategy,
  status: ProcessIsolationPlanStatus,
): ProcessIsolationPlanStep[] {
  const stepStatus = stepStatusForPlanStatus(status);

  switch (strategy) {
    case "none":
      return [
        {
          name: "host-execution",
          action: "Launch the command directly on the host.",
          status: stepStatus,
        },
      ];

    case "temp-workspace":
      return [
        {
          name: "prepare-temp-workspace",
          action: "Copy tracked workspace files into a disposable temporary workspace.",
          status: stepStatus,
        },
        {
          name: "filter-environment",
          action: "Launch with a filtered environment and RUNWITNESS_SANDBOX_WORKSPACE pointing at the copy.",
          status: stepStatus,
        },
        {
          name: "cleanup-temp-workspace",
          action: "Remove the temporary workspace after the run.",
          status: stepStatus,
        },
      ];

    case "container":
      return [
        {
          name: "prepare-container-runtime",
          action: "Use the caller-declared container runtime, image, mounts, and network flags.",
          status: stepStatus,
        },
        {
          name: "mount-workspace",
          action: "Mount the workspace according to the run policy.",
          status: stepStatus,
        },
        {
          name: "collect-container-result",
          action: "Collect exit status and workspace changes after the container exits.",
          status: stepStatus,
        },
      ];

    case "job-object/windows":
      return [
        {
          name: "prepare-job-object-runner",
          action: "Use a Windows runner that creates a Job Object with cleanup semantics.",
          status: stepStatus,
        },
        {
          name: "launch-in-job",
          action: "Assign the command process tree to the Job Object.",
          status: stepStatus,
        },
        {
          name: "close-job",
          action: "Close the Job Object and terminate remaining assigned processes when configured.",
          status: stepStatus,
        },
      ];

    case "namespace/linux":
      return [
        {
          name: "prepare-namespace-runner",
          action: "Use a Linux runner that configures process, mount, user, and optional network namespaces.",
          status: stepStatus,
        },
        {
          name: "launch-in-namespaces",
          action: "Launch the command inside the configured namespace set.",
          status: stepStatus,
        },
        {
          name: "collect-namespace-result",
          action: "Collect exit status and workspace changes after the namespace runner exits.",
          status: stepStatus,
        },
      ];
  }
}

function stepStatusForPlanStatus(status: ProcessIsolationPlanStatus): ProcessIsolationPlanStepStatus {
  if (status === "ready") {
    return "ready";
  }

  return status === "not_applicable" ? "not_applicable" : "requires_setup";
}

function guaranteesForStrategy(strategy: ProcessIsolationStrategy): ProcessIsolationGuarantees {
  switch (strategy) {
    case "none":
      return {
        workspace: "source workspace",
        filesystem: "host filesystem",
        processTree: "host process tree",
        network: "host network",
        cleanup: "process exit only",
      };

    case "temp-workspace":
      return {
        workspace: "temporary workspace copy",
        filesystem: "source-workspace write reduction only",
        processTree: "host process tree",
        network: "host network",
        cleanup: "temporary workspace cleanup",
      };

    case "container":
      return {
        workspace: "runtime mount policy",
        filesystem: "container runtime filesystem policy",
        processTree: "container runtime process boundary",
        network: "container runtime network policy",
        cleanup: "container runtime cleanup",
      };

    case "job-object/windows":
      return {
        workspace: "caller-selected workspace",
        filesystem: "host filesystem unless paired with another strategy",
        processTree: "Windows Job Object process tree",
        network: "host network",
        cleanup: "Job Object cleanup semantics",
      };

    case "namespace/linux":
      return {
        workspace: "runner-selected mount namespace",
        filesystem: "Linux mount namespace when configured",
        processTree: "Linux process namespace",
        network: "Linux network namespace when configured",
        cleanup: "namespace runner cleanup",
      };
  }
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
