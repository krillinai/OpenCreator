# Codex Runtime R3 Profiles / Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use git worktree; implement in the current workspace.

**Goal:** 实现 R3 Profiles / Settings / CODEX_HOME 后端能力：全局 Codex home 只读，isolated Codex home 支持 profile CRUD、写锁、备份、原子写入和 run/thread profile 校验。

**Architecture:** `CODEX_HOME/config.toml` 是 profile 真相源；SQLite 不作为 profile 真相源。新增 `codex/profiles` 小模块负责解析、校验、写入和扫描 profile，`routes.profiles.ts` 暴露 API，run/thread 创建前通过 profile manager 校验显式 profile。

**Tech Stack:** TypeScript, Fastify, Vitest, Node fs/path, existing `toml` parser, fake Codex helper, gated real Codex smoke.

---

## File Structure

Create:

- `apps/daemon/src/codex/profiles/types.ts`  
  Profile 类型、错误类型、请求校验结果。
- `apps/daemon/src/codex/profiles/config.ts`  
  读取和解析 `config.toml`，解析 `[profiles.<name>]`，校验 profile name 和受支持 TOML value。
- `apps/daemon/src/codex/profiles/writer.ts`  
  isolated 写入：进程内写锁、临时文件、备份、原子 rename。
- `apps/daemon/src/codex/profiles/manager.ts`  
  组合 reader/writer，提供 list/get/create/update/delete/validate 接口。
- `apps/daemon/src/api/routes.profiles.ts`  
  `/codex/profiles` API。
- `apps/daemon/test/unit/codex-profile-config.test.ts`
- `apps/daemon/test/unit/codex-profile-writer.test.ts`

Modify:

- `packages/protocol/src/api.ts`  
  增加 R3 API response/request 类型。
- `packages/protocol/src/errors.ts`  
  增加 R3 错误码。
- `apps/daemon/src/codex/home.ts`  
  增加 `writable` 推导。
- `apps/daemon/src/api/routes.codex.ts`  
  `/codex/status` 返回 `codexHomeSource` / `codexHomeWritable`。
- `apps/daemon/src/api/server.ts`  
  创建 profile manager，注册 profile routes，把 profile validator 注入 run/thread routes。
- `apps/daemon/src/api/routes.runs.ts`  
  independent run 和 thread run 前校验显式 profile。
- `apps/daemon/src/api/routes.threads.ts`  
  thread 创建前校验显式 profile。
- `apps/daemon/src/runs/manager.ts`  
  不直接读 profile，只保持 run 快照；必要时扩展 diagnostics metadata。
- `apps/daemon/src/threads/manager.ts`  
  不直接读 profile，只接受 route 层已校验输入。
- `apps/daemon/test/unit/codex-home.test.ts`
- `apps/daemon/test/integration/api.test.ts`
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- `docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md`

Do not modify in R3:

- UI.
- Skills management.
- MCP management API.
- Scheduler CRUD.
- Messages table.

---

### Task 1: Real Codex Profile ABI Spike

**Files:**
- Modify: `apps/daemon/test/smoke/real-codex-smoke.test.ts`

- [ ] **Step 1: Add a gated smoke test that writes an isolated profile config**

Append this test inside `describe.runIf(runRealCodex)('real codex smoke', () => { ... })`:

```ts
  it('verifies isolated CODEX_HOME profile config shape', () => {
    const home = join(fixtureDir, `profile-smoke-${Date.now()}`);
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, 'config.toml'),
      [
        '[profiles.r3_smoke]',
        'model = "gpt-5.3-codex"',
        'model_reasoning_effort = "medium"',
        ''
      ].join('\n')
    );

    const result = runSmokeCommand([
      'env',
      `CODEX_HOME=${home}`,
      'codex',
      'exec',
      '-p',
      'r3_smoke',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      'Reply with OK only.'
    ]);
    writeFixture('exec-isolated-profile-jsonl', result);

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  }, 120_000);
```

- [ ] **Step 2: Run the smoke and confirm profile shape**

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: the new profile smoke passes.  
If it fails because Codex rejects `[profiles.r3_smoke]`, stop and update the R3 spec and this plan to match the real Codex profile format.

- [ ] **Step 3: Commit**

```bash
git add apps/daemon/test/smoke/real-codex-smoke.test.ts
git commit -m "test: verify codex profile config shape"
```

---

