# Codex Runtime R4 Skills Pass-through 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实现本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。不要使用 git worktree；所有实现都在当前工作区完成。

**Goal:** 实现 R4 Codex Skills Pass-through 后端能力：扫描、安装、覆盖、删除当前 `CODEX_HOME/skills`，记录操作日志，并通过 gated 真实 Codex smoke 验证原生发现能力。

**Architecture:** `CODEX_HOME/skills` 是唯一真相源，Runtime 不实现 skill runtime，也不把 SQLite 当 skill 数据源。新增 `codex/skills` 小模块负责扫描、校验、写锁、备份和安装删除；`routes.skills.ts` 暴露 API；SQLite 只记录写操作日志；`/codex/status` 扩展 skills 能力矩阵。

**Tech Stack:** TypeScript, Fastify, Vitest, Node fs/path, existing SQLite `better-sqlite3`, existing fake/real Codex smoke helpers.

---

## File Structure

Create:

- `apps/daemon/src/codex/skills/types.ts`  
  定义 skill 状态、响应模型、操作日志模型、安装输入、校验结果。
- `apps/daemon/src/codex/skills/validator.ts`  
  校验 skill id、解析 `SKILL.md` frontmatter、校验目录、拒绝 symlink。
- `apps/daemon/src/codex/skills/scanner.ts`  
  扫描 `CODEX_HOME/skills/*`，返回 valid/invalid skill 和 diagnostics。
- `apps/daemon/src/codex/skills/operations.ts`  
  SQLite 操作日志 repository：insert/list。
- `apps/daemon/src/codex/skills/installer.ts`  
  skills 写锁、安装、覆盖、删除、备份、临时目录清理。
- `apps/daemon/src/codex/skills/manager.ts`  
  组合 scanner/installer/operations，作为 API 和测试入口。
- `apps/daemon/src/api/routes.skills.ts`  
  `/codex/skills` API。
- `apps/daemon/test/unit/codex-skills-validator.test.ts`
- `apps/daemon/test/unit/codex-skills-scanner.test.ts`
- `apps/daemon/test/unit/codex-skills-installer.test.ts`

Modify:

- `packages/protocol/src/api.ts`  
  增加 R4 API request/response 类型。
- `packages/protocol/src/errors.ts`  
  增加 `CODEX_SKILL_*` 错误码。
- `apps/daemon/src/storage/migrations.ts`  
  增加 `codex_skill_operations` 表和索引。
- `apps/daemon/src/codex/capabilities.ts`  
  扩展 `RuntimeCapabilityMatrix` skills 字段和 unknown 默认能力。
- `apps/daemon/src/api/routes.codex.ts`  
  `/codex/status` 返回扩展能力矩阵。
- `apps/daemon/src/api/server.ts`  
  创建 skill manager，注册 skill routes。
- `apps/daemon/test/integration/api.test.ts`  
  增加 skills API 集成测试。
- `apps/daemon/test/unit/storage.test.ts`  
  覆盖 skill 操作日志表迁移。
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`  
  增加 gated skills discovery smoke。

Do not modify in R4:

- UI。
- MCP 管理。
- Scheduler。
- 自研 skill runtime。
- profile 写入策略。
- 用户全局 `~/.codex/skills` 的默认自动化写测试。

---

### Task 1: Protocol、错误码和能力矩阵

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/errors.ts`
- Modify: `apps/daemon/src/codex/capabilities.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Test: `apps/daemon/test/unit/codex-capabilities.test.ts`
- Test: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 写 failing protocol shape 测试**

在 `apps/daemon/test/unit/codex-capabilities.test.ts` 增加测试，放在现有 capability tests 的 `describe` 内：

```ts
it('defaults skill capability flags to false when capability help is unknown', () => {
  const matrix = parseCodexCapabilityMatrix({
    versionOutput: 'codex-cli 0.142.5',
    execHelp: '',
    resumeHelp: '',
    mcpAddHelp: '',
    checkedAt: '2026-07-05T00:00:00.000Z'
  });

  expect(matrix).toMatchObject({
    skillsScan: false,
    skillsInstall: false,
    skillsDelete: false,
    skillsGlobalWrite: false,
    skillsRuntimeDiscoveryVerified: false,
    skillsRuntimeBehaviorVerified: false
  });
});
```

在 `apps/daemon/test/integration/api.test.ts` 的 `returns codex status with auth` 断言里补充：

```ts
      capabilities: {
        resumeJson: true,
        resumeByThreadId: true,
        skillsScan: false,
        skillsInstall: false,
        skillsDelete: false,
        skillsGlobalWrite: false,
        skillsRuntimeDiscoveryVerified: false,
        skillsRuntimeBehaviorVerified: false
      }
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-capabilities.test.ts test/integration/api.test.ts
```

Expected: 失败，因为 `RuntimeCapabilityMatrix` 还没有 skills 字段。

- [ ] **Step 3: 增加协议类型**

在 `packages/protocol/src/api.ts` 增加：

```ts
export type CodexSkillStatus = 'valid' | 'invalid';
export type CodexSkillOperationType = 'install' | 'overwrite' | 'delete';
export type CodexSkillOperationStatus = 'succeeded' | 'failed';

export type CodexSkillResponse = {
  id: string;
  name?: string;
  description?: string;
  status: CodexSkillStatus;
  diagnostics: string[];
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  skillsPath: string;
  skillPath: string;
  skillFilePath: string;
  updatedAt?: string;
};

export type CodexSkillListResponse = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  skillsPath: string;
  skillsWritable: boolean;
  requiresWriteConfirmation: boolean;
  skills: CodexSkillResponse[];
  diagnostics: string[];
};

export type InstallCodexSkillRequest = {
  sourcePath: string;
  id?: string;
  overwrite?: boolean;
  confirmWriteToCodexHome?: true;
};

