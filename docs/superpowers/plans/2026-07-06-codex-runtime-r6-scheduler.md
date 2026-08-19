# Codex Runtime R6 Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use git worktree; all work happens in the current workspace.

**Goal:** Build the R6 backend Scheduler so the local daemon can persist schedules, trigger ordinary Codex runs, enforce desktop-safe missed-trigger behavior, and expose schedule APIs.

**Architecture:** SQLite is the schedule source of truth. `cron-parser` is used only for cron/timezone/DST time calculation; the daemon owns timers, missed-trigger handling, concurrency, operation logs, and all state transitions. Scheduler never starts Codex directly: it creates ordinary runs through `RunManager.startRun()` with `createdBy = "schedule"` and `sourceId = scheduleId`.

**Tech Stack:** TypeScript, Fastify inject, better-sqlite3, Vitest, cron-parser 5.6.x, fake Codex, gated real Codex smoke.

---

## Context

Read before implementing:

- Spec: `docs/superpowers/specs/2026-07-06-codex-runtime-r6-scheduler-design.md`
- Contract: `docs/superpowers/specs/2026-07-03-codex-native-runtime-contract-design.md`
- Coverage plan: `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md`

Current Codex CLI check:

- `codex --version` currently reports `codex-cli 0.142.5`.
- `codex --help` does not expose a local `schedule` command.
- R6 is therefore a Runtime local thin scheduler, not a Codex schedule pass-through. If a future Codex CLI adds stable local schedule commands, R6 can be migrated into a pass-through layer.

R6 fixed product decisions:

- `misfirePolicy = "skip"` is the only supported policy.
- `run_once` is disabled by desktop safety and must return `SCHEDULE_INVALID`.
- Sleep/wake, daemon offline, and long event-loop stalls skip missed triggers.
- Schedule runs are independent runs and do not bind to existing threads.
- `queue` concurrency is coalesced: multiple overlapping triggers become one pending trigger.

## File Structure

Create:

- `apps/daemon/src/api/routes.schedules.ts` - schedule HTTP API and error mapping.
- `apps/daemon/src/scheduler/cron.ts` - wrapper around `cron-parser`.
- `apps/daemon/src/scheduler/repository.ts` - SQLite schedule and operation repository.
- `apps/daemon/src/scheduler/service.ts` - scheduler use cases, timers, run-now, due processing, concurrency.
- `apps/daemon/src/scheduler/validator.ts` - create/update request parsing and validation.
- `apps/daemon/test/unit/scheduler-cron.test.ts`
- `apps/daemon/test/unit/scheduler-validator.test.ts`
- `apps/daemon/test/unit/scheduler-repository.test.ts`
- `apps/daemon/test/unit/scheduler-service.test.ts`

Modify:

- `apps/daemon/package.json` and `pnpm-lock.yaml` - add `cron-parser`.
- `packages/protocol/src/api.ts` - schedule request/response types.
- `packages/protocol/src/errors.ts` - add `SCHEDULE_NOT_FOUND`.
- `apps/daemon/src/scheduler/types.ts` - replace the R0 helper-only types with full R6 types.
- `apps/daemon/src/scheduler/scheduler.ts` - keep `shouldRunMissedSchedule` compatibility but make R6 desktop-safe semantics explicit.
- `apps/daemon/src/storage/migrations.ts` - create `schedules` and `schedule_operations`, add indexes.
- `apps/daemon/src/storage/repositories.ts` - insert `timeout_ms` and expose run source metadata.
- `apps/daemon/src/runs/types.ts` - add `createdBy/sourceId/timeoutMs` to create input.
- `apps/daemon/src/runs/manager.ts` - persist source metadata and per-run timeout.
- `apps/daemon/src/api/server.ts` - construct scheduler service, register schedule routes, stop service on close.
- `apps/daemon/test/unit/protocol-shape.test.ts`
- `apps/daemon/test/unit/storage.test.ts`
- `apps/daemon/test/integration/run-manager.test.ts`
- `apps/daemon/test/integration/api.test.ts`
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md`

## Task 1: Protocol Types and Dependency

**Files:**

- Modify: `apps/daemon/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/errors.ts`
- Modify: `apps/daemon/test/unit/protocol-shape.test.ts`

- [ ] **Step 1: Add failing protocol shape test**

In `apps/daemon/test/unit/protocol-shape.test.ts`, extend the existing `@opencreator/protocol` type import to include schedule types:

```ts
import type {
  AgentEventEnvelope,
  CreateScheduleRequest,
  RunRequest,
  RunScheduleNowResponse,
  RuntimeErrorCode,
  ScheduleDetailResponse,
  ScheduleOperationListResponse,
  ScheduleResponse
} from '@opencreator/protocol';
```

Add tests inside the existing `describe('protocol shape', () => { ... })` block:

```ts
  it('allows schedule request and response shapes', () => {
    const request: CreateScheduleRequest = {
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize the project state',
      profile: 'default',
      sandbox: 'workspace-write',
      concurrencyPolicy: 'skip',
      misfirePolicy: 'skip'
    };
    const response: ScheduleResponse = {
      id: 'sch_123',
      name: request.name,
      cron: request.cron,
      timezone: 'Asia/Shanghai',
      enabled: true,
      promptPreviewRedacted: 'Summarize the project state',
      profile: 'default',
      cwd: '/tmp/project',
      canonicalCwd: '/tmp/project',
      model: null,
      reasoning: null,
      sandbox: 'workspace-write',
      timeoutMs: 60000,
      concurrencyPolicy: 'skip',
      misfirePolicy: 'skip',
      nextRunAt: '2026-07-06T01:00:00.000Z',
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null,
      pendingTrigger: false,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z'
    };
    const detail: ScheduleDetailResponse = {
      ...response,
      prompt: request.prompt
    };
    const runNow: RunScheduleNowResponse = {
      run: { id: 'run_1', status: 'running' },
      schedule: response,
      skipped: false,
      queued: false
    };
    const operations: ScheduleOperationListResponse = {
      operations: [
        {
          id: 'schop_1',
          operation: 'run_now',
          scheduleId: 'sch_123',
          status: 'succeeded',
          runId: 'run_1',
          errorCode: null,
          errorMessage: null,
          createdAt: '2026-07-06T00:00:01.000Z'
        }
      ]
    };

    expect(detail.prompt).toBe('Summarize the project state');
    expect(runNow.run?.id).toBe('run_1');
    expect(operations.operations[0]?.operation).toBe('run_now');
  });

  it('includes schedule not found as a closed error code', () => {
    const code: RuntimeErrorCode = 'SCHEDULE_NOT_FOUND';
    expect(code).toBe('SCHEDULE_NOT_FOUND');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/protocol-shape.test.ts
```

Expected: FAIL with TypeScript errors for missing exported schedule types and `SCHEDULE_NOT_FOUND`.

- [ ] **Step 3: Add cron-parser dependency**

Run:

```bash
pnpm --filter @opencreator/daemon add cron-parser@^5.6.1
```

Expected: `apps/daemon/package.json` includes `cron-parser`, and `pnpm-lock.yaml` changes.

- [ ] **Step 4: Add schedule protocol types**

In `packages/protocol/src/api.ts`, after MCP operation types, add:

```ts
export type ScheduleConcurrencyPolicy = 'skip' | 'queue' | 'parallel';
export type ScheduleMisfirePolicy = 'skip';
export type ScheduleLastStatus = PublicRunStatus | 'skipped' | 'queued';
export type ScheduleOperationType =
  | 'create'
  | 'update'
  | 'delete'
  | 'run_now'
  | 'timer_trigger'
  | 'skip_misfire'
  | 'skip_concurrency'
  | 'queue_trigger'
  | 'run_queued';
export type ScheduleOperationStatus = 'succeeded' | 'failed' | 'skipped' | 'queued';
export type ScheduleRunSummary = Pick<RunResponse, 'id' | 'threadId' | 'status'>;

export type CreateScheduleRequest = {
  name: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
  prompt: string;
  profile?: string;
  cwd?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
  timeoutMs?: number;
  concurrencyPolicy?: ScheduleConcurrencyPolicy;
  misfirePolicy?: ScheduleMisfirePolicy;
};

export type UpdateScheduleRequest = Partial<Omit<
  CreateScheduleRequest,
  'model' | 'reasoning' | 'timeoutMs'
>> & {
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  timeoutMs?: number | null;
};

export type ScheduleResponse = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  promptPreviewRedacted: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  timeoutMs?: number | null;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  misfirePolicy: ScheduleMisfirePolicy;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  lastStatus?: ScheduleLastStatus | null;
  pendingTrigger: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleDetailResponse = ScheduleResponse & {
  prompt: string;
};

export type ScheduleListResponse = {
  schedules: ScheduleResponse[];
};

export type RunScheduleNowResponse = {
  run: ScheduleRunSummary | null;
  schedule: ScheduleResponse;
  skipped: boolean;
  queued: boolean;
};

export type ScheduleOperationResponse = {
  id: string;
  operation: ScheduleOperationType;
  scheduleId: string;
  status: ScheduleOperationStatus;
  runId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type ScheduleOperationListResponse = {
  operations: ScheduleOperationResponse[];
};
```

In `packages/protocol/src/errors.ts`, add `'SCHEDULE_NOT_FOUND'` immediately after `'SCHEDULE_INVALID'`.

- [ ] **Step 5: Run protocol shape test**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/protocol-shape.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/package.json pnpm-lock.yaml packages/protocol/src/api.ts packages/protocol/src/errors.ts apps/daemon/test/unit/protocol-shape.test.ts
git commit -m "feat: add scheduler protocol types"
```

## Task 2: Cron Adapter and Schedule Validator

**Files:**

- Create: `apps/daemon/src/scheduler/cron.ts`
- Create: `apps/daemon/src/scheduler/validator.ts`
- Modify: `apps/daemon/src/scheduler/types.ts`
- Modify: `apps/daemon/src/scheduler/scheduler.ts`
- Test: `apps/daemon/test/unit/scheduler-cron.test.ts`
- Test: `apps/daemon/test/unit/scheduler-validator.test.ts`
- Test: `apps/daemon/test/unit/scheduler.test.ts`

- [ ] **Step 1: Write failing cron adapter tests**

Create `apps/daemon/test/unit/scheduler-cron.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  computeNextRunAt,
  getDefaultTimezone,
  isValidTimezone,
  validateCronExpression
} from '../../src/scheduler/cron.js';

describe('scheduler cron adapter', () => {
  it('computes the next run after the provided date', () => {
    expect(
      computeNextRunAt({
        cron: '0 9 * * *',
        timezone: 'UTC',
        from: '2026-07-06T08:59:00.000Z'
      })
    ).toBe('2026-07-06T09:00:00.000Z');
  });

  it('uses fixed timezone semantics', () => {
    const utc = computeNextRunAt({
      cron: '0 9 * * *',
      timezone: 'UTC',
      from: '2026-07-06T00:00:00.000Z'
    });
    const shanghai = computeNextRunAt({
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      from: '2026-07-06T00:00:00.000Z'
    });
    expect(utc).toBe('2026-07-06T09:00:00.000Z');
    expect(shanghai).toBe('2026-07-06T01:00:00.000Z');
  });

  it('returns deterministic DST behavior for New York spring forward', () => {
    const next = computeNextRunAt({
      cron: '30 2 * * *',
      timezone: 'America/New_York',
      from: '2026-03-08T06:00:00.000Z'
    });
    expect(next).toBe('2026-03-08T07:30:00.000Z');
  });

  it('validates cron and timezone inputs', () => {
    expect(validateCronExpression('0 9 * * *').ok).toBe(true);
    expect(validateCronExpression('not a cron').ok).toBe(false);
    expect(isValidTimezone('Asia/Shanghai')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(getDefaultTimezone().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write failing validator tests**

Create `apps/daemon/test/unit/scheduler-validator.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-schedule-validator-'));
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
        canonicalCwd: tempDir,
        sandbox: 'workspace-write',
        concurrencyPolicy: 'skip',
        misfirePolicy: 'skip',
        nextRunAt: expect.any(String)
      }
    });
  });

  it('rejects invalid cron, timezone, timeout, misfire, cwd, and profile', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-schedule-validator-'));
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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-schedule-validator-'));
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler.test.ts test/unit/scheduler-cron.test.ts test/unit/scheduler-validator.test.ts
```

Expected: FAIL because `scheduler/cron.js` and `scheduler/validator.js` do not exist, and the legacy missed-trigger helper still allows `run_once`.

- [ ] **Step 4: Update legacy missed-trigger tests**

In `apps/daemon/test/unit/scheduler.test.ts`, replace the last two tests with R6 desktop-safe expectations:

```ts
  it('does not catch up missed schedules even if legacy callers pass run_once', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: true,
        misfirePolicy: 'run_once',
        nextRunAt: '2026-07-04T01:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(false);
  });

  it('does not treat equality as a catch-up signal in the legacy helper', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: true,
        misfirePolicy: 'run_once',
        nextRunAt: '2026-07-04T02:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(false);
  });
