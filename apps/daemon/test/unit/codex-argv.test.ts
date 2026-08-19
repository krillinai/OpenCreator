import { describe, expect, it } from 'vitest';
import {
  buildCodexExecArgs,
  buildCodexMcpConfigArgs,
  buildCodexResumeArgs
} from '../../src/codex/argv.js';

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

  it('injects the same non-secret MCP config into exec and resume', () => {
    const mcpServers = [{
      name: 'opencreator_schedule',
      url: 'http://127.0.0.1:43123/internal/agent-tools/mcp',
      bearerTokenEnvVar: 'OPENCREATOR_AGENT_CAPABILITY_TOKEN',
      enabledTools: [
        'opencreator_schedule_update',
        'opencreator_schedule_get'
      ],
      required: true,
      startupTimeoutSec: 10,
      toolTimeoutSec: 30
    }];

    const exec = buildCodexExecArgs({
      cwd: '/repo',
      sandbox: 'workspace-write',
      mcpServers
    });
    const resume = buildCodexResumeArgs({
      codexThreadId: '019f-thread',
      sandbox: 'workspace-write',
      mcpServers
    });
    const expected = [
      '-c',
      'mcp_servers.opencreator_schedule.url="http://127.0.0.1:43123/internal/agent-tools/mcp"',
      '-c',
      'mcp_servers.opencreator_schedule.bearer_token_env_var="OPENCREATOR_AGENT_CAPABILITY_TOKEN"',
      '-c',
      'mcp_servers.opencreator_schedule.enabled_tools=["opencreator_schedule_update","opencreator_schedule_get"]',
      '-c',
      'mcp_servers.opencreator_schedule.required=true',
      '-c',
      'mcp_servers.opencreator_schedule.startup_timeout_sec=10',
      '-c',
      'mcp_servers.opencreator_schedule.tool_timeout_sec=30'
    ];

    expect(exec).toEqual(expect.arrayContaining(expected));
    expect(resume).toEqual(expect.arrayContaining(expected));
    expect(resume.at(-1)).toBe('019f-thread');
    expect(JSON.stringify([exec, resume])).not.toContain('clwcap_');
    expect(JSON.stringify([exec, resume])).not.toContain('/usr/bin/node');
  });

  it('formats a fail-closed built-in policy before MCP allowlisting', () => {
    const builtInTools = {
      shell: false,
      fileRead: false,
      fileWrite: false,
      applyPatch: false,
      webSearch: false
    } as const;
    const args = buildCodexExecArgs({
      cwd: '/knowledge',
      sandbox: 'read-only',
      builtInTools,
      mcpServers: [{
        name: 'opencreator_knowledge',
        url: 'http://127.0.0.1:43123/internal/agent-tools/mcp/knowledge',
        enabledTools: ['knowledge.search'],
        required: true
      }]
    });

    expect(args).toEqual(expect.arrayContaining([
      '--ignore-user-config',
      '-c', 'mcp_servers={}',
      '-c', 'plugins={}',
      '-c', 'web_search="disabled"',
      '--disable', 'shell_tool',
      '--disable', 'unified_exec',
      '-c', 'mcp_servers.opencreator_knowledge.enabled_tools=["knowledge.search"]'
    ]));
    expect(() => buildCodexExecArgs({
      cwd: '/knowledge',
      sandbox: 'read-only',
      builtInTools: { ...builtInTools, shell: true }
    })).toThrow('must disable every tool');
  });

  it('can disable an MCP server inherited from CODEX_HOME without redefining it', () => {
    expect(buildCodexMcpConfigArgs([{
      name: 'claw-mcp',
      enabled: false
    }])).toEqual([
      '-c',
      'mcp_servers.claw-mcp.enabled=false'
    ]);
  });
});
