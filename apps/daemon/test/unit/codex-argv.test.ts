import { describe, expect, it } from 'vitest';
import { buildCodexExecArgs } from '../../src/codex/argv.js';

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
});
