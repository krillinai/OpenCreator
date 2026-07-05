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
      ]);
      writeFixture('skills-discovery-jsonl', result);

      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      expect(result.stdout + result.stderr).not.toContain('No such file or directory');
    } finally {
      await server.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  }, 240_000);

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
      stderr: result.stderr
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
