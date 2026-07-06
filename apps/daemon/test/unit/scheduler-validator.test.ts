import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCreateScheduleRequest, parseUpdateScheduleRequest } from '../../src/scheduler/validator.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

const profileValidator = {
  validateProfileForRun(name: string) {
    return name === 'missing'
      ? { ok: false as const, code: 'CODEX_PROFILE_NOT_FOUND', message: 'Profile not found: missing' }
      : { ok: true as const };
  }
};

describe('scheduler validator', () => {
  it('normalizes a create request with defaults', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-schedule-validator-'));
    const result = parseCreateScheduleRequest(
      {
        name: 'daily status',
        cron: '0 9 * * *',
        prompt: 'Summarize status',
        cwd: tempDir
      },
      {
        now: '2026-07-06T00:00:00.000Z',
        defaultCwd: tempDir,
        profileValidator
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        name: 'daily status',
        timezone: expect.any(String),
        enabled: true,
        profile: 'default',
        cwd: tempDir,
        canonicalCwd: realpathSync(tempDir),
        sandbox: 'workspace-write',
        concurrencyPolicy: 'skip',
        misfirePolicy: 'skip',
        nextRunAt: expect.any(String)
      }
    });
  });

  it('rejects invalid cron, timezone, timeout, misfire, cwd, and profile', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-schedule-validator-'));
    const base = { name: 'bad', cron: '0 9 * * *', prompt: 'x', cwd: tempDir };
    const options = {
      now: '2026-07-06T00:00:00.000Z',
      defaultCwd: tempDir,
      profileValidator
    };

    expect(parseCreateScheduleRequest({ ...base, cron: 'bad cron' }, options)).toMatchObject({
      ok: false,
      code: 'SCHEDULE_INVALID'
    });
    expect(parseCreateScheduleRequest({ ...base, timezone: 'Mars/Olympus' }, options)).toMatchObject({
      ok: false,
      code: 'SCHEDULE_INVALID'
    });
    expect(parseCreateScheduleRequest({ ...base, timeoutMs: 999 }, options)).toMatchObject({
      ok: false,
      code: 'SCHEDULE_INVALID'
    });
    expect(parseCreateScheduleRequest({ ...base, misfirePolicy: 'run_once' }, options)).toMatchObject({
      ok: false,
      code: 'SCHEDULE_INVALID'
    });
    expect(parseCreateScheduleRequest({ ...base, cwd: join(tempDir, 'missing') }, options)).toMatchObject({
      ok: false,
      code: 'SCHEDULE_INVALID'
    });
    expect(parseCreateScheduleRequest({ ...base, profile: 'missing' }, options)).toMatchObject({
      ok: false,
      code: 'CODEX_PROFILE_NOT_FOUND'
    });
  });

  it('normalizes an update request and permits clearing nullable overrides', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-schedule-validator-'));
    const result = parseUpdateScheduleRequest(
      {
        enabled: false,
        model: null,
        reasoning: null,
        timeoutMs: null
      },
      {
        now: '2026-07-06T00:00:00.000Z',
        defaultCwd: tempDir,
        profileValidator
      }
    );

    expect(result).toEqual({
      ok: true,
      value: {
        enabled: false,
        model: null,
        reasoning: null,
        timeoutMs: null
      }
    });
  });
});
