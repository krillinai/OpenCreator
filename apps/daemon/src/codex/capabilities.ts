import { spawnSync } from 'node:child_process';

export type ExecHelpCapabilities = {
  supportsJson: boolean;
  supportsProfiles: boolean;
  supportsCd: boolean;
  supportsSandbox: boolean;
  supportsImages: boolean;
  supportsSkipGitRepoCheck: boolean;
};

export type RuntimeCapabilityMatrix = {
  codexVersion: string;
  checkedAt: string;
  execJson: boolean;
  execStdinPrompt: boolean;
  execProfile: boolean;
  execCwd: boolean;
  execSandbox: boolean;
  execSkipGitRepoCheck: boolean;
  resumeJson: boolean;
  resumeByThreadId: boolean;
  resumeLast: boolean;
  resumeModelOverride: boolean;
  resumeConfigOverride: boolean;
  resumeCwdOverride: boolean;
  resumeProfileOverride: boolean;
  resumeSandboxOverride: boolean;
  execImages: boolean;
  resumeImages: boolean;
  resumeContextContinuityVerified: boolean;
  mcpList: boolean;
  mcpGet: boolean;
  mcpAdd: boolean;
  mcpRemove: boolean;
  mcpLogin: boolean;
  mcpLogout: boolean;
  mcpAddEnv: boolean;
  mcpAddUrl: boolean;
  mcpAddBearerTokenEnvVar: boolean;
  mcpAddOAuth: boolean;
  mcpRuntimeDiscoveryVerified: boolean;
  mcpRuntimeBehaviorVerified: boolean;
  skillsScan: boolean;
  skillsInstall: boolean;
  skillsDelete: boolean;
  skillsGlobalWrite: boolean;
  skillsRuntimeDiscoveryVerified: boolean;
  skillsRuntimeBehaviorVerified: boolean;
  warnings: string[];
};

export type CollectCodexCapabilityMatrixInput = {
  codexBin?: string;
  checkedAt?: string;
  resumeContextContinuityVerified?: boolean;
  timeoutMs?: number;
};

export function parseCodexExecHelp(help: string): ExecHelpCapabilities {
  return {
    supportsJson: help.includes('--json'),
    supportsProfiles: help.includes('--profile') || help.includes('-p,'),
    supportsCd: help.includes('--cd') || help.includes('-C,'),
    supportsSandbox: help.includes('--sandbox'),
    supportsImages: help.includes('--image'),
    supportsSkipGitRepoCheck: help.includes('--skip-git-repo-check')
  };
}

function hasMcpCommand(help: string, command: string): boolean {
  const commandPattern = new RegExp(`^\\s*${command}\\b`);
  let inCommandsSection = false;

  for (const line of help.split(/\r?\n/)) {
    if (/^\s*Commands:\s*$/.test(line)) {
      inCommandsSection = true;
      continue;
    }
    if (!inCommandsSection || line.trim() === '') continue;
    if (commandPattern.test(line)) return true;
    if (/^\S/.test(line)) break;
  }

  return false;
}

