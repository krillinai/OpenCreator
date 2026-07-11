# Clawee Skills Hub 插件市场实施计划

> **面向执行 Agent：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans`，按任务逐项执行并使用复选框追踪。不得使用 Git worktree。

**目标：** 将 Skills Hub 的 55 条审核目录原生整合到 Clawee“插件”Tab，接入真实全局 Skill 安装、更新和新对话草稿插入能力。

**架构：** 新增 `@clawee/skill-market` 共享包作为 web 与 daemon 的单一审核目录；daemon 只接受市场条目 ID，下载固定 GitHub commit 后复用现有本地 Skill 安装器；web 负责市场浏览、状态合并和交互，并通过 App 创建新对话后向 Composer 写入 `$skill-id ` 草稿。

**技术栈：** TypeScript 5.7、React 18、Vite 6、Fastify 5、SQLite / better-sqlite3、Vitest、Testing Library、`yaml`、`tar`。

## 全局约束

- 所有开发必须在当前分支、当前工作区完成，不得创建或使用 Git worktree。
- 不得回退当前工作区已有的刷新恢复、文件预览和 `apps/web/vite.config.ts` 修改。
- `Skills-Hub/` 继续由 `.git/info/exclude` 排除，不得提交其目录或嵌套 Git 元数据。
- 市场目录使用 `Skills-Hub` commit `91302f79937b8f4e194e56554afdbb2ca939a1d5` 的 53 条正式数据和 2 条定制数据，共 55 条。
- 市场目录随 Clawee 发版更新；运行时不得远程更新目录。
- 首版只有以下 6 个条目允许从市场安装，`skillPath` 均为 `.`，`marketRevision` 均为 `1`：

| Skill ID | Repository | Commit |
|---|---|---|
| `frontend-slides` | `zarazhangrui/frontend-slides` | `9906a34d640d2111f724544cbc50f7f130569ae1` |
| `op7418-humanizer-zh` | `op7418/Humanizer-zh` | `91f3d394db8419c20d67ebe22a96cf8fee0a404b` |
| `follow-builders` | `zarazhangrui/follow-builders` | `aa6769f2a0be11fe663c4594a48d9679075f06c1` |
| `biliup` | `biliup/biliup` | `18c5bf086e943e07e9d88a905d2e5d407d6305bb` |
| `codebase-to-course` | `zarazhangrui/codebase-to-course` | `ff8837ecf8e9f6ce9874ffa42e42633394a52a00` |
| `guizang-social-card-skill` | `op7418/guizang-social-card-skill` | `cf4b810fac1c73fb65a2bb31d8c9278d82cbc4c5` |

- 其余目录条目未安装时显示“暂不可安装”；若全局目录已有同名有效 Skill，则真实安装状态优先，允许“使用”。
- `garrytan-gstack` 首版不允许市场安装，因为审核 commit 中包含符号链接；本机已有同名有效 Skill 时仍可使用。
- 安装目标固定为全局 Codex Skills 目录；用户点击“安装”即构成本次写入确认，不再显示二次弹窗。
- 后端只接受市场条目 ID，不接受前端传入 repository、commit、skillPath 或本地路径。
- 下载内容固定到目录中的 commit；不得执行仓库脚本或自动安装系统依赖。
- 点击“使用”每次都在当前项目创建新对话，输入框插入 `$skill-id `，聚焦但不自动发送。
- 首版不提供市场卸载入口。
- 所有新增文档和用户可见文本使用中文。

---

## 文件结构

### 新增共享目录包

- `packages/skill-market/package.json`：共享目录包配置。
- `packages/skill-market/tsconfig.json`：TypeScript 配置。
- `packages/skill-market/src/types.ts`：目录源数据和对外模型。
- `packages/skill-market/src/source-skills.json`：从 Skills Hub 复制的 53 条正式数据。
- `packages/skill-market/src/source-categories.json`：从 Skills Hub 复制的 10 个分类。
- `packages/skill-market/src/custom-skills.ts`：2 条北立定制数据。
- `packages/skill-market/src/install-sources.ts`：6 条可安装来源白名单。
- `packages/skill-market/src/catalog.ts`：生成 55 条运行时目录。
- `packages/skill-market/src/index.ts`：公共导出。
- `packages/skill-market/test/catalog.test.ts`：目录完整性和安装白名单测试。

### daemon

- `apps/daemon/src/codex/skills/market-records.ts`：市场安装记录仓库。
- `apps/daemon/src/codex/skills/market-downloader.ts`：固定 commit 下载、归档校验和安全解压。
- `apps/daemon/src/codex/skills/market-manager.ts`：安装、更新和补偿回滚用例。
- `apps/daemon/src/api/routes.skill-market.ts`：市场安装 API。
- `apps/daemon/test/unit/codex-skill-market-records.test.ts`：记录仓库测试。
- `apps/daemon/test/unit/codex-skill-market-downloader.test.ts`：下载与归档安全测试。
- `apps/daemon/test/unit/codex-skill-market-manager.test.ts`：市场用例测试。

### web

- `apps/web/src/services/skill-market-service.ts`：市场 API client。
- `apps/web/src/services/skill-market-service.test.ts`：API client 测试。
- `apps/web/src/features/plugins/skill-market-model.ts`：状态合并、筛选、场景和排序。
- `apps/web/src/features/plugins/skill-market-model.test.ts`：纯逻辑测试。
- `apps/web/src/features/plugins/skill-market-storage.ts`：收藏本地持久化。
- `apps/web/src/features/plugins/skill-market-storage.test.ts`：收藏持久化测试。
- `apps/web/src/features/plugins/SkillMarketView.tsx`：市场页面容器。
- `apps/web/src/features/plugins/SkillMarketView.test.tsx`：页面交互测试。
- `apps/web/src/features/plugins/SkillMarketCard.tsx`：Skill 卡片。
- `apps/web/src/features/plugins/SkillDetailModal.tsx`：悬浮详情弹窗。
- `apps/web/src/features/plugins/SkillMarketCover.tsx`：远程图片与生成封面降级。
- `apps/web/src/features/plugins/skill-market.css`：市场专用样式。
- `apps/web/public/skill-market/examples/*.png`：3 张本地回退封面。

### 修改现有文件

- `packages/protocol/src/api.ts`：市场安装记录和变更响应类型。
- `packages/protocol/src/errors.ts`：市场错误码。
- `apps/daemon/src/storage/migrations.ts`：安装记录表和索引。
- `apps/daemon/src/codex/skills/validator.ts`：改用标准 YAML 解析 frontmatter。
- `apps/daemon/src/codex/skills/installer.ts`：补偿回滚能力。
- `apps/daemon/src/codex/skills/manager.ts`：向市场管理器暴露回滚入口。
- `apps/daemon/src/api/server.ts`：创建并注册市场管理器。
- `apps/daemon/package.json`：添加目录包、`yaml` 和 `tar`。
- `apps/web/package.json`：添加目录包。
- `apps/web/src/features/runs/Composer.tsx`：接收一次性外部草稿。
- `apps/web/src/app/App.tsx`：插件页、市场状态、安装和新对话桥接。
- `apps/web/src/app/App.test.tsx`：插件市场集成测试。

---

### Task 1：建立共享市场目录包

**文件：**

- 创建：`packages/skill-market/package.json`
- 创建：`packages/skill-market/tsconfig.json`
- 创建：`packages/skill-market/src/types.ts`
- 创建：`packages/skill-market/src/source-skills.json`
- 创建：`packages/skill-market/src/source-categories.json`
- 创建：`packages/skill-market/src/custom-skills.ts`
- 创建：`packages/skill-market/src/install-sources.ts`
- 创建：`packages/skill-market/src/catalog.ts`
- 创建：`packages/skill-market/src/index.ts`
- 创建：`packages/skill-market/test/catalog.test.ts`

**接口：**

- 产出：`skillMarketCatalog: readonly SkillMarketEntry[]`
- 产出：`getSkillMarketEntry(id: string): SkillMarketEntry | undefined`
- 产出：`skillMarketCategories: readonly SkillMarketCategory[]`
- 产出：`SkillMarketEntry`、`SkillMarketInstallSource` 类型

- [ ] **Step 1：先写失败的目录完整性测试**

```ts
import { describe, expect, it } from 'vitest';
import { skillMarketCatalog } from '../src/index.js';

describe('skill market catalog', () => {
  it('contains the reviewed 55-entry snapshot with unique ids', () => {
    expect(skillMarketCatalog).toHaveLength(55);
    expect(new Set(skillMarketCatalog.map(entry => entry.id)).size).toBe(55);
  });

  it('only enables the six reviewed root skills', () => {
    expect(
      skillMarketCatalog
        .filter(entry => entry.install.available)
        .map(entry => entry.id)
        .sort()
    ).toEqual([
      'biliup',
      'codebase-to-course',
      'follow-builders',
      'frontend-slides',
      'guizang-social-card-skill',
      'op7418-humanizer-zh'
    ]);
  });

  it('pins every installable entry to a full commit and positive revision', () => {
    for (const entry of skillMarketCatalog) {
      if (!entry.install.available) continue;
      expect(entry.install.repository).toMatch(/^[^/]+\/[^/]+$/);
      expect(entry.install.skillPath).toBe('.');
      expect(entry.install.commit).toMatch(/^[a-f0-9]{40}$/);
      expect(entry.install.marketRevision).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2：运行测试并确认因包不存在而失败**

运行：

```bash
pnpm --filter @clawee/skill-market test
```

预期：失败，提示找不到 `@clawee/skill-market` 包或 `src/index.ts`。

- [ ] **Step 3：创建包配置并复制审核数据快照**

`packages/skill-market/package.json`：

```json
{
  "name": "@clawee/skill-market",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests"
  }
}
```

`packages/skill-market/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "src/**/*.json"]
}
```

复制数据：

```bash
cp Skills-Hub/02_projects/clawee-skills-hub/data/skills.json \
  packages/skill-market/src/source-skills.json
