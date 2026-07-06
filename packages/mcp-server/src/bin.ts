#!/usr/bin/env node
import { parseRunWitnessMcpServerArgs, renderRunWitnessMcpServerHelp, runRunWitnessMcpStdioServer } from "./index.js";

const options = parseRunWitnessMcpServerArgs(process.argv.slice(2));

if (options.help) {
  console.log(renderRunWitnessMcpServerHelp());
  process.exit(0);
}

runRunWitnessMcpStdioServer(options).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
