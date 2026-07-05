#!/usr/bin/env node
import pc from "picocolors";
import { main } from "./index.js";

main().catch((error: unknown) => {
  console.error(pc.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