cp Skills-Hub/02_projects/clawee-skills-hub/data/categories.json \
  packages/skill-market/src/source-categories.json
cp Skills-Hub/02_projects/clawee-skills-hub/lib/custom-skills.ts \
  packages/skill-market/src/custom-skills.ts
```

把 `custom-skills.ts` 的类型导入改为：

```ts
import type { CreatorSkillSource } from './types.js';

export const customSkills: CreatorSkillSource[] = [
```

只修改文件开头的 import 和数组类型声明；后面的两条完整对象数据保持原样，文件末尾继续使用原有的：

```ts
];
```

- [ ] **Step 4：定义目录类型和固定安装来源**

`types.ts` 至少包含：

```ts
export type SkillMarketInstallSource =
  | { available: false; reason: 'missing_skill_manifest' | 'unsafe_archive' }
  | {
      available: true;
      repository: string;
      skillPath: string;
      commit: string;
      marketRevision: number;
    };

export type SkillMarketEntry = {
  id: string;
  name: string;
  title: string;
  tagline: string;
  summary: string;
  category: string;
  subcategory: string;
  platforms: string[];
  tasks: string[];
  creator: { name: string; avatarUrl: string };
  examples: Array<{
    type: 'image' | 'video';
    url: string;
    title: string;
    approved: boolean;
  }>;
  inputs: string[];
  outputs: string[];
  risks: {
    requiresLogin: boolean;
    requiresApiKey: boolean;
    externalWrite: boolean;
    readsLocalFiles: boolean;
    privateDataRisk: boolean;
    notes: string[];
  };
  listingStatus: 'featured' | 'verified' | 'curated-exception';
  install: SkillMarketInstallSource;
};
```

`install-sources.ts` 使用全局约束表中的 6 个固定 commit，并为 `garrytan-gstack` 返回：

```ts
{ available: false, reason: 'unsafe_archive' }
```

其他未列入白名单的条目返回：

```ts
{ available: false, reason: 'missing_skill_manifest' }
```

- [ ] **Step 5：生成对外目录**

`catalog.ts`：

```ts
import sourceSkills from './source-skills.json' with { type: 'json' };
import sourceCategories from './source-categories.json' with { type: 'json' };
import { customSkills } from './custom-skills.js';
import { installSourceForSkill } from './install-sources.js';
import type {
  CreatorSkillSource,
  SkillMarketCategory,
  SkillMarketEntry
} from './types.js';

const visibleStatuses = new Set(['featured', 'verified', 'curated-exception']);
const sourceCommit = '91302f79937b8f4e194e56554afdbb2ca939a1d5';

