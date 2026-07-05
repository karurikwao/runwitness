import { randomBytes } from "node:crypto";

export function createRunId(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  const suffix = randomBytes(3).toString("hex");
  return `rw_${stamp}_${suffix}`;
}

export function createStepId(prefix = "step"): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}