export type CodexSkillOperationResponse = {
  id: string;
  operation: CodexSkillOperationType;
  skillId: string;
  codexHome: string;
  skillsPath: string;
  sourcePath?: string | null;
  targetPath: string;
  backupPath?: string | null;
  status: CodexSkillOperationStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type CodexSkillOperationListResponse = {
  operations: CodexSkillOperationResponse[];
};
```

- [ ] **Step 4: 增加错误码**

在 `packages/protocol/src/errors.ts` 的 `RuntimeErrorCode` union 增加：

```ts
  | 'CODEX_SKILL_NOT_FOUND'
  | 'CODEX_SKILL_EXISTS'
  | 'CODEX_SKILL_INVALID'
  | 'CODEX_SKILL_WRITE_FAILED'
  | 'CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED'
```

- [ ] **Step 5: 扩展能力矩阵类型和默认值**

在 `apps/daemon/src/codex/capabilities.ts` 的 `RuntimeCapabilityMatrix` 增加：

```ts
  skillsScan: boolean;
  skillsInstall: boolean;
  skillsDelete: boolean;
  skillsGlobalWrite: boolean;
  skillsRuntimeDiscoveryVerified: boolean;
  skillsRuntimeBehaviorVerified: boolean;
```

在 `parseCodexCapabilityMatrix` 返回对象中增加：

```ts
    skillsScan: false,
    skillsInstall: false,
    skillsDelete: false,
    skillsGlobalWrite: false,
    skillsRuntimeDiscoveryVerified: false,
    skillsRuntimeBehaviorVerified: false,
```

在 `apps/daemon/src/api/server.ts` 的 `createUnknownCapabilityMatrix()` 返回对象中增加同样字段。

在 `apps/daemon/test/integration/api.test.ts` 的 `makeResumeCapableMatrix()` helper 返回对象中也增加同样字段，值全部为 `false`，避免测试 fixture 在扩展 `RuntimeCapabilityMatrix` 后类型不完整。

- [ ] **Step 6: 运行测试和类型检查**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-capabilities.test.ts test/integration/api.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add packages/protocol/src/api.ts packages/protocol/src/errors.ts apps/daemon/src/codex/capabilities.ts apps/daemon/src/api/server.ts apps/daemon/test/unit/codex-capabilities.test.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: add skills capability contract"
```

---

### Task 2: Skill id 和 SKILL.md 校验器

**Files:**
- Create: `apps/daemon/src/codex/skills/types.ts`
- Create: `apps/daemon/src/codex/skills/validator.ts`
- Create: `apps/daemon/test/unit/codex-skills-validator.test.ts`

- [ ] **Step 1: 写 failing validator 测试**

创建 `apps/daemon/test/unit/codex-skills-validator.test.ts`：

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNoSymlinks,
  deriveSkillId,
  isValidSkillId,
  parseSkillMarkdown
} from '../../src/codex/skills/validator.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skill validator', () => {
  it('validates skill ids', () => {
    expect(isValidSkillId('brainstorming')).toBe(true);
    expect(isValidSkillId('team.skill_1')).toBe(true);
    expect(isValidSkillId('')).toBe(false);
    expect(isValidSkillId('.')).toBe(false);
    expect(isValidSkillId('..')).toBe(false);
    expect(isValidSkillId('../escape')).toBe(false);
    expect(isValidSkillId('bad/slash')).toBe(false);
    expect(isValidSkillId('bad\\slash')).toBe(false);
  });

  it('derives ids from request or source directory', () => {
    expect(deriveSkillId({ requestedId: 'explicit', sourcePath: '/tmp/source-name' })).toBe('explicit');
    expect(deriveSkillId({ sourcePath: '/tmp/source-name' })).toBe('source-name');
  });

  it('parses valid SKILL.md frontmatter', () => {
    const parsed = parseSkillMarkdown([
      '---',
      'name: brainstorming',
      'description: "Explore requirements"',
      '---',
      '',
      '# Body'
    ].join('\n'));

    expect(parsed).toEqual({
      ok: true,
      metadata: {
        name: 'brainstorming',
        description: 'Explore requirements'
      },
      diagnostics: []
    });
  });

  it('returns diagnostics for invalid SKILL.md frontmatter', () => {
    expect(parseSkillMarkdown('# Missing frontmatter')).toMatchObject({
      ok: false,
      diagnostics: [expect.stringContaining('frontmatter')]
    });
    expect(parseSkillMarkdown('---\nname:\n---\n')).toMatchObject({
      ok: false,
      diagnostics: [expect.stringContaining('name')]
    });
    expect(parseSkillMarkdown('---\nname: test\n---\n')).toMatchObject({
      ok: false,
      diagnostics: [expect.stringContaining('description')]
    });
  });

  it('rejects symlinks anywhere in a skill directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skill-validator-'));
    const skillDir = join(tempDir, 'skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: test\ndescription: test\n---\n');
    symlinkSync(join(skillDir, 'SKILL.md'), join(skillDir, 'linked.md'));

    expect(() => assertNoSymlinks(skillDir)).toThrow(/CODEX_SKILL_INVALID/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-skills-validator.test.ts
```

Expected: 失败，因为 `codex/skills/validator.ts` 不存在。

- [ ] **Step 3: 创建 types**

创建 `apps/daemon/src/codex/skills/types.ts`：

```ts
import type {
  CodexHomeMode,
  CodexSkillOperationResponse,
  CodexSkillOperationStatus,
  CodexSkillOperationType,
  CodexSkillResponse,
  CodexSkillStatus
} from '@clawee/protocol';

export type {
  CodexSkillOperationResponse,
  CodexSkillOperationStatus,
  CodexSkillOperationType,
  CodexSkillResponse,
  CodexSkillStatus
};

export type SkillMetadata = {
  name: string;
  description: string;
};

export type ParseSkillMarkdownResult =
  | { ok: true; metadata: SkillMetadata; diagnostics: string[] }
  | { ok: false; diagnostics: string[] };

export type SkillScanResult = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  skillsPath: string;
  skillsWritable: boolean;
  requiresWriteConfirmation: boolean;
  skills: CodexSkillResponse[];
  diagnostics: string[];
};

export type InstallSkillInput = {
  sourcePath: string;
  id?: string;
  overwrite?: boolean;
  confirmWriteToCodexHome?: true;
};
```

- [ ] **Step 4: 实现 validator**

创建 `apps/daemon/src/codex/skills/validator.ts`：

```ts
import { lstatSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ParseSkillMarkdownResult } from './types.js';

const SKILL_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function isValidSkillId(id: string): boolean {
  return id.length > 0 && id !== '.' && id !== '..' && SKILL_ID_PATTERN.test(id);
}

export function assertValidSkillId(id: string): void {
  if (!isValidSkillId(id)) throw new Error(`CODEX_SKILL_INVALID: invalid skill id: ${id}`);
}

export function deriveSkillId(input: { requestedId?: string; sourcePath: string }): string {
  const id = input.requestedId ?? basename(input.sourcePath);
  assertValidSkillId(id);
  return id;
}

export function parseSkillMarkdown(content: string): ParseSkillMarkdownResult {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { ok: false, diagnostics: ['SKILL.md missing frontmatter'] };
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { ok: false, diagnostics: ['SKILL.md frontmatter is not closed'] };

  const frontmatter = normalized.slice(4, end);
  const values: Record<string, string> = {};
  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(':');
    if (separator === -1) {
      return { ok: false, diagnostics: [`SKILL.md frontmatter line is invalid: ${line}`] };
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    values[key] = unquoteYamlString(rawValue);
  }

  if (typeof values.name !== 'string' || values.name.trim().length === 0) {
    return { ok: false, diagnostics: ['SKILL.md frontmatter name must be a non-empty string'] };
  }
  if (typeof values.description !== 'string' || values.description.trim().length === 0) {
    return { ok: false, diagnostics: ['SKILL.md frontmatter description must be a non-empty string'] };
  }

  return {
    ok: true,
    metadata: {
      name: values.name,
      description: values.description
    },
    diagnostics: []
  };
}