export function parseCodexCapabilityMatrix(input: {
  versionOutput: string;
  execHelp: string;
  resumeHelp: string;
  mcpHelp: string;
  mcpAddHelp: string;
  resumeContextContinuityVerified?: boolean;
  checkedAt?: string;
}): RuntimeCapabilityMatrix {
  const exec = parseCodexExecHelp(input.execHelp);

  return {
    codexVersion: input.versionOutput.trim(),
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    execJson: exec.supportsJson,
    execStdinPrompt: input.execHelp.includes('[PROMPT]') || input.execHelp.includes('PROMPT'),
    execProfile: exec.supportsProfiles,
    execCwd: exec.supportsCd,
    execSandbox: exec.supportsSandbox,
    execSkipGitRepoCheck: exec.supportsSkipGitRepoCheck,
    resumeJson: input.resumeHelp.includes('--json'),
    resumeByThreadId:
      input.resumeHelp.includes('[SESSION_ID]') || input.resumeHelp.includes('SESSION_ID'),
    resumeLast: input.resumeHelp.includes('--last'),
    resumeModelOverride: input.resumeHelp.includes('--model') || input.resumeHelp.includes('-m,'),
    resumeConfigOverride:
      input.resumeHelp.includes('--config') || input.resumeHelp.includes('-c,'),
    resumeCwdOverride: input.resumeHelp.includes('--cd') || input.resumeHelp.includes('-C,'),
    resumeProfileOverride:
      input.resumeHelp.includes('--profile') || input.resumeHelp.includes('-p,'),
    resumeSandboxOverride: input.resumeHelp.includes('--sandbox'),
    execImages: exec.supportsImages,
    resumeImages: input.resumeHelp.includes('--image') || input.resumeHelp.includes('-i,'),
    resumeContextContinuityVerified: input.resumeContextContinuityVerified ?? false,
    mcpList: hasMcpCommand(input.mcpHelp, 'list'),
    mcpGet: hasMcpCommand(input.mcpHelp, 'get'),
    mcpAdd: hasMcpCommand(input.mcpHelp, 'add'),
    mcpRemove: hasMcpCommand(input.mcpHelp, 'remove'),
    mcpLogin: hasMcpCommand(input.mcpHelp, 'login'),
    mcpLogout: hasMcpCommand(input.mcpHelp, 'logout'),
    mcpAddEnv: input.mcpAddHelp.includes('--env'),
    mcpAddUrl: input.mcpAddHelp.includes('--url'),
    mcpAddBearerTokenEnvVar: input.mcpAddHelp.includes('--bearer-token-env-var'),
    mcpAddOAuth:
      input.mcpAddHelp.includes('--oauth-client-id') &&
      input.mcpAddHelp.includes('--oauth-resource'),
    mcpRuntimeDiscoveryVerified: false,
    mcpRuntimeBehaviorVerified: false,
    skillsScan: false,
    skillsInstall: false,
    skillsDelete: false,
    skillsGlobalWrite: false,
    skillsRuntimeDiscoveryVerified: false,
    skillsRuntimeBehaviorVerified: false,
    warnings: []
  };
}

export function collectCodexCapabilityMatrix(
  input: CollectCodexCapabilityMatrixInput = {}
): RuntimeCapabilityMatrix {
  const codexBin = input.codexBin ?? 'codex';
  const version = runCodexInfo(codexBin, ['--version'], input.timeoutMs);
  const execHelp = runCodexInfo(codexBin, ['exec', '--help'], input.timeoutMs);
  const resumeHelp = runCodexInfo(codexBin, ['exec', 'resume', '--help'], input.timeoutMs);
  const mcpHelp = runCodexInfo(codexBin, ['mcp', '--help'], input.timeoutMs);
  const mcpAddHelp = runCodexInfo(codexBin, ['mcp', 'add', '--help'], input.timeoutMs);

  const matrix = parseCodexCapabilityMatrix({
    versionOutput: version.output.trim() || 'unknown',
    execHelp: execHelp.output,
    resumeHelp: resumeHelp.output,
    mcpHelp: mcpHelp.output,
    mcpAddHelp: mcpAddHelp.output,
    resumeContextContinuityVerified: input.resumeContextContinuityVerified,
    checkedAt: input.checkedAt
  });

  matrix.warnings.push(
    ...version.warnings,
    ...execHelp.warnings,
    ...resumeHelp.warnings,
    ...mcpHelp.warnings,
    ...mcpAddHelp.warnings
  );
  if (!isResumeExecutionSupported(matrix)) {
    matrix.warnings.push('Codex resume execution support was not verified from help output.');
  }

  return matrix;
}

export function isResumeExecutionSupported(matrix: RuntimeCapabilityMatrix): boolean {
  return matrix.resumeJson && matrix.resumeByThreadId;
}

export function withRuntimeSkillCapabilities(
  matrix: RuntimeCapabilityMatrix
): RuntimeCapabilityMatrix {
  return {
    ...matrix,
    skillsScan: true,
    skillsInstall: true,
    skillsDelete: true,
    skillsGlobalWrite: true
  };
}

function runCodexInfo(
  codexBin: string,
  args: string[],
  timeoutMs = 5_000
): { output: string; warnings: string[] } {
  const result = spawnSync(codexBin, args, {
    encoding: 'utf8',
    timeout: timeoutMs
  });
  const command = [codexBin, ...args].join(' ');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const warnings: string[] = [];

  if (result.error !== undefined) {
    warnings.push(`${command} failed: ${result.error.message}`);
  } else if (result.status !== 0) {
    warnings.push(`${command} exited with code ${result.status}`);
  }

  return { output, warnings };
}