```

- [ ] **Step 5: Implement scheduler types**

Replace `apps/daemon/src/scheduler/types.ts` with:

```ts
import type {
  ReasoningEffort,
  SandboxMode,
  ScheduleConcurrencyPolicy,
  ScheduleLastStatus,
  ScheduleMisfirePolicy,
  ScheduleOperationStatus,
  ScheduleOperationType
} from '@opencreator/protocol';

export type LegacyMisfirePolicy = ScheduleMisfirePolicy | 'run_once';

export type SchedulerClock = {
  now(): Date;
};

export type ScheduleRecord = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  prompt: string;
  promptHash: string;
  promptPreviewRedacted: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  timeoutMs?: number | null;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  misfirePolicy: ScheduleMisfirePolicy;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  lastStatus?: ScheduleLastStatus | null;
  pendingTrigger: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type InsertScheduleInput = Omit<
  ScheduleRecord,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'lastRunAt' | 'lastRunId' | 'lastStatus' | 'pendingTrigger'
>;

export type UpdateScheduleInput = Partial<
  Pick<
    ScheduleRecord,
    | 'name'
    | 'cron'
    | 'timezone'
    | 'enabled'
    | 'prompt'
    | 'promptHash'
    | 'promptPreviewRedacted'
    | 'profile'
    | 'cwd'
    | 'canonicalCwd'
    | 'model'
    | 'reasoning'
    | 'sandbox'
    | 'timeoutMs'
    | 'concurrencyPolicy'
    | 'misfirePolicy'
    | 'nextRunAt'
    | 'pendingTrigger'
  >
>;

