# Core Concepts

- **Run**: one user-requested task with a unique id, workspace, agent name, status, timeline, and final receipt.
- **Step**: a discrete observed action inside a run, such as a command, file snapshot, approval, or test result.
- **Receipt**: the final JSON and Markdown proof bundle for a run.
- **Policy**: local rules that classify actions as allowed, denied, or approval-required.
- **Skill**: a reusable capability with declared permissions, canonical digesting, and optional signature verification.
- **Approval**: a recorded human or non-interactive decision for a risky action.
- **Adapter**: the connection between RunWitness and the runtime doing work.

The product identity is: **Autonomous agents with receipts.**