export const skillMarketCatalog = Object.freeze(
  [...customSkills, ...(sourceSkills as CreatorSkillSource[])]
    .filter(skill => visibleStatuses.has(skill.listingStatus))
    .map((skill): SkillMarketEntry => ({
      id: skill.id,
      name: skill.name,
      title: skill.titleZh,
      tagline: skill.tagline,
      summary: skill.summary,
      category: skill.category,
      subcategory: skill.subcategory,
      platforms: [...skill.platforms],
      tasks: [...skill.tasks],
      creator: { ...skill.creator },
      examples: skill.examples
        .filter(example => example.approved)
        .map(example => ({
          type: example.type,
          url: example.url,
          title: example.title,
          approved: true
        })),
      inputs: [...skill.inputs],
      outputs: [...skill.outputs],
      risks: {
        requiresLogin: skill.risks.requiresLogin,
        requiresApiKey: skill.risks.requiresApiKey,
        externalWrite: skill.risks.externalWrite,
        readsLocalFiles: skill.risks.readsLocalFiles,
        privateDataRisk: skill.risks.privateDataRisk,
        notes: [...skill.risks.notes]
      },
      listingStatus: skill.listingStatus,
      install: installSourceForSkill(skill.id)
    }))
);

export const skillMarketCategories =
  sourceCategories as readonly SkillMarketCategory[];

export const skillMarketSourceCommit = sourceCommit;

export function getSkillMarketEntry(id: string): SkillMarketEntry | undefined {
  return skillMarketCatalog.find(entry => entry.id === id);
}
```

- [ ] **Step 6：运行包测试和类型检查**

运行：

```bash
pnpm --filter @clawee/skill-market test
pnpm --filter @clawee/skill-market typecheck
```

预期：全部通过，目录数量为 55，可安装 ID 精确为 6 个。

- [ ] **Step 7：提交共享目录包**

```bash
git add packages/skill-market
git commit -m "feat: add reviewed skill market catalog"
```

---

### Task 2：增加协议类型和市场安装记录

**文件：**

- 修改：`packages/protocol/src/api.ts`
- 修改：`packages/protocol/src/errors.ts`
- 修改：`apps/daemon/src/storage/migrations.ts`
- 创建：`apps/daemon/src/codex/skills/market-records.ts`
- 创建：`apps/daemon/test/unit/codex-skill-market-records.test.ts`
- 修改：`apps/daemon/test/unit/storage.test.ts`
- 修改：`apps/daemon/test/unit/protocol-shape.test.ts`

**接口：**

- 产出：`CodexSkillMarketInstallRecordResponse`
- 产出：`CodexSkillMarketInstallRecordListResponse`
- 产出：`CodexSkillMarketMutationResponse`
- 产出：`SkillMarketRecordRepository`

- [ ] **Step 1：写协议和数据库失败测试**

协议测试应构造：

```ts
const record: CodexSkillMarketInstallRecordResponse = {
  skillId: 'frontend-slides',
  repository: 'zarazhangrui/frontend-slides',
  skillPath: '.',
  commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
  marketRevision: 1,
  installedAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z'
};
```

存储测试应断言存在：

```text
codex_skill_market_installs
idx_codex_skill_market_installs_updated_at
```

记录仓库测试应覆盖 `upsertRecord()`、`getRecord()`、`listRecords()`，并验证同一 `skillId` 更新后保留 `installedAt`、刷新 `updatedAt`。

- [ ] **Step 2：运行测试并确认失败**

```bash
pnpm --filter @clawee/daemon test -- codex-skill-market-records storage protocol-shape
```

预期：失败，提示协议类型、数据表和 repository 不存在。

- [ ] **Step 3：增加协议类型**

在 `packages/protocol/src/api.ts` 增加：

```ts
export type CodexSkillMarketInstallRecordResponse = {
  skillId: string;
  repository: string;
  skillPath: string;
  commit: string;
  marketRevision: number;
  installedAt: string;
  updatedAt: string;
};

export type CodexSkillMarketInstallRecordListResponse = {
  records: CodexSkillMarketInstallRecordResponse[];
};

