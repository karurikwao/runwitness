export interface CommandInvocationParts {
  command: string;
  args?: string[];
}

export function renderInvocation(invocation: CommandInvocationParts): string {
  const args = invocation.args ?? [];
  if (args.length === 0) {
    return invocation.command;
  }
  return [invocation.command, ...args].map(formatShellPart).join(" ");
}

function formatShellPart(value: string): string {
  return value.length === 0 || /[\s"'`|&<>()[\]{};]/.test(value) ? JSON.stringify(value) : value;
}
