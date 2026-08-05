import type { ReasoningEffort, SandboxMode } from '@clawee/protocol';

export type BuildCodexExecArgsInput = {
  profile?: string;
  cwd: string;
  sandbox: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
  imagePaths?: string[];
  mcpServers?: CodexMcpServerConfig[];
  builtInTools?: BuiltInToolPolicy;
};

export type BuildCodexResumeArgsInput = {
  codexThreadId: string;
  profile?: string;
  cwd?: string;
  sandbox: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
  imagePaths?: string[];
  mcpServers?: CodexMcpServerConfig[];
  builtInTools?: BuiltInToolPolicy;
};

export type BuiltInToolPolicy = {
  shell: boolean;
  fileRead: boolean;
  fileWrite: boolean;
  applyPatch: boolean;
  webSearch: boolean;
};

type CodexMcpServerCommonConfig = {
  name: string;
  enabledTools?: string[];
  required?: boolean;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
};

export type CodexMcpServerConfig = CodexMcpServerCommonConfig & (
  | {
      command: string;
      args?: string[];
      envVars?: string[];
      url?: never;
      bearerTokenEnvVar?: never;
    }
  | {
      url: string;
      bearerTokenEnvVar?: string;
      command?: never;
      args?: never;
      envVars?: never;
    }
);

export function buildCodexExecArgs(input: BuildCodexExecArgsInput): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check'];

  if (input.builtInTools !== undefined) {
    args.push('--ignore-user-config', ...codexToolIsolationArgs(input.builtInTools));
  }

  if (input.profile) args.push('-p', input.profile);
  args.push('-C', input.cwd);
  args.push('--sandbox', input.sandbox);
  if (input.model) args.push('--model', input.model);
  if (input.reasoning && input.reasoning !== 'default') {
    args.push('-c', `model_reasoning_effort="${input.reasoning}"`);
  }
  args.push(...buildCodexMcpConfigArgs(input.mcpServers));
  for (const imagePath of input.imagePaths ?? []) args.push('--image', imagePath);

  return args;
}

export function buildCodexResumeArgs(input: BuildCodexResumeArgsInput): string[] {
  const args = ['exec'];
  if (input.builtInTools !== undefined) {
    args.push('--ignore-user-config', ...codexToolIsolationArgs(input.builtInTools));
  }
  args.push('resume', '--json', '--skip-git-repo-check');

  args.push('-c', `sandbox_mode="${input.sandbox}"`);
  if (input.model) args.push('--model', input.model);
  if (input.reasoning && input.reasoning !== 'default') {
    args.push('-c', `model_reasoning_effort="${input.reasoning}"`);
  }
  args.push(...buildCodexMcpConfigArgs(input.mcpServers));
  for (const imagePath of input.imagePaths ?? []) args.push('--image', imagePath);
  args.push(input.codexThreadId);

  return args;
}

export function codexToolIsolationArgs(policy: BuiltInToolPolicy): string[] {
  if (Object.values(policy).some(enabled => enabled)) {
    throw new Error('Knowledge built-in tool policy must disable every tool');
  }
  const disabled = [
    'hooks',
    'plugins',
    'apps',
    'multi_agent',
    'browser_use',
    'computer_use',
    'in_app_browser',
    'image_generation',
    'tool_suggest',
    'shell_tool',
    'unified_exec',
    'shell_snapshot'
  ];
  return [
    '-c', 'mcp_servers={}',
    '-c', 'plugins={}',
    '-c', 'web_search="disabled"',
    '-c', 'notify=[]',
    ...disabled.flatMap(feature => ['--disable', feature])
  ];
}

export function buildCodexMcpConfigArgs(
  servers: CodexMcpServerConfig[] | undefined
): string[] {
  const args: string[] = [];
  for (const server of servers ?? []) {
    if (!/^[A-Za-z0-9_-]+$/.test(server.name)) {
      throw new Error(`Invalid MCP server name: ${server.name}`);
    }
    const prefix = `mcp_servers.${server.name}`;
    if (server.url !== undefined) {
      pushConfig(args, `${prefix}.url`, JSON.stringify(server.url));
      if (server.bearerTokenEnvVar !== undefined) {
        pushConfig(
          args,
          `${prefix}.bearer_token_env_var`,
          JSON.stringify(server.bearerTokenEnvVar)
        );
      }
    } else {
      pushConfig(args, `${prefix}.command`, JSON.stringify(server.command));
      if (server.args !== undefined) {
        pushConfig(args, `${prefix}.args`, JSON.stringify(server.args));
      }
      if (server.envVars !== undefined) {
        pushConfig(args, `${prefix}.env_vars`, JSON.stringify(server.envVars));
      }
    }
    if (server.enabledTools !== undefined) {
      pushConfig(args, `${prefix}.enabled_tools`, JSON.stringify(server.enabledTools));
    }
    if (server.required !== undefined) {
      pushConfig(args, `${prefix}.required`, String(server.required));
    }
    if (server.startupTimeoutSec !== undefined) {
      pushConfig(
        args,
        `${prefix}.startup_timeout_sec`,
        String(server.startupTimeoutSec)
      );
    }
    if (server.toolTimeoutSec !== undefined) {
      pushConfig(args, `${prefix}.tool_timeout_sec`, String(server.toolTimeoutSec));
    }
  }
  return args;
}

function pushConfig(
  args: string[],
  key: string,
  value: string
): void {
  args.push('-c', `${key}=${value}`);
}