### Task 2: Protocol and CODEX_HOME Status

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/errors.ts`
- Modify: `apps/daemon/src/codex/home.ts`
- Modify: `apps/daemon/src/api/routes.codex.ts`
- Modify: `apps/daemon/test/unit/codex-home.test.ts`
- Modify: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: Write failing protocol and status tests**

In `apps/daemon/test/unit/codex-home.test.ts`, extend the existing assertions:

```ts
  it('marks global codex homes read-only and isolated homes writable', () => {
    expect(resolveCodexHome({ env: {}, homeDir: '/Users/tester' })).toMatchObject({
      path: '/Users/tester/.codex',
      mode: 'global',
      source: 'default',
      writable: false
    });

    expect(resolveCodexHome({
      env: { CODEX_HOME: '~/custom-codex' },
      homeDir: '/Users/tester'
    })).toMatchObject({
      path: '/Users/tester/custom-codex',
      mode: 'global',
      source: 'env',
      writable: false
    });

    expect(resolveCodexHome({
      env: { CODEX_HOME: '~/custom-codex' },
      homeDir: '/Users/tester',
      isolatedHome: '~/isolated-codex'
    })).toMatchObject({
      path: '/Users/tester/isolated-codex',
      mode: 'isolated',
      source: 'isolated',
      writable: true
    });
  });
```

In `apps/daemon/test/integration/api.test.ts`, update `returns codex status with auth` to assert:

```ts
    expect(response.json()).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      codexHomeSource: 'isolated',
      codexHomeWritable: true,
      codexVersion: capabilities.codexVersion,
      capabilities: {
        resumeJson: true,
        resumeByThreadId: true
      }
    });
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-home.test.ts test/integration/api.test.ts
```

Expected: fails because `writable`, `codexHomeSource`, and `codexHomeWritable` are missing.

- [ ] **Step 3: Add protocol types**

In `packages/protocol/src/api.ts`, add:

```ts
export type CodexHomeMode = 'global' | 'isolated';
export type CodexHomeSource = 'env' | 'default' | 'isolated';

export type CodexStatusResponse = {
  codexBin: string;
  codexVersion: string;
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  codexHomeSource: CodexHomeSource;
  codexHomeWritable: boolean;
  capabilities: unknown;
  diagnostics: string[];
};
```

In `packages/protocol/src/errors.ts`, add:

```ts
  | 'CODEX_HOME_READ_ONLY'
  | 'CODEX_PROFILE_NOT_FOUND'
  | 'CODEX_PROFILE_EXISTS'
  | 'CODEX_PROFILE_INVALID'
  | 'CODEX_CONFIG_WRITE_FAILED'
  | 'CODEX_CONFIG_LOCKED'
```

`CODEX_CONFIG_INVALID` already exists; do not duplicate it.

- [ ] **Step 4: Extend codex home resolution**

In `apps/daemon/src/codex/home.ts`, extend `ResolvedCodexHome`:

```ts
export type ResolvedCodexHome = {
  path: string;
  mode: CodexHomeMode;
  source: 'env' | 'default' | 'isolated';
  writable: boolean;
};
```

Set `writable: true` only for `isolatedHome !== undefined`; otherwise `false`.

- [ ] **Step 5: Extend `/codex/status`**

In `apps/daemon/src/api/routes.codex.ts`, return:

```ts
      codexHomeSource: input.codexHome.source,
      codexHomeWritable: input.codexHome.writable,
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-home.test.ts test/integration/api.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/api.ts packages/protocol/src/errors.ts apps/daemon/src/codex/home.ts apps/daemon/src/api/routes.codex.ts apps/daemon/test/unit/codex-home.test.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: expose codex home write status"
```

---

### Task 3: Profile Config Parser

**Files:**
- Create: `apps/daemon/src/codex/profiles/types.ts`
- Create: `apps/daemon/src/codex/profiles/config.ts`
- Create: `apps/daemon/test/unit/codex-profile-config.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `apps/daemon/test/unit/codex-profile-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isValidProfileName,
  parseCodexProfileConfig,
  validateProfileConfig
} from '../../src/codex/profiles/config.js';

describe('codex profile config parser', () => {
  it('parses profiles from config.toml', () => {
    const result = parseCodexProfileConfig([
      '[profiles.default]',
      'model = "gpt-5.3-codex"',
      'model_reasoning_effort = "medium"',
      '',
      '[profiles.review]',
      'model = "gpt-5.3-codex"',
      'model_reasoning_effort = "high"',
      ''
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected parser success');
    expect(result.profiles).toEqual([
      expect.objectContaining({
        name: 'default',
        status: 'valid',
        config: {
          model: 'gpt-5.3-codex',
          model_reasoning_effort: 'medium'
        }
      }),
      expect.objectContaining({
        name: 'review',
        status: 'valid',
        config: {
          model: 'gpt-5.3-codex',
          model_reasoning_effort: 'high'
        }
      })
    ]);
  });

  it('returns diagnostics for invalid toml without throwing', () => {
    const result = parseCodexProfileConfig('[profiles.default\\nmodel = "x"');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected parser failure');
    expect(result.diagnostics[0]).toContain('Failed to parse');
  });

  it('validates profile names', () => {
    expect(isValidProfileName('default')).toBe(true);
    expect(isValidProfileName('review-1')).toBe(true);
    expect(isValidProfileName('team.alpha')).toBe(true);
    expect(isValidProfileName('')).toBe(false);
    expect(isValidProfileName('../secret')).toBe(false);
    expect(isValidProfileName('bad/name')).toBe(false);
  });

  it('rejects nested profile values in R3 first version', () => {
    expect(validateProfileConfig({ model: 'gpt-5.3-codex', effort: 'high' }).ok).toBe(true);
    expect(validateProfileConfig({ enabled: true, count: 2 }).ok).toBe(true);
    expect(validateProfileConfig({ tags: ['a', 'b'] }).ok).toBe(true);
    expect(validateProfileConfig({ nested: { bad: true } }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-profile-config.test.ts
```