export function assertNoSymlinks(root: string): void {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`CODEX_SKILL_INVALID: symlink is not allowed: ${root}`);
  if (!stat.isDirectory()) return;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const childStat = lstatSync(path);
    if (childStat.isSymbolicLink()) {
      throw new Error(`CODEX_SKILL_INVALID: symlink is not allowed: ${path}`);
    }
    if (childStat.isDirectory()) assertNoSymlinks(path);
  }
}

function unquoteYamlString(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
```

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-skills-validator.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add apps/daemon/src/codex/skills/types.ts apps/daemon/src/codex/skills/validator.ts apps/daemon/test/unit/codex-skills-validator.test.ts
git commit -m "feat: add codex skill validation"
```

---

### Task 3: Skills scanner

**Files:**
- Create: `apps/daemon/src/codex/skills/scanner.ts`
- Create: `apps/daemon/test/unit/codex-skills-scanner.test.ts`

- [ ] **Step 1: 写 failing scanner 测试**

创建 `apps/daemon/test/unit/codex-skills-scanner.test.ts`：

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanCodexSkills } from '../../src/codex/skills/scanner.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skills scanner', () => {
  it('returns an empty list when skills directory does not exist', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-scan-'));
    const codexHome = join(tempDir, 'codex-home');

    expect(scanCodexSkills({
      codexHome: { path: codexHome, mode: 'isolated', source: 'isolated', writable: true }
    })).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      skillsPath: join(codexHome, 'skills'),
      skillsWritable: true,
      requiresWriteConfirmation: false,
      skills: [],
      diagnostics: []
    });
  });

  it('scans valid and invalid skills without crashing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-scan-'));
    const codexHome = join(tempDir, 'codex-home');
    const validDir = join(codexHome, 'skills', 'valid-skill');
    const invalidDir = join(codexHome, 'skills', 'invalid-skill');
    mkdirSync(validDir, { recursive: true });
    mkdirSync(invalidDir, { recursive: true });
    writeFileSync(join(validDir, 'SKILL.md'), [
      '---',
      'name: valid-skill',
      'description: "A valid skill"',
      '---',
      ''
    ].join('\n'));
    writeFileSync(join(invalidDir, 'SKILL.md'), '# missing frontmatter');

    const result = scanCodexSkills({
      codexHome: { path: codexHome, mode: 'global', source: 'default', writable: false }
    });

    expect(result.skillsWritable).toBe(true);
    expect(result.requiresWriteConfirmation).toBe(true);
    expect(result.skills).toEqual([
      expect.objectContaining({
        id: 'invalid-skill',
        status: 'invalid',
        diagnostics: [expect.stringContaining('frontmatter')]
      }),
      expect.objectContaining({
        id: 'valid-skill',
        name: 'valid-skill',
        description: 'A valid skill',
        status: 'valid',
        diagnostics: []
      })
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-skills-scanner.test.ts
```

Expected: 失败，因为 scanner 不存在。

- [ ] **Step 3: 实现 scanner**

创建 `apps/daemon/src/codex/skills/scanner.ts`：

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedCodexHome } from '../home.js';
import { isValidSkillId, parseSkillMarkdown } from './validator.js';
import type { CodexSkillResponse, SkillScanResult } from './types.js';

export function skillsPathForCodexHome(codexHome: string): string {
  return join(codexHome, 'skills');
}

export function scanCodexSkills(input: { codexHome: ResolvedCodexHome }): SkillScanResult {
  const skillsPath = skillsPathForCodexHome(input.codexHome.path);
  const diagnostics: string[] = [];
  const skills = readSkillDirectories(input.codexHome, skillsPath, diagnostics);

  return {
    codexHome: input.codexHome.path,
    codexHomeMode: input.codexHome.mode,
    skillsPath,
    skillsWritable: true,
    requiresWriteConfirmation: input.codexHome.mode === 'global',
    skills: skills.sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics
  };
}

function readSkillDirectories(
  codexHome: ResolvedCodexHome,
  skillsPath: string,
  diagnostics: string[]
): CodexSkillResponse[] {
  if (!existsSync(skillsPath)) return [];

  let entries: Dirent[];
  try {
    entries = readdirSync(skillsPath, { withFileTypes: true });
  } catch (error) {
    diagnostics.push(`Failed to scan skills directory ${skillsPath}: ${formatError(error)}`);
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const skill = readSkillDirectory(codexHome, skillsPath, entry.name, diagnostics);
      return skill === undefined ? [] : [skill];
    });
}

function readSkillDirectory(
  codexHome: ResolvedCodexHome,
  skillsPath: string,
  id: string,
  diagnostics: string[]
): CodexSkillResponse | undefined {
  if (!isValidSkillId(id)) {
    diagnostics.push(`Ignoring invalid skill directory name: ${id}`);
    return undefined;
  }

  const skillPath = join(skillsPath, id);
  const skillFilePath = join(skillPath, 'SKILL.md');
  let updatedAt: string | undefined;
  try {
    updatedAt = statSync(skillPath).mtime.toISOString();
  } catch (error) {
    diagnostics.push(`Failed to stat skill ${id}: ${formatError(error)}`);
  }

  let content: string;
  try {
    content = readFileSync(skillFilePath, 'utf8');
  } catch (error) {
    return invalidSkill(codexHome, skillsPath, skillPath, skillFilePath, id, [
      `Failed to read SKILL.md: ${formatError(error)}`
    ], updatedAt);
  }

  const parsed = parseSkillMarkdown(content);
  if (!parsed.ok) {
    return invalidSkill(codexHome, skillsPath, skillPath, skillFilePath, id, parsed.diagnostics, updatedAt);
  }

  return {
    id,
    name: parsed.metadata.name,
    description: parsed.metadata.description,
    status: 'valid',
    diagnostics: [],
    codexHome: codexHome.path,
    codexHomeMode: codexHome.mode,
    skillsPath,
    skillPath,
    skillFilePath,
    updatedAt
  };
}

function invalidSkill(
  codexHome: ResolvedCodexHome,
  skillsPath: string,
  skillPath: string,
  skillFilePath: string,
  id: string,
  skillDiagnostics: string[],
  updatedAt?: string
): CodexSkillResponse {
  return {
    id,
    status: 'invalid',
    diagnostics: skillDiagnostics,
    codexHome: codexHome.path,
    codexHomeMode: codexHome.mode,
    skillsPath,
    skillPath,
    skillFilePath,
    updatedAt
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-skills-scanner.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/codex/skills/scanner.ts apps/daemon/test/unit/codex-skills-scanner.test.ts
git commit -m "feat: scan codex skills directory"
```

---

### Task 4: Skill 操作日志迁移和 repository

**Files:**
- Modify: `apps/daemon/src/storage/migrations.ts`
- Create: `apps/daemon/src/codex/skills/operations.ts`
- Modify: `apps/daemon/test/unit/storage.test.ts`

- [ ] **Step 1: 写 failing storage 测试**

在 `apps/daemon/test/unit/storage.test.ts` 的顶部 `describe('runtime storage', () => {` 代码块内，放在 `creates tables and enforces unique event sequence per run` 测试之后增加：

```ts
  it('creates codex skill operation log table', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_skill_operations'"
      )
      .all() as Array<{ name: string }>;
    expect(tableRows).toEqual([{ name: 'codex_skill_operations' }]);

    const indexRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_codex_skill_operations_created_at'"
      )
      .all() as Array<{ name: string }>;
    expect(indexRows).toEqual([{ name: 'idx_codex_skill_operations_created_at' }]);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/storage.test.ts
```

Expected: 失败，因为表不存在。

- [ ] **Step 3: 增加迁移**

在 `apps/daemon/src/storage/migrations.ts` 的 `db.exec` SQL 内增加：

```sql
    CREATE TABLE IF NOT EXISTS codex_skill_operations (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      codex_home TEXT NOT NULL,
      skills_path TEXT NOT NULL,
      source_path TEXT,
      target_path TEXT NOT NULL,
      backup_path TEXT,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_codex_skill_operations_created_at
      ON codex_skill_operations(created_at DESC, id DESC);
```

- [ ] **Step 4: 创建 operations repository**

创建 `apps/daemon/src/codex/skills/operations.ts`：

```ts
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  CodexSkillOperationResponse,
  CodexSkillOperationStatus,
  CodexSkillOperationType
} from './types.js';

export type InsertSkillOperationInput = {
  operation: CodexSkillOperationType;
  skillId: string;
  codexHome: string;
  skillsPath: string;
  sourcePath?: string | null;
  targetPath: string;
  backupPath?: string | null;
  status: CodexSkillOperationStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type SkillOperationRepository = {
  insertOperation(input: InsertSkillOperationInput): CodexSkillOperationResponse;
  listOperations(limit?: number): CodexSkillOperationResponse[];
};

export function createSkillOperationRepository(db: Database.Database): SkillOperationRepository {
  const insert = db.prepare(`
    INSERT INTO codex_skill_operations (
      id, operation, skill_id, codex_home, skills_path, source_path,
      target_path, backup_path, status, error_code, error_message
    ) VALUES (
      @id, @operation, @skillId, @codexHome, @skillsPath, @sourcePath,
      @targetPath, @backupPath, @status, @errorCode, @errorMessage
    )
  `);
  const get = db.prepare<string>('SELECT * FROM codex_skill_operations WHERE id = ?');
  const list = db.prepare<{ limit: number }>(`
    SELECT *
    FROM codex_skill_operations
    ORDER BY rowid DESC
    LIMIT @limit
  `);

  return {
    insertOperation(input): CodexSkillOperationResponse {
      const id = `skillop_${nanoid()}`;
      insert.run({
        id,
        sourcePath: null,
        backupPath: null,
        errorCode: null,
        errorMessage: null,
        ...input
      });
      const row = get.get(id) as SkillOperationRow;
      return mapRow(row);
    },
    listOperations(limit = 50): CodexSkillOperationResponse[] {
      const normalizedLimit = Math.max(1, Math.min(limit, 200));
      return (list.all({ limit: normalizedLimit }) as SkillOperationRow[]).map(mapRow);
    }
  };
}

type SkillOperationRow = {
  id: string;
  operation: CodexSkillOperationType;
  skill_id: string;
  codex_home: string;
  skills_path: string;
  source_path: string | null;
  target_path: string;
  backup_path: string | null;
  status: CodexSkillOperationStatus;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

function mapRow(row: SkillOperationRow): CodexSkillOperationResponse {
  return {
    id: row.id,
    operation: row.operation,
    skillId: row.skill_id,
    codexHome: row.codex_home,
    skillsPath: row.skills_path,
    sourcePath: row.source_path,
    targetPath: row.target_path,
    backupPath: row.backup_path,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}
```

- [ ] **Step 5: 给 repository 增加单元覆盖**

在 `apps/daemon/test/unit/storage.test.ts` 顶部 import：

```ts
import { createSkillOperationRepository } from '../../src/codex/skills/operations.js';
```

在 `apps/daemon/test/unit/storage.test.ts` 的顶部 `describe('runtime storage', () => {` 代码块内，放在 `creates codex skill operation log table` 测试之后增加：

```ts
  it('persists codex skill operations', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const operations = createSkillOperationRepository(db);

    const inserted = operations.insertOperation({
      operation: 'install',
      skillId: 'writer',
      codexHome: join(tempDir, 'codex-home'),
      skillsPath: join(tempDir, 'codex-home', 'skills'),
      sourcePath: join(tempDir, 'source'),
      targetPath: join(tempDir, 'codex-home', 'skills', 'writer'),
      status: 'succeeded'
    });

    expect(inserted).toMatchObject({
      operation: 'install',
      skillId: 'writer',
      status: 'succeeded',
      sourcePath: join(tempDir, 'source'),
      errorCode: null
    });
    expect(operations.listOperations()).toEqual([inserted]);
  });
```

- [ ] **Step 6: 运行测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/storage.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/storage/migrations.ts apps/daemon/src/codex/skills/operations.ts apps/daemon/test/unit/storage.test.ts
git commit -m "feat: log codex skill operations"
```

---

### Task 5: Skills installer

**Files:**
- Create: `apps/daemon/src/codex/skills/installer.ts`
- Create: `apps/daemon/test/unit/codex-skills-installer.test.ts`

- [ ] **Step 1: 写 failing installer 测试**

创建 `apps/daemon/test/unit/codex-skills-installer.test.ts`：

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSkillInstaller } from '../../src/codex/skills/installer.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skills installer', () => {
  it('installs a local skill directory into CODEX_HOME skills', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-install-'));
    const source = createSourceSkill('writer', 'first');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    const result = await installer.install({ sourcePath: source, id: 'writer' });

    expect(result.backupPath).toBeNull();
    expect(readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('first');
  });

  it('rejects duplicates unless overwrite is true', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-install-'));
    const first = createSourceSkill('writer-first', 'first');
    const second = createSourceSkill('writer-second', 'second');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    await installer.install({ sourcePath: first, id: 'writer' });
    await expect(installer.install({ sourcePath: second, id: 'writer' })).rejects.toThrow(/CODEX_SKILL_EXISTS/);

    const overwritten = await installer.install({ sourcePath: second, id: 'writer', overwrite: true });
    expect(overwritten.backupPath).toEqual(expect.stringContaining('backups'));
    expect(existsSync(overwritten.backupPath ?? '')).toBe(true);
    expect(readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('second');
  });

  it('deletes a skill after backing it up', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-install-'));
    const source = createSourceSkill('writer', 'first');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    await installer.install({ sourcePath: source, id: 'writer' });
    const deleted = await installer.delete('writer');

    expect(deleted.backupPath).toEqual(expect.stringContaining('backups'));
    expect(existsSync(deleted.backupPath ?? '')).toBe(true);
    expect(existsSync(join(codexHome, 'skills', 'writer'))).toBe(false);
  });
});

function createSourceSkill(id: string, marker: string): string {
  const source = join(tempDir, id);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), [
    '---',
    `name: ${id}`,
    `description: "${marker}"`,
    '---',
    '',
    marker
  ].join('\n'));
  return source;
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-skills-installer.test.ts
```

Expected: 失败，因为 installer 不存在。

- [ ] **Step 3: 实现 installer**

创建 `apps/daemon/src/codex/skills/installer.ts`：

```ts
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { skillsPathForCodexHome } from './scanner.js';
import { assertNoSymlinks, assertValidSkillId, deriveSkillId, parseSkillMarkdown } from './validator.js';

export type SkillInstaller = {
  install(input: { sourcePath: string; id?: string; overwrite?: boolean }): Promise<{ id: string; backupPath: string | null }>;
  delete(id: string): Promise<{ id: string; backupPath: string | null }>;
};

const locks = new Map<string, Promise<void>>();
let fileCounter = 0;

export function createSkillInstaller(input: { codexHome: string }): SkillInstaller {
  return {
    install(request) {
      return withSkillsLock(input.codexHome, () => installSkill(input.codexHome, request));
    },
    delete(id) {
      return withSkillsLock(input.codexHome, () => deleteSkill(input.codexHome, id));
    }
  };
}

async function withSkillsLock<T>(codexHome: string, operation: () => T | Promise<T>): Promise<T> {
  const previous = locks.get(codexHome) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });
  const chained = previous.then(() => current, () => current);
  locks.set(codexHome, chained);

  try {
    await previous.catch(() => undefined);
    return await operation();
  } finally {
    release();
    if (locks.get(codexHome) === chained) locks.delete(codexHome);
  }
}

function installSkill(
  codexHome: string,
  request: { sourcePath: string; id?: string; overwrite?: boolean }
): { id: string; backupPath: string | null } {
  if (!existsSync(request.sourcePath)) {
    throw new Error(`CODEX_SKILL_INVALID: sourcePath does not exist: ${request.sourcePath}`);
  }
  const sourcePath = realpathSync(request.sourcePath);
  if (!statSync(sourcePath).isDirectory()) {
    throw new Error(`CODEX_SKILL_INVALID: sourcePath must be a directory: ${request.sourcePath}`);
  }
  assertNoSymlinks(sourcePath);

  const skillFile = join(sourcePath, 'SKILL.md');
  if (!existsSync(skillFile)) throw new Error(`CODEX_SKILL_INVALID: SKILL.md is required: ${skillFile}`);
  const parsed = parseSkillMarkdown(readFileSync(skillFile, 'utf8'));
  if (!parsed.ok) throw new Error(`CODEX_SKILL_INVALID: ${parsed.diagnostics.join('; ')}`);

  const id = deriveSkillId({ requestedId: request.id, sourcePath });
  const skillsPath = skillsPathForCodexHome(codexHome);
  const targetPath = ensurePathInside(skillsPath, id);
  const tempPath = ensurePathInside(skillsPath, `.tmp-install-${id}-${process.pid}-${Date.now()}-${nextFileCounter()}`);
  let backupPath: string | null = null;

  mkdirSync(skillsPath, { recursive: true });
  try {
    if (existsSync(targetPath) && request.overwrite !== true) {
      throw new Error(`CODEX_SKILL_EXISTS: ${id}`);
    }

    cpSync(sourcePath, tempPath, { recursive: true, force: false, errorOnExist: true });
    assertNoSymlinks(tempPath);
    const tempSkill = join(tempPath, 'SKILL.md');
    const tempParsed = parseSkillMarkdown(readFileSync(tempSkill, 'utf8'));
    if (!tempParsed.ok) throw new Error(`CODEX_SKILL_INVALID: ${tempParsed.diagnostics.join('; ')}`);

    if (existsSync(targetPath)) {
      backupPath = backupSkill(codexHome, id, targetPath);
      rmSync(targetPath, { recursive: true, force: true });
    }

    renameSync(tempPath, targetPath);
    return { id, backupPath };
  } catch (error) {
    rmSync(tempPath, { recursive: true, force: true });
    throw error;
  }
}

function deleteSkill(codexHome: string, id: string): { id: string; backupPath: string | null } {
  assertValidSkillId(id);
  const skillsPath = skillsPathForCodexHome(codexHome);
  const targetPath = ensurePathInside(skillsPath, id);
  if (!existsSync(targetPath)) throw new Error(`CODEX_SKILL_NOT_FOUND: ${id}`);

  const backupPath = backupSkill(codexHome, id, targetPath);
  rmSync(targetPath, { recursive: true, force: true });
  return { id, backupPath };
}

function backupSkill(codexHome: string, id: string, targetPath: string): string {
  const backupRoot = join(codexHome, 'backups', 'skills');
  mkdirSync(backupRoot, { recursive: true });
  const backupPath = join(
    backupRoot,
    `${id}.${new Date().toISOString().replace(/[:.]/g, '-')}.${nextFileCounter()}.bak`
  );
  cpSync(targetPath, backupPath, { recursive: true, force: false, errorOnExist: true });
  return backupPath;
}

function ensurePathInside(parent: string, childName: string): string {
  const target = resolve(parent, childName);
  const normalizedParent = resolve(parent);
  if (target !== normalizedParent && target.startsWith(`${normalizedParent}/`)) return target;
  throw new Error(`CODEX_SKILL_INVALID: target path escapes skills directory: ${childName}`);
}

function nextFileCounter(): number {
  fileCounter = (fileCounter + 1) % Number.MAX_SAFE_INTEGER;
  return fileCounter;
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-skills-installer.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/codex/skills/installer.ts apps/daemon/test/unit/codex-skills-installer.test.ts
git commit -m "feat: install and delete codex skills"
```

---

### Task 6: Skills manager 和 API routes

**Files:**
- Create: `apps/daemon/src/codex/skills/manager.ts`
- Create: `apps/daemon/src/api/routes.skills.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/src/codex/capabilities.ts`
- Modify: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 写 failing API 集成测试**

在 `apps/daemon/test/integration/api.test.ts` 增加测试：

```ts
  it('lists, installs, overwrites, deletes, and logs codex skills', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const source = join(tempDir, 'source-skill');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), [
      '---',
      'name: writer',
      'description: "first"',
      '---',
      ''
    ].join('\n'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const empty = await authGet('/codex/skills');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      skillsPath: join(codexHome, 'skills'),
      skillsWritable: true,
      requiresWriteConfirmation: false,
      skills: []
    });

    const installed = await authPost('/codex/skills/install', {
      sourcePath: source,
      id: 'writer'
    });
    expect(installed.statusCode).toBe(201);
    expect(installed.json().skill).toMatchObject({
      id: 'writer',
      name: 'writer',
      description: 'first',
      status: 'valid'
    });

    const duplicate = await authPost('/codex/skills/install', {
      sourcePath: source,
      id: 'writer'
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CODEX_SKILL_EXISTS');

    writeFileSync(join(source, 'SKILL.md'), [
      '---',
      'name: writer',
      'description: "second"',
      '---',
      ''
    ].join('\n'));
    const overwritten = await authPost('/codex/skills/install', {
      sourcePath: source,
      id: 'writer',
      overwrite: true
    });
    expect(overwritten.statusCode).toBe(201);
    expect(overwritten.json().operation.operation).toBe('overwrite');
    expect(overwritten.json().operation.backupPath).toEqual(expect.stringContaining('backups'));

    const listed = await authGet('/codex/skills');
    expect(listed.json().skills).toEqual([
      expect.objectContaining({ id: 'writer', description: 'second', status: 'valid' })
    ]);

    const deleted = await authDelete('/codex/skills/writer');
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ deleted: true });
    expect(deleted.json().backupPath).toEqual(expect.stringContaining('backups'));

    const operations = await authGet('/codex/skills/operations');
    expect(operations.statusCode).toBe(200);
    expect(operations.json().operations.map((operation: { operation: string }) => operation.operation)).toEqual([
      'delete',
      'overwrite',
      'install'
    ]);
  });
```

再增加全局确认测试：

```ts
  it('requires explicit confirmation for global codex skill writes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const source = join(tempDir, 'source-skill');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), '---\nname: writer\ndescription: writer\n---\n');
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const install = await authPost('/codex/skills/install', {
      sourcePath: source,
      id: 'writer'
    });

    expect(install.statusCode).toBe(409);
    expect(install.json().error.code).toBe('CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
```

Expected: 失败，因为 routes 和 manager 不存在。

- [ ] **Step 3: 实现 manager**

创建 `apps/daemon/src/codex/skills/manager.ts`：

```ts
import type Database from 'better-sqlite3';
import { basename, join } from 'node:path';
import type { ResolvedCodexHome } from '../home.js';
import { createSkillInstaller } from './installer.js';
import { createSkillOperationRepository } from './operations.js';
import { scanCodexSkills, skillsPathForCodexHome } from './scanner.js';
import type {
  CodexSkillOperationResponse,
  CodexSkillResponse,
  InstallSkillInput,
  SkillScanResult
} from './types.js';

export type SkillManager = {
  listSkills(): SkillScanResult;
  getSkill(id: string): CodexSkillResponse | undefined;
  installSkill(input: InstallSkillInput): Promise<{ skill: CodexSkillResponse; operation: CodexSkillOperationResponse }>;
  deleteSkill(id: string, confirmed: boolean): Promise<{ deleted: true; backupPath: string | null; operation: CodexSkillOperationResponse }>;
  listOperations(limit?: number): CodexSkillOperationResponse[];
};

export function createSkillManager(input: {
  codexHome: ResolvedCodexHome;
  db: Database.Database;
}): SkillManager {
  const installer = createSkillInstaller({ codexHome: input.codexHome.path });
  const operations = createSkillOperationRepository(input.db);

  return {
    listSkills() {
      return scanCodexSkills({ codexHome: input.codexHome });
    },
    getSkill(id) {
      return scanCodexSkills({ codexHome: input.codexHome }).skills.find(skill => skill.id === id);
    },
    async installSkill(request) {
      requireWriteConfirmation(input.codexHome, request.confirmWriteToCodexHome === true);
      const skillId = request.id ?? basename(request.sourcePath);
      const requestedOperationType = request.overwrite === true ? 'overwrite' : 'install';
      try {
        const installed = await installer.install(request);
        const skill = scanCodexSkills({ codexHome: input.codexHome }).skills.find(candidate => candidate.id === installed.id);
        if (skill === undefined) throw new Error(`CODEX_SKILL_NOT_FOUND: ${installed.id}`);
        const operationType = installed.backupPath === null ? 'install' : 'overwrite';
        const operation = operations.insertOperation({
          operation: operationType,
          skillId: installed.id,
          codexHome: input.codexHome.path,
          skillsPath: skillsPathForCodexHome(input.codexHome.path),
          sourcePath: request.sourcePath,
          targetPath: skill.skillPath,
          backupPath: installed.backupPath,
          status: 'succeeded'
        });
        return { skill, operation };
      } catch (error) {
        operations.insertOperation({
          operation: requestedOperationType,
          skillId,
          codexHome: input.codexHome.path,
          skillsPath: skillsPathForCodexHome(input.codexHome.path),
          sourcePath: request.sourcePath,
          targetPath: join(skillsPathForCodexHome(input.codexHome.path), skillId),
          status: 'failed',
          errorCode: getCodexErrorCode(error) ?? 'CODEX_SKILL_WRITE_FAILED',
          errorMessage: getErrorMessage(error)
        });
        throw error;
      }
    },
    async deleteSkill(id, confirmed) {
      requireWriteConfirmation(input.codexHome, confirmed);
      try {
        const deleted = await installer.delete(id);
        const operation = operations.insertOperation({
          operation: 'delete',
          skillId: id,
          codexHome: input.codexHome.path,
          skillsPath: skillsPathForCodexHome(input.codexHome.path),
          targetPath: join(skillsPathForCodexHome(input.codexHome.path), id),
          backupPath: deleted.backupPath,
          status: 'succeeded'
        });
        return { deleted: true, backupPath: deleted.backupPath, operation };
      } catch (error) {
        operations.insertOperation({
          operation: 'delete',
          skillId: id,
          codexHome: input.codexHome.path,
          skillsPath: skillsPathForCodexHome(input.codexHome.path),
          targetPath: join(skillsPathForCodexHome(input.codexHome.path), id),
          status: 'failed',
          errorCode: getCodexErrorCode(error) ?? 'CODEX_SKILL_WRITE_FAILED',
          errorMessage: getErrorMessage(error)
        });
        throw error;
      }
    },
    listOperations(limit) {
      return operations.listOperations(limit);
    }
  };
}

function requireWriteConfirmation(codexHome: ResolvedCodexHome, confirmed: boolean): void {
  if (codexHome.mode === 'global' && !confirmed) {
    throw new Error('CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED: global CODEX_HOME skills write requires confirmation');
  }
}

function getCodexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.split(':', 1)[0];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: 实现 routes**

创建 `apps/daemon/src/api/routes.skills.ts`：

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SkillManager } from '../codex/skills/manager.js';
import { isValidSkillId } from '../codex/skills/validator.js';
import { apiError } from './errors.js';

export async function registerSkillRoutes(
  server: FastifyInstance,
  input: { skillManager: SkillManager }
): Promise<void> {
  server.get('/codex/skills', async () => input.skillManager.listSkills());

  server.get<{ Querystring: { limit?: string } }>('/codex/skills/operations', async (request) => {
    return { operations: input.skillManager.listOperations(parseLimit(request.query.limit)) };
  });

  server.get<{ Params: { id: string } }>('/codex/skills/:id', async (request, reply) => {
    if (!isValidSkillId(request.params.id)) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'id must be a valid skill id'));
    }
    const skill = input.skillManager.getSkill(request.params.id);
    if (skill === undefined) {
      return reply.code(404).send(apiError('CODEX_SKILL_NOT_FOUND', 'Skill not found'));
    }
    return { skill };
  });

  server.post<{ Body: unknown }>('/codex/skills/install', async (request, reply) => {
    const body = parseInstallRequest(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

    try {
      const result = await input.skillManager.installSkill(body.value);
      return reply.code(201).send(result);
    } catch (error) {
      return sendSkillWriteError(error, reply);
    }
  });

  server.delete<{ Params: { id: string }; Querystring: { confirmWriteToCodexHome?: string } }>(
    '/codex/skills/:id',
    async (request, reply) => {
      if (!isValidSkillId(request.params.id)) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'id must be a valid skill id'));
      }

      try {
        return await input.skillManager.deleteSkill(
          request.params.id,
          request.query.confirmWriteToCodexHome === 'true'
        );
      } catch (error) {
        return sendSkillWriteError(error, reply);
      }
    }
  );
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseInstallRequest(body: unknown): ParseResult<{
  sourcePath: string;
  id?: string;
  overwrite?: boolean;
  confirmWriteToCodexHome?: true;
}> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (typeof body.sourcePath !== 'string' || body.sourcePath.trim().length === 0) {
    return { ok: false, message: 'sourcePath must be a non-empty string' };
  }
  if (body.id !== undefined && (typeof body.id !== 'string' || !isValidSkillId(body.id))) {
    return { ok: false, message: 'id must be a valid skill id' };
  }
  if (body.overwrite !== undefined && typeof body.overwrite !== 'boolean') {
    return { ok: false, message: 'overwrite must be a boolean' };
  }
  if (body.confirmWriteToCodexHome !== undefined && body.confirmWriteToCodexHome !== true) {
    return { ok: false, message: 'confirmWriteToCodexHome must be true when provided' };
  }

  return {
    ok: true,
    value: {
      sourcePath: body.sourcePath,
      ...(body.id === undefined ? {} : { id: body.id }),
      ...(body.overwrite === undefined ? {} : { overwrite: body.overwrite }),
      ...(body.confirmWriteToCodexHome === true ? { confirmWriteToCodexHome: true } : {})
    }
  };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 200));
}

function sendSkillWriteError(error: unknown, reply: FastifyReply) {
  const code = getCodexErrorCode(error);
  if (code === 'CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED') {
    return reply.code(409).send(apiError(code, 'Global CODEX_HOME skills write requires confirmation'));
  }
  if (code === 'CODEX_SKILL_EXISTS') {
    return reply.code(409).send(apiError(code, 'Skill already exists'));
  }
  if (code === 'CODEX_SKILL_NOT_FOUND') {
    return reply.code(404).send(apiError(code, 'Skill not found'));
  }
  if (code === 'CODEX_SKILL_INVALID') {
    return reply.code(422).send(apiError(code, getErrorMessage(error, 'Skill is invalid')));
  }
  return reply.code(500).send(apiError('CODEX_SKILL_WRITE_FAILED', 'Failed to write Codex skill'));
}

function getCodexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.split(':', 1)[0];
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 5: 注册 routes**

在 `apps/daemon/src/api/server.ts` 增加 imports：

```ts
import { createSkillManager } from '../codex/skills/manager.js';
import { registerSkillRoutes } from './routes.skills.js';
```

在 `buildServer` 中创建：

```ts
  const skillManager = createSkillManager({ codexHome: resolvedCodexHome, db });
```

在 profile routes 之后注册：

```ts
  await registerSkillRoutes(server, { skillManager });
```

- [ ] **Step 6: 启用 Runtime skills 能力矩阵**

在 `apps/daemon/src/codex/capabilities.ts` 增加 helper：

```ts
export function withRuntimeSkillCapabilities(
  matrix: RuntimeCapabilityMatrix
): RuntimeCapabilityMatrix {
  return {
    ...matrix,
    skillsScan: true,
    skillsInstall: true,
    skillsDelete: true,
    skillsGlobalWrite: true
  };
}
```

在 `apps/daemon/src/api/server.ts` 把 capabilities import 从：

```ts
import {
  isResumeExecutionSupported,
  type RuntimeCapabilityMatrix
} from '../codex/capabilities.js';
```

改为：

```ts
import {
  isResumeExecutionSupported,
  withRuntimeSkillCapabilities,
  type RuntimeCapabilityMatrix
} from '../codex/capabilities.js';
```

在 `buildServer` 中、`resumeCapabilityVerified` 计算之后创建：

```ts
  const capabilities = withRuntimeSkillCapabilities(
    input.capabilities ?? createUnknownCapabilityMatrix()
  );
```

把 `registerCodexRoutes` 的 `capabilities` 入参从：

```ts
    capabilities: input.capabilities ?? createUnknownCapabilityMatrix()
```

改为：

```ts
    capabilities
```

在 `apps/daemon/test/integration/api.test.ts` 的 `returns codex status with auth` 断言里，把 skills capability 期望改成：

```ts
        skillsScan: true,
        skillsInstall: true,
        skillsDelete: true,
        skillsGlobalWrite: true,
        skillsRuntimeDiscoveryVerified: false,
        skillsRuntimeBehaviorVerified: false
```

- [ ] **Step 7: 运行测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 8: 提交**

```bash
git add apps/daemon/src/codex/skills/manager.ts apps/daemon/src/api/routes.skills.ts apps/daemon/src/api/server.ts apps/daemon/src/codex/capabilities.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: expose codex skills API"
```

---

### Task 7: Skills 全局只读扫描测试和 API 细节补齐

**Files:**
- Modify: `apps/daemon/test/integration/api.test.ts`
- Modify: `apps/daemon/src/api/routes.skills.ts`
- Modify: `apps/daemon/src/codex/skills/manager.ts`

- [ ] **Step 1: 写全局非破坏性扫描测试**

在 `apps/daemon/test/integration/api.test.ts` 增加：

```ts
  it('scans global codex skills without requiring write access', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const response = await authGet('/codex/skills');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      codexHomeMode: 'global',
      skillsWritable: true,
      requiresWriteConfirmation: true
    });
    expect(response.json().skillsPath).toEqual(expect.any(String));
    expect(Array.isArray(response.json().skills)).toBe(true);
  });