export type CodexSkillMarketMutationResponse = {
  skill: CodexSkillResponse;
  operation: CodexSkillOperationResponse;
  record: CodexSkillMarketInstallRecordResponse;
};
```

在 `errors.ts` 增加：

```ts
| 'CODEX_SKILL_MARKET_ENTRY_NOT_FOUND'
| 'CODEX_SKILL_MARKET_NOT_INSTALLABLE'
| 'CODEX_SKILL_MARKET_DOWNLOAD_FAILED'
```

- [ ] **Step 4：增加 SQLite 表**

在 `migrations.ts` 增加：

```sql
CREATE TABLE IF NOT EXISTS codex_skill_market_installs (
  skill_id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  skill_path TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  market_revision INTEGER NOT NULL,
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_codex_skill_market_installs_updated_at
  ON codex_skill_market_installs(updated_at DESC, skill_id ASC);
```

- [ ] **Step 5：实现记录仓库**

`market-records.ts` 暴露：

```ts
export type SkillMarketRecordRepository = {
  upsertRecord(input: {
    skillId: string;
    repository: string;
    skillPath: string;
    commit: string;
    marketRevision: number;
  }): CodexSkillMarketInstallRecordResponse;
  getRecord(skillId: string): CodexSkillMarketInstallRecordResponse | undefined;
  listRecords(): CodexSkillMarketInstallRecordResponse[];
};
```

使用以下 upsert，更新时不得覆盖 `installed_at`：

```sql
INSERT INTO codex_skill_market_installs (
  skill_id, repository, skill_path, commit_sha, market_revision
) VALUES (
  @skillId, @repository, @skillPath, @commit, @marketRevision
)
ON CONFLICT(skill_id) DO UPDATE SET
  repository = excluded.repository,
  skill_path = excluded.skill_path,
  commit_sha = excluded.commit_sha,
  market_revision = excluded.market_revision,
  updated_at = CURRENT_TIMESTAMP
```

- [ ] **Step 6：运行协议、存储和 repository 测试**

```bash
pnpm --filter @clawee/protocol test
pnpm --filter @clawee/daemon test -- codex-skill-market-records storage protocol-shape
pnpm --filter @clawee/protocol typecheck
pnpm --filter @clawee/daemon typecheck
```

预期：全部通过。

- [ ] **Step 7：提交协议和记录层**

```bash
git add packages/protocol apps/daemon/src/storage/migrations.ts \
  apps/daemon/src/codex/skills/market-records.ts \
  apps/daemon/test/unit/codex-skill-market-records.test.ts \
  apps/daemon/test/unit/storage.test.ts \
  apps/daemon/test/unit/protocol-shape.test.ts
git commit -m "feat: persist skill market install records"
```

---

### Task 3：支持标准 YAML frontmatter 和安全归档下载

**文件：**

- 修改：`apps/daemon/package.json`
- 修改：`pnpm-lock.yaml`
- 修改：`apps/daemon/src/codex/skills/validator.ts`
- 修改：`apps/daemon/src/codex/skills/installer.ts`
- 修改：`apps/daemon/src/codex/skills/manager.ts`
- 创建：`apps/daemon/src/codex/skills/market-downloader.ts`
- 修改：`apps/daemon/test/unit/codex-skills-validator.test.ts`
- 修改：`apps/daemon/test/unit/codex-skills-installer.test.ts`
- 创建：`apps/daemon/test/unit/codex-skill-market-downloader.test.ts`

**接口：**

- 产出：`MarketArchiveDownloader.download(input): Promise<string>`
- 产出：`SkillManager.rollbackSkillInstall(id, backupPath): Promise<void>`
- 消费：`SkillMarketInstallSource`

- [ ] **Step 1：写失败测试**

为 validator 增加：

```ts
it('accepts multiline descriptions and additional YAML collections', () => {
  const parsed = parseSkillMarkdown([
    '---',
    'name: humanizer-zh',
    'description: |',
    '  第一行',
    '  第二行',
    'allowed-tools:',
    '  - Read',
    '  - Write',
    '---',
    ''
  ].join('\n'));

  expect(parsed).toMatchObject({
    ok: true,
    metadata: {
      name: 'humanizer-zh',
      description: '第一行\n第二行\n'
    }
  });
});
```

为 installer 增加：

```ts
it('rolls back a fresh install or restores an overwritten backup', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-rollback-'));
  const first = createSourceSkill('writer-first', 'first');
  const second = createSourceSkill('writer-second', 'second');
  const freshSource = createSourceSkill('fresh-source', 'fresh');
  const codexHome = join(tempDir, 'codex-home');
  const installer = createSkillInstaller({ codexHome });

  const fresh = await installer.install({ sourcePath: freshSource, id: 'fresh' });
  await installer.rollback({ id: 'fresh', backupPath: fresh.backupPath });
  expect(existsSync(join(codexHome, 'skills', 'fresh'))).toBe(false);

  await installer.install({ sourcePath: first, id: 'writer' });
  const overwritten = await installer.install({
    sourcePath: second,
    id: 'writer',
    overwrite: true
  });
  await installer.rollback({
    id: 'writer',
    backupPath: overwritten.backupPath
  });

  expect(
    readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')
  ).toContain('first');
});
```

为 downloader 增加以下场景：

1. 正常 tar.gz 解压到临时目录。
2. `content-length` 超过 `100 * 1024 * 1024` 时拒绝。
3. tar 包含绝对路径、`..`、hard link 或 symlink 时拒绝。
4. HTTP 非 2xx 时抛出 `CODEX_SKILL_MARKET_DOWNLOAD_FAILED`。
5. `skillPath` 逃逸解压目录时拒绝。

- [ ] **Step 2：运行测试并确认失败**

```bash
pnpm --filter @clawee/daemon test -- codex-skills-validator codex-skills-installer codex-skill-market-downloader
```

预期：validator 的块文本测试失败，rollback 和 downloader 尚不存在。

- [ ] **Step 3：安装显式依赖**

```bash
pnpm add --filter @clawee/daemon yaml@^2.8.1 tar@^7.4.3
pnpm add --filter @clawee/daemon @clawee/skill-market@workspace:*
```

- [ ] **Step 4：用 `yaml` 解析 frontmatter**

`parseSkillMarkdown()` 必须：

1. 规范化 CRLF。
2. 只解析首个 `---` frontmatter。
3. 使用 `parseDocument()`。
4. 将 YAML errors 转成 diagnostics。
5. 要求 `name` 和 `description` 都是非空字符串。
6. 忽略其他合法字段，不限制 `allowed-tools`、`metadata` 等扩展。

核心实现：

```ts
const document = parseDocument(frontmatter, { uniqueKeys: true });
if (document.errors.length > 0) {
  return {
    ok: false,
    diagnostics: document.errors.map(error => `SKILL.md frontmatter is invalid: ${error.message}`)
  };
}
const value = document.toJS();
```

- [ ] **Step 5：增加安装补偿回滚**

`SkillInstaller` 增加：

```ts
rollback(input: { id: string; backupPath: string | null }): Promise<void>;
```

规则：

1. 在同一 `withSkillsLock()` 中执行。
2. 删除当前目标。
3. `backupPath === null` 时结束，表示撤销首次安装。
4. 有 backup 时先复制到 `.tmp-rollback-*`，再 rename 到目标。
5. rollback 失败抛出 `CODEX_SKILL_WRITE_FAILED`。

`SkillManager` 暴露：

```ts
rollbackSkillInstall(id: string, backupPath: string | null): Promise<void>;
```

- [ ] **Step 6：实现安全下载器**

`market-downloader.ts`：

```ts
export const MAX_MARKET_ARCHIVE_BYTES = 100 * 1024 * 1024;

export type MarketArchiveDownloader = {
  download(input: {
    repository: string;
    commit: string;
    workDir: string;
  }): Promise<string>;
};
```

默认下载 URL：

```ts
`https://codeload.github.com/${repository}/tar.gz/${commit}`
```

实现要求：

1. 流式写入 `archive.tar.gz`，累计字节数并执行 100 MiB 上限。
2. 先用 `tar.t()` 扫描所有 entry。
3. entry path 不得是绝对路径，不得包含 `..`。
4. entry type 不得为 `SymbolicLink` 或 `Link`。
5. 再使用 `tar.x({ strip: 1, preservePaths: false })` 解压。
6. 返回解压根目录。
7. 所有网络、流和 tar 错误统一包装为 `CODEX_SKILL_MARKET_DOWNLOAD_FAILED`。

同时导出：

```ts
export function resolveMarketSkillSource(root: string, skillPath: string): string
```

该函数用 `resolve()` 和父路径前缀校验，确保结果位于解压根目录内且是目录。

- [ ] **Step 7：运行安全层测试**

```bash
pnpm --filter @clawee/daemon test -- codex-skills-validator codex-skills-installer codex-skill-market-downloader
pnpm --filter @clawee/daemon typecheck
```

预期：全部通过。

- [ ] **Step 8：提交安全下载层**

```bash
git add apps/daemon/package.json pnpm-lock.yaml \
  apps/daemon/src/codex/skills/validator.ts \
  apps/daemon/src/codex/skills/installer.ts \
  apps/daemon/src/codex/skills/manager.ts \
  apps/daemon/src/codex/skills/market-downloader.ts \
  apps/daemon/test/unit/codex-skills-validator.test.ts \
  apps/daemon/test/unit/codex-skills-installer.test.ts \
  apps/daemon/test/unit/codex-skill-market-downloader.test.ts