Expected: fails because module does not exist.

- [ ] **Step 3: Create profile types**

Create `apps/daemon/src/codex/profiles/types.ts`:

```ts
import type { CodexHomeMode } from '@clawee/protocol';

export type CodexProfileStatus = 'valid' | 'invalid';
export type TomlPrimitive = string | number | boolean;
export type TomlProfileValue = TomlPrimitive | TomlPrimitive[];
export type TomlProfileConfig = Record<string, TomlProfileValue>;

export type CodexProfile = {
  name: string;
  status: CodexProfileStatus;
  config: TomlProfileConfig;
  diagnostics: string[];
  source: 'config.toml';
  codexHomeMode: CodexHomeMode;
  updatedAt?: string;
};

export type ParseProfileConfigResult =
  | { ok: true; profiles: Array<Omit<CodexProfile, 'codexHomeMode'>>; diagnostics: string[] }
  | { ok: false; profiles: []; diagnostics: string[] };

export type ValidationResult = { ok: true } | { ok: false; message: string };
```

- [ ] **Step 4: Implement parser**

Create `apps/daemon/src/codex/profiles/config.ts`:

```ts
import { parse } from 'toml';
import type {
  ParseProfileConfigResult,
  TomlPrimitive,
  TomlProfileConfig,
  TomlProfileValue,
  ValidationResult
} from './types.js';

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function isValidProfileName(name: string): boolean {
  return name.length > 0 && PROFILE_NAME_PATTERN.test(name);
}

export function validateProfileConfig(config: Record<string, unknown>): ValidationResult {
  for (const [key, value] of Object.entries(config)) {
    if (!isValidProfileName(key)) return { ok: false, message: `invalid config key: ${key}` };
    if (!isTomlProfileValue(value)) {
      return { ok: false, message: `unsupported profile value for key: ${key}` };
    }
  }
  return { ok: true };
}

export function parseCodexProfileConfig(content: string): ParseProfileConfigResult {
  let parsed: unknown;
  try {
    parsed = content.trim().length === 0 ? {} : parse(content);
  } catch (error) {
    return {
      ok: false,
      profiles: [],
      diagnostics: [`Failed to parse config.toml: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  const root = isRecord(parsed) ? parsed : {};
  const profiles = isRecord(root.profiles) ? root.profiles : {};
  const result: Array<{
    name: string;
    status: 'valid' | 'invalid';
    config: TomlProfileConfig;
    diagnostics: string[];
    source: 'config.toml';
  }> = [];

  for (const [name, rawConfig] of Object.entries(profiles)) {
    if (!isRecord(rawConfig)) {
      result.push({
        name,
        status: 'invalid',
        config: {},
        diagnostics: ['profile config must be a table'],
        source: 'config.toml'
      });
      continue;
    }

    const validation = validateProfileConfig(rawConfig);
    result.push({
      name,
      status: validation.ok ? 'valid' : 'invalid',
      config: validation.ok ? normalizeProfileConfig(rawConfig) : {},
      diagnostics: validation.ok ? [] : [validation.message],
      source: 'config.toml'
    });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, profiles: result, diagnostics: [] };
}

