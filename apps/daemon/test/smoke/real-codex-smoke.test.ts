import type { ThreadHistoryItem } from '@opencreator/protocol';
import type { SmokeCommandResult } from '../../src/codex/smoke.js';
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildServer } from '../../src/api/server.js';
import { collectCodexCapabilityMatrix } from '../../src/codex/capabilities.js';
import { runRealCodexResumeSmoke, runSmokeCommand } from '../../src/codex/smoke.js';

const runRealCodex = process.env.OPENCREATOR_RUN_REAL_CODEX_SMOKE === '1';
const fixtureDir = join(process.cwd(), 'test', 'fixtures', 'real-codex', 'generated');
const SCHEDULER_FIRST_MARKER = 'P0_SCHEDULE_FIRST_MARKER';
const SCHEDULER_SECOND_MARKER = 'P0_SCHEDULE_SECOND_MARKER';
const ROTATION_FIRST_MARKER = 'P2_ROTATION_FIRST_MARKER';
const ROTATION_SECOND_MARKER = 'P2_ROTATION_SECOND_MARKER';

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
  }, 240_000);

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

  it('verifies a Runtime-installed skill is accepted by the global codex environment', async () => {
    const skillId = `r4_smoke_skill_${Date.now()}`;
    const marker = `R4_SKILL_SMOKE_MARKER_${Date.now()}`;
    const source = join(fixtureDir, `skills-source-${Date.now()}`);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), [
      '---',
      `name: ${skillId}`,
      'description: "R4 smoke skill used to verify global Codex skills directory discovery."',
      '---',
      '',
      `When explicitly asked for ${marker}, reply with ${marker}.`
    ].join('\n'));

    const server = await buildServer({
      token: 'secret',
      dataDir: join(fixtureDir, `skills-runtime-${Date.now()}`)
    });
    try {
      const installed = await server.inject({
        method: 'POST',
        url: '/codex/skills/install',
        headers: { authorization: 'Bearer secret' },
        payload: {
          sourcePath: source,
          id: skillId,
          confirmWriteToCodexHome: true
        }
      });
      expect(installed.statusCode).toBe(201);

      const result = runSmokeCommand([
        'codex',
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        `Use the ${skillId} skill and reply with ${marker} only.`
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
        await server.inject({
          method: 'DELETE',
          url: `/codex/skills/${encodeURIComponent(skillId)}?confirmWriteToCodexHome=true`,
          headers: { authorization: 'Bearer secret' }
        });
      } finally {
        try {
          await server.close();
        } finally {
          rmSync(source, { recursive: true, force: true });
        }
      }
    }
  }, 240_000);

  it('verifies isolated CODEX_HOME skills layout without requiring model auth', async () => {
    const home = join(fixtureDir, `skills-layout-${Date.now()}`);
    const source = join(fixtureDir, `skills-layout-source-${Date.now()}`);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), [
      '---',
      'name: r4_layout_skill',
      'description: "R4 smoke skill used to verify isolated skills layout."',
      '---',
      '',
      'Layout-only smoke.'
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
        payload: { sourcePath: source, id: 'r4_layout_skill' }
      });
      expect(installed.statusCode).toBe(201);

      const listed = await server.inject({
        method: 'GET',
        url: '/codex/skills',
        headers: { authorization: 'Bearer secret' }
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject({
        codexHomeMode: 'isolated',
        skills: [
          expect.objectContaining({
            id: 'r4_layout_skill',
            status: 'valid'
          })
        ]
      });
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
        'opencreator-r5-echo',
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
        'opencreator-r5-echo'
      ]);
      writeFixture('mcp-get', getResult);
      expect(getResult.exitCode, getResult.stderr || getResult.stdout).toBe(0);
      expect(getResult.stdout).toContain('opencreator-r5-echo');
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
      expect(listResult.stdout).toContain('opencreator-r5-echo');

      const removeResult = runSmokeCommand([
        'env',
        `CODEX_HOME=${home}`,
        'codex',
        'mcp',
        'remove',
        'opencreator-r5-echo'
      ]);
      writeFixture('mcp-remove', removeResult);
      expect(removeResult.exitCode, removeResult.stderr || removeResult.stdout).toBe(0);

      const getAfterRemove = runSmokeCommand([
        'env',
        `CODEX_HOME=${home}`,
        'codex',
        'mcp',
        'get',
        'opencreator-r5-echo'
      ]);
      writeFixture('mcp-get-after-remove', getAfterRemove);
      expect(getAfterRemove.exitCode).not.toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(serverDir, { recursive: true, force: true });
    }
  });

  it('runs one schedule twice through the same OpenCreator and Codex threads', async () => {
    const dataDir = join(fixtureDir, `scheduler-data-${Date.now()}`);
    const workspace = join(fixtureDir, `scheduler-workspace-${Date.now()}`);
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(workspace, { recursive: true });

    const server = await buildServer({
      token: 'secret',
      dataDir,
      codexBin: 'codex',
      // Mirror production startup against the user's real Codex home and capability probe.
      // The smoke only creates Runtime data/workspace and runs Codex in read-only sandbox.
      capabilities: collectCodexCapabilityMatrix({ codexBin: 'codex' }),
      schedulerAutostart: false
    });

    try {
      const created = await server.inject({
        method: 'POST',
        url: '/schedules',
        headers: { authorization: 'Bearer secret' },
        payload: {
          name: 'real codex scheduler smoke',
          cron: '0 9 * * *',
          timezone: 'UTC',
          prompt: [
            'This scheduled task runs repeatedly in one conversation.',
            'Do not run tools and do not modify files.',
            `If no earlier assistant message contains ${SCHEDULER_FIRST_MARKER}, reply with ${SCHEDULER_FIRST_MARKER} only.`,
            `If an earlier assistant message contains ${SCHEDULER_FIRST_MARKER}, reply with ${SCHEDULER_SECOND_MARKER} only.`
          ].join(' '),
          cwd: workspace,
          sandbox: 'read-only',
          timeoutMs: 180_000
        }
      });

      if (created.statusCode !== 201) {
        writeSchedulerFixture('scheduler-run-now', {
          created: responseFixture(created)
        });
        throwIfBlockedResponse(created, 'create schedule');
      }
      expect(created.statusCode).toBe(201);

      const scheduleId = created.json<{ id: string }>().id;
      const threadId = created.json<{ threadId: string }>().threadId;
      const first = await runScheduleNow(server, scheduleId, dataDir);
      const second = await runScheduleNow(server, scheduleId, dataDir);
      const operations = await server.inject({
        method: 'GET',
        url: `/schedules/${scheduleId}/operations`,
        headers: { authorization: 'Bearer secret' }
      });

      const fixture = {
        created: responseFixture(created),
        first: {
          runNow: responseFixture(first.runNow),
          finished: responseFixture(first.finished),
          events: first.events
        },
        second: {
          runNow: responseFixture(second.runNow),
          finished: responseFixture(second.finished),
          events: second.events
        },
        operations: responseFixture(operations)
      };
      writeSchedulerFixture('scheduler-run-now', fixture);

      const firstRun = first.finished.json<{
        status: string;
        threadId?: string | null;
        codexThreadId?: string | null;
        createdBy?: string;
        sourceId?: string | null;
        errorCode?: string | null;
        errorMessage?: string | null;
      }>();
      const secondRun = second.finished.json<typeof firstRun>();
      if (firstRun.status !== 'succeeded') throwIfBlockedRun(firstRun, fixture);
      if (secondRun.status !== 'succeeded') throwIfBlockedRun(secondRun, fixture);

      expect(firstRun).toMatchObject({
        status: 'succeeded',
        threadId,
        createdBy: 'schedule',
        sourceId: scheduleId
      });
      expect(secondRun).toMatchObject({
        status: 'succeeded',
        threadId,
        codexThreadId: firstRun.codexThreadId,
        createdBy: 'schedule',
        sourceId: scheduleId
      });
      expect(firstRun.codexThreadId).toMatch(/[0-9a-f-]{10,}/);
      expect(first.runNow.json()).toMatchObject({
        skipped: false,
        queued: false,
        schedule: {
          id: scheduleId,
          lastRunId: first.runId
        }
      });
      expect(second.runNow.json()).toMatchObject({
        skipped: false,
        queued: false,
        schedule: {
          id: scheduleId,
          lastRunId: second.runId
        }
      });
      expect(
        operations.json().operations.filter(
          (operation: { operation: string }) => operation.operation === 'run_now'
        )
      ).toHaveLength(2);
      expect(first.events.body).toContain(SCHEDULER_FIRST_MARKER);
      expect(second.events.body).toContain(SCHEDULER_SECOND_MARKER);
      expect(first.events.eventTypes).toContain('assistant_message');
      expect(second.events.eventTypes).toContain('assistant_message');
      expect(first.events.eventTypes).toContain('done');
      expect(second.events.eventTypes).toContain('done');
    } finally {
      await server.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 240_000);

  it('rotates a scheduled Codex thread and restores context from ConversationSummary', async () => {
    const dataDir = join(fixtureDir, `rotation-data-${Date.now()}`);
    const workspace = join(fixtureDir, `rotation-workspace-${Date.now()}`);
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    let rotationSummaryItems: ThreadHistoryItem[] = [];

    const server = await buildServer({
      token: 'secret',
      dataDir,
      codexBin: 'codex',
      capabilities: collectCodexCapabilityMatrix({ codexBin: 'codex' }),
      schedulerAutostart: false,
      codexThreadRotationRunThreshold: 1,
      memoryHistoryReader: () => ({ items: rotationSummaryItems })
    });

    try {
      const created = await server.inject({
        method: 'POST',
        url: '/schedules',
        headers: { authorization: 'Bearer secret' },
        payload: {
          name: 'real codex rotation smoke',
          cron: '0 9 * * *',
          timezone: 'UTC',
          prompt: [
            'This scheduled task validates context restoration after a Codex thread rotation.',
            'Do not run tools and do not modify files.',
            `If the restored summary does not contain ${ROTATION_FIRST_MARKER}, reply with ${ROTATION_FIRST_MARKER} only.`,
            `If the restored summary contains ${ROTATION_FIRST_MARKER}, reply with ${ROTATION_SECOND_MARKER} only.`
          ].join(' '),
          cwd: workspace,
          sandbox: 'read-only',
          timeoutMs: 180_000
        }
      });
      if (created.statusCode !== 201) {
        throwIfBlockedResponse(created, 'create rotation schedule');
      }

      const scheduleId = created.json<{ id: string }>().id;
      const threadId = created.json<{ threadId: string }>().threadId;
      const first = await runScheduleNow(server, scheduleId, dataDir);
      const firstRun = first.finished.json<{
        status: string;
        threadId?: string | null;
        codexThreadId?: string | null;
        errorCode?: string | null;
        errorMessage?: string | null;
      }>();
      if (firstRun.status !== 'succeeded') throwIfBlockedRun(firstRun, first);
      expect(first.events.body).toContain(ROTATION_FIRST_MARKER);
      rotationSummaryItems = [readAssistantHistoryItem(dataDir, first.runId)];

      const summary = await server.inject({
        method: 'POST',
        url: `/threads/${encodeURIComponent(threadId)}/summaries`,
        headers: { authorization: 'Bearer secret' }
      });
      expect(summary.statusCode).toBe(201);
      expect(summary.body).toContain(ROTATION_FIRST_MARKER);

      const second = await runScheduleNow(server, scheduleId, dataDir);
      const secondRun = second.finished.json<typeof firstRun>();
      const fixture = {
        created: responseFixture(created),
        first: {
          finished: responseFixture(first.finished),
          events: first.events
        },
        summary: responseFixture(summary),
        second: {
          finished: responseFixture(second.finished),
          events: second.events
        }
      };
      writeSchedulerFixture('scheduler-thread-rotation', fixture);
      if (secondRun.status !== 'succeeded') throwIfBlockedRun(secondRun, fixture);

      expect(firstRun).toMatchObject({ status: 'succeeded', threadId });
      expect(secondRun).toMatchObject({ status: 'succeeded', threadId });
      expect(secondRun.codexThreadId).not.toBe(firstRun.codexThreadId);
      expect(second.events.body).toContain(ROTATION_SECOND_MARKER);
      expect(second.events.body).toContain('THREAD_CODEX_SESSION_ROTATED');
      expect(second.events.body).toContain('执行上下文已重新连接');
    } finally {
      await server.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
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
  }, 240_000);

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

async function runScheduleNow(
  server: Awaited<ReturnType<typeof buildServer>>,
  scheduleId: string,
  dataDir: string
) {
  const runNow = await server.inject({
    method: 'POST',
    url: `/schedules/${scheduleId}/run-now`,
    headers: { authorization: 'Bearer secret' }
  });

  if (runNow.statusCode !== 202) {
    throwIfBlockedResponse(runNow, 'run schedule now');
  }
  expect(runNow.statusCode).toBe(202);

  const runId = runNow.json<{ run: { id: string } | null }>().run?.id;
  if (runId === undefined) throw new Error('scheduler smoke did not create a run');

  await expect
    .poll(async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/runs/${runId}`,
        headers: { authorization: 'Bearer secret' }
      });
      return response.json<{ status?: string }>().status;
    }, { timeout: 180_000, interval: 1_000 })
    .toMatch(/^(succeeded|failed|canceled)$/);

  const finished = await server.inject({
    method: 'GET',
    url: `/runs/${runId}`,
    headers: { authorization: 'Bearer secret' }
  });
  return {
    runId,
    runNow,
    finished,
    events: readRunEventsFixture(dataDir, runId)
  };
}

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

function writeSchedulerFixture(name: string, value: unknown): void {
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

function responseFixture(response: {
  statusCode: number;
  body: string;
  json: <T = unknown>() => T;
}): { statusCode: number; body: unknown } {
  let body: unknown;
  try {
    body = response.json();
  } catch {
    body = response.body;
  }
  return { statusCode: response.statusCode, body };
}

function readRunEventsFixture(
  dataDir: string,
  runId: string
): { body: string; eventTypes: string[] } {
  const body = readFileSync(join(dataDir, 'runs', runId, 'events.ndjson'), 'utf8');
  const eventTypes = body
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => (JSON.parse(line) as { type?: string }).type)
    .filter((type): type is string => type !== undefined);
  return { body, eventTypes };
}

function readAssistantHistoryItem(dataDir: string, runId: string): ThreadHistoryItem {
  const events = readFileSync(join(dataDir, 'runs', runId, 'events.ndjson'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as {
      id: string;
      ts: string;
      type?: string;
      payload?: { type?: string; text?: string };
    });
  let event: (typeof events)[number] | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (
      candidate?.type === 'assistant_message'
      && candidate.payload?.type === 'assistant_message'
      && typeof candidate.payload.text === 'string'
    ) {
      event = candidate;
      break;
    }
  }
  if (event?.payload?.text === undefined) {
    throw new Error(`Run ${runId} did not persist an assistant message for summary creation`);
  }
  return {
    id: event.id,
    type: 'assistant_message',
    text: event.payload.text,
    createdAt: event.ts
  };
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

function throwIfBlockedResponse(response: { body: string }, phase: string): void {
  if (!isBlockedEnvironmentText(response.body)) return;
  throw new Error(`BLOCKED_ENV: real Codex scheduler smoke could not ${phase}.
Summary:
${summarizeSmokeOutput(response.body)}`);
}

function throwIfBlockedRun(
  run: {
    status: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
  fixture: unknown
): void {
  const output = JSON.stringify(fixture);
  if (!isBlockedEnvironmentText(output)) return;

  throw new Error(`BLOCKED_ENV: real Codex scheduler smoke could not reach an authenticated/model-ready runtime.
Status: ${run.status}
Error code: ${run.errorCode ?? 'none'}
Error message: ${run.errorMessage ?? 'none'}
Summary:
${summarizeSmokeOutput(output)}`);
}

function isBlockedEnvironmentText(output: string): boolean {
  return /(not logged in|login|authentication|unauthorized|network|connection|timed out|ETIMEDOUT|rate limit|model .*unavailable|model_not_found|insufficient_quota|quota|offline|token_expired|refresh_token_reused)/i.test(output);
}