```

- [ ] **Step 2: 写 invalid skill API 测试**

在同一文件增加：

```ts
  it('returns invalid skill diagnostics instead of crashing', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const invalidDir = join(codexHome, 'skills', 'broken');
    mkdirSync(invalidDir, { recursive: true });
    writeFileSync(join(invalidDir, 'SKILL.md'), '# no frontmatter');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await authGet('/codex/skills');

    expect(response.statusCode).toBe(200);
    expect(response.json().skills).toEqual([
      expect.objectContaining({
        id: 'broken',
        status: 'invalid',
        diagnostics: [expect.stringContaining('frontmatter')]
      })
    ]);
  });
```

- [ ] **Step 3: 修正 routes 顺序风险**

确认 `GET /codex/skills/operations` 在 `GET /codex/skills/:id` 之前注册。最终 `routes.skills.ts` 顺序应是：

```ts
server.get('/codex/skills', async () => input.skillManager.listSkills());
server.get('/codex/skills/operations', async (request) => {
  return { operations: input.skillManager.listOperations(parseLimit(request.query.limit)) };
});
server.get('/codex/skills/:id', async (request, reply) => {
  if (!isValidSkillId(request.params.id)) {
    return reply.code(400).send(apiError('VALIDATION_FAILED', 'id must be a valid skill id'));
  }
  const skill = input.skillManager.getSkill(request.params.id);
  if (skill === undefined) {
    return reply.code(404).send(apiError('CODEX_SKILL_NOT_FOUND', 'Skill not found'));
  }
  return { skill };
});
server.post('/codex/skills/install', async (request, reply) => {
  const body = parseInstallRequest(request.body);
  if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
  try {
    const result = await input.skillManager.installSkill(body.value);
    return reply.code(201).send(result);
  } catch (error) {
    return sendSkillWriteError(error, reply);
  }
});
server.delete('/codex/skills/:id', async (request, reply) => {
  if (!isValidSkillId(request.params.id)) {
    return reply.code(400).send(apiError('VALIDATION_FAILED', 'id must be a valid skill id'));
  }
  try {
    return await input.skillManager.deleteSkill(
      request.params.id,
      request.query.confirmWriteToCodexHome === 'true'
    );
  } catch (error) {
    return sendSkillWriteError(error, reply);
  }
});
```

删除 `request.params.id === 'operations'` 的 fallback，因为明确路由顺序后不需要。

- [ ] **Step 4: 运行测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/api/routes.skills.ts apps/daemon/src/codex/skills/manager.ts apps/daemon/test/integration/api.test.ts
git commit -m "test: cover codex skills API edge cases"
```