function normalizeProfileConfig(config: Record<string, unknown>): TomlProfileConfig {
  const normalized: TomlProfileConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (isTomlProfileValue(value)) normalized[key] = value;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTomlProfileValue(value: unknown): value is TomlProfileValue {
  if (isTomlPrimitive(value)) return true;
  return Array.isArray(value) && value.every(isTomlPrimitive);
}

function isTomlPrimitive(value: unknown): value is TomlPrimitive {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-profile-config.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/codex/profiles/types.ts apps/daemon/src/codex/profiles/config.ts apps/daemon/test/unit/codex-profile-config.test.ts
git commit -m "feat: parse codex profiles from config"
```

---

### Task 4: Isolated Profile Writer

**Files:**
- Modify: `apps/daemon/src/codex/profiles/config.ts`
- Create: `apps/daemon/src/codex/profiles/writer.ts`
- Create: `apps/daemon/test/unit/codex-profile-writer.test.ts`

- [ ] **Step 1: Write failing writer tests**

Create `apps/daemon/test/unit/codex-profile-writer.test.ts`:

```ts
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProfileWriter,
  serializeCodexProfileConfig
} from '../../src/codex/profiles/writer.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex profile writer', () => {
  it('creates updates and deletes profiles with backups', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-profile-writer-'));
    const writer = createProfileWriter({ codexHome: tempDir });

    await writer.createProfile('review', {
      model: 'gpt-5.3-codex',
      model_reasoning_effort: 'high'
    });
    expect(readFileSync(join(tempDir, 'config.toml'), 'utf8')).toContain('[profiles.review]');

    await writer.updateProfile('review', {
      model: 'gpt-5.3-codex',
      model_reasoning_effort: 'medium'
    });
    expect(readFileSync(join(tempDir, 'config.toml'), 'utf8')).toContain('model_reasoning_effort = "medium"');
    expect(readdirSync(join(tempDir, 'backups')).some(name => name.startsWith('config.toml.'))).toBe(true);

    await writer.deleteProfile('review');
    expect(readFileSync(join(tempDir, 'config.toml'), 'utf8')).not.toContain('[profiles.review]');
  });

  it('does not destroy the original config when current toml is invalid', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-profile-writer-'));
    mkdirSync(tempDir, { recursive: true });
    const configPath = join(tempDir, 'config.toml');
    writeFileSync(configPath, '[profiles.default\\nmodel = "broken"');
    const writer = createProfileWriter({ codexHome: tempDir });

    await expect(writer.createProfile('review', { model: 'gpt-5.3-codex' })).rejects.toThrow(/CODEX_CONFIG_INVALID/);
    expect(readFileSync(configPath, 'utf8')).toBe('[profiles.default\\nmodel = "broken"');
  });

  it('serializes supported profile values', () => {
    const content = serializeCodexProfileConfig({
      root: {},
      profiles: {
        review: {
          model: 'gpt-5.3-codex',
          enabled: true,
          count: 2,
          tags: ['a', 'b']
        }
      }
    });

    expect(content).toContain('[profiles.review]');
    expect(content).toContain('model = "gpt-5.3-codex"');
    expect(content).toContain('enabled = true');
    expect(content).toContain('count = 2');
    expect(content).toContain('tags = ["a", "b"]');
  });

  it('preserves supported non-profile root config fields', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-profile-writer-'));
    writeFileSync(join(tempDir, 'config.toml'), 'model = "gpt-5.3-codex"\napproval_policy = "never"\n');
    const writer = createProfileWriter({ codexHome: tempDir });

    await writer.createProfile('review', { model_reasoning_effort: 'high' });

    const content = readFileSync(join(tempDir, 'config.toml'), 'utf8');
    expect(content).toContain('model = "gpt-5.3-codex"');
    expect(content).toContain('approval_policy = "never"');
    expect(content).toContain('[profiles.review]');
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-profile-writer.test.ts
```

Expected: fails because writer module does not exist.

- [ ] **Step 3: Implement writer**

Create `apps/daemon/src/codex/profiles/writer.ts`:

```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'toml';
import { parseCodexProfileConfig, validateProfileConfig } from './config.js';
import type { TomlProfileConfig, TomlProfileValue } from './types.js';

export type ProfileWriter = {
  createProfile(name: string, config: TomlProfileConfig): Promise<void>;
  updateProfile(name: string, config: TomlProfileConfig): Promise<void>;
  deleteProfile(name: string): Promise<void>;
};

type RootConfig = {
  root: TomlProfileConfig;
  profiles: Record<string, TomlProfileConfig>;
};

const locks = new Map<string, Promise<void>>();

export function createProfileWriter(input: { codexHome: string }): ProfileWriter {
  return {
    createProfile(name, config) {
      return withLock(input.codexHome, () => writeProfile(input.codexHome, 'create', name, config));
    },
    updateProfile(name, config) {
      return withLock(input.codexHome, () => writeProfile(input.codexHome, 'update', name, config));
    },
    deleteProfile(name) {
      return withLock(input.codexHome, () => writeProfile(input.codexHome, 'delete', name));
    }
  };
}

export function serializeCodexProfileConfig(root: RootConfig): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(root.root).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }
  if (lines.length > 0) lines.push('');

  for (const [name, config] of Object.entries(root.profiles).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`[profiles.${name}]`);
    for (const [key, value] of Object.entries(config).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${key} = ${formatTomlValue(value)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function withLock(codexHome: string, fn: () => void): Promise<void> {
  const previous = locks.get(codexHome) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  locks.set(codexHome, previous.then(() => current));
  await previous;
  try {
    fn();
  } finally {
    release();
    if (locks.get(codexHome) === current) locks.delete(codexHome);
  }
}

function writeProfile(
  codexHome: string,
  action: 'create' | 'update' | 'delete',
  name: string,
  config?: TomlProfileConfig
): void {
  if (config !== undefined) {
    const validation = validateProfileConfig(config);
    if (!validation.ok) throw new Error(`CODEX_PROFILE_INVALID: ${validation.message}`);
  }

  mkdirSync(codexHome, { recursive: true });
  const configPath = join(codexHome, 'config.toml');
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const parsed = parseCodexProfileConfig(existing);
  if (!parsed.ok) throw new Error(`CODEX_CONFIG_INVALID: ${parsed.diagnostics.join('; ')}`);

  const root = parseRootConfig(existing);
  if (action === 'create' && root.profiles[name] !== undefined) {
    throw new Error('CODEX_PROFILE_EXISTS');
  }
  if ((action === 'update' || action === 'delete') && root.profiles[name] === undefined) {
    throw new Error('CODEX_PROFILE_NOT_FOUND');
  }

  if (action === 'delete') delete root.profiles[name];
  else root.profiles[name] = config ?? {};

  const next = serializeCodexProfileConfig(root);
  parse(next);

  const tmpPath = join(codexHome, `config.toml.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmpPath, next);
  parse(readFileSync(tmpPath, 'utf8'));
  if (existsSync(configPath)) backupConfig(codexHome, configPath);
  renameSync(tmpPath, configPath);
}

function parseRootConfig(content: string): RootConfig {
  const parsed = content.trim().length === 0 ? {} : parse(content);
  if (!isRecord(parsed)) return { root: {}, profiles: {} };

  const validation = validateProfileConfig(
    Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'profiles'))
  );
  if (!validation.ok) {
    throw new Error(`CODEX_CONFIG_INVALID: unsupported top-level config: ${validation.message}`);
  }

  const root: TomlProfileConfig = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== 'profiles' && isTomlProfileValue(value)) root[key] = value;
  }

  const rawProfiles = isRecord(parsed.profiles)
    ? parsed.profiles
    : {};
  const profiles: Record<string, TomlProfileConfig> = {};
  for (const [name, value] of Object.entries(rawProfiles)) {
    if (isRecord(value)) profiles[name] = value as TomlProfileConfig;
  }
  return { root, profiles };
}

function backupConfig(codexHome: string, configPath: string): void {
  const backupDir = join(codexHome, 'backups');
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(configPath, join(backupDir, `config.toml.${Date.now()}.bak`));
}

function formatTomlValue(value: TomlProfileValue): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `[${value.map(formatTomlValue).join(', ')}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTomlProfileValue(value: unknown): value is TomlProfileValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  return Array.isArray(value)
    && value.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-profile-config.test.ts test/unit/codex-profile-writer.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/codex/profiles/config.ts apps/daemon/src/codex/profiles/writer.ts apps/daemon/test/unit/codex-profile-writer.test.ts
git commit -m "feat: write isolated codex profiles atomically"
```

---

### Task 5: Profile Manager and Read API

**Files:**
- Create: `apps/daemon/src/codex/profiles/manager.ts`
- Create: `apps/daemon/src/api/routes.profiles.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: Write failing read API tests**

Add to `apps/daemon/test/integration/api.test.ts`:

```ts
  it('lists profiles from an isolated codex home', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'config.toml'),
      '[profiles.review]\nmodel = "gpt-5.3-codex"\n'
    );
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      writable: true,
      profiles: [
        {
          name: 'review',
          status: 'valid',
          config: { model: 'gpt-5.3-codex' }
        }
      ]
    });
  });

  it('returns diagnostics instead of crashing for invalid profile config', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), '[profiles.review\nmodel = "broken"');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profiles).toEqual([]);
    expect(response.json().diagnostics[0]).toContain('Failed to parse');
  });
```

Also import `mkdirSync`, `writeFileSync` from `node:fs` at the top.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
```

Expected: 404 for `/codex/profiles`.

- [ ] **Step 3: Implement profile manager**

Create `apps/daemon/src/codex/profiles/manager.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedCodexHome } from '../home.js';
import { parseCodexProfileConfig } from './config.js';
import { createProfileWriter } from './writer.js';
import type { CodexProfile, TomlProfileConfig } from './types.js';

export type ProfileManager = {
  listProfiles(): { profiles: CodexProfile[]; diagnostics: string[] };
  getProfile(name: string): CodexProfile | undefined;
  createProfile(name: string, config: TomlProfileConfig): Promise<void>;
  updateProfile(name: string, config: TomlProfileConfig): Promise<void>;
  deleteProfile(name: string): Promise<void>;
  validateProfileForRun(name: string): { ok: true } | { ok: false; code: string; message: string };
};

export function createProfileManager(input: { codexHome: ResolvedCodexHome }): ProfileManager {
  const writer = createProfileWriter({ codexHome: input.codexHome.path });

  return {
    listProfiles() {
      return scanProfiles(input.codexHome);
    },
    getProfile(name) {
      return scanProfiles(input.codexHome).profiles.find(profile => profile.name === name);
    },
    async createProfile(name, config) {
      assertWritable(input.codexHome.writable);
      await writer.createProfile(name, config);
    },
    async updateProfile(name, config) {
      assertWritable(input.codexHome.writable);
      await writer.updateProfile(name, config);
    },
    async deleteProfile(name) {
      assertWritable(input.codexHome.writable);
      await writer.deleteProfile(name);
    },
    validateProfileForRun(name) {
      if (name === 'default') return { ok: true };
      const scan = scanProfiles(input.codexHome);
      if (scan.diagnostics.length > 0) {
        return { ok: false, code: 'CODEX_CONFIG_INVALID', message: scan.diagnostics.join('; ') };
      }
      const profile = scan.profiles.find(item => item.name === name);
      if (profile === undefined) {
        return { ok: false, code: 'CODEX_PROFILE_NOT_FOUND', message: `Profile not found: ${name}` };
      }
      if (profile.status !== 'valid') {
        return { ok: false, code: 'CODEX_PROFILE_INVALID', message: `Profile is invalid: ${name}` };
      }
      return { ok: true };
    }
  };
}

function scanProfiles(codexHome: ResolvedCodexHome): { profiles: CodexProfile[]; diagnostics: string[] } {
  const configPath = join(codexHome.path, 'config.toml');
  const content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const updatedAt = existsSync(configPath) ? statSync(configPath).mtime.toISOString() : undefined;
  const parsed = parseCodexProfileConfig(content);
  if (!parsed.ok) return { profiles: [], diagnostics: parsed.diagnostics };
  return {
    profiles: parsed.profiles.map(profile => ({
      ...profile,
      codexHomeMode: codexHome.mode,
      updatedAt
    })),
    diagnostics: parsed.diagnostics
  };
}

function assertWritable(writable: boolean): void {
  if (!writable) throw new Error('CODEX_HOME_READ_ONLY');
}
```

- [ ] **Step 4: Implement routes**

Create `apps/daemon/src/api/routes.profiles.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { ProfileManager } from '../codex/profiles/manager.js';
import { validateProfileConfig, isValidProfileName } from '../codex/profiles/config.js';
import { apiError } from './errors.js';

export async function registerProfileRoutes(
  server: FastifyInstance,
  input: { manager: ProfileManager; codexHome: { path: string; mode: 'global' | 'isolated'; writable: boolean } }
): Promise<void> {
  server.get('/codex/profiles', async () => {
    const result = input.manager.listProfiles();
    return {
      codexHome: input.codexHome.path,
      codexHomeMode: input.codexHome.mode,
      writable: input.codexHome.writable,
      profiles: result.profiles,
      diagnostics: result.diagnostics
    };
  });

  server.get('/codex/profiles/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const profile = input.manager.getProfile(name);
    if (profile === undefined) {
      return reply.code(404).send(apiError('CODEX_PROFILE_NOT_FOUND', 'Profile not found'));
    }
    return { profile };
  });
}
```

- [ ] **Step 5: Wire routes in server**

In `apps/daemon/src/api/server.ts`, import and create:

```ts
import { createProfileManager } from '../codex/profiles/manager.js';
import { registerProfileRoutes } from './routes.profiles.js';
```

After `resolvedCodexHome`:

```ts
  const profileManager = createProfileManager({ codexHome: resolvedCodexHome });
```

Before run/thread routes:

```ts
  await registerProfileRoutes(server, {
    manager: profileManager,
    codexHome: resolvedCodexHome
  });
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/codex/profiles/manager.ts apps/daemon/src/api/routes.profiles.ts apps/daemon/src/api/server.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: expose codex profile read api"
```

---

### Task 6: Isolated Profile Write API

**Files:**
- Modify: `apps/daemon/src/codex/profiles/manager.ts`
- Modify: `apps/daemon/src/api/routes.profiles.ts`
- Modify: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: Write failing write API tests**

Add to `apps/daemon/test/integration/api.test.ts`:

```ts
  it('creates updates and deletes profiles in isolated codex home', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const created = await server.inject({
      method: 'POST',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' },
      payload: { name: 'review', config: { model: 'gpt-5.3-codex' } }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().profile).toMatchObject({ name: 'review', status: 'valid' });

    const updated = await server.inject({
      method: 'PATCH',
      url: '/codex/profiles/review',
      headers: { authorization: 'Bearer secret' },
      payload: { config: { model: 'gpt-5.3-codex', model_reasoning_effort: 'high' } }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().profile.config.model_reasoning_effort).toBe('high');

    const deleted = await server.inject({
      method: 'DELETE',
      url: '/codex/profiles/review',
      headers: { authorization: 'Bearer secret' }
    });
    expect(deleted.statusCode).toBe(200);

    const missing = await server.inject({
      method: 'GET',
      url: '/codex/profiles/review',
      headers: { authorization: 'Bearer secret' }
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects profile writes in global codex home', async () => {
    server = await buildServer({ token: 'secret' });

    const response = await server.inject({
      method: 'POST',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' },
      payload: { name: 'review', config: { model: 'gpt-5.3-codex' } }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CODEX_HOME_READ_ONLY');
  });
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
```

Expected: POST/PATCH/DELETE are not implemented.

- [ ] **Step 3: Add write routes**

Extend `apps/daemon/src/api/routes.profiles.ts`:

```ts
  server.post<{ Body: unknown }>('/codex/profiles', async (request, reply) => {
    const parsed = parseProfileWriteBody(request.body, true);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    try {
      await input.manager.createProfile(parsed.value.name, parsed.value.config);
      const profile = input.manager.getProfile(parsed.value.name);
      return reply.code(201).send({ profile });
    } catch (error) {
      return sendProfileError(reply, error);
    }
  });

  server.patch<{ Body: unknown }>('/codex/profiles/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const parsed = parseProfileWriteBody({ ...(request.body as object), name }, false);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    try {
      await input.manager.updateProfile(name, parsed.value.config);
      return { profile: input.manager.getProfile(name) };
    } catch (error) {
      return sendProfileError(reply, error);
    }
  });

  server.delete('/codex/profiles/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      await input.manager.deleteProfile(name);
      return { deleted: true };
    } catch (error) {
      return sendProfileError(reply, error);
    }
  });
```

Add helpers in the same file:

```ts
function parseProfileWriteBody(
  body: unknown,
  requireName: boolean
): { ok: true; value: { name: string; config: Record<string, unknown> } } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'body must be an object' };
  }
  const input = body as Record<string, unknown>;
  const name = input.name;
  if (requireName && (typeof name !== 'string' || !isValidProfileName(name))) {
    return { ok: false, message: 'name must be a valid profile name' };
  }
  const config = input.config;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { ok: false, message: 'config must be an object' };
  }
  const validation = validateProfileConfig(config as Record<string, unknown>);
  if (!validation.ok) return { ok: false, message: validation.message };
  return { ok: true, value: { name: name as string, config: config as Record<string, unknown> } };
}