git commit -m "feat: safely download reviewed market skills"
```

---

### Task 4：实现 daemon 市场安装、更新和 API

**文件：**

- 创建：`apps/daemon/src/codex/skills/market-manager.ts`
- 创建：`apps/daemon/src/api/routes.skill-market.ts`
- 修改：`apps/daemon/src/api/server.ts`
- 创建：`apps/daemon/test/unit/codex-skill-market-manager.test.ts`
- 修改：`apps/daemon/test/integration/api.test.ts`

**接口：**

- 产出：`SkillMarketManager.installSkill(id)`
- 产出：`SkillMarketManager.updateSkill(id)`
- 产出：`SkillMarketManager.listInstallRecords()`
- 消费：`SkillManager`、`MarketArchiveDownloader`、`SkillMarketRecordRepository`

- [ ] **Step 1：写 manager 失败测试**

使用 fake downloader 将测试 Skill 写到临时目录，覆盖：

1. 未知 ID 返回 `CODEX_SKILL_MARKET_ENTRY_NOT_FOUND`。
2. 不可安装 ID 返回 `CODEX_SKILL_MARKET_NOT_INSTALLABLE`。
3. 安装调用 `installSkill({ id, sourcePath, confirmWriteToCodexHome: true })`。
4. 更新调用 `overwrite: true`。
5. 安装后写入固定 repository、commit 和 marketRevision。
6. 更新目标不存在时返回 `CODEX_SKILL_NOT_FOUND`。
7. 记录写入失败时调用 rollback，首次安装目标被删除，更新时旧版本恢复。
8. 不论成功失败都清理临时下载目录。

- [ ] **Step 2：写 API 失败测试**

在 `api.test.ts` 增加：

```text
GET  /codex/skill-market/install-records
POST /codex/skill-market/frontend-slides/install
POST /codex/skill-market/frontend-slides/update
```

使用 `BuildServerInput.marketArchiveDownloader` 注入 fake downloader，避免测试访问网络。

断言：

1. install 返回 201。
2. update 返回 200。
3. 未知 ID 返回 404。
4. 不可安装条目返回 422。
5. 下载失败返回 502。
6. 全局 CODEX_HOME 的市场安装不要求第二次请求确认。

- [ ] **Step 3：运行测试并确认失败**

```bash
pnpm --filter @clawee/daemon test -- codex-skill-market-manager api
```

预期：失败，提示 manager、路由和 server 注入项不存在。

- [ ] **Step 4：实现市场 manager**

公开类型：

```ts
export type SkillMarketManager = {
  listInstallRecords(): CodexSkillMarketInstallRecordResponse[];
  installSkill(id: string): Promise<CodexSkillMarketMutationResponse>;
  updateSkill(id: string): Promise<CodexSkillMarketMutationResponse>;
};
```

安装和更新共用私有 `mutateSkill(id, overwrite)`：

1. 从 `getSkillMarketEntry(id)` 获取目录。
2. 检查 `entry.install.available`。
3. 更新前检查 `skillManager.getSkill(id)` 存在。
4. 在 `dataDir/skill-market-downloads/` 下创建临时目录。
5. 下载固定 commit。
6. 解析安全 `skillPath`。
7. 调用现有 `skillManager.installSkill()`。
8. 写入市场安装记录。
9. 若记录写入失败，调用 `rollbackSkillInstall()`。
10. `finally` 删除临时目录。

- [ ] **Step 5：实现路由和错误映射**

`routes.skill-market.ts` 注册：

```ts
GET /codex/skill-market/install-records
POST /codex/skill-market/:id/install
POST /codex/skill-market/:id/update
```

状态映射：

| 错误码 | HTTP |
|---|---|
| `CODEX_SKILL_MARKET_ENTRY_NOT_FOUND` | 404 |
| `CODEX_SKILL_MARKET_NOT_INSTALLABLE` | 422 |
| `CODEX_SKILL_NOT_FOUND` | 404 |
| `CODEX_SKILL_EXISTS` | 409 |
| `CODEX_SKILL_INVALID` | 422 |
| `CODEX_SKILL_MARKET_DOWNLOAD_FAILED` | 502 |
| 其他写入失败 | 500 |

- [ ] **Step 6：在 server 中注入并注册**

`BuildServerInput` 增加：

```ts
marketArchiveDownloader?: MarketArchiveDownloader;
```

默认使用 `createMarketArchiveDownloader()`；测试可注入 fake。创建 `SkillMarketRecordRepository` 和 `SkillMarketManager` 后注册新路由。

- [ ] **Step 7：运行 daemon 全部测试和类型检查**

```bash
pnpm --filter @clawee/daemon test
pnpm --filter @clawee/daemon typecheck
```

预期：全部通过，现有本地 Skill API 不回归。

- [ ] **Step 8：提交 daemon 市场能力**

```bash
git add apps/daemon/src/codex/skills/market-manager.ts \
  apps/daemon/src/api/routes.skill-market.ts \
  apps/daemon/src/api/server.ts \
  apps/daemon/test/unit/codex-skill-market-manager.test.ts \
  apps/daemon/test/integration/api.test.ts
