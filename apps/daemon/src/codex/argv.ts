import type { ReasoningEffort, SandboxMode } from '@clawee/protocol';

export type BuildCodexExecArgsInput = {
  profile?: string;
  cwd: string;
  sandbox: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
};

export type BuildCodexResumeArgsInput = {
  codexThreadId: string;
  profile?: string;
  cwd?: string;
  sandbox?: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
};

export function buildCodexExecArgs(input: BuildCodexExecArgsInput): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check'];

  if (input.profile) args.push('-p', input.profile);
  args.push('-C', input.cwd);
  args.push('--sandbox', input.sandbox);
  if (input.model) args.push('--model', input.model);
  if (input.reasoning && input.reasoning !== 'default') {
    args.push('-c', `model_reasoning_effort="${input.reasoning}"`);
  }

  return args;
}

export function buildCodexResumeArgs(input: BuildCodexResumeArgsInput): string[] {
  const args = ['exec', 'resume', input.codexThreadId, '--json', '--skip-git-repo-check'];

  if (input.model) args.push('--model', input.model);
  if (input.reasoning && input.reasoning !== 'default') {
    args.push('-c', `model_reasoning_effort="${input.reasoning}"`);
  }

  return args;
}
