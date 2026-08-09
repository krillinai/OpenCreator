import type { ReasoningEffort, SandboxMode } from '@clawee/protocol';

export type BuildCodexExecArgsInput = {
  profile?: string;
  cwd: string;
  sandbox: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
  imagePaths?: string[];
  mcpServers?: CodexMcpServerConfig[];
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
};

type CodexMcpServerCommonConfig = {
  name: string;
  enabled?: boolean;
  enabledTools?: string[];
  required?: boolean;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
};

export type CodexMcpServerConfig =
  | (CodexMcpServerCommonConfig & {
      enabled: false;
      command?: never;
      args?: never;
      envVars?: never;
      url?: never;
      bearerTokenEnvVar?: never;
    })
  | (CodexMcpServerCommonConfig & (
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
  ));

export function buildCodexExecArgs(input: BuildCodexExecArgsInput): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check'];

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
  const args = ['exec', 'resume', '--json', '--skip-git-repo-check'];

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
    } else if (server.command !== undefined) {
      pushConfig(args, `${prefix}.command`, JSON.stringify(server.command));
      if (server.args !== undefined) {
        pushConfig(args, `${prefix}.args`, JSON.stringify(server.args));
      }
      if (server.envVars !== undefined) {
        pushConfig(args, `${prefix}.env_vars`, JSON.stringify(server.envVars));
      }
    }
    if (server.enabled !== undefined) {
      pushConfig(args, `${prefix}.enabled`, String(server.enabled));
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