git commit -m "feat: add skill market install API"
```

---

### Task 5：实现 web 市场 service、状态模型和收藏

**文件：**

- 修改：`apps/web/package.json`
- 修改：`pnpm-lock.yaml`
- 创建：`apps/web/src/services/skill-market-service.ts`
- 创建：`apps/web/src/services/skill-market-service.test.ts`
- 创建：`apps/web/src/features/plugins/skill-market-model.ts`
- 创建：`apps/web/src/features/plugins/skill-market-model.test.ts`
- 创建：`apps/web/src/features/plugins/skill-market-storage.ts`
- 创建：`apps/web/src/features/plugins/skill-market-storage.test.ts`

**接口：**

- 产出：`createSkillMarketService(client)`
- 产出：`resolveSkillMarketStatus(entry, skills, records)`
- 产出：`filterAndSortSkillMarketEntries(input)`
- 产出：`readSavedSkillIds()`、`writeSavedSkillIds(ids)`

- [ ] **Step 1：写 service 失败测试**

测试以下精确请求：

```ts
expect(client.get).toHaveBeenCalledWith('/codex/skill-market/install-records');
expect(client.post).toHaveBeenCalledWith(
  '/codex/skill-market/frontend-slides/install'
);
expect(client.post).toHaveBeenCalledWith(
  '/codex/skill-market/frontend-slides/update'
);
```

- [ ] **Step 2：写状态模型失败测试**

至少覆盖：

1. 未安装 + 不可安装来源 => `unavailable`。
2. 已安装有效 + 不可安装来源 + 无记录 => `installed_unknown_version`。
3. 已安装无效 => `invalid`。
4. 已安装 + revision 低 => `update_available`。
5. 已安装 + revision 相等 => `installed`。
6. 安装中和更新中覆盖静态状态。
7. 搜索同时匹配中文标题、英文名、任务和平台。
8. “已安装”筛选包含外部安装条目。
9. 推荐、使用人数、已安装和收藏排序稳定。

- [ ] **Step 3：写收藏失败测试**

使用 key：

```text
clawee.skill-market.saved.v1
```

损坏 JSON 返回空集合并移除损坏值；写入时去重并保持稳定顺序。

- [ ] **Step 4：运行测试并确认失败**

```bash
pnpm --filter @clawee/web test -- skill-market-service skill-market-model skill-market-storage
```

预期：失败，相关模块不存在。

- [ ] **Step 5：添加共享包依赖并实现 service**

```bash
pnpm add --filter @clawee/web @clawee/skill-market@workspace:*
```

`createSkillMarketService(client)`：

```ts
return {
  listInstallRecords() {
    return client.get<CodexSkillMarketInstallRecordListResponse>(
      '/codex/skill-market/install-records'
    );
  },
  installSkill(id: string) {
    return client.post<CodexSkillMarketMutationResponse>(
      `/codex/skill-market/${encodeURIComponent(id)}/install`
    );
  },
  updateSkill(id: string) {
    return client.post<CodexSkillMarketMutationResponse>(
      `/codex/skill-market/${encodeURIComponent(id)}/update`
    );
  }
};
```

- [ ] **Step 6：实现状态、筛选和排序**

状态联合：

```ts
export type SkillMarketStatus =
  | 'unavailable'
  | 'not_installed'
  | 'invalid'
  | 'installed_unknown_version'
  | 'installed'
  | 'update_available'
  | 'installing'
  | 'updating';
```

状态优先级必须与设计文档一致：本机真实 Skill 状态先于目录可安装性。

把 Skills Hub 中的主分类映射、细场景推导、标题覆盖和稳定使用人数算法移入该纯逻辑文件，不在 React 组件中重复。

- [ ] **Step 7：实现收藏持久化**

`skill-market-storage.ts` 使用现有 `readJsonFromStorage()` 和 `writeJsonToStorage()`；只接受字符串数组，过滤空值并去重。

- [ ] **Step 8：运行 web 纯逻辑测试和类型检查**

```bash
pnpm --filter @clawee/web test -- skill-market-service skill-market-model skill-market-storage
pnpm --filter @clawee/web typecheck
```

预期：全部通过。

- [ ] **Step 9：提交 web 数据层**

```bash
git add apps/web/package.json pnpm-lock.yaml \
  apps/web/src/services/skill-market-service.ts \
  apps/web/src/services/skill-market-service.test.ts \
  apps/web/src/features/plugins/skill-market-model.ts \
  apps/web/src/features/plugins/skill-market-model.test.ts \
  apps/web/src/features/plugins/skill-market-storage.ts \
  apps/web/src/features/plugins/skill-market-storage.test.ts
git commit -m "feat: add skill market web model"
```

---

### Task 6：移植 Skills Hub 市场页面

**文件：**

- 创建：`apps/web/src/features/plugins/SkillMarketView.tsx`
- 创建：`apps/web/src/features/plugins/SkillMarketView.test.tsx`
- 创建：`apps/web/src/features/plugins/SkillMarketCard.tsx`
- 创建：`apps/web/src/features/plugins/SkillDetailModal.tsx`
- 创建：`apps/web/src/features/plugins/SkillMarketCover.tsx`
- 创建：`apps/web/src/features/plugins/skill-market.css`
- 创建：`apps/web/public/skill-market/examples/gpt-image-2-info-poster.png`
- 创建：`apps/web/public/skill-market/examples/nano-banana-pro-product-visual.png`
- 创建：`apps/web/public/skill-market/examples/seedance-2-video-ad.png`

**接口：**

- 产出：`SkillMarketViewProps`
- 消费：`skillMarketCatalog`、状态模型、收藏 storage

- [ ] **Step 1：写页面失败测试**

`SkillMarketView.test.tsx` 至少覆盖：

1. 渲染 55 条目录和分类计数。
2. 搜索“字幕”后只显示匹配卡片。
3. 点击卡片打开 `role="dialog"` 的详情弹窗。
4. Escape 和关闭按钮关闭弹窗。
5. 收藏后“我的收藏”计数更新并持久化。
6. 未安装不可安装条目显示禁用的“暂不可安装”。
7. 外部安装同名有效 Skill 显示“使用”和“版本未知”。
8. 可安装未安装条目点击“安装”调用 `onInstall(id)`。
9. 低修订号条目点击“更新”调用 `onUpdate(id)`。
10. 已安装条目点击“使用”调用 `onUse(id)`。
11. Runtime 未连接时仍展示目录，但所有变更按钮禁用并显示连接提示。

- [ ] **Step 2：运行测试并确认失败**

```bash
pnpm --filter @clawee/web test -- SkillMarketView
```

预期：失败，页面组件不存在。

- [ ] **Step 3：复制 3 张本地回退封面**

```bash
mkdir -p apps/web/public/skill-market/examples
cp Skills-Hub/02_projects/clawee-skills-hub/public/examples/gpt-image-2-info-poster.png \
  apps/web/public/skill-market/examples/
cp Skills-Hub/02_projects/clawee-skills-hub/public/examples/nano-banana-pro-product-visual.png \
  apps/web/public/skill-market/examples/
cp Skills-Hub/02_projects/clawee-skills-hub/public/examples/seedance-2-video-ad.png \
  apps/web/public/skill-market/examples/
```

- [ ] **Step 4：实现页面容器和组件边界**

`SkillMarketViewProps`：

```ts
export type SkillMarketOperation =
  | { skillId: string; kind: 'install' | 'update'; error?: string }
  | undefined;