export type ScheduleOperationRecord = {
  id: string;
  operation: ScheduleOperationType;
  scheduleId: string;
  status: ScheduleOperationStatus;
  runId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type InsertScheduleOperationInput = {
  operation: ScheduleOperationType;
  scheduleId: string;
  status: ScheduleOperationStatus;
  runId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type ProfileValidator = {
  validateProfileForRun(name: string): { ok: true } | { ok: false; code: string; message: string };
};
```

- [ ] **Step 6: Make legacy scheduler helper desktop-safe**

Replace `apps/daemon/src/scheduler/scheduler.ts` with:

```ts
import type { LegacyMisfirePolicy } from './types.js';

export type ShouldRunMissedScheduleInput = {
  enabled: boolean;
  misfirePolicy: LegacyMisfirePolicy;
  nextRunAt: string;
  now: string;
};

export function shouldRunMissedSchedule(input: ShouldRunMissedScheduleInput): boolean {
  if (!input.enabled) return false;
  if (new Date(input.nextRunAt).getTime() > new Date(input.now).getTime()) return false;
  return false;
}
```

- [ ] **Step 7: Implement cron adapter**

Create `apps/daemon/src/scheduler/cron.ts`:

```ts
import { CronExpressionParser } from 'cron-parser';

export type ComputeNextRunAtInput = {
  cron: string;
  timezone: string;
  from: string | Date;
};

export type ValidationResult = { ok: true } | { ok: false; message: string };

export function computeNextRunAt(input: ComputeNextRunAtInput): string {
  const interval = CronExpressionParser.parse(input.cron, {
    currentDate: input.from,
    tz: input.timezone
  });
  const next = interval.next().toISOString();
  if (next === null) {
    throw new Error('cron expression did not produce an ISO timestamp');
  }
  return next;
}

export function validateCronExpression(cron: string): ValidationResult {
  try {
    computeNextRunAt({ cron, timezone: 'UTC', from: new Date('2026-01-01T00:00:00.000Z') });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: formatError(error) };
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(new Date('2026-01-01T00:00:00.000Z'));
    return true;
  } catch {
    return false;
  }
}

export function getDefaultTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 8: Implement validator**

Create `apps/daemon/src/scheduler/validator.ts`:

```ts
import type { ReasoningEffort, SandboxMode, ScheduleConcurrencyPolicy } from '@opencreator/protocol';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { redactText } from '../security/redaction.js';
import { computeNextRunAt, getDefaultTimezone, isValidTimezone, validateCronExpression } from './cron.js';
import type { ProfileValidator } from './types.js';

export type ScheduleValidationErrorCode =
  | 'VALIDATION_FAILED'
  | 'SCHEDULE_INVALID'
  | 'CODEX_PROFILE_NOT_FOUND'
  | 'CODEX_PROFILE_INVALID'
  | 'CODEX_CONFIG_INVALID';

export type ScheduleValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ScheduleValidationErrorCode; message: string };

export type NormalizedCreateScheduleInput = {
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  prompt: string;
  promptHash: string;
  promptPreviewRedacted: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  timeoutMs?: number | null;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  misfirePolicy: 'skip';
  nextRunAt: string;
};

export type NormalizedUpdateScheduleInput = Partial<Omit<
  NormalizedCreateScheduleInput,
  'model' | 'reasoning' | 'timeoutMs' | 'nextRunAt'
>> & {
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  timeoutMs?: number | null;
  nextRunAt?: string | null;
};

export type ParseScheduleOptions = {
  now: string;
  defaultCwd: string;
  profileValidator: ProfileValidator;
};

const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
const REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'] as const;
const CONCURRENCY_POLICIES = ['skip', 'queue', 'parallel'] as const;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 86_400_000;

export function parseCreateScheduleRequest(
  body: unknown,
  options: ParseScheduleOptions
): ScheduleValidationResult<NormalizedCreateScheduleInput> {
  if (!isPlainObject(body)) return { ok: false, code: 'VALIDATION_FAILED', message: 'body must be an object' };
  const base = parseCommonFields(body, options, true);
  if (!base.ok) return base;
  const cron = requireString(body.cron, 'cron');
  if (!cron.ok) return cron;
  const prompt = requireString(body.prompt, 'prompt');
  if (!prompt.ok) return prompt;
  const timezone = typeof body.timezone === 'string' ? body.timezone : getDefaultTimezone();
  const cronResult = validateCronAndTimezone(cron.value, timezone, options.now);
  if (!cronResult.ok) return cronResult;
  const promptMetadata = buildPromptMetadata(prompt.value);

  return {
    ok: true,
    value: {
      ...base.value,
      cron: cron.value,
      timezone,
      prompt: prompt.value,
      ...promptMetadata,
      nextRunAt: cronResult.value.nextRunAt
    }
  };
}

export function parseUpdateScheduleRequest(
  body: unknown,
  options: ParseScheduleOptions
): ScheduleValidationResult<NormalizedUpdateScheduleInput> {
  if (!isPlainObject(body)) return { ok: false, code: 'VALIDATION_FAILED', message: 'body must be an object' };
  const base = parseCommonFields(body, options, false);
  if (!base.ok) return base;
  const value: NormalizedUpdateScheduleInput = { ...base.value };

  if (body.cron !== undefined) {
    const cron = requireString(body.cron, 'cron');
    if (!cron.ok) return cron;
    value.cron = cron.value;
  }
  if (body.timezone !== undefined) {
    const timezone = requireString(body.timezone, 'timezone');
    if (!timezone.ok) return timezone;
    value.timezone = timezone.value;
  }
  if (body.prompt !== undefined) {
    const prompt = requireString(body.prompt, 'prompt');
    if (!prompt.ok) return prompt;
    value.prompt = prompt.value;
    Object.assign(value, buildPromptMetadata(prompt.value));
  }
  if (value.cron !== undefined) {
    const cronResult = validateCronExpression(value.cron);
    if (!cronResult.ok) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: `cron is invalid: ${cronResult.message}` };
    }
  }
  if (value.timezone !== undefined && !isValidTimezone(value.timezone)) {
    return { ok: false, code: 'SCHEDULE_INVALID', message: 'timezone must be a valid IANA timezone' };
  }
  return { ok: true, value };
}

function parseCommonFields(
  body: Record<string, unknown>,
  options: ParseScheduleOptions,
  applyDefaults: true
): ScheduleValidationResult<Omit<NormalizedCreateScheduleInput, 'cron' | 'timezone' | 'prompt' | 'promptHash' | 'promptPreviewRedacted' | 'nextRunAt'>>;
function parseCommonFields(
  body: Record<string, unknown>,
  options: ParseScheduleOptions,
  applyDefaults: false
): ScheduleValidationResult<NormalizedUpdateScheduleInput>;
function parseCommonFields(
  body: Record<string, unknown>,
  options: ParseScheduleOptions,
  applyDefaults: boolean
): ScheduleValidationResult<NormalizedUpdateScheduleInput> {
  const value: NormalizedUpdateScheduleInput = {};

  if (applyDefaults || body.name !== undefined) {
    const name = requireString(body.name, 'name');
    if (!name.ok) return name;
    if (name.value.length > 120) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: 'name must be at most 120 characters' };
    }
    value.name = name.value;
  }

  if (applyDefaults || body.enabled !== undefined) {
    value.enabled = body.enabled === undefined ? true : body.enabled === true;
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'enabled must be a boolean' };
    }
  }

  if (applyDefaults || body.profile !== undefined) {
    const profile = body.profile === undefined ? 'default' : body.profile;
    if (typeof profile !== 'string' || profile.length === 0) {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'profile must be a non-empty string' };
    }
    const profileResult = options.profileValidator.validateProfileForRun(profile);
    if (!profileResult.ok) {
      return {
        ok: false,
        code: profileResult.code as ScheduleValidationErrorCode,
        message: profileResult.message
      };
    }
    value.profile = profile;
  }

  if (applyDefaults || body.cwd !== undefined) {
    const cwd = body.cwd === undefined ? options.defaultCwd : body.cwd;
    if (typeof cwd !== 'string' || cwd.length === 0) {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'cwd must be a non-empty string' };
    }
    try {
      value.cwd = cwd;
      value.canonicalCwd = realpathSync(cwd);
    } catch (error) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: `cwd must exist: ${formatError(error)}` };
    }
  }

  if (body.model !== undefined) {
    if (body.model !== null && typeof body.model !== 'string') {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'model must be a string or null' };
    }
    value.model = body.model;
  } else if (applyDefaults) {
    value.model = null;
  }

  if (body.reasoning !== undefined) {
    if (body.reasoning !== null && !isOneOf(body.reasoning, REASONING_EFFORTS)) {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'reasoning must be a valid reasoning effort or null' };
    }
    value.reasoning = body.reasoning;
  } else if (applyDefaults) {
    value.reasoning = null;
  }

  if (applyDefaults || body.sandbox !== undefined) {
    const sandbox = body.sandbox === undefined ? 'workspace-write' : body.sandbox;
    if (!isOneOf(sandbox, SANDBOX_MODES)) {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'sandbox must be a valid sandbox mode' };
    }
    value.sandbox = sandbox;
  }

  if (body.timeoutMs !== undefined) {
    if (body.timeoutMs !== null && (!Number.isInteger(body.timeoutMs) || body.timeoutMs < MIN_TIMEOUT_MS || body.timeoutMs > MAX_TIMEOUT_MS)) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: 'timeoutMs must be between 1000 and 86400000' };
    }
    value.timeoutMs = body.timeoutMs;
  } else if (applyDefaults) {
    value.timeoutMs = null;
  }

  if (applyDefaults || body.concurrencyPolicy !== undefined) {
    const policy = body.concurrencyPolicy === undefined ? 'skip' : body.concurrencyPolicy;
    if (!isOneOf(policy, CONCURRENCY_POLICIES)) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: 'concurrencyPolicy must be skip, queue, or parallel' };
    }
    value.concurrencyPolicy = policy;
  }

  if (body.misfirePolicy !== undefined && body.misfirePolicy !== 'skip') {
    return {
      ok: false,
      code: 'SCHEDULE_INVALID',
      message: 'run_once misfire is disabled for desktop-safe scheduler'
    };
  }
  if (applyDefaults || body.misfirePolicy !== undefined) {
    value.misfirePolicy = 'skip';
  }

  return { ok: true, value };
}

function validateCronAndTimezone(
  cron: string,
  timezone: string,
  now: string
): ScheduleValidationResult<{ nextRunAt: string }> {
  if (!isValidTimezone(timezone)) {
    return { ok: false, code: 'SCHEDULE_INVALID', message: 'timezone must be a valid IANA timezone' };
  }
  const cronResult = validateCronExpression(cron);
  if (!cronResult.ok) {
    return { ok: false, code: 'SCHEDULE_INVALID', message: `cron is invalid: ${cronResult.message}` };
  }
  return { ok: true, value: { nextRunAt: computeNextRunAt({ cron, timezone, from: now }) } };
}

function buildPromptMetadata(prompt: string): { promptHash: string; promptPreviewRedacted: string } {
  return {
    promptHash: createHash('sha256').update(prompt).digest('hex'),
    promptPreviewRedacted: redactText(prompt).slice(0, 240)
  };
}

function requireString(value: unknown, field: string): ScheduleValidationResult<string> {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, code: 'VALIDATION_FAILED', message: `${field} must be a non-empty string` };
  }
  return { ok: true, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && options.includes(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 9: Run scheduler cron, validator, and legacy helper tests**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler.test.ts test/unit/scheduler-cron.test.ts test/unit/scheduler-validator.test.ts
```

Expected: PASS.

- [ ] **Step 10: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/daemon/src/scheduler/types.ts apps/daemon/src/scheduler/scheduler.ts apps/daemon/src/scheduler/cron.ts apps/daemon/src/scheduler/validator.ts apps/daemon/test/unit/scheduler.test.ts apps/daemon/test/unit/scheduler-cron.test.ts apps/daemon/test/unit/scheduler-validator.test.ts
git commit -m "feat: validate scheduler definitions"
```

## Task 3: Schedule Storage and Repository

**Files:**

- Modify: `apps/daemon/src/storage/migrations.ts`
- Create: `apps/daemon/src/scheduler/repository.ts`
- Modify: `apps/daemon/test/unit/storage.test.ts`
- Test: `apps/daemon/test/unit/scheduler-repository.test.ts`

- [ ] **Step 1: Write failing storage schema test**

Add to `apps/daemon/test/unit/storage.test.ts` inside `describe('runtime storage', () => { ... })`:

```ts
  it('creates scheduler tables and indexes', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schedules', 'schedule_operations')"
      )
      .all() as Array<{ name: string }>;
    expect(tableRows.map((row) => row.name).sort()).toEqual(['schedule_operations', 'schedules']);

    const indexRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_schedules_enabled_next_run_at', 'idx_schedule_operations_created_at', 'idx_runs_schedule_source')"
      )
      .all() as Array<{ name: string }>;
    expect(indexRows.map((row) => row.name).sort()).toEqual([
      'idx_runs_schedule_source',
      'idx_schedule_operations_created_at',
      'idx_schedules_enabled_next_run_at'
    ]);
  });
```

- [ ] **Step 2: Write failing repository tests**

Create `apps/daemon/test/unit/scheduler-repository.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createScheduleRepository } from '../../src/scheduler/repository.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function createDb(): Database.Database {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-scheduler-repo-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  return db;
}

function makeSchedule(overrides = {}) {
  return {
    name: 'daily status',
    cron: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    prompt: 'Summarize status',
    promptHash: 'hash',
    promptPreviewRedacted: 'Summarize status',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    model: null,
    reasoning: null,
    sandbox: 'workspace-write' as const,
    timeoutMs: 60000,
    concurrencyPolicy: 'skip' as const,
    misfirePolicy: 'skip' as const,
    nextRunAt: '2026-07-06T09:00:00.000Z',
    ...overrides
  };
}