---

### Task 8: 真实 Codex skills discovery smoke

**Files:**
- Modify: `apps/daemon/test/smoke/real-codex-smoke.test.ts`

- [ ] **Step 1: 写 gated smoke 测试**

在 `apps/daemon/test/smoke/real-codex-smoke.test.ts` 中把现有 `node:fs` import 从：

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
```

改为：

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
```

并增加 server import：

```ts
import { buildServer } from '../../src/api/server.js';
```

在 `apps/daemon/test/smoke/real-codex-smoke.test.ts` 的 `describe.runIf(runRealCodex)('real codex smoke', () => {` 代码块内增加：

```ts
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
```

说明：该测试先验证 Codex 接受 isolated `CODEX_HOME/skills` 文件布局并能完成 JSONL run。是否真实按 skill 行为输出 marker 受模型和 Codex 事件可观测性影响，不作为第一版硬断言。

- [ ] **Step 2: 运行 gated smoke**

Run:

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: skills discovery smoke 通过，并生成 `test/fixtures/real-codex/generated/skills-discovery-jsonl.json`。如果 Codex 因账号、网络、模型不可用失败，记录为 `BLOCKED_ENV`，不要把 R4 behavior smoke 标记为通过。

- [ ] **Step 3: 提交**

```bash
git add apps/daemon/test/smoke/real-codex-smoke.test.ts
git commit -m "test: add codex skills discovery smoke"
```