export type SkillMarketViewProps = {
  connected: boolean;
  skills?: CodexSkillListResponse;
  installRecords: CodexSkillMarketInstallRecordResponse[];
  loading: boolean;
  loadError?: string;
  operation?: SkillMarketOperation;
  useError?: string;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(skillId: string): void;
};
```

职责：

1. `SkillMarketView` 管搜索、状态筛选、主分类、细场景、排序、收藏和当前详情。
2. `SkillMarketCard` 只负责一张卡片和按钮事件。
3. `SkillDetailModal` 只负责详情、焦点和关闭。
4. `SkillMarketCover` 先加载 approved example，失败后使用本地回退图，再失败时生成 CSS 封面。

- [ ] **Step 5：移植现有信息架构**

必须保留：

1. 顶部搜索。
2. “我的收藏”“已安装”。
3. 主分类和细场景。
4. 推荐、使用人数、已安装、收藏排序。
5. 三列视觉卡片。
6. 悬浮详情弹窗中的“适合做什么、需要输入、会产出、精选案例、使用前注意”。
7. 卡片与详情底部统一状态按钮。

独立站点的 `Clawee Skills Hub` Header 不移入应用。

- [ ] **Step 6：实现市场专用 CSS**

要求：

1. 使用 Clawee 的 `--bg`、`--surface`、`--surface-2`、`--text`、`--muted`、`--accent` token。
2. 保留 Skills Hub 的视觉卡片密度和彩色封面，不把插件页做成营销 Hero。
3. 卡片桌面三列，中等窗口两列，窄窗口一列。
4. 卡片和弹窗圆角不超过现有 `var(--radius)`。
5. modal 不与侧栏、卡片按钮或底部操作重叠。
6. 所有图标使用 `lucide-react`。
7. 图片加载失败时不得显示破损图标；作者头像降级为姓名首字母。
8. 所有按钮文本在 320px 宽度下不溢出。

- [ ] **Step 7：运行组件测试和 web 构建**

```bash
pnpm --filter @clawee/web test -- SkillMarketView
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

预期：全部通过。

- [ ] **Step 8：提交市场页面**

```bash
git add apps/web/src/features/plugins \
  apps/web/public/skill-market
git commit -m "feat: add native skill market view"
```

---

### Task 7：接入 App、真实安装状态和新对话草稿

**文件：**

- 修改：`apps/web/src/features/runs/Composer.tsx`
- 修改：`apps/web/src/features/runs/Composer.test.tsx`
- 修改：`apps/web/src/app/App.tsx`
- 修改：`apps/web/src/app/App.test.tsx`

**接口：**

- 产出：`ComposerDraftRequest`
- 消费：`createSkillMarketService()`、`SkillMarketView`
- 行为：每次“使用”创建新 thread，并插入一次性草稿

- [ ] **Step 1：写 Composer 外部草稿失败测试**

新增测试：

```ts
it('applies an external draft once and focuses the textarea', async () => {
  const onDraftApplied = vi.fn();
  const { rerender } = render(
    <Composer
      {...defaultProps}
      draftRequest={{ id: 1, text: '$frontend-slides ' }}
      onDraftApplied={onDraftApplied}
    />
  );

  const textbox = screen.getByRole('textbox', { name: '输入任务' });
  await waitFor(() => expect(textbox).toHaveValue('$frontend-slides '));
  expect(textbox).toHaveFocus();
  expect(onDraftApplied).toHaveBeenCalledWith(1);

  await userEvent.type(textbox, '生成季度汇报');
  rerender(<Composer {...defaultProps} onDraftApplied={onDraftApplied} />);
  expect(textbox).toHaveValue('$frontend-slides 生成季度汇报');
});
```

- [ ] **Step 2：写 App 插件市场失败测试**

增加集成场景：

1. 点击侧栏“插件”后显示市场，不再显示占位标题。
2. 初次加载调用 `/codex/skills` 和 `/codex/skill-market/install-records`。
3. 点击 `frontend-slides` 的“安装”调用市场 install API，随后重新请求 Skills 和 records。
4. 点击已安装条目的“使用”只调用一次 `/threads`，不调用 `/runs`。
5. 创建 thread 的 cwd、profile、sandbox 来自当前项目。
6. 创建成功后切回对话页，选中新 thread，Composer 值为 `$skill-id `。
7. 再次点击同一 Skill 的“使用”会创建另一个新 thread。
8. thread 创建失败时仍停留插件页并显示重试错误。

- [ ] **Step 3：运行测试并确认失败**

```bash
pnpm --filter @clawee/web test -- Composer App
```

预期：Composer 不接受 draft，插件页仍是 Placeholder。

- [ ] **Step 4：实现一次性 Composer 草稿接口**

导出：

```ts
export type ComposerDraftRequest = {
  id: number;
  text: string;
};
```

props 增加：

```ts
draftRequest?: ComposerDraftRequest;
onDraftApplied?(id: number): void;
```

effect 规则：

1. 仅在 `draftRequest.id` 变化时应用。
2. `setPrompt(draftRequest.text)`。
3. 关闭 Slash 和其他菜单。
4. `requestAnimationFrame()` 后聚焦 textarea，并将光标放到末尾。
5. 调用 `onDraftApplied(id)`，由 App 清除 pending draft。

- [ ] **Step 5：在 App 加载和刷新市场状态**

增加状态：

```ts
const [skillMarketInstallRecords, setSkillMarketInstallRecords] = useState<
  CodexSkillMarketInstallRecordResponse[]
>([]);
const [skillMarketLoading, setSkillMarketLoading] = useState(false);
const [skillMarketLoadError, setSkillMarketLoadError] = useState<string>();
const [skillMarketOperation, setSkillMarketOperation] =
  useState<SkillMarketOperation>();
const [skillMarketUseError, setSkillMarketUseError] = useState<string>();
const [pendingComposerDraft, setPendingComposerDraft] = useState<
  { threadId: string; request: ComposerDraftRequest } | undefined
>();
```

创建 `skillMarketService`，连接成功后并行加载：

```text
listSkills()
listMcp()
listInstallRecords()
```

安装或更新成功后必须再次调用 `listSkills()` 和 `listInstallRecords()`，不能只依靠 mutation 响应做乐观更新。

- [ ] **Step 6：实现安装和更新 handler**

