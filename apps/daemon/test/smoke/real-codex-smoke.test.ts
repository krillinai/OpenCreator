import type { SmokeCommandResult } from '../../src/codex/smoke.js';
import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildServer } from '../../src/api/server.js';
import { runRealCodexResumeSmoke, runSmokeCommand } from '../../src/codex/smoke.js';

const runRealCodex = process.env.CLAWEE_RUN_REAL_CODEX_SMOKE === '1';
const fixtureDir = join(process.cwd(), 'test', 'fixtures', 'real-codex', 'generated');

describe.runIf(runRealCodex)('real codex smoke', () => {
  it('captures codex version', () => {
    const result = runSmokeCommand(['codex', '--version']);
    writeFixture('version', result);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('codex');
  });

  it('captures codex exec help', () => {
    const result = runSmokeCommand(['codex', 'exec', '--help']);
    writeFixture('exec-help', result);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('--json');
  });

  it('captures codex exec resume help', () => {
    const result = runSmokeCommand(['codex', 'exec', 'resume', '--help']);
    writeFixture('exec-resume-help', result);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('--json');
  });

  it('captures codex mcp help', () => {
    const result = runSmokeCommand(['codex', 'mcp', '--help']);
    writeFixture('mcp-help', result);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('add');
  });

  it('captures codex mcp add help', () => {
    const result = runSmokeCommand(['codex', 'mcp', 'add', '--help']);
    writeFixture('mcp-add-help', result);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('--env');
  });

  it('captures a minimal codex exec jsonl fixture', () => {
    const result = runSmokeCommand([
      'codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      'Reply with OK only.'
    ]);
    writeFixture('exec-minimal-jsonl', result);

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('verifies isolated CODEX_HOME profile config shape', () => {
    const home = join(fixtureDir, `profile-smoke-${Date.now()}`);
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, 'r3_smoke.config.toml'),
      [
        'model = "gpt-5.3-codex"',
        'model_reasoning_effort = "medium"',
        ''
      ].join('\n')
    );

    const result = runSmokeCommand([
      'env',
      `CODEX_HOME=${home}`,
      'codex',
      '-p',
      'r3_smoke',
      'features',
      'list',
      '--help'
    ]);
    writeFixture('profile-overlay-help', result);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('List known features');
  });

  it('verifies a Runtime-installed skill is accepted by codex isolated CODEX_HOME', async () => {
    const home = join(fixtureDir, `skills-smoke-${Date.now()}`);
    const source = join(fixtureDir, `skills-source-${Date.now()}`);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), [
      '---',
      'name: r4_smoke_skill',
      'description: "R4 smoke skill used to verify Codex skills directory discovery."',
      '---',
      '',
      'When explicitly asked for R4_SKILL_SMOKE_MARKER, reply with R4_SKILL_SMOKE_MARKER.'
    ].join('\n'));

    const server = await buildServer({
      token: 'secret',
      dataDir: join(home, 'runtime'),
      codexHome: home
    });
    try {
      const installed = await server.inject({
        method: 'POST',
        url: '/codex/skills/install',
        headers: { authorization: 'Bearer secret' },
        payload: { sourcePath: source, id: 'r4_smoke_skill' }
      });
      expect(installed.statusCode).toBe(201);

      const result = runSmokeCommand([
        'env',
        `CODEX_HOME=${home}`,
        'codex',
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        'Use the r4_smoke_skill skill and reply with R4_SKILL_SMOKE_MARKER only.'
      ], { timeoutMs: 180_000 });
      writeFixture('skills-discovery-jsonl', result);

      throwIfBlockedEnvironment(result);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      expect(result.stdout + result.stderr).not.toContain('No such file or directory');
    } finally {
      try {
        await server.close();
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(source, { recursive: true, force: true });
      }
    }
  }, 240_000);

  it('adds, gets, lists, and removes a stdio MCP server through codex mcp', () => {
    const home = join(fixtureDir, `mcp-smoke-home-${Date.now()}`);
    const serverDir = join(fixtureDir, `mcp-smoke-server-${Date.now()}`);
    const serverPath = join(serverDir, 'echo-mcp.js');
    mkdirSync(home, { recursive: true });
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(
      serverPath,
      [
        '#!/usr/bin/env node',
        'process.stdin.resume();',
        "process.stdin.on('data', chunk => {",
        '  process.stdout.write(chunk);',
        '});',
        ''
      ].join('\n')
    );

    // R5 verifies Codex MCP configuration management. Model-time MCP tool invocation
    // remains a runtime behavior smoke and is recorded separately as BLOCKED_ENV
    // when local Codex auth is unavailable.
    try {
      const addResult = runSmokeCommand([
        'env',
        `CODEX_HOME=${home}`,
        'codex',
        'mcp',
        'add',
        'clawee-r5-echo',
        '--env',
        'R5_SMOKE_VALUE=visible-smoke-value',
        '--',
        process.execPath,
        serverPath
      ]);
      writeFixture('mcp-add', addResult);
      expect(addResult.exitCode, addResult.stderr || addResult.stdout).toBe(0);

      const getResult = runSmokeCommand([
        'env',
        `CODEX_HOME=${home}`,
        'codex',
        'mcp',
        'get',
        'clawee-r5-echo'
      ]);
      writeFixture('mcp-get', getResult);
      expect(getResult.exitCode, getResult.stderr || getResult.stdout).toBe(0);
      expect(getResult.stdout).toContain('clawee-r5-echo');
      expect(getResult.stdout).toContain('R5_SMOKE_VALUE');

      const listResult = runSmokeCommand([
        'env',
        `CODEX_HOME=${home}`,
        'codex',
        'mcp',
        'list'
      ]);
      writeFixture('mcp-list', listResult);
      expect(listResult.exitCode, listResult.stderr || listResult.stdout).toBe(0);
      expect(listResult.stdout).toContain('clawee-r5-echo');

      const removeResult = runSmokeCommand([
        'env',
        `CODEX_HOME=${home}`,
        'codex',
        'mcp',
        'remove',
        'clawee-r5-echo'
      ]);
      writeFixture('mcp-remove', removeResult);
      expect(removeResult.exitCode, removeResult.stderr || removeResult.stdout).toBe(0);

      const getAfterRemove = runSmokeCommand([
        'env',
        `CODEX_HOME=${home}`,
        'codex',
        'mcp',
        'get',
        'clawee-r5-echo'
      ]);
      writeFixture('mcp-get-after-remove', getAfterRemove);
      expect(getAfterRemove.exitCode).not.toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(serverDir, { recursive: true, force: true });
    }
  });

  it('captures a command execution jsonl fixture', () => {
    const result = runSmokeCommand([
      'codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      'Run the shell command `pwd` exactly once, then reply DONE.'
    ]);
    writeFixture('exec-command-jsonl', result);

    expect(result.exitCode).toBe(0);
    const events = result.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as { type?: string; item?: { type?: string } });
    expect(events.some(event => event.item?.type === 'command_execution')).toBe(true);
  });

  it('verifies codex exec resume context continuity', async () => {
    const result = await runRealCodexResumeSmoke({
      marker: `R2_RESUME_${Date.now()}`
    });
    writeResumeFixture(result);

    expect(result.first.exitCode).toBe(0);
    expect(result.first.threadId).toMatch(/[0-9a-f-]{10,}/);
    expect(result.first.malformedLines).toEqual([]);
    expect(result.first.toolEvents).toEqual([]);
    expect(result.second.exitCode).toBe(0);
    expect(result.second.malformedLines).toEqual([]);
    expect(result.second.toolEvents).toEqual([]);
    expect(result.second.agentMessages.join('\n')).toContain(result.marker);
    expect(result.resumeContextContinuityVerified).toBe(true);
    expect(result.first.stderr).toEqual(expect.any(String));
    expect(result.second.stderr).toEqual(expect.any(String));
  }, 240_000);
});