---

### Task 9: 全量验证和覆盖报告更新

**Files:**
- Modify: `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md` 或后续 coverage report 文件，如果当前仓库已存在 R4 覆盖报告。

- [ ] **Step 1: 运行 R4 相关测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-skills-validator.test.ts test/unit/codex-skills-scanner.test.ts test/unit/codex-skills-installer.test.ts test/unit/storage.test.ts test/integration/api.test.ts
```

Expected: 全部通过。

- [ ] **Step 2: 运行全量测试和类型检查**

Run:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Expected: 全部通过，`git diff --check` 无 whitespace error。

- [ ] **Step 3: 运行 gated real Codex smoke**

Run:

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: 当前机器具备 Codex auth/network 时通过。若失败原因是账号、网络、模型或 Codex 版本事件不可观测，记录为环境阻塞。

- [ ] **Step 4: 更新 R4 覆盖状态**

如果继续维护 `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md`，把 R4 状态从：

```text
MISSING_IMPL
```

更新为：

```text
PASS/PARTIAL
```

并明确区分：

```text
skills 文件管理、API、invalid 诊断、备份、操作日志：PASS
真实 Codex discovery smoke：PASS 或 BLOCKED_ENV
真实模型 behavior smoke：UNVERIFIED_BEHAVIOR 或 PASS
```

如果项目已有独立 coverage report 文件，则改该 report，不直接改旧计划。

- [ ] **Step 5: 最终提交**

```bash
git add docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md
git commit -m "docs: update R4 skills coverage status"
```

如果没有文档需要更新，跳过本提交，并在最终汇报中说明。

---

## Self-Review Checklist

- [ ] Spec 第 2 节目标均有任务覆盖：扫描、元数据、安装、删除、备份、invalid、写锁、操作日志、API、真实 Codex smoke。
- [ ] Spec 第 3 节非目标没有被实现计划突破：没有 UI、MCP、Scheduler、市场、远程下载、自研 runtime。
- [ ] Spec 第 4.2 节“全局 skills 可写但需确认”由 Task 6/7 覆盖。
- [ ] Spec 第 8 节 `CODEX_SKILL_*` 错误码由 Task 1/6 覆盖。
- [ ] Spec 第 10 节 symlink/path traversal 安全由 Task 2/5 覆盖。
- [ ] Spec 第 11 节能力矩阵由 Task 1 覆盖。
- [ ] Spec 第 12 节测试方案由 Task 2-9 覆盖。
