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

  it('builds codex exec resume args with sandbox config override', () => {
    expect(
      buildCodexResumeArgs({
        codexThreadId: '019f-thread',
        sandbox: 'read-only',
        model: 'gpt-5',
        reasoning: 'high'
      })
    ).toEqual([
      'exec',
      'resume',
      '--json',
      '--skip-git-repo-check',
      '-c',
      'sandbox_mode="read-only"',
      '--model',
      'gpt-5',
      '-c',
      'model_reasoning_effort="high"',
      '019f-thread'
    ]);
  });

  it('does not pass unsupported profile cwd or sandbox flags to resume', () => {
    const args = buildCodexResumeArgs({
      codexThreadId: '019f-thread',
      profile: 'default',
      cwd: '/tmp/project',
      sandbox: 'workspace-write'
    });
    expect(args).not.toContain('-p');
    expect(args).not.toContain('-C');
    expect(args).not.toContain('--sandbox');
    expect(args).toContain('sandbox_mode="workspace-write"');
  });

  it('passes controlled image paths to exec and resume before the session id', () => {
    expect(
      buildCodexExecArgs({
        cwd: '/repo',
        sandbox: 'read-only',
        imagePaths: ['/data/attachments/a.png', '/data/attachments/b.webp']
      })
    ).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-C',
      '/repo',
      '--sandbox',
      'read-only',
      '--image',
      '/data/attachments/a.png',
      '--image',
      '/data/attachments/b.webp'
    ]);

    const resume = buildCodexResumeArgs({
      codexThreadId: '019f-thread',
      sandbox: 'read-only',
      imagePaths: ['/data/attachments/a.png']
    });
    expect(resume.slice(-3)).toEqual([
      '--image',
      '/data/attachments/a.png',
      '019f-thread'
    ]);
  });
});