function sendProfileError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('CODEX_HOME_READ_ONLY')) {
    return reply.code(409).send(apiError('CODEX_HOME_READ_ONLY', 'Codex home is read-only'));
  }
  if (message.includes('CODEX_PROFILE_EXISTS')) {
    return reply.code(409).send(apiError('CODEX_PROFILE_EXISTS', 'Profile already exists'));
  }
  if (message.includes('CODEX_PROFILE_NOT_FOUND')) {
    return reply.code(404).send(apiError('CODEX_PROFILE_NOT_FOUND', 'Profile not found'));
  }
  if (message.includes('CODEX_CONFIG_INVALID')) {
    return reply.code(422).send(apiError('CODEX_CONFIG_INVALID', message));
  }
  if (message.includes('CODEX_PROFILE_INVALID')) {
    return reply.code(422).send(apiError('CODEX_PROFILE_INVALID', message));
  }
  return reply.code(500).send(apiError('CODEX_CONFIG_WRITE_FAILED', message));
}
```

Import `FastifyReply`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts test/unit/codex-profile-writer.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/codex/profiles/manager.ts apps/daemon/src/api/routes.profiles.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: manage isolated codex profiles"
```

---

### Task 7: Run and Thread Profile Validation

**Files:**
- Modify: `apps/daemon/src/api/routes.runs.ts`
- Modify: `apps/daemon/src/api/routes.threads.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: Write failing validation tests**

Add to `apps/daemon/test/integration/api.test.ts`:

```ts
  it('rejects explicit missing profiles for new runs and threads', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }, { type: 'turn.completed' }]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir, profile: 'missing-profile' }
    });
    expect(run.statusCode).toBe(404);
    expect(run.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');

    const thread = await server.inject({
      method: 'POST',
      url: '/threads',
      headers: { authorization: 'Bearer secret' },
      payload: { workspaceMode: 'external', cwd: tempDir, profile: 'missing-profile' }
    });
    expect(thread.statusCode).toBe(404);
    expect(thread.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');
  });

  it('allows runs with profiles created in isolated codex home', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }, { type: 'turn.completed' }]
    });
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexBin: fake.bin, codexHome });

    await server.inject({
      method: 'POST',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' },
      payload: { name: 'review', config: { model: 'gpt-5.3-codex' } }
    });

    const run = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir, profile: 'review' }
    });
    expect(run.statusCode).toBe(202);
    await waitForRunStatus(run.json().id, 'succeeded');
    expect(fake.readArgv()).toEqual(expect.arrayContaining(['-p', 'review']));
  });

  it('does not require default profile to exist', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }, { type: 'turn.completed' }]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir }
    });

    expect(run.statusCode).toBe(202);
    await waitForRunStatus(run.json().id, 'succeeded');
  });

  it('rejects explicit profiles when config.toml is invalid', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), '[profiles.review\nmodel = "broken"');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const run = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir, profile: 'review' }
    });

    expect(run.statusCode).toBe(422);
    expect(run.json().error.code).toBe('CODEX_CONFIG_INVALID');
  });
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
```

Expected: missing profile is not rejected yet.

- [ ] **Step 3: Inject profile validator into routes**

In `apps/daemon/src/api/routes.runs.ts`, extend options:

```ts
profileValidator?: { validateProfileForRun(name: string): { ok: true } | { ok: false; code: string; message: string } };
```

Before starting an independent run:

```ts
    const profile = body.profile ?? 'default';
    if (body.profile !== undefined && options.profileValidator !== undefined) {
      const validation = options.profileValidator.validateProfileForRun(profile);
      if (!validation.ok) return sendProfileValidationError(reply, validation);
    }