describe('schedule repository', () => {
  it('creates, lists, gets, updates, and soft deletes schedules', () => {
    const repo = createScheduleRepository(createDb());
    const created = repo.insertSchedule(makeSchedule());
    expect(created.id).toMatch(/^sch_/);
    expect(repo.getSchedule(created.id)).toMatchObject({ name: 'daily status' });
    expect(repo.listSchedules()).toHaveLength(1);

    repo.updateSchedule(created.id, {
      enabled: false,
      name: 'paused',
      model: null,
      reasoning: null,
      timeoutMs: null,
      nextRunAt: null
    });
    expect(repo.getSchedule(created.id)).toMatchObject({
      enabled: false,
      name: 'paused',
      model: null,
      reasoning: null,
      timeoutMs: null,
      nextRunAt: null
    });

    repo.softDeleteSchedule(created.id);
    expect(repo.getSchedule(created.id)).toBeUndefined();
    expect(repo.listSchedules()).toEqual([]);
  });

  it('finds due schedules and pending triggers', () => {
    const repo = createScheduleRepository(createDb());
    const due = repo.insertSchedule(makeSchedule({ nextRunAt: '2026-07-06T09:00:00.000Z' }));
    repo.insertSchedule(makeSchedule({ name: 'future', nextRunAt: '2026-07-06T10:00:00.000Z' }));
    const pending = repo.insertSchedule(makeSchedule({ name: 'pending', nextRunAt: '2026-07-06T11:00:00.000Z' }));
    repo.setPendingTrigger(pending.id, true);

    expect(repo.listDueSchedules('2026-07-06T09:00:00.000Z').map((schedule) => schedule.id)).toEqual([due.id]);
    expect(repo.listPendingTriggerSchedules().map((schedule) => schedule.id)).toEqual([pending.id]);
  });

  it('records operation log newest first', () => {
    const repo = createScheduleRepository(createDb());
    const schedule = repo.insertSchedule(makeSchedule());
    const first = repo.insertOperation({
      operation: 'create',
      scheduleId: schedule.id,
      status: 'succeeded'
    });
    const second = repo.insertOperation({
      operation: 'run_now',
      scheduleId: schedule.id,
      status: 'succeeded',
      runId: 'run_1'
    });

    expect(repo.listOperations(schedule.id).map((operation) => operation.id)).toEqual([second.id, first.id]);
  });

  it('detects active runs by schedule source', () => {
    const database = createDb();
    const repo = createScheduleRepository(database);
    const schedule = repo.insertSchedule(makeSchedule());
    database.prepare(`
      INSERT INTO runs (
        id, public_status, internal_status, created_by, source_id, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run_active',
      'running',
      'running',
      'schedule',
      schedule.id,
      'default',
      tempDir,
      tempDir,
      'managed',
      'workspace-write',
      'test',
      'codex',
      join(tempDir, 'codex-home'),
      1
    );
    database.prepare(`
      INSERT INTO runs (
        id, public_status, internal_status, created_by, source_id, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run_done',
      'succeeded',
      'succeeded',
      'schedule',
      'sch_done',
      'default',
      tempDir,
      tempDir,
      'managed',
      'workspace-write',
      'test',
      'codex',
      join(tempDir, 'codex-home'),
      1
    );

    expect(repo.hasActiveRunForSource('schedule', schedule.id)).toBe(true);
    expect(repo.hasActiveRunForSource('schedule', 'sch_done')).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts test/unit/scheduler-repository.test.ts
```

Expected: FAIL because scheduler tables and repository do not exist.

- [ ] **Step 4: Add migrations**

In `apps/daemon/src/storage/migrations.ts`, add `schedules` and `schedule_operations` inside the main `db.exec()` block:

```sql
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      prompt_preview_redacted TEXT NOT NULL,
      profile TEXT NOT NULL,
      cwd TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      sandbox TEXT NOT NULL,
      timeout_ms INTEGER,
      concurrency_policy TEXT NOT NULL,
      misfire_policy TEXT NOT NULL,
      next_run_at TEXT,
      last_run_at TEXT,
      last_run_id TEXT,
      last_status TEXT,
      pending_trigger INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_operations (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      status TEXT NOT NULL,
      run_id TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
```

Add indexes:

```sql
    CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next_run_at
      ON schedules(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_schedules_deleted_at
      ON schedules(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_schedule_operations_created_at
      ON schedule_operations(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_schedule_operations_schedule_id
      ON schedule_operations(schedule_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_schedule_source
      ON runs(created_by, source_id, public_status);
```

After existing `ensureColumn` calls, add:

```ts
  ensureColumn(db, 'runs', 'timeout_ms', 'timeout_ms INTEGER');
```

- [ ] **Step 5: Implement repository**

Create `apps/daemon/src/scheduler/repository.ts`:

```ts
import type { ScheduleOperationResponse } from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  InsertScheduleInput,
  InsertScheduleOperationInput,
  ScheduleOperationRecord,
  ScheduleRecord,
  UpdateScheduleInput
} from './types.js';

export type ScheduleRepository = {
  insertSchedule(input: InsertScheduleInput): ScheduleRecord;
  getSchedule(id: string): ScheduleRecord | undefined;
  listSchedules(limit?: number): ScheduleRecord[];
  updateSchedule(id: string, input: UpdateScheduleInput): ScheduleRecord | undefined;
  softDeleteSchedule(id: string): void;
  listDueSchedules(now: string): ScheduleRecord[];
  getNextEnabledSchedule(): ScheduleRecord | undefined;
  listPendingTriggerSchedules(): ScheduleRecord[];
  setPendingTrigger(id: string, pending: boolean): void;
  hasActiveRunForSource(createdBy: 'schedule', sourceId: string): boolean;
  recordRun(input: { id: string; runId: string; ranAt: string; status: string }): void;
  recordSkipped(input: { id: string; status: 'skipped' | 'queued' | 'failed' }): void;
  insertOperation(input: InsertScheduleOperationInput): ScheduleOperationRecord;
  listOperations(scheduleId: string, limit?: number): ScheduleOperationResponse[];
};

export function createScheduleRepository(db: Database.Database): ScheduleRepository {
  const insertSchedule = db.prepare(`
    INSERT INTO schedules (
      id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
      profile, cwd, canonical_cwd, model, reasoning, sandbox, timeout_ms,
      concurrency_policy, misfire_policy, next_run_at
    ) VALUES (
      @id, @name, @cron, @timezone, @enabled, @prompt, @promptHash, @promptPreviewRedacted,
      @profile, @cwd, @canonicalCwd, @model, @reasoning, @sandbox, @timeoutMs,
      @concurrencyPolicy, @misfirePolicy, @nextRunAt
    )
  `);
  const getSchedule = db.prepare<string>(`
    SELECT * FROM schedules
    WHERE id = ? AND deleted_at IS NULL
  `);
  const listSchedules = db.prepare<{ limit: number }>(`
    SELECT * FROM schedules
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC, rowid DESC
    LIMIT @limit
  `);
  const listDue = db.prepare<{ now: string }>(`
    SELECT * FROM schedules
    WHERE enabled = 1
      AND deleted_at IS NULL
      AND next_run_at IS NOT NULL
      AND next_run_at <= @now
    ORDER BY next_run_at ASC, id ASC
  `);
  const getNext = db.prepare(`
    SELECT * FROM schedules
    WHERE enabled = 1
      AND deleted_at IS NULL
      AND next_run_at IS NOT NULL
    ORDER BY next_run_at ASC, id ASC
    LIMIT 1
  `);
  const listPending = db.prepare(`
    SELECT * FROM schedules
    WHERE enabled = 1
      AND deleted_at IS NULL
      AND pending_trigger = 1
    ORDER BY updated_at ASC, id ASC
  `);
  const softDelete = db.prepare(`
    UPDATE schedules
    SET deleted_at = CURRENT_TIMESTAMP,
        pending_trigger = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const setPending = db.prepare(`
    UPDATE schedules
    SET pending_trigger = @pending,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `);
  const recordRun = db.prepare(`
    UPDATE schedules
    SET last_run_at = @ranAt,
        last_run_id = @runId,
        last_status = @status,
        pending_trigger = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `);
  const recordSkipped = db.prepare(`
    UPDATE schedules
    SET last_status = @status,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `);
  const insertOperation = db.prepare(`
    INSERT INTO schedule_operations (
      id, operation, schedule_id, status, run_id, error_code, error_message
    ) VALUES (
      @id, @operation, @scheduleId, @status, @runId, @errorCode, @errorMessage
    )
  `);
  const listOperations = db.prepare<{ scheduleId: string; limit: number }>(`
    SELECT *
    FROM schedule_operations
    WHERE schedule_id = @scheduleId
    ORDER BY created_at DESC, rowid DESC
    LIMIT @limit
  `);
  const activeRunForSource = db.prepare<{ createdBy: string; sourceId: string }>(`
    SELECT 1
    FROM runs
    WHERE created_by = @createdBy
      AND source_id = @sourceId
      AND (
        public_status IN ('queued', 'running')
        OR internal_status IN ('created', 'queued', 'spawning', 'running', 'canceling')
      )
    LIMIT 1
  `);

  return {
    insertSchedule(input) {
      const id = `sch_${nanoid(10)}`;
      insertSchedule.run({
        id,
        enabled: input.enabled ? 1 : 0,
        model: null,
        reasoning: null,
        timeoutMs: null,
        ...input
      });
      return mapSchedule(getSchedule.get(id) as ScheduleRow);
    },
    getSchedule(id) {
      const row = getSchedule.get(id) as ScheduleRow | undefined;
      return row === undefined ? undefined : mapSchedule(row);
    },
    listSchedules(limit = 50) {
      return (listSchedules.all({ limit }) as ScheduleRow[]).map(mapSchedule);
    },
    updateSchedule(id, input) {
      runDynamicScheduleUpdate(db, id, input);
      const row = getSchedule.get(id) as ScheduleRow | undefined;
      return row === undefined ? undefined : mapSchedule(row);
    },
    softDeleteSchedule(id) {
      softDelete.run(id);
    },
    listDueSchedules(now) {
      return (listDue.all({ now }) as ScheduleRow[]).map(mapSchedule);
    },
    getNextEnabledSchedule() {
      const row = getNext.get() as ScheduleRow | undefined;
      return row === undefined ? undefined : mapSchedule(row);
    },
    listPendingTriggerSchedules() {
      return (listPending.all() as ScheduleRow[]).map(mapSchedule);
    },
    setPendingTrigger(id, pending) {
      setPending.run({ id, pending: pending ? 1 : 0 });
    },
    hasActiveRunForSource(createdBy, sourceId) {
      return activeRunForSource.get({ createdBy, sourceId }) !== undefined;
    },
    recordRun(input) {
      recordRun.run(input);
    },
    recordSkipped(input) {
      recordSkipped.run(input);
    },
    insertOperation(input) {
      const id = `schop_${nanoid(10)}`;
      insertOperation.run({
        id,
        runId: null,
        errorCode: null,
        errorMessage: null,
        ...input
      });
      const rows = listOperations.all({ scheduleId: input.scheduleId, limit: 1 }) as ScheduleOperationRow[];
      return mapOperation(rows[0]!);
    },
    listOperations(scheduleId, limit = 50) {
      return (listOperations.all({ scheduleId, limit }) as ScheduleOperationRow[]).map(mapOperation);
    }
  };
}

type ScheduleRow = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: 0 | 1;
  prompt: string;
  prompt_hash: string;
  prompt_preview_redacted: string;
  profile: string;
  cwd: string;
  canonical_cwd: string;
  model: string | null;
  reasoning: string | null;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  timeout_ms: number | null;
  concurrency_policy: 'skip' | 'queue' | 'parallel';
  misfire_policy: 'skip';
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_id: string | null;
  last_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'skipped' | null;
  pending_trigger: 0 | 1;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type ScheduleOperationRow = {
  id: string;
  operation: ScheduleOperationRecord['operation'];
  schedule_id: string;
  status: ScheduleOperationRecord['status'];
  run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

function mapSchedule(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    prompt: row.prompt,
    promptHash: row.prompt_hash,
    promptPreviewRedacted: row.prompt_preview_redacted,
    profile: row.profile,
    cwd: row.cwd,
    canonicalCwd: row.canonical_cwd,
    model: row.model,
    reasoning: row.reasoning as ScheduleRecord['reasoning'],
    sandbox: row.sandbox,
    timeoutMs: row.timeout_ms,
    concurrencyPolicy: row.concurrency_policy,
    misfirePolicy: row.misfire_policy,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunId: row.last_run_id,
    lastStatus: row.last_status,
    pendingTrigger: row.pending_trigger === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function runDynamicScheduleUpdate(db: Database.Database, id: string, input: UpdateScheduleInput): void {
  const assignments: string[] = [];
  const values: Record<string, unknown> = { id };
  const fieldMap = {
    name: 'name',
    cron: 'cron',
    timezone: 'timezone',
    enabled: 'enabled',
    prompt: 'prompt',
    promptHash: 'prompt_hash',
    promptPreviewRedacted: 'prompt_preview_redacted',
    profile: 'profile',
    cwd: 'cwd',
    canonicalCwd: 'canonical_cwd',
    model: 'model',
    reasoning: 'reasoning',
    sandbox: 'sandbox',
    timeoutMs: 'timeout_ms',
    concurrencyPolicy: 'concurrency_policy',
    misfirePolicy: 'misfire_policy',
    nextRunAt: 'next_run_at',
    pendingTrigger: 'pending_trigger'
  } satisfies Record<keyof UpdateScheduleInput, string>;

  for (const [key, column] of Object.entries(fieldMap) as Array<[keyof UpdateScheduleInput, string]>) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const raw = input[key];
    values[key] = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
    assignments.push(`${column} = @${key}`);
  }
  if (assignments.length === 0) return;
  assignments.push('updated_at = CURRENT_TIMESTAMP');
  db.prepare(`
    UPDATE schedules
    SET ${assignments.join(', ')}
    WHERE id = @id AND deleted_at IS NULL
  `).run(values);
}

function mapOperation(row: ScheduleOperationRow): ScheduleOperationRecord {
  return {
    id: row.id,
    operation: row.operation,
    scheduleId: row.schedule_id,
    status: row.status,
    runId: row.run_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}
```

- [ ] **Step 6: Run repository tests**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts test/unit/scheduler-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/storage/migrations.ts apps/daemon/src/scheduler/repository.ts apps/daemon/test/unit/storage.test.ts apps/daemon/test/unit/scheduler-repository.test.ts
git commit -m "feat: persist scheduler records"
```

## Task 4: RunManager Schedule Metadata and Timeout

**Files:**

- Modify: `apps/daemon/src/runs/types.ts`
- Modify: `apps/daemon/src/runs/manager.ts`
- Modify: `apps/daemon/src/storage/repositories.ts`
- Test: `apps/daemon/test/integration/run-manager.test.ts`

- [ ] **Step 1: Write failing RunManager metadata test**

Add to `apps/daemon/test/integration/run-manager.test.ts`:

```ts
  it('persists schedule source metadata and per-run timeout', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await manager.createAndRun({
      prompt: 'scheduled prompt',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      createdBy: 'schedule',
      sourceId: 'sch_123',
      timeoutMs: 2500
    });

    const row = db.prepare('SELECT created_by, source_id, timeout_ms FROM runs WHERE id = ?').get(run.id) as {
      created_by: string;
      source_id: string | null;
      timeout_ms: number | null;
    };
    expect(row).toEqual({
      created_by: 'schedule',
      source_id: 'sch_123',
      timeout_ms: 2500
    });
    expect(manager.getRun(run.id)).toMatchObject({
      createdBy: 'schedule',
      sourceId: 'sch_123',
      timeoutMs: 2500
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts -t "schedule source metadata"
```

Expected: FAIL because `CreateRunInput`, `RunRepository`, and `RuntimeRun` do not support these fields yet.

- [ ] **Step 3: Extend run types**

In `apps/daemon/src/runs/types.ts`, update `CreateRunInput`:

```ts
export type CreateRunInput = {
  prompt: string;
  cwd: string;
  profile: string;
  sandbox: SandboxMode;
  threadId?: string;
  resumeMode?: 'auto' | 'new_thread' | 'resume_thread';
  codexThreadId?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  createdBy?: 'api' | 'schedule';
  sourceId?: string;
  timeoutMs?: number;
};
```

- [ ] **Step 4: Extend RunRepository**

In `apps/daemon/src/storage/repositories.ts`:

1. Add `timeoutMs?: number | null` to `InsertRunInput`.
2. Include `timeout_ms` in the `INSERT INTO runs` column list and values.
3. In `insertRun`, default `timeoutMs` to `null`.

- [ ] **Step 5: Extend RuntimeRun mapping**

In `apps/daemon/src/runs/manager.ts`, extend `RuntimeRun`:

```ts
  createdBy: string;
  sourceId?: string | null;
  timeoutMs?: number | null;
```

In `mapRunRow`, include:

```ts
    createdBy: row.created_by,
    sourceId: row.source_id,
    timeoutMs: row.timeout_ms,
```

In `insertInitialRun`, change:

```ts
      createdBy: input.createdBy ?? 'api',
      sourceId: input.sourceId,
      timeoutMs: input.timeoutMs ?? null,
```

Use per-run timeout:

```ts
      timeoutMs: runInput.timeoutMs ?? options.timeoutMs ?? EXEC_TIMEOUT_MS,
```

- [ ] **Step 6: Run focused test**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts -t "schedule source metadata"
```

Expected: PASS.

- [ ] **Step 7: Run broader run/storage suites**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts test/integration/run-manager.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/runs/types.ts apps/daemon/src/runs/manager.ts apps/daemon/src/storage/repositories.ts apps/daemon/test/integration/run-manager.test.ts
git commit -m "feat: tag scheduled runs"
```

## Task 5: Scheduler Service Run-Now and CRUD Use Cases

**Files:**

- Create: `apps/daemon/src/scheduler/service.ts`
- Modify: `apps/daemon/src/scheduler/repository.ts`
- Test: `apps/daemon/test/unit/scheduler-service.test.ts`

- [ ] **Step 1: Write failing service tests for CRUD and run-now**

Create `apps/daemon/test/unit/scheduler-service.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduleRepository } from '../../src/scheduler/repository.js';
import { createSchedulerService } from '../../src/scheduler/service.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function createFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-scheduler-service-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const repository = createScheduleRepository(db);
  let runCount = 0;
  const runManager = {
    startRun: vi.fn(() => ({ id: `run_${runCount++}`, status: 'running' as const })),
    getRun: vi.fn(),
    hasActiveRunForThread: vi.fn(),
    createAndRun: vi.fn(),
    cancelRun: vi.fn(),
    listRuns: vi.fn(),
    listRunsByThread: vi.fn(),
    listEvents: vi.fn(),
    subscribe: vi.fn()
  };
  const service = createSchedulerService({
    repository,
    runManager,
    defaultCwd: tempDir,
    profileValidator: { validateProfileForRun: () => ({ ok: true as const }) },
    clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
    autostart: false
  });
  return { repository, runManager, service };
}

describe('scheduler service', () => {
  it('creates, lists, gets, updates, and deletes schedules', () => {
    const { service } = createFixture();
    const created = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize status'
    });

    expect(created).toMatchObject({ name: 'daily status', enabled: true });
    expect(service.listSchedules().schedules).toHaveLength(1);
    expect(service.getSchedule(created.id)?.prompt).toBe('Summarize status');

    const updated = service.updateSchedule(created.id, {
      enabled: false,
      name: 'paused',
      cron: '30 9 * * *',
      timezone: 'UTC'
    });
    expect(updated).toMatchObject({
      enabled: false,
      name: 'paused',
      nextRunAt: '2026-07-06T09:30:00.000Z'
    });

    service.deleteSchedule(created.id);
    expect(service.getSchedule(created.id)).toBeUndefined();
    expect(service.listSchedules().schedules).toEqual([]);
  });

  it('run-now creates a scheduled run with source metadata', () => {
    const { runManager, service } = createFixture();
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize status',
      timeoutMs: 2500
    });

    const result = service.runNow(schedule.id);

    expect(result).toMatchObject({
      run: { id: 'run_0', status: 'running' },
      skipped: false,
      queued: false
    });
    expect(runManager.startRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Summarize status',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      createdBy: 'schedule',
      sourceId: schedule.id,
      timeoutMs: 2500
    }));
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'run_now',
      status: 'succeeded',
      runId: 'run_0'
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler-service.test.ts
```

Expected: FAIL because `scheduler/service.js` does not exist.

- [ ] **Step 3: Implement service response mappers and run-now**

Create `apps/daemon/src/scheduler/service.ts`:

```ts
import type {
  CreateScheduleRequest,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleListResponse,
  ScheduleOperationListResponse,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@opencreator/protocol';
import type { RunManager } from '../runs/manager.js';
import { parseCreateScheduleRequest, parseUpdateScheduleRequest, type ScheduleValidationErrorCode } from './validator.js';
import { computeNextRunAt } from './cron.js';
import type { ScheduleRepository } from './repository.js';
import type { ProfileValidator, ScheduleRecord, SchedulerClock } from './types.js';

export type SchedulerService = {
  start(): void;
  stop(): void;
  createSchedule(input: CreateScheduleRequest): ScheduleResponse;
  listSchedules(): ScheduleListResponse;
  getSchedule(id: string): ScheduleDetailResponse | undefined;
  updateSchedule(id: string, input: UpdateScheduleRequest): ScheduleResponse;
  deleteSchedule(id: string): void;
  runNow(id: string): RunScheduleNowResponse;
  listOperations(id: string, limit?: number): ScheduleOperationListResponse;
  refreshTimer(): void;
};

export type SchedulerServiceOptions = {
  repository: ScheduleRepository;
  runManager: RunManager;
  defaultCwd: string;
  profileValidator: ProfileValidator;
  clock?: SchedulerClock;
  autostart?: boolean;
};

export class SchedulerError extends Error {
  constructor(
    public readonly code: ScheduleValidationErrorCode | 'SCHEDULE_NOT_FOUND' | 'INTERNAL_ERROR',
    message: string
  ) {
    super(`${code}: ${message}`);
  }
}

export function createSchedulerService(options: SchedulerServiceOptions): SchedulerService {
  const clock = options.clock ?? { now: () => new Date() };

  const service: SchedulerService = {
    start() {},
    stop() {},
    createSchedule(input) {
      const parsed = parseCreateScheduleRequest(input, {
        now: clock.now().toISOString(),
        defaultCwd: options.defaultCwd,
        profileValidator: options.profileValidator
      });
      if (!parsed.ok) throw new SchedulerError(parsed.code, parsed.message);
      const schedule = options.repository.insertSchedule(parsed.value);
      options.repository.insertOperation({
        operation: 'create',
        scheduleId: schedule.id,
        status: 'succeeded'
      });
      service.refreshTimer();
      return toScheduleResponse(schedule);
    },
    listSchedules() {
      return { schedules: options.repository.listSchedules().map(toScheduleResponse) };
    },
    getSchedule(id) {
      const schedule = options.repository.getSchedule(id);
      return schedule === undefined ? undefined : { ...toScheduleResponse(schedule), prompt: schedule.prompt };
    },
    updateSchedule(id, input) {
      const existing = requireSchedule(id);
      const parsed = parseUpdateScheduleRequest(input, {
        now: clock.now().toISOString(),
        defaultCwd: existing.cwd,
        profileValidator: options.profileValidator
      });
      if (!parsed.ok) throw new SchedulerError(parsed.code, parsed.message);
      const patch = { ...parsed.value };
      if (patch.cron !== undefined || patch.timezone !== undefined || patch.enabled !== undefined) {
        const mergedCron = patch.cron ?? existing.cron;
        const mergedTimezone = patch.timezone ?? existing.timezone;
        const mergedEnabled = patch.enabled ?? existing.enabled;
        patch.nextRunAt = mergedEnabled
          ? computeNextRunAt({ cron: mergedCron, timezone: mergedTimezone, from: clock.now() })
          : null;
      }
      const updated = options.repository.updateSchedule(id, patch);
      if (updated === undefined) throw new SchedulerError('SCHEDULE_NOT_FOUND', 'Schedule not found');
      options.repository.insertOperation({
        operation: 'update',
        scheduleId: id,
        status: 'succeeded'
      });
      service.refreshTimer();
      return toScheduleResponse(updated);
    },
    deleteSchedule(id) {
      requireSchedule(id);
      options.repository.softDeleteSchedule(id);
      options.repository.insertOperation({
        operation: 'delete',
        scheduleId: id,
        status: 'succeeded'
      });
      service.refreshTimer();
    },
    runNow(id) {
      const schedule = requireSchedule(id);
      const run = options.runManager.startRun({
        prompt: schedule.prompt,
        cwd: schedule.cwd,
        profile: schedule.profile,
        sandbox: schedule.sandbox,
        model: schedule.model ?? undefined,
        reasoning: schedule.reasoning ?? undefined,
        createdBy: 'schedule',
        sourceId: schedule.id,
        timeoutMs: schedule.timeoutMs ?? undefined
      });
      const ranAt = clock.now().toISOString();
      options.repository.recordRun({
        id: schedule.id,
        runId: run.id,
        ranAt,
        status: run.status
      });
      options.repository.insertOperation({
        operation: 'run_now',
        scheduleId: schedule.id,
        status: 'succeeded',
        runId: run.id
      });
      return {
        run,
        schedule: toScheduleResponse(options.repository.getSchedule(schedule.id) ?? schedule),
        skipped: false,
        queued: false
      };
    },
    listOperations(id, limit) {
      requireSchedule(id);
      return { operations: options.repository.listOperations(id, limit) };
    },
    refreshTimer() {}
  };

  if (options.autostart !== false) service.start();
  return service;

  function requireSchedule(id: string): ScheduleRecord {
    const schedule = options.repository.getSchedule(id);
    if (schedule === undefined) throw new SchedulerError('SCHEDULE_NOT_FOUND', 'Schedule not found');
    return schedule;
  }
}

export function toScheduleResponse(schedule: ScheduleRecord): ScheduleResponse {
  return {
    id: schedule.id,
    name: schedule.name,
    cron: schedule.cron,
    timezone: schedule.timezone,
    enabled: schedule.enabled,
    promptPreviewRedacted: schedule.promptPreviewRedacted,
    profile: schedule.profile,
    cwd: schedule.cwd,
    canonicalCwd: schedule.canonicalCwd,
    model: schedule.model,
    reasoning: schedule.reasoning,
    sandbox: schedule.sandbox,
    timeoutMs: schedule.timeoutMs,
    concurrencyPolicy: schedule.concurrencyPolicy,
    misfirePolicy: schedule.misfirePolicy,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    lastRunId: schedule.lastRunId,
    lastStatus: schedule.lastStatus,
    pendingTrigger: schedule.pendingTrigger,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt
  };
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/scheduler/service.ts apps/daemon/test/unit/scheduler-service.test.ts
git commit -m "feat: add scheduler service run-now"
```

## Task 6: Schedule API Routes and Server Wiring

**Files:**

- Create: `apps/daemon/src/api/routes.schedules.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: Write failing API integration tests**

Add to `apps/daemon/test/integration/api.test.ts` inside `describe('runtime api', () => { ... })`:

```ts
  it('creates, lists, gets, updates, deletes, and runs schedules', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome,
      codexBin: fake.bin
    });

    const created = await server.inject({
      method: 'POST',
      url: '/schedules',
      headers: { authorization: 'Bearer secret' },
      payload: {
        name: 'daily status',
        cron: '0 9 * * *',
        timezone: 'UTC',
        prompt: 'Summarize status',
        cwd: tempDir,
        timeoutMs: 5000
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'daily status',
      promptPreviewRedacted: 'Summarize status',
      timeoutMs: 5000,
      concurrencyPolicy: 'skip',
      misfirePolicy: 'skip'
    });
    expect(created.json()).not.toHaveProperty('prompt');

    const id = created.json().id;
    const listed = await server.inject({
      method: 'GET',
      url: '/schedules',
      headers: { authorization: 'Bearer secret' }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().schedules).toHaveLength(1);
    expect(listed.json().schedules[0]).not.toHaveProperty('prompt');

    const got = await server.inject({
      method: 'GET',
      url: `/schedules/${id}`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().prompt).toBe('Summarize status');

    const updated = await server.inject({
      method: 'PATCH',
      url: `/schedules/${id}`,
      headers: { authorization: 'Bearer secret' },
      payload: { enabled: false, name: 'paused status' }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ enabled: false, name: 'paused status' });

    const runNow = await server.inject({
      method: 'POST',
      url: `/schedules/${id}/run-now`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(runNow.statusCode).toBe(202);
    expect(runNow.json().run).toMatchObject({ status: 'running' });

    const operations = await server.inject({
      method: 'GET',
      url: `/schedules/${id}/operations`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(operations.statusCode).toBe(200);
    expect(operations.json().operations.map((operation: { operation: string }) => operation.operation)).toContain('run_now');

    const deleted = await server.inject({
      method: 'DELETE',
      url: `/schedules/${id}`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
  });

  it('maps invalid and missing schedule requests', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-api-'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });

    const invalid = await server.inject({
      method: 'POST',
      url: '/schedules',
      headers: { authorization: 'Bearer secret' },
      payload: {
        name: 'bad',
        cron: 'bad cron',
        prompt: 'x',
        cwd: tempDir
      }
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe('SCHEDULE_INVALID');

    const missing = await server.inject({
      method: 'GET',
      url: '/schedules/sch_missing',
      headers: { authorization: 'Bearer secret' }
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('SCHEDULE_NOT_FOUND');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts -t "schedules"
```

Expected: FAIL because `/schedules` routes are not registered.

- [ ] **Step 3: Implement schedule routes**

Create `apps/daemon/src/api/routes.schedules.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SchedulerService } from '../scheduler/service.js';
import { SchedulerError } from '../scheduler/service.js';
import { apiError } from './errors.js';

export async function registerScheduleRoutes(
  server: FastifyInstance,
  input: { scheduler: SchedulerService }
): Promise<void> {
  server.get('/schedules', async () => input.scheduler.listSchedules());

  server.post<{ Body: unknown }>('/schedules', async (request, reply) => {
    try {
      return reply.code(201).send(input.scheduler.createSchedule(request.body as never));
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  server.get<{ Params: { id: string } }>('/schedules/:id', async (request, reply) => {
    const schedule = input.scheduler.getSchedule(request.params.id);
    if (schedule === undefined) {
      return reply.code(404).send(apiError('SCHEDULE_NOT_FOUND', 'Schedule not found'));
    }
    return schedule;
  });

  server.patch<{ Params: { id: string }; Body: unknown }>('/schedules/:id', async (request, reply) => {
    try {
      return input.scheduler.updateSchedule(request.params.id, request.body as never);
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  server.delete<{ Params: { id: string } }>('/schedules/:id', async (request, reply) => {
    try {
      input.scheduler.deleteSchedule(request.params.id);
      return { deleted: true };
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  server.post<{ Params: { id: string } }>('/schedules/:id/run-now', async (request, reply) => {
    try {
      return reply.code(202).send(input.scheduler.runNow(request.params.id));
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  server.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/schedules/:id/operations',
    async (request, reply) => {
      try {
        return input.scheduler.listOperations(request.params.id, parseLimit(request.query.limit));
      } catch (error) {
        return sendScheduleError(error, reply);
      }
    }
  );
}

function sendScheduleError(error: unknown, reply: FastifyReply) {
  if (error instanceof SchedulerError) {
    if (error.code === 'VALIDATION_FAILED') {
      return reply.code(400).send(apiError(error.code, stripCode(error.message)));
    }
    if (error.code === 'SCHEDULE_NOT_FOUND') {
      return reply.code(404).send(apiError(error.code, 'Schedule not found'));
    }
    if (error.code === 'CODEX_PROFILE_NOT_FOUND') {
      return reply.code(404).send(apiError(error.code, stripCode(error.message)));
    }
    if (
      error.code === 'SCHEDULE_INVALID'
      || error.code === 'CODEX_PROFILE_INVALID'
      || error.code === 'CODEX_CONFIG_INVALID'
    ) {
      return reply.code(422).send(apiError(error.code, stripCode(error.message)));
    }
  }
  return reply.code(500).send(apiError('INTERNAL_ERROR', 'Internal scheduler error'));
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 200)) : undefined;
}

function stripCode(message: string): string {
  return message.replace(/^[A-Z_]+:\s*/, '');
}
```

- [ ] **Step 4: Wire routes in server**

In `apps/daemon/src/api/server.ts`:

1. Import:

```ts
import { createScheduleRepository } from '../scheduler/repository.js';
import { createSchedulerService, type SchedulerService } from '../scheduler/service.js';
import { registerScheduleRoutes } from './routes.schedules.js';
```

2. Extend `BuildServerInput`:

```ts
  scheduler?: SchedulerService;
  schedulerAutostart?: boolean;
```

3. After `runManager` creation, create scheduler:

```ts
  const scheduleRepository = createScheduleRepository(db);
  const scheduler =
    input.scheduler ??
    createSchedulerService({
      repository: scheduleRepository,
      runManager,
      defaultCwd: process.cwd(),
      profileValidator: profileManager,
      autostart: input.schedulerAutostart
    });
```

4. In `onClose`, stop scheduler before closing DB:

```ts
    scheduler.stop();
```

5. Register route before diagnostics:

```ts
  await registerScheduleRoutes(server, { scheduler });
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts -t "schedules"
```

Expected: PASS.

- [ ] **Step 6: Run broader API and typecheck**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/api/routes.schedules.ts apps/daemon/src/api/server.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: expose scheduler API"
```

## Task 7: Timer Loop and Desktop-Safe Misfire Skip

**Files:**

- Modify: `apps/daemon/src/scheduler/service.ts`
- Test: `apps/daemon/test/unit/scheduler-service.test.ts`

- [ ] **Step 1: Add failing timer and misfire tests**

Append to `apps/daemon/test/unit/scheduler-service.test.ts`:

```ts
  it('creates a run for a due timer inside the grace window', () => {
    const timers: Array<{ callback: () => void; ms: number }> = [];
    const { runManager, service, setNow } = createFixtureWithTimers(timers, '2026-07-06T08:59:45.000Z');
    service.createSchedule({
      name: 'daily',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'run at nine',
      cwd: tempDir
    });

    expect(timers[0]?.ms).toBe(15000);
    setNow('2026-07-06T09:00:00.000Z');
    timers[0]!.callback();

    expect(runManager.startRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'run at nine',
      createdBy: 'schedule'
    }));
  });

  it('skips missed triggers outside the grace window and advances nextRunAt', () => {
    const timers: Array<{ callback: () => void; ms: number }> = [];
    const { repository, runManager, service, setNow } = createFixtureWithTimers(timers, '2026-07-06T08:00:00.000Z');
    const schedule = service.createSchedule({
      name: 'daily',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'run at nine',
      cwd: tempDir
    });

    setNow('2026-07-06T09:05:00.000Z');
    service.processDueSchedulesForTest?.();

    expect(runManager.startRun).not.toHaveBeenCalled();
    expect(repository.getSchedule(schedule.id)).toMatchObject({
      lastStatus: 'skipped',
      nextRunAt: '2026-07-07T09:00:00.000Z'
    });
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'skip_misfire',
      status: 'skipped'
    });
  });
```

At the bottom of the test file, add helpers:

```ts
function createFixtureWithTimers(timers: Array<{ callback: () => void; ms: number }>, now: string) {
  const fixture = createFixture();
  let currentNow = now;
  const service = createSchedulerService({
    repository: fixture.repository,
    runManager: fixture.runManager,
    defaultCwd: tempDir,
    profileValidator: { validateProfileForRun: () => ({ ok: true as const }) },
    clock: { now: () => new Date(currentNow) },
    timers: {
      setTimeout(callback, ms) {
        timers.push({ callback, ms });
        return callback;
      },
      clearTimeout() {}
    },
    autostart: false
  });
  return {
    ...fixture,
    service,
    setNow(value: string) {
      currentNow = value;
    }
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler-service.test.ts -t "due timer|missed triggers"
```

Expected: FAIL because service has no timer loop or test hook.

- [ ] **Step 3: Add timer injection and constants**

In `apps/daemon/src/scheduler/service.ts`, add:

```ts
type TimerHandle = ReturnType<typeof setTimeout>;
type SchedulerTimers = {
  setTimeout(callback: () => void, ms: number): TimerHandle | unknown;
  clearTimeout(handle: TimerHandle | unknown): void;
};

const DEFAULT_TRIGGER_GRACE_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
```

Extend `SchedulerServiceOptions`:

```ts
  timers?: SchedulerTimers;
  triggerGraceMs?: number;
```

Inside `createSchedulerService`:

```ts
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: TimerHandle | unknown) => clearTimeout(handle as TimerHandle)
  };
  const triggerGraceMs = options.triggerGraceMs ?? DEFAULT_TRIGGER_GRACE_MS;
  let timer: TimerHandle | unknown;
```

- [ ] **Step 4: Implement start, stop, refreshTimer, and due processing**

In `service.ts`, replace `start/stop/refreshTimer` methods:

```ts
    start() {
      service.refreshTimer();
    },
    stop() {
      if (timer !== undefined) {
        timers.clearTimeout(timer);
        timer = undefined;
      }
    },
    refreshTimer() {
      if (timer !== undefined) {
        timers.clearTimeout(timer);
        timer = undefined;
      }
      const next = options.repository.getNextEnabledSchedule();
      if (next === undefined || next.nextRunAt === null || next.nextRunAt === undefined) return;
      const delay = Math.max(
        0,
        Math.min(MAX_TIMER_DELAY_MS, new Date(next.nextRunAt).getTime() - clock.now().getTime())
      );
      timer = timers.setTimeout(() => {
        processDueSchedules();
      }, delay);
    },
```

Add helper functions inside `createSchedulerService`:

```ts
  function processDueSchedules(): void {
    const now = clock.now().toISOString();
    for (const schedule of options.repository.listDueSchedules(now)) {
      processDueSchedule(schedule, now);
    }
    service.refreshTimer();
  }

  function processDueSchedule(schedule: ScheduleRecord, now: string): void {
    const ageMs = new Date(now).getTime() - new Date(schedule.nextRunAt ?? now).getTime();
    const nextRunAt = computeNextRunAt({
      cron: schedule.cron,
      timezone: schedule.timezone,
      from: now
    });
    if (ageMs > triggerGraceMs) {
      options.repository.recordSkipped({ id: schedule.id, status: 'skipped' });
      options.repository.updateSchedule(schedule.id, { nextRunAt });
      options.repository.insertOperation({
        operation: 'skip_misfire',
        scheduleId: schedule.id,
        status: 'skipped'
      });
      return;
    }
    triggerSchedule(schedule, 'timer_trigger', now);
    options.repository.updateSchedule(schedule.id, { nextRunAt });
  }

  function triggerSchedule(
    schedule: ScheduleRecord,
    operation: 'run_now' | 'timer_trigger' | 'run_queued',
    ranAt: string
  ): RunScheduleNowResponse {
    const run = options.runManager.startRun({
      prompt: schedule.prompt,
      cwd: schedule.cwd,
      profile: schedule.profile,
      sandbox: schedule.sandbox,
      model: schedule.model ?? undefined,
      reasoning: schedule.reasoning ?? undefined,
      createdBy: 'schedule',
      sourceId: schedule.id,
      timeoutMs: schedule.timeoutMs ?? undefined
    });
    options.repository.recordRun({
      id: schedule.id,
      runId: run.id,
      ranAt,
      status: run.status
    });
    options.repository.insertOperation({
      operation,
      scheduleId: schedule.id,
      status: 'succeeded',
      runId: run.id
    });
    return {
      run,
      schedule: toScheduleResponse(options.repository.getSchedule(schedule.id) ?? schedule),
      skipped: false,
      queued: false
    };
  }
```

Update `runNow` to call `triggerSchedule(schedule, 'run_now', clock.now().toISOString())`.

For test-only access, add optional export on service object:

```ts
    processDueSchedulesForTest: processDueSchedules
```

and update the `SchedulerService` type with optional `processDueSchedulesForTest?(): void`.

- [ ] **Step 5: Import computeNextRunAt**

At top of `service.ts`:

```ts
import { computeNextRunAt } from './cron.js';
```

- [ ] **Step 6: Run timer tests**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler-service.test.ts -t "due timer|missed triggers"
```

Expected: PASS.

- [ ] **Step 7: Run all service tests and typecheck**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler-service.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/scheduler/service.ts apps/daemon/test/unit/scheduler-service.test.ts
git commit -m "feat: run scheduler timers safely"
```

## Task 8: Scheduler Concurrency Policies

**Files:**

- Modify: `apps/daemon/src/scheduler/service.ts`
- Modify: `apps/daemon/test/unit/scheduler-service.test.ts`

- [ ] **Step 1: Add failing concurrency tests**

Append to `apps/daemon/test/unit/scheduler-service.test.ts`:

```ts
  it('skips run-now when skip policy has an active run', () => {
    const { repository, runManager, service } = createFixture();
    vi.spyOn(repository, 'listOperations');
    const schedule = service.createSchedule({
      name: 'skip overlap',
      cron: '0 9 * * *',
      prompt: 'skip overlap',
      cwd: tempDir,
      concurrencyPolicy: 'skip'
    });
    db!.prepare(`
      INSERT INTO runs (
        id, public_status, internal_status, created_by, source_id, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run_active',
      'running',
      'running',
      'schedule',
      schedule.id,
      'default',
      tempDir,
      tempDir,
      'managed',
      'workspace-write',
      'test',
      'codex',
      join(tempDir, 'codex-home'),
      1
    );

    const result = service.runNow(schedule.id);

    expect(result).toMatchObject({ run: null, skipped: true, queued: false });
    expect(runManager.startRun).not.toHaveBeenCalled();
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'skip_concurrency',
      status: 'skipped'
    });
  });

  it('coalesces queue policy and runs one pending trigger after active run ends', () => {
    const timers: Array<{ callback: () => void; ms: number }> = [];
    const { repository, runManager, service } = createFixtureWithTimers(timers, '2026-07-06T00:00:00.000Z');
    const schedule = service.createSchedule({
      name: 'queue overlap',
      cron: '0 9 * * *',
      prompt: 'queue overlap',
      cwd: tempDir,
      concurrencyPolicy: 'queue'
    });
    db!.prepare(`
      INSERT INTO runs (
        id, public_status, internal_status, created_by, source_id, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run_active',
      'running',
      'running',
      'schedule',
      schedule.id,
      'default',
      tempDir,
      tempDir,
      'managed',
      'workspace-write',
      'test',
      'codex',
      join(tempDir, 'codex-home'),
      1
    );

    const queued = service.runNow(schedule.id);
    expect(queued).toMatchObject({ run: null, skipped: false, queued: true });
    expect(repository.getSchedule(schedule.id)?.pendingTrigger).toBe(true);

    db!.prepare("UPDATE runs SET public_status = 'succeeded', internal_status = 'succeeded' WHERE id = ?").run('run_active');
    service.processPendingTriggersForTest?.();

    expect(runManager.startRun).toHaveBeenCalledTimes(1);
    expect(repository.getSchedule(schedule.id)?.pendingTrigger).toBe(false);
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'run_queued',
      status: 'succeeded'
    });
  });

  it('allows parallel policy to create overlapping runs', () => {
    const { runManager, service } = createFixture();
    const schedule = service.createSchedule({
      name: 'parallel overlap',
      cron: '0 9 * * *',
      prompt: 'parallel overlap',
      cwd: tempDir,
      concurrencyPolicy: 'parallel'
    });
    db!.prepare(`
      INSERT INTO runs (
        id, public_status, internal_status, created_by, source_id, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run_active',
      'running',
      'running',
      'schedule',
      schedule.id,
      'default',
      tempDir,
      tempDir,
      'managed',
      'workspace-write',
      'test',
      'codex',
      join(tempDir, 'codex-home'),
      1
    );

    const result = service.runNow(schedule.id);

    expect(result.run).toMatchObject({ id: 'run_0' });
    expect(runManager.startRun).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler-service.test.ts -t "skip policy|queue policy|parallel policy"
```

Expected: FAIL because concurrency policies are not implemented.

- [ ] **Step 3: Extend SchedulerService type for pending test hook**

In `service.ts`, add optional method:

```ts
  processPendingTriggersForTest?(): void;
```

- [ ] **Step 4: Implement concurrency handler**

In `service.ts`, change `runNow` and due trigger path to use:

```ts
  function handleTrigger(
    schedule: ScheduleRecord,
    operation: 'run_now' | 'timer_trigger' | 'run_queued',
    ranAt: string
  ): RunScheduleNowResponse {
    if (operation !== 'run_queued' && schedule.concurrencyPolicy !== 'parallel') {
      const active = options.repository.hasActiveRunForSource('schedule', schedule.id);
      if (active && schedule.concurrencyPolicy === 'skip') {
        options.repository.recordSkipped({ id: schedule.id, status: 'skipped' });
        options.repository.insertOperation({
          operation: 'skip_concurrency',
          scheduleId: schedule.id,
          status: 'skipped'
        });
        return {
          run: null,
          schedule: toScheduleResponse(options.repository.getSchedule(schedule.id) ?? schedule),
          skipped: true,
          queued: false
        };
      }
      if (active && schedule.concurrencyPolicy === 'queue') {
        options.repository.setPendingTrigger(schedule.id, true);
        options.repository.recordSkipped({ id: schedule.id, status: 'queued' });
        options.repository.insertOperation({
          operation: 'queue_trigger',
          scheduleId: schedule.id,
          status: 'queued'
        });
        refreshQueueTimer();
        return {
          run: null,
          schedule: toScheduleResponse(options.repository.getSchedule(schedule.id) ?? schedule),
          skipped: false,
          queued: true
        };
      }
    }
    return triggerSchedule(schedule, operation, ranAt);
  }
```

Replace previous `triggerSchedule` calls:

```ts
handleTrigger(schedule, 'timer_trigger', now);
handleTrigger(schedule, 'run_now', clock.now().toISOString());
```

- [ ] **Step 5: Implement queue timer and pending processing**

In `service.ts`, add constants and state:

```ts
const QUEUE_CHECK_INTERVAL_MS = 5_000;
let queueTimer: TimerHandle | unknown;
```

In `stop`, clear queue timer:

```ts
      if (queueTimer !== undefined) {
        timers.clearTimeout(queueTimer);
        queueTimer = undefined;
      }
```

Add functions:

```ts
  function refreshQueueTimer(): void {
    if (queueTimer !== undefined) {
      timers.clearTimeout(queueTimer);
      queueTimer = undefined;
    }
    if (options.repository.listPendingTriggerSchedules().length === 0) return;
    queueTimer = timers.setTimeout(() => {
      processPendingTriggers();
    }, QUEUE_CHECK_INTERVAL_MS);
  }

  function processPendingTriggers(): void {
    for (const schedule of options.repository.listPendingTriggerSchedules()) {
      if (options.repository.hasActiveRunForSource('schedule', schedule.id)) continue;
      handleTrigger(schedule, 'run_queued', clock.now().toISOString());
    }
    refreshQueueTimer();
  }
```

Call `refreshQueueTimer()` after create/update/delete/run-now/timer-trigger and in `start()`.

The `start` method should become:

```ts
    start() {
      service.refreshTimer();
      refreshQueueTimer();
    },
```

After any method that may create, remove, clear, or mark a pending trigger, call both timer refreshers:

```ts
      service.refreshTimer();
      refreshQueueTimer();
```

Expose optional test hook:

```ts
    processPendingTriggersForTest: processPendingTriggers
```

- [ ] **Step 6: Run concurrency tests**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler-service.test.ts -t "skip policy|queue policy|parallel policy"
```

Expected: PASS.

- [ ] **Step 7: Run full scheduler service suite and typecheck**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler-service.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/scheduler/service.ts apps/daemon/test/unit/scheduler-service.test.ts
git commit -m "feat: enforce scheduler concurrency policies"
```

## Task 9: Gated Real Codex Scheduler Smoke

**Files:**

- Modify: `apps/daemon/test/smoke/real-codex-smoke.test.ts`

- [ ] **Step 1: Add gated scheduler run-now smoke**

In `apps/daemon/test/smoke/real-codex-smoke.test.ts`, `buildServer` is already imported in the current file. If an implementation branch no longer has it, add:

```ts
import { buildServer } from '../../src/api/server.js';
```

Add test inside `describe.runIf(runRealCodex)('real codex smoke', () => { ... })`:

```ts
  it('creates a schedule run-now path through the daemon', async () => {
    const home = join(fixtureDir, `scheduler-smoke-${Date.now()}`);
    const dataDir = join(fixtureDir, `scheduler-data-${Date.now()}`);
    const workspace = join(fixtureDir, `scheduler-workspace-${Date.now()}`);
    mkdirSync(home, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(workspace, { recursive: true });

    const server = await buildServer({
      token: 'secret',
      dataDir,
      codexHome: home,
      codexBin: 'codex'
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
          prompt: 'Reply with R6_SCHEDULER_SMOKE_MARKER only.',
          cwd: workspace,
          sandbox: 'read-only',
          timeoutMs: 180000
        }
      });
      expect(created.statusCode).toBe(201);

      const runNow = await server.inject({
        method: 'POST',
        url: `/schedules/${created.json().id}/run-now`,
        headers: { authorization: 'Bearer secret' }
      });
      expect(runNow.statusCode).toBe(202);
      const runId = runNow.json().run.id;

      await expect
        .poll(async () => {
          const response = await server.inject({
            method: 'GET',
            url: `/runs/${runId}`,
            headers: { authorization: 'Bearer secret' }
          });
          return response.json().status;
        }, { timeout: 180000 })
        .toMatch(/^(succeeded|failed|canceled)$/);

      const finished = await server.inject({
        method: 'GET',
        url: `/runs/${runId}`,
        headers: { authorization: 'Bearer secret' }
      });
      const run = finished.json() as {
        status: string;
        errorCode?: string | null;
        errorMessage?: string | null;
      };
      if (run.status === 'failed') {
        const blocked = `${run.errorCode ?? ''}\n${run.errorMessage ?? ''}`;
        if (/(auth|login|unauthorized|network|timed out|rate limit|quota|model)/i.test(blocked)) {
          throw new Error(`BLOCKED_ENV: real Codex scheduler smoke could not reach an authenticated/model-ready runtime.
Run: ${runId}
Error code: ${run.errorCode ?? 'none'}
Error message: ${run.errorMessage ?? 'none'}`);
        }
      }
      expect(run.status).toBe('succeeded');
    } finally {
      await server.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
    }
  });
```

If this test fails because Codex auth returns 401, wrap the failure using the existing smoke helper pattern that throws `BLOCKED_ENV` with stdout/stderr summary. Do not mark R6 fake Codex coverage as failed because of auth.

- [ ] **Step 2: Run default smoke to verify gate remains off**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: PASS with gated real smoke skipped.

- [ ] **Step 3: Run gated scheduler smoke**

Run:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts -t "creates a schedule run-now path through the daemon"
```

Expected: PASS if Codex auth/model is available, or clear `BLOCKED_ENV` if Codex auth/network is unavailable.

- [ ] **Step 4: Commit**

```bash
git add apps/daemon/test/smoke/real-codex-smoke.test.ts
git commit -m "test: add scheduler real codex smoke"
```

## Task 10: Coverage Report and Full Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md`

- [ ] **Step 1: Run R6 focused suite**

Run:

```bash
pnpm --filter @opencreator/daemon test -- \
  test/unit/protocol-shape.test.ts \
  test/unit/scheduler.test.ts \
  test/unit/scheduler-cron.test.ts \
  test/unit/scheduler-validator.test.ts \
  test/unit/scheduler-repository.test.ts \
  test/unit/scheduler-service.test.ts \
  test/unit/storage.test.ts \
  test/integration/run-manager.test.ts \
  test/integration/api.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run project-level verification**

Run:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Expected:

- `pnpm typecheck` PASS.
- `pnpm test` PASS.
- `git diff --check` has no whitespace errors.

- [ ] **Step 3: Run gated scheduler smoke**

Run:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts -t "creates a schedule run-now path through the daemon"
```

Expected: PASS or `BLOCKED_ENV`. Do not report unrun smoke as pass.

- [ ] **Step 4: Update R6 coverage section**

In `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md`, replace the R6 section with:

```md
## 11. R6 Scheduler 测试

### R6 Scheduler

Status: `PASS`

Scope:

- schedule CRUD：`PASS`
- run-now：`PASS`
- timer 到点创建 ordinary run：`PASS`
- schedule run `created_by/source_id/timeout_ms`：`PASS`
- cron/timezone/DST：`PASS`
- sleep/wake missed trigger skip：`PASS`
- concurrency skip/queue/parallel：`PASS`
- operation audit：`PASS`
- `run_once` misfire：`DISABLED_BY_DESKTOP_SAFETY`
- thread-bound schedule：`OUT_OF_SCOPE_R6`
- OS-level background service：`OUT_OF_SCOPE_R6`

Verification:

- `pnpm --filter @opencreator/daemon test -- test/unit/protocol-shape.test.ts test/unit/scheduler.test.ts test/unit/scheduler-cron.test.ts test/unit/scheduler-validator.test.ts test/unit/scheduler-repository.test.ts test/unit/scheduler-service.test.ts test/unit/storage.test.ts test/integration/run-manager.test.ts test/integration/api.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `git diff --check`
- `OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts -t "creates a schedule run-now path through the daemon"`

Notes:

- 当前 Codex CLI 没有稳定本地 schedule 命令，R6 使用 Runtime 本地薄触发器。
- Scheduler 不直接启动 Codex；它只通过 RunManager 创建 ordinary run。
- 电脑睡眠、daemon 离线或长时间卡顿导致的 missed trigger 不补跑。
- `run_once` 被禁用是桌面安全策略，不是缺实现。
```

If gated smoke is blocked by Codex auth/network, add:

```md
Blocked:

- Gated real Codex scheduler smoke: `BLOCKED_ENV`
- 原因：Codex auth/network unavailable；fake Codex R6 backend coverage remains `PASS`.
```

- [ ] **Step 5: Commit coverage report**

```bash
git add docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md
git commit -m "docs: update R6 scheduler coverage"
```

## Self-Review Checklist

Before implementing this plan, confirm:

- [ ] Current Codex CLI still has no stable local `schedule` command. If it does, stop and redesign R6 as pass-through.
- [ ] No git worktree is created.
- [ ] `run_once` is not implemented and is rejected as `SCHEDULE_INVALID`.
- [ ] Sleep/wake missed triggers skip rather than catch up.
- [ ] Schedule runs are independent runs, not thread-bound runs.
- [ ] Scheduler never starts Codex directly.
- [ ] All schedule-created runs go through `RunManager.startRun()`.
- [ ] SQLite stores schedule truth; timers are derived state.
- [ ] `queue` concurrency is coalesced to one pending trigger.
- [ ] Every task ends with focused tests, typecheck when needed, and a separate commit.