```ts
async function installMarketSkill(skillId: string) {
  if (skillMarketService === null || skillMarketOperation !== undefined) return;
  setSkillMarketOperation({ skillId, kind: 'install' });
  try {
    await skillMarketService.installSkill(skillId);
    await refreshSkillMarketState();
    setSkillMarketOperation(undefined);
  } catch (error) {
    setSkillMarketOperation({
      skillId,
      kind: 'install',
      error: error instanceof Error ? error.message : '安装失败，请重试'
    });
  }
}

async function updateMarketSkill(skillId: string) {
  if (skillMarketService === null || skillMarketOperation !== undefined) return;
  setSkillMarketOperation({ skillId, kind: 'update' });
  try {
    await skillMarketService.updateSkill(skillId);
    await refreshSkillMarketState();
    setSkillMarketOperation(undefined);
  } catch (error) {
    setSkillMarketOperation({
      skillId,
      kind: 'update',
      error: error instanceof Error ? error.message : '更新失败，请重试'
    });
  }
}
```

操作中同一个 Skill 不得重复发送请求。

`refreshSkillMarketState()` 必须并行请求真实状态：

```ts
async function refreshSkillMarketState() {
  if (capabilityService === null || skillMarketService === null) return;
  const [skillsResponse, recordsResponse] = await Promise.all([
    capabilityService.listSkills(),
    skillMarketService.listInstallRecords()
  ]);
  if (!mountedRef.current) return;
  setCodexSkills(skillsResponse);
  setSkillMarketInstallRecords(recordsResponse.records);
}
```

- [ ] **Step 7：实现“使用”创建新对话**

`useMarketSkill(skillId)`：

1. 读取 `getSkillMarketEntry(skillId)`。
2. 捕获当前 `currentProject` 和 `effectiveComposerConfig`。
3. 调用 `threadService.createThread()`，title 使用目录中文标题。
4. request 使用当前项目的 `cwd`、`profile`、`workspaceMode: 'external'` 和 sandbox。
5. 将 thread upsert 到 `runtimeThreads`。
6. 清空 timeline、history loading、run busy 和线程错误。
7. 设置 `skipNextHistoryLoadForThreadRef`。
8. dispatch `select_thread`，自动切到 conversation。
9. 设置：

```ts
{
  threadId: created.thread.id,
  request: {
    id: nextDraftId,
    text: `$${skillId} `
  }
}
```

10. 不调用 `/runs`。
11. 创建失败时不 dispatch，不离开插件页，显示错误。

- [ ] **Step 8：替换插件占位页**

`main` 分支改为以下顺序：

```tsx
const main = props.capabilitiesView !== undefined ? (
  <CapabilitiesView {...props.capabilitiesView} />
) : state.activeView === 'settings' ? (
  <ClaweeSettingsView
    runtimeStatus={runtimeStatus}
    dynamicBackgroundEnabled={dynamicBackgroundEnabled}
    onDynamicBackgroundChange={handleDynamicBackgroundChange}
    onBack={() => dispatch({ type: 'back_to_app' })}
  />
) : state.activeView === 'plugins' ? (
  <SkillMarketView
    connected={connectionState.status === 'connected'}
    skills={codexSkills}
    installRecords={skillMarketInstallRecords}
    loading={skillMarketLoading}
    loadError={skillMarketLoadError}
    operation={skillMarketOperation}
    useError={skillMarketUseError}
    onInstall={skillId => void installMarketSkill(skillId)}
    onUpdate={skillId => void updateMarketSkill(skillId)}
    onUse={skillId => void useMarketSkill(skillId)}
  />
) : state.activeView === 'conversation' ? (
  conversationWorkspace
) : (
  <PlaceholderView label={getPlaceholderLabel(state.activeView)} />
);
```

只删除 `plugins` 对应的 Placeholder 使用路径；搜索、文件等其他占位页保持原状。

Composer 只在 `pendingComposerDraft.threadId === state.selectedThreadId` 时接收 draft，并在 `onDraftApplied` 中清除匹配请求。

- [ ] **Step 9：运行 App、Composer 和全量 web 测试**

```bash
pnpm --filter @clawee/web test -- Composer App SkillMarketView
pnpm --filter @clawee/web test
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

预期：全部通过。

- [ ] **Step 10：提交 App 集成**

```bash
git add apps/web/src/features/runs/Composer.tsx \
  apps/web/src/features/runs/Composer.test.tsx \
  apps/web/src/app/App.tsx \
  apps/web/src/app/App.test.tsx
git commit -m "feat: connect skill market to conversations"
```

---

## 最终验证

- [ ] **Step 1：运行仓库全量验证**

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

预期：全部成功，无 whitespace error。

- [ ] **Step 2：检查目录和 Git 边界**

```bash
git status --short
git check-ignore -v Skills-Hub
git diff --name-only HEAD~7..HEAD
```

预期：

1. `Skills-Hub/` 仍被 `.git/info/exclude` 排除。
2. 没有提交 `Skills-Hub/.git`、`.next` 或 `node_modules`。
3. 用户原有未提交文件没有被回退。

- [ ] **Step 3：启动本地服务进行真实页面检查**

分别启动 daemon 和 web；若 `9000` 已被占用，使用下一个可用端口：

```bash
pnpm daemon:dev
pnpm web:dev
```

记录 Vite 输出的本地 URL。

- [ ] **Step 4：浏览器桌面验收**

使用 1440×1000 viewport 检查：

1. 插件页首屏能看到搜索、状态入口、分类和三列卡片。
2. 55 条目录加载完成。
3. 卡片封面、标题、按钮和作者区不重叠。
4. 搜索和场景筛选不造成布局跳动。
5. 打开详情弹窗后背景滚动锁定，弹窗底部操作始终可见。
6. 关闭弹窗后列表滚动位置不变。
7. 安装失败、更新失败和 Runtime 未连接提示清晰。

- [ ] **Step 5：浏览器窄窗口验收**

使用 390×844 viewport 检查：

1. 卡片单列显示。
2. 分类和场景横向滚动，不压缩文字。
3. 弹窗使用底部抽屉形态或完整可滚动弹窗。
4. 所有按钮文本和图标不溢出。
5. 页面不存在横向整体滚动或元素重叠。

- [ ] **Step 6：真实使用流程验收**

1. 对一个可安装测试 Skill 执行安装。
2. 确认全局 Skills 目录出现目标目录。
3. 刷新页面，状态仍为“使用”。
4. 点击“使用”，确认创建新对话。
5. 输入框内容为 `$skill-id `，光标在末尾，未自动发送。
6. 再次点击“使用”，确认创建第二个新对话。
7. 手动放置一个不可从市场安装但 ID 匹配的有效 Skill，确认页面显示“使用”和“版本未知”。
8. 更新测试使用 isolated CODEX_HOME 或临时测试目录，不覆盖用户真实 Skill。
