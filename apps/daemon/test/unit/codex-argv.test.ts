import { describe, expect, it } from 'vitest';
import { buildCodexExecArgs, buildCodexResumeArgs } from '../../src/codex/argv.js';

describe('codex argv', () => {
  it('builds exec args without prompt in argv', () => {
    const args = buildCodexExecArgs({
      profile: 'default',
      cwd: '/repo',
      sandbox: 'workspace-write',
      model: 'gpt-5',
      reasoning: 'high'
    });

    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-p',
      'default',
      '-C',
      '/repo',
      '--sandbox',
      'workspace-write',
      '--model',
      'gpt-5',
      '-c',
      'model_reasoning_effort="high"'
    ]);
    expect(args).not.toContain('hello');
  });

  it('builds codex exec resume args without unsupported cwd profile or sandbox flags', () => {
    expect(
      buildCodexResumeArgs({
        codexThreadId: '019f-thread',
        model: 'gpt-5',
        reasoning: 'high'
      })
    ).toEqual([
      'exec',
      'resume',
      '019f-thread',
      '--json',
      '--skip-git-repo-check',
      '--model',
      'gpt-5',
      '-c',
      'model_reasoning_effort="high"'
    ]);
  });

  it('does not pass profile cwd or sandbox to resume', () => {
    const args = buildCodexResumeArgs({
      codexThreadId: '019f-thread',
      profile: 'default',
      cwd: '/tmp/project',
      sandbox: 'workspace-write'
    });
    expect(args).not.toContain('-p');
    expect(args).not.toContain('-C');
    expect(args).not.toContain('--sandbox');
  });
});
