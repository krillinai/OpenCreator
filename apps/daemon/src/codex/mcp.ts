export type BuildMcpAddArgsInput = {
  name: string;
  env: Record<string, string>;
  command: string;
  args: string[];
};

export function buildMcpGetArgs(name: string): string[] {
  return ['mcp', 'get', name];
}

export function buildMcpAddArgs(input: BuildMcpAddArgsInput): string[] {
  const args = ['mcp', 'add', input.name];
  for (const [key, value] of Object.entries(input.env)) {
    args.push('--env', `${key}=${value}`);
  }
  args.push('--', input.command, ...input.args);
  return args;
}
