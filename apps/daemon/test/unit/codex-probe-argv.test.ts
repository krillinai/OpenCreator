import { describe, expect, it } from 'vitest';
import { buildCodexProbeArgs } from '../../src/codex/probe-argv.js';

describe('Codex Probe argv', () => {
  it('uses an ephemeral read-only invocation with external integrations disabled', () => {
    const args = buildCodexProbeArgs({
      cwd: '/tmp/opencreator-probe',
      outputPath: '/tmp/opencreator-probe/result.txt'
    });

    expect(args).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-rules',
      '--sandbox',
      'read-only',
      '-c',
      'approval_policy="never"',
      '-c',
      'model_reasoning_effort="low"',
      '-c',
      'model_verbosity="low"',
      '-c',
      'mcp_servers={}',
      '-c',
      'plugins={}',
      '-c',
      'web_search="disabled"',
      '-c',
      'notify=[]',
      '-c',
      'check_for_update_on_startup=false',
      '--disable',
      'hooks',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      '--disable',
      'multi_agent',
      '--disable',
      'browser_use',
      '--disable',
      'computer_use',
      '--disable',
      'in_app_browser',
      '--disable',
      'image_generation',
      '--disable',
      'tool_suggest',
      '--disable',
      'shell_tool',
      '--disable',
      'unified_exec',
      '--disable',
      'shell_snapshot',
      '-C',
      '/tmp/opencreator-probe',
      '--output-last-message',
      '/tmp/opencreator-probe/result.txt'
    ]);
    expect(args).not.toContain('--ignore-user-config');
  });
});
