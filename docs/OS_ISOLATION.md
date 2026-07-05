# OS Isolation Planning

RunWitness exposes OS/process isolation in two layers: an auditable strategy planner and an opt-in container-backed runner. The planner lives in `packages/sandbox/src/processIsolation.ts` and records what strategy was requested, what is ready on the declared platform, what fallback was selected, and which limits remain. The enforced container runner lives in `packages/sandbox/src/enforcedSandbox.ts` and builds/runs Docker or Podman invocations with explicit mounts, environment allowlists, and network modes.

## Strategies

- `none`: host execution with no filesystem, process-tree, or network isolation.
- `temp-workspace`: copies workspace files into a disposable temporary workspace and filters the launched environment. This reduces source-workspace writes but is not a kernel boundary.
- `container`: plans use of a caller-provided runtime such as Docker or Podman. Runtime, image, mount, and network policy determine the real boundary.
- `job-object/windows`: plans use of a Windows Job Object capable runner for process-tree cleanup and limits. It requires Windows and a runner outside the pure planner.
- `namespace/linux`: plans use of a Linux namespace capable runner for process, mount, user, and optional network namespaces. It requires Linux and a runner outside the pure planner.

## Current Posture

The sandbox package can assess the current platform, document each strategy, and create a serializable plan object. Only `none` and `temp-workspace` are ready without caller-supplied runtime facts. Container, Windows Job Object, and Linux namespace strategies become ready only when the caller declares an appropriate runtime or runner.

The container runner can build a dry-run invocation or spawn Docker/Podman with a read-only workspace mount by default, optional read-write mode, explicit `disabled`/`bridge`/`host` network modes, and secret-safe `--env KEY` pass-through for allowlisted variables. It is available from code through `runEnforcedSandbox` and from the CLI:

```bash
npm run rw -- sandbox container --image node:22-alpine --dry-run -- node --version
```

Current limits: normal `runwitness run` commands still use the host or temporary-workspace path unless the operator chooses the container sandbox command, Docker/Podman availability is the operator's responsibility, network enforcement is delegated to the selected container runtime mode, and Windows Job Object/Linux namespace runners remain planned integrations.