function writeFixture(name: string, result: SmokeCommandResult): void {
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, `${name}.json`),
    `${JSON.stringify({
      command: result.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      terminationSignal: result.terminationSignal,
      errorMessage: result.errorMessage
    }, null, 2)}\n`
  );
}

function writeResumeFixture(result: Awaited<ReturnType<typeof runRealCodexResumeSmoke>>): void {
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, 'exec-resume-context-continuity.json'),
    `${JSON.stringify(result, null, 2)}\n`
  );
}

function throwIfBlockedEnvironment(result: SmokeCommandResult): void {
  if (result.exitCode === 0) return;

  const output = `${result.stdout}\n${result.stderr}\n${result.errorMessage ?? ''}`;
  const blockedPattern =
    /(not logged in|login|authentication|unauthorized|network|connection|timed out|ETIMEDOUT|rate limit|model .*unavailable|model_not_found|insufficient_quota|quota|offline)/i;
  if (!blockedPattern.test(output)) return;

  throw new Error(`BLOCKED_ENV: real Codex smoke could not reach an authenticated/model-ready runtime.
Command: ${result.command.join(' ')}
Exit code: ${result.exitCode}
Timed out: ${result.timedOut}
Signal: ${result.terminationSignal ?? 'none'}
Summary:
${summarizeSmokeOutput(output)}`);
}

function summarizeSmokeOutput(output: string): string {
  const summary = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join('\n');
  return summary === '' ? '(no output)' : summary;
}
