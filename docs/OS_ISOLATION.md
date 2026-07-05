# OS Isolation Planning

RunWitness currently exposes OS/process isolation as an auditable plan, not as a process runner. The planner lives in `packages/sandbox/src/processIsolation.ts` and records what strategy was requested, what is ready on the declared platform, what fallback was selected, and which limits remain.

## Strategies

- `none`: host execution with no filesystem, process-tree, or network isolation.
- `temp-workspace`: copies workspace files into a disposable temporary workspace and filters the launched environment. This reduces source-workspace writes but is not a kernel boundary.
- `container`: plans use of a caller-provided runtime such as Docker or Podman. Runtime, image, mount, and network policy determine the real boundary.
- `job-object/windows`: plans use of a Windows Job Object capable runner for process-tree cleanup and limits. It requires Windows and a runner outside the pure planner.
- `namespace/linux`: plans use of a Linux namespace capable runner for process, mount, user, and optional network namespaces. It requires Linux and a runner outside the pure planner.

## Current Posture

The sandbox package can assess the current platform, document each strategy, and create a serializable plan object. Only `none` and `temp-workspace` are ready without caller-supplied runtime facts. Container, Windows Job Object, and Linux namespace strategies become ready only when the caller declares an appropriate runtime or runner.

This module does not spawn containers, call OS sandbox APIs, block network access, or enforce nested-process policy. It is intended to make isolation intent explicit before those enforcement layers are wired into higher-level runners.