```

For thread runs, do not revalidate on every run; thread creation validates profile and thread config is immutable.

In `apps/daemon/src/api/routes.threads.ts`, add an optional profile validator argument or include it in the existing options object. Before `manager.createThread(body.value)`:

```ts
    if (body.value.profile !== undefined && profileValidator !== undefined) {
      const validation = profileValidator.validateProfileForRun(body.value.profile);
      if (!validation.ok) return sendProfileValidationError(reply, validation);
    }
```

Add helper in both files or a shared small helper:

```ts
function sendProfileValidationError(reply: FastifyReply, validation: { code: string; message: string }) {
  if (validation.code === 'CODEX_PROFILE_NOT_FOUND') {
    return reply.code(404).send(apiError('CODEX_PROFILE_NOT_FOUND', validation.message));
  }
  if (validation.code === 'CODEX_CONFIG_INVALID') {
    return reply.code(422).send(apiError('CODEX_CONFIG_INVALID', validation.message));
  }
  return reply.code(422).send(apiError('CODEX_PROFILE_INVALID', validation.message));
}
```

In `apps/daemon/src/api/server.ts`, pass `profileManager` into run/thread routes:

```ts
  await registerRunRoutes(server, runManager, {
    sseHeartbeatMs: input.sseHeartbeatMs,
    threadManager,
    profileValidator: profileManager
  });
  await registerThreadRoutes(server, threadManager, runManager, {
    profileValidator: profileManager
  });
