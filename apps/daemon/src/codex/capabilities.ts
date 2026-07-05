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
  resumeContextContinuityVerified: boolean;
  mcpAddEnv: boolean;
  warnings: string[];
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

export function parseCodexCapabilityMatrix(input: {
  versionOutput: string;
  execHelp: string;
  resumeHelp: string;
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
    resumeContextContinuityVerified: input.resumeContextContinuityVerified ?? false,
    mcpAddEnv: input.mcpAddHelp.includes('--env'),
    warnings: []
  };
}