```

If `registerThreadRoutes` signature is changed, update tests compile errors accordingly.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts test/integration/run-manager.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/api/routes.runs.ts apps/daemon/src/api/routes.threads.ts apps/daemon/src/api/server.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: validate codex profiles for new runs"
```

---

### Task 8: R3 Smoke, Coverage Report, and Final Verification

**Files:**
- Modify: `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- Modify: `docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md`

- [ ] **Step 1: Ensure real profile smoke is present**

If Task 1 added the smoke test, keep it. If it was deferred, add it now using the exact code from Task 1.

- [ ] **Step 2: Update coverage report**

In `docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md`, update:

```md
| CODEX_HOME 解析 | `apps/daemon/src/codex/home.ts` | `apps/daemon/test/unit/codex-home.test.ts` | `PASS` | 已覆盖 global/env/isolated/source/writable；全局写入仍禁止 |
```

Update Profile row or add one:

```md
| Profile API | `apps/daemon/src/codex/profiles/*`, `apps/daemon/src/api/routes.profiles.ts` | `apps/daemon/test/unit/codex-profile-*.test.ts`, `apps/daemon/test/integration/api.test.ts`, `apps/daemon/test/smoke/real-codex-smoke.test.ts` | `PARTIAL` | isolated profile CRUD、写锁、备份、原子写入、run/thread 校验已覆盖；全局写入、复杂 config normalize、UI 未实现 |
```

Do not claim Skills, MCP, Scheduler, or UI are complete.

- [ ] **Step 3: Run full automated verification**

```bash
pnpm typecheck
pnpm test
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
git diff --check
```

Expected:

1. Typecheck passes.
2. Unit/integration tests pass.
3. Real Codex smoke passes, including isolated profile smoke.
4. No whitespace errors.

- [ ] **Step 4: Run a manual daemon smoke for R3**

```bash
pnpm daemon:dev
```

In another shell, using the printed address/token:

```bash
export CLAWEE_DAEMON_URL="http://127.0.0.1:<port>"
export CLAWEE_DAEMON_TOKEN="<token>"

curl -sS -H "authorization: Bearer $CLAWEE_DAEMON_TOKEN" \
  "$CLAWEE_DAEMON_URL/codex/status"

curl -sS -H "authorization: Bearer $CLAWEE_DAEMON_TOKEN" \
  "$CLAWEE_DAEMON_URL/codex/profiles"
```

Expected in default global mode:

1. `codexHomeWritable` is false.
2. `GET /codex/profiles` returns 200.
3. `POST /codex/profiles` returns `CODEX_HOME_READ_ONLY`.

- [ ] **Step 5: Commit final report**

```bash
git add apps/daemon/test/smoke/real-codex-smoke.test.ts docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md
git commit -m "test: verify r3 profile integration"
```

---

## Self-Review Checklist

Before executing this plan:

1. Confirm Task 1 validates the actual Codex profile TOML structure before implementation depends on it.
2. Confirm global `CODEX_HOME` writes are rejected in API tests.
3. Confirm isolated writes are atomic and backed up.
4. Confirm missing/invalid explicit profiles block new run/thread creation.
5. Confirm default profile absence does not block run creation.
6. Confirm coverage report still marks Skills, MCP, Scheduler, UI as not complete.
