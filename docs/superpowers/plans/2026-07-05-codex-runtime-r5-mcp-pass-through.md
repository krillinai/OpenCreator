# Codex Runtime R5 MCP Pass-through 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实现本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。不要使用 git worktree；所有实现都在当前工作区完成。

**Goal:** 实现 R5 MCP pass-through 后端能力：Runtime 通过 `codex mcp` 原生命令管理 MCP server，完成参数校验、env 脱敏、超时诊断、操作审计、API 暴露和 fake/真实 Codex 验证。

**Architecture:** Codex CLI 仍是 MCP 配置和运行时发现的唯一执行真相源。Runtime 不直接手写 MCP TOML 配置，不实现 MCP runtime；Runtime 只做 API 契约层、命令封装、输出解析、错误映射、脱敏和操作日志。

**Tech Stack:** TypeScript, Fastify, Vitest, Node `child_process`, `fs`, `path`, `better-sqlite3`, existing fake Codex helpers, existing gated real Codex smoke.

---

## File Structure

Create:

- `apps/daemon/src/codex/mcp/argv.ts`
  构造 `codex mcp list/get/add/remove/login/logout` argv，禁止 shell 拼接。
- `apps/daemon/src/codex/mcp/types.ts`
  定义 MCP 内部输入、能力、校验、命令结果、操作类型。
- `apps/daemon/src/codex/mcp/validator.ts`
  校验 MCP name、env key、stdio command/args、URL transport 和 capability gate。
- `apps/daemon/src/codex/mcp/redaction.ts`
  脱敏 env value、token-like key/value、URL query secret、bearer/authorization 值。
- `apps/daemon/src/codex/mcp/runner.ts`
  执行 `codex mcp`，注入 `CODEX_HOME`，处理 timeout、stdout/stderr 和脱敏诊断。
- `apps/daemon/src/codex/mcp/parser.ts`
  容错解析 `codex mcp list/get` 输出、not found 输出和未知格式输出。
- `apps/daemon/src/codex/mcp/operations.ts`
  SQLite `codex_mcp_operations` repository。
- `apps/daemon/src/codex/mcp/manager.ts`
  MCP use-case 层，组合 validator、argv、runner、parser、确认策略和操作日志。
- `apps/daemon/src/api/routes.mcp.ts`
  `/codex/mcp` API routes 和 HTTP 错误映射。
- `apps/daemon/test/unit/codex-mcp-validator.test.ts`
- `apps/daemon/test/unit/codex-mcp-redaction.test.ts`
- `apps/daemon/test/unit/codex-mcp-runner.test.ts`
- `apps/daemon/test/unit/codex-mcp-parser.test.ts`
- `apps/daemon/test/unit/codex-mcp-operations.test.ts`
- `apps/daemon/test/unit/codex-mcp-manager.test.ts`

Modify:

- `apps/daemon/src/codex/mcp.ts`
  保留兼容导出，转发到 `codex/mcp/argv.ts`。
- `apps/daemon/test/unit/mcp-argv.test.ts`
  扩展 argv 覆盖。
- `packages/protocol/src/api.ts`
  增加 MCP request/response 类型。
- `packages/protocol/src/errors.ts`
  增加 MCP 专用错误码。
- `apps/daemon/src/codex/capabilities.ts`
  增加 MCP capability flags 和 help 解析。
- `apps/daemon/src/api/server.ts`
  创建 MCP manager 并注册 MCP routes。
- `apps/daemon/src/storage/migrations.ts`
  增加 `codex_mcp_operations` 表和索引。
- `apps/daemon/test/unit/storage.test.ts`
  覆盖 MCP migration。
- `apps/daemon/test/integration/api.test.ts`
  使用 fake Codex binary 覆盖 MCP API。
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`
  增加 gated `codex mcp add/get/remove` smoke。
- `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md`
  实现完成后更新 R5 覆盖状态。

Do not modify in R5:

- UI。
- Scheduler。
- 企业 MCP Gateway。
- 自研 MCP runtime。
- 默认路径下直接手写 Codex MCP TOML。
- 自动化测试中写用户全局 `~/.codex`。

---

### Task 1: Protocol、错误码和 MCP 能力矩阵

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/errors.ts`
- Modify: `apps/daemon/src/codex/capabilities.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Test: `apps/daemon/test/unit/codex-capabilities.test.ts`
- Test: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 写 failing capability tests**

在 `apps/daemon/test/unit/codex-capabilities.test.ts` 中把 `MCP_ADD_HELP_01425` 改为包含 env、url、bearer token env var、OAuth flags：

```ts
const MCP_HELP_01425 = `
Usage: codex mcp [COMMAND]
Commands:
  list
  get
  add
  remove
  login
  logout
`;

const MCP_ADD_HELP_01425 = `
Usage: codex mcp add [OPTIONS] <NAME> <COMMAND>...
  --env <KEY=VALUE>
  --url <URL>
  --bearer-token-env-var <ENV_VAR>
  --oauth-client-id <CLIENT_ID>
  --oauth-resource <RESOURCE>
`;
```

把现有 `parseCodexCapabilityMatrix` 调用补上 `mcpHelp: MCP_HELP_01425` 或 `mcpHelp: ''`。

新增测试：

```ts
it('detects mcp management support from help output', () => {
  const matrix = parseCodexCapabilityMatrix({
    versionOutput: 'codex-cli 0.142.5',
    execHelp: EXEC_HELP_01425,
    resumeHelp: RESUME_HELP_01425,
    mcpHelp: MCP_HELP_01425,
    mcpAddHelp: MCP_ADD_HELP_01425,
    checkedAt: '2026-07-05T00:00:00.000Z'
  });

  expect(matrix).toMatchObject({
    mcpList: true,
    mcpGet: true,
    mcpAdd: true,
    mcpRemove: true,
    mcpLogin: true,
    mcpLogout: true,
    mcpAddEnv: true,
    mcpAddUrl: true,
    mcpAddBearerTokenEnvVar: true,
    mcpAddOAuth: true,
    mcpRuntimeDiscoveryVerified: false,
    mcpRuntimeBehaviorVerified: false
  });
});
```

扩展 unknown/default capability 测试，断言新增 MCP flags 全部为 `false`。

在 `apps/daemon/test/integration/api.test.ts` 的 `returns codex status with auth` 和 `makeResumeCapableMatrix()` 中增加：

```ts
mcpList: true,
mcpGet: true,
mcpAdd: true,
mcpRemove: true,
mcpLogin: true,
mcpLogout: true,
mcpAddEnv: true,
mcpAddUrl: true,
mcpAddBearerTokenEnvVar: true,
mcpAddOAuth: true,
mcpRuntimeDiscoveryVerified: false,
mcpRuntimeBehaviorVerified: false
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-capabilities.test.ts test/integration/api.test.ts
```

Expected: 失败，因为 `parseCodexCapabilityMatrix` 还不接受 `mcpHelp`，`RuntimeCapabilityMatrix` 还没有新增 MCP flags。

- [ ] **Step 3: 增加 protocol MCP 类型**

在 `packages/protocol/src/api.ts` 的 skill 类型之后增加：

```ts
export type CodexMcpTransport = 'stdio' | 'http' | 'sse' | 'unknown';
export type CodexMcpStatus = 'configured' | 'missing' | 'invalid' | 'unknown';
export type CodexMcpOperationType = 'add' | 'remove' | 'login' | 'logout' | 'get' | 'list';
export type CodexMcpOperationStatus = 'succeeded' | 'failed';

export type CodexMcpServerResponse = {
  name: string;
  transport: CodexMcpTransport;
  status: CodexMcpStatus;
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  hasSecrets: boolean;
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  diagnostics: string[];
  raw?: string;
};

export type CodexMcpListResponse = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  requiresWriteConfirmation: boolean;
  servers: CodexMcpServerResponse[];
  diagnostics: string[];
};

export type AddCodexMcpRequest =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      confirmWriteToCodexHome?: true;
    }
  | {
      name: string;
      transport: 'http' | 'sse';
      url: string;
      env?: Record<string, string>;
      oauthClientId?: string;
      oauthResource?: string;
      bearerTokenEnvVar?: string;
      confirmWriteToCodexHome?: true;
    };

export type CodexMcpOperationResponse = {
  id: string;
  operation: CodexMcpOperationType;
  serverName?: string | null;
  codexHome: string;
  command: string[];
  status: CodexMcpOperationStatus;
  exitCode?: number | null;
  timedOut: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type CodexMcpOperationListResponse = {
  operations: CodexMcpOperationResponse[];
};
```

- [ ] **Step 4: 增加 MCP 错误码**

在 `packages/protocol/src/errors.ts` 的 `RuntimeErrorCode` union 增加：

```ts
  | 'MCP_SERVER_NOT_FOUND'
  | 'MCP_SERVER_EXISTS'
  | 'MCP_SERVER_INVALID'
  | 'MCP_WRITE_CONFIRMATION_REQUIRED'
```

- [ ] **Step 5: 扩展 capability matrix**

在 `apps/daemon/src/codex/capabilities.ts` 的 `RuntimeCapabilityMatrix` 增加：

```ts
  mcpList: boolean;
  mcpGet: boolean;
  mcpAdd: boolean;
  mcpRemove: boolean;
  mcpLogin: boolean;
  mcpLogout: boolean;
  mcpAddUrl: boolean;
  mcpAddBearerTokenEnvVar: boolean;
  mcpAddOAuth: boolean;
  mcpRuntimeDiscoveryVerified: boolean;
  mcpRuntimeBehaviorVerified: boolean;
```

把 `parseCodexCapabilityMatrix` input 增加：

```ts
  mcpHelp: string;
```

在返回对象中增加：

```ts
    mcpList: input.mcpHelp.includes('list'),
    mcpGet: input.mcpHelp.includes('get'),
    mcpAdd: input.mcpHelp.includes('add'),
    mcpRemove: input.mcpHelp.includes('remove'),
    mcpLogin: input.mcpHelp.includes('login'),
    mcpLogout: input.mcpHelp.includes('logout'),
    mcpAddEnv: input.mcpAddHelp.includes('--env'),
    mcpAddUrl: input.mcpAddHelp.includes('--url'),
    mcpAddBearerTokenEnvVar: input.mcpAddHelp.includes('--bearer-token-env-var'),
    mcpAddOAuth:
      input.mcpAddHelp.includes('--oauth-client-id') &&
      input.mcpAddHelp.includes('--oauth-resource'),
    mcpRuntimeDiscoveryVerified: false,
    mcpRuntimeBehaviorVerified: false,
```

在 `collectCodexCapabilityMatrix` 中新增：

```ts
const mcpHelp = runCodexInfo(codexBin, ['mcp', '--help'], input.timeoutMs);
```

传入 `mcpHelp: mcpHelp.output`，并把 `...mcpHelp.warnings` 加入 warnings。

在 `apps/daemon/src/api/server.ts` 的 `createUnknownCapabilityMatrix()` 中把新增 MCP flags 全部设为 `false`。

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
git commit -m "feat: add mcp capability contract"
```

---

### Task 2: MCP argv builder 和 validator

**Files:**
- Create: `apps/daemon/src/codex/mcp/argv.ts`
- Create: `apps/daemon/src/codex/mcp/types.ts`
- Create: `apps/daemon/src/codex/mcp/validator.ts`
- Modify: `apps/daemon/src/codex/mcp.ts`
- Test: `apps/daemon/test/unit/mcp-argv.test.ts`
- Test: `apps/daemon/test/unit/codex-mcp-validator.test.ts`

- [ ] **Step 1: 写 failing argv tests**

用下面内容替换 `apps/daemon/test/unit/mcp-argv.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  buildMcpAddArgs,
  buildMcpGetArgs,
  buildMcpListArgs,
  buildMcpLoginArgs,
  buildMcpLogoutArgs,
  buildMcpRemoveArgs
} from '../../src/codex/mcp.js';

describe('mcp argv', () => {
  it('builds list get remove login and logout args', () => {
    expect(buildMcpListArgs()).toEqual(['mcp', 'list']);
    expect(buildMcpGetArgs('github')).toEqual(['mcp', 'get', 'github']);
    expect(buildMcpRemoveArgs('github')).toEqual(['mcp', 'remove', 'github']);
    expect(buildMcpLoginArgs('github')).toEqual(['mcp', 'login', 'github']);
    expect(buildMcpLogoutArgs('github')).toEqual(['mcp', 'logout', 'github']);
  });

  it('builds stdio mcp add args with env before separator', () => {
    expect(
      buildMcpAddArgs({
        name: 'github',
        transport: 'stdio',
        env: { GITHUB_TOKEN: 'secret' },
        command: 'node',
        args: ['server.js']
      })
    ).toEqual(['mcp', 'add', 'github', '--env', 'GITHUB_TOKEN=secret', '--', 'node', 'server.js']);
  });

  it('builds url and oauth mcp add args', () => {
    expect(
      buildMcpAddArgs({
        name: 'remote',
        transport: 'http',
        url: 'https://example.test/mcp',
        bearerTokenEnvVar: 'REMOTE_TOKEN'
      })
    ).toEqual([
      'mcp',
      'add',
      'remote',
      '--bearer-token-env-var',
      'REMOTE_TOKEN',
      '--url',
      'https://example.test/mcp'
    ]);

    expect(
      buildMcpAddArgs({
        name: 'oauth',
        transport: 'sse',
        url: 'https://example.test/sse',
        oauthClientId: 'client-1',
        oauthResource: 'https://example.test'
      })
    ).toEqual([
      'mcp',
      'add',
      'oauth',
      '--oauth-client-id',
      'client-1',
      '--oauth-resource',
      'https://example.test',
      '--url',
      'https://example.test/sse'
    ]);
  });
});
```

- [ ] **Step 2: 写 failing validator tests**

创建 `apps/daemon/test/unit/codex-mcp-validator.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  assertMcpAddRequestSupported,
  isValidMcpEnvKey,
  isValidMcpName,
  validateMcpAddRequest
} from '../../src/codex/mcp/validator.js';

const allCapabilities = {
  mcpAddEnv: true,
  mcpAddUrl: true,
  mcpAddBearerTokenEnvVar: true,
  mcpAddOAuth: true
};

describe('codex mcp validator', () => {
  it('validates mcp names and env keys', () => {
    expect(isValidMcpName('github')).toBe(true);
    expect(isValidMcpName('team.github_1')).toBe(true);
    expect(isValidMcpName('../github')).toBe(false);
    expect(isValidMcpName('bad name')).toBe(false);
    expect(isValidMcpName('')).toBe(false);

    expect(isValidMcpEnvKey('GITHUB_TOKEN')).toBe(true);
    expect(isValidMcpEnvKey('_TOKEN1')).toBe(true);
    expect(isValidMcpEnvKey('1TOKEN')).toBe(false);
    expect(isValidMcpEnvKey('BAD-NAME')).toBe(false);
  });

  it('validates stdio add requests', () => {
    expect(validateMcpAddRequest({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'secret' }
    })).toEqual({
      ok: true,
      value: {
        name: 'github',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { GITHUB_TOKEN: 'secret' }
      }
    });

    expect(validateMcpAddRequest({ name: 'bad name', transport: 'stdio', command: 'node' })).toEqual({
      ok: false,
      message: 'name must be a valid MCP server name'
    });
    expect(validateMcpAddRequest({ name: 'github', transport: 'stdio', command: '' })).toEqual({
      ok: false,
      message: 'command must be a non-empty string'
    });
    expect(validateMcpAddRequest({ name: 'github', transport: 'stdio', command: 'node', args: 'server.js' })).toEqual({
      ok: false,
      message: 'args must be an array of strings'
    });
    expect(validateMcpAddRequest({ name: 'github', transport: 'stdio', command: 'node', env: { 'BAD-NAME': 'secret' } })).toEqual({
      ok: false,
      message: 'env keys must be valid environment variable names'
    });
  });

  it('validates url add requests and capability gates', () => {
    const request = {
      name: 'remote',
      transport: 'http' as const,
      url: 'https://example.test/mcp',
      bearerTokenEnvVar: 'REMOTE_TOKEN'
    };

    expect(validateMcpAddRequest(request)).toEqual({ ok: true, value: request });
    expect(validateMcpAddRequest({ ...request, url: 'file:///tmp/mcp' })).toEqual({
      ok: false,
      message: 'url must use http or https'
    });

    expect(assertMcpAddRequestSupported(request, allCapabilities)).toEqual({ ok: true });
    expect(assertMcpAddRequestSupported(request, { ...allCapabilities, mcpAddBearerTokenEnvVar: false })).toEqual({
      ok: false,
      code: 'CODEX_INCOMPATIBLE',
      message: 'Current Codex does not support --bearer-token-env-var for mcp add'
    });
    expect(assertMcpAddRequestSupported({
      name: 'oauth',
      transport: 'sse',
      url: 'https://example.test/sse',
      oauthClientId: 'client',
      oauthResource: 'https://example.test'
    }, { ...allCapabilities, mcpAddOAuth: false })).toEqual({
      ok: false,
      code: 'CODEX_INCOMPATIBLE',
      message: 'Current Codex does not support OAuth flags for mcp add'
    });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/mcp-argv.test.ts test/unit/codex-mcp-validator.test.ts
```

Expected: 失败，因为新模块和函数还不存在。

- [ ] **Step 4: 实现 MCP internal types**

创建 `apps/daemon/src/codex/mcp/types.ts`：

```ts
import type { RuntimeErrorCode } from '@clawee/protocol';

export type McpTransport = 'stdio' | 'http' | 'sse';

export type AddMcpServerInput =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
      confirmWriteToCodexHome?: true;
    }
  | {
      name: string;
      transport: 'http' | 'sse';
      url: string;
      env: Record<string, string>;
      oauthClientId?: string;
      oauthResource?: string;
      bearerTokenEnvVar?: string;
      confirmWriteToCodexHome?: true;
    };

export type McpAddCapabilityFlags = {
  mcpAddEnv: boolean;
  mcpAddUrl: boolean;
  mcpAddBearerTokenEnvVar: boolean;
  mcpAddOAuth: boolean;
};

export type McpValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export type McpCapabilityResult =
  | { ok: true }
  | { ok: false; code: RuntimeErrorCode; message: string };
```

- [ ] **Step 5: 实现 argv builder**

创建 `apps/daemon/src/codex/mcp/argv.ts`：

```ts
import type { AddMcpServerInput } from './types.js';

export function buildMcpListArgs(): string[] {
  return ['mcp', 'list'];
}

export function buildMcpGetArgs(name: string): string[] {
  return ['mcp', 'get', name];
}

export function buildMcpRemoveArgs(name: string): string[] {
  return ['mcp', 'remove', name];
}

export function buildMcpLoginArgs(name: string): string[] {
  return ['mcp', 'login', name];
}

export function buildMcpLogoutArgs(name: string): string[] {
  return ['mcp', 'logout', name];
}

export function buildMcpAddArgs(input: AddMcpServerInput): string[] {
  const args = ['mcp', 'add', input.name];
  for (const [key, value] of Object.entries(input.env)) {
    args.push('--env', `${key}=${value}`);
  }

  if (input.transport === 'stdio') {
    args.push('--', input.command, ...input.args);
    return args;
  }

  if (input.bearerTokenEnvVar !== undefined) {
    args.push('--bearer-token-env-var', input.bearerTokenEnvVar);
  }
  if (input.oauthClientId !== undefined) {
    args.push('--oauth-client-id', input.oauthClientId);
  }
  if (input.oauthResource !== undefined) {
    args.push('--oauth-resource', input.oauthResource);
  }
  args.push('--url', input.url);
  return args;
}
```

把 `apps/daemon/src/codex/mcp.ts` 改成兼容导出：

```ts
export {
  buildMcpAddArgs,
  buildMcpGetArgs,
  buildMcpListArgs,
  buildMcpLoginArgs,
  buildMcpLogoutArgs,
  buildMcpRemoveArgs
} from './mcp/argv.js';
export type { AddMcpServerInput as BuildMcpAddArgsInput } from './mcp/types.js';
```

- [ ] **Step 6: 实现 validator**

创建 `apps/daemon/src/codex/mcp/validator.ts`：

```ts
import type {
  AddMcpServerInput,
  McpAddCapabilityFlags,
  McpCapabilityResult,
  McpValidationResult
} from './types.js';

const MCP_NAME_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidMcpName(name: string): boolean {
  return MCP_NAME_PATTERN.test(name);
}

export function isValidMcpEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

export function validateMcpAddRequest(body: unknown): McpValidationResult<AddMcpServerInput> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (typeof body.name !== 'string' || !isValidMcpName(body.name)) {
    return { ok: false, message: 'name must be a valid MCP server name' };
  }
  if (body.transport !== 'stdio' && body.transport !== 'http' && body.transport !== 'sse') {
    return { ok: false, message: 'transport must be stdio, http, or sse' };
  }
  if (body.confirmWriteToCodexHome !== undefined && body.confirmWriteToCodexHome !== true) {
    return { ok: false, message: 'confirmWriteToCodexHome must be true when provided' };
  }

  const env = normalizeEnv(body.env);
  if (!env.ok) return env;

  if (body.transport === 'stdio') {
    if (typeof body.command !== 'string' || body.command.trim().length === 0) {
      return { ok: false, message: 'command must be a non-empty string' };
    }
    if (body.args !== undefined && !isStringArray(body.args)) {
      return { ok: false, message: 'args must be an array of strings' };
    }
    return {
      ok: true,
      value: {
        name: body.name,
        transport: 'stdio',
        command: body.command,
        args: body.args ?? [],
        env: env.value,
        ...(body.confirmWriteToCodexHome === true ? { confirmWriteToCodexHome: true } : {})
      }
    };
  }

  if (typeof body.url !== 'string' || !isHttpUrl(body.url)) {
    return { ok: false, message: 'url must use http or https' };
  }
  if (body.bearerTokenEnvVar !== undefined && (
    typeof body.bearerTokenEnvVar !== 'string' || !isValidMcpEnvKey(body.bearerTokenEnvVar)
  )) {
    return { ok: false, message: 'bearerTokenEnvVar must be a valid environment variable name' };
  }
  if (body.oauthClientId !== undefined && typeof body.oauthClientId !== 'string') {
    return { ok: false, message: 'oauthClientId must be a string' };
  }
  if (body.oauthResource !== undefined && typeof body.oauthResource !== 'string') {
    return { ok: false, message: 'oauthResource must be a string' };
  }

  return {
    ok: true,
    value: {
      name: body.name,
      transport: body.transport,
      url: body.url,
      env: env.value,
      ...(body.bearerTokenEnvVar === undefined ? {} : { bearerTokenEnvVar: body.bearerTokenEnvVar }),
      ...(body.oauthClientId === undefined ? {} : { oauthClientId: body.oauthClientId }),
      ...(body.oauthResource === undefined ? {} : { oauthResource: body.oauthResource }),
      ...(body.confirmWriteToCodexHome === true ? { confirmWriteToCodexHome: true } : {})
    }
  };
}

export function assertMcpAddRequestSupported(
  input: AddMcpServerInput,
  capabilities: McpAddCapabilityFlags
): McpCapabilityResult {
  if (Object.keys(input.env).length > 0 && !capabilities.mcpAddEnv) {
    return { ok: false, code: 'CODEX_INCOMPATIBLE', message: 'Current Codex does not support --env for mcp add' };
  }
  if (input.transport !== 'stdio' && !capabilities.mcpAddUrl) {
    return { ok: false, code: 'CODEX_INCOMPATIBLE', message: 'Current Codex does not support --url for mcp add' };
  }
  if (input.transport !== 'stdio' && input.bearerTokenEnvVar !== undefined && !capabilities.mcpAddBearerTokenEnvVar) {
    return { ok: false, code: 'CODEX_INCOMPATIBLE', message: 'Current Codex does not support --bearer-token-env-var for mcp add' };
  }
  if (input.transport !== 'stdio' && (input.oauthClientId !== undefined || input.oauthResource !== undefined) && !capabilities.mcpAddOAuth) {
    return { ok: false, code: 'CODEX_INCOMPATIBLE', message: 'Current Codex does not support OAuth flags for mcp add' };
  }
  return { ok: true };
}

function normalizeEnv(value: unknown): McpValidationResult<Record<string, string>> {
  if (value === undefined) return { ok: true, value: {} };
  if (!isPlainObject(value)) return { ok: false, message: 'env must be an object' };
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isValidMcpEnvKey(key)) return { ok: false, message: 'env keys must be valid environment variable names' };
    if (typeof raw !== 'string') return { ok: false, message: 'env values must be strings' };
    env[key] = raw;
  }
  return { ok: true, value: env };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

- [ ] **Step 7: 运行测试和类型检查**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/mcp-argv.test.ts test/unit/codex-mcp-validator.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 8: 提交**

```bash
git add apps/daemon/src/codex/mcp.ts apps/daemon/src/codex/mcp/argv.ts apps/daemon/src/codex/mcp/types.ts apps/daemon/src/codex/mcp/validator.ts apps/daemon/test/unit/mcp-argv.test.ts apps/daemon/test/unit/codex-mcp-validator.test.ts
git commit -m "feat: validate mcp passthrough requests"
```

---

### Task 3: MCP 脱敏和命令 runner

**Files:**
- Create: `apps/daemon/src/codex/mcp/redaction.ts`
- Create: `apps/daemon/src/codex/mcp/runner.ts`
- Test: `apps/daemon/test/unit/codex-mcp-redaction.test.ts`
- Test: `apps/daemon/test/unit/codex-mcp-runner.test.ts`

- [ ] **Step 1: 写 failing redaction tests**

创建 `apps/daemon/test/unit/codex-mcp-redaction.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { redactMcpArgv, redactMcpText } from '../../src/codex/mcp/redaction.js';

describe('codex mcp redaction', () => {
  it('redacts env values in argv', () => {
    expect(redactMcpArgv([
      'mcp',
      'add',
      'github',
      '--env',
      'GITHUB_TOKEN=secret',
      '--env',
      'SAFE=value',
      '--',
      'node',
      'server.js'
    ])).toEqual([
      'mcp',
      'add',
      'github',
      '--env',
      'GITHUB_TOKEN=[REDACTED]',
      '--env',
      'SAFE=[REDACTED]',
      '--',
      'node',
      'server.js'
    ]);
  });

  it('redacts token-like text and url query secrets', () => {
    expect(redactMcpText('GITHUB_TOKEN=secret\nAuthorization: Bearer abc123')).toContain('GITHUB_TOKEN=[REDACTED]');
    expect(redactMcpText('Authorization: Bearer abc123')).toContain('Authorization: Bearer [REDACTED]');
    expect(redactMcpText('https://example.test/mcp?token=secret&safe=ok')).toContain('token=[REDACTED]');
  });
});
```

- [ ] **Step 2: 写 failing runner tests**

创建 `apps/daemon/test/unit/codex-mcp-runner.test.ts`：

```ts
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMcpCommand } from '../../src/codex/mcp/runner.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex mcp runner', () => {
  it('runs codex mcp commands with CODEX_HOME and redacts output', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-mcp-runner-'));
    const codexHome = join(tempDir, 'codex-home');
    const bin = writeFakeBin(`
      require('fs').writeFileSync(${JSON.stringify(join(tempDir, 'home.txt'))}, process.env.CODEX_HOME || '');
      console.log('GITHUB_TOKEN=secret');
      console.error('Authorization: Bearer abc123');
      process.exit(0);
    `);

    const result = runMcpCommand({
      codexBin: bin,
      codexHome,
      args: ['mcp', 'get', 'github'],
      timeoutMs: 1000,
      sensitiveValues: ['secret', 'abc123']
    });

    expect(readFileSync(join(tempDir, 'home.txt'), 'utf8')).toBe(codexHome);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('GITHUB_TOKEN=secret');
    expect(result.redactedStdout).toContain('GITHUB_TOKEN=[REDACTED]');
    expect(result.stderr).toContain('Authorization: Bearer abc123');
    expect(result.redactedStderr).toContain('Authorization: Bearer [REDACTED]');
  });

  it('reports timeout diagnostics', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-mcp-runner-'));
    const bin = writeFakeBin('setTimeout(() => {}, 10_000);');

    const result = runMcpCommand({
      codexBin: bin,
      codexHome: join(tempDir, 'codex-home'),
      args: ['mcp', 'list'],
      timeoutMs: 10
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.redactedStderr).toContain('[codex-mcp] timed out after 10ms');
  });
});

function writeFakeBin(body: string): string {
  mkdirSync(tempDir, { recursive: true });
  const bin = join(tempDir, 'fake-codex.js');
  writeFileSync(bin, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-mcp-redaction.test.ts test/unit/codex-mcp-runner.test.ts
```

Expected: 失败，因为 redaction 和 runner 模块还不存在。

- [ ] **Step 4: 实现 redaction**

创建 `apps/daemon/src/codex/mcp/redaction.ts`：

```ts
export function redactMcpArgv(argv: string[]): string[] {
  const redacted: string[] = [];
  let redactNextEnv = false;

  for (const arg of argv) {
    if (redactNextEnv) {
      redacted.push(redactKeyValue(arg));
      redactNextEnv = false;
      continue;
    }
    redacted.push(redactMcpText(arg));
    if (arg === '--env') redactNextEnv = true;
  }

  return redacted;
}

export function redactMcpText(input: string, sensitiveValues: string[] = []): string {
  let output = input;
  output = output.replace(/([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|KEY)[A-Za-z0-9_]*=)([^\s&]+)/gi, '$1[REDACTED]');
  output = output.replace(/(Authorization:\s*Bearer\s+)([^\s]+)/gi, '$1[REDACTED]');
  output = output.replace(/(bearer\s+)([A-Za-z0-9._~+/-]+)/gi, '$1[REDACTED]');
  output = output.replace(/([?&](?:token|secret|password|key|api_key)=)([^&\s]+)/gi, '$1[REDACTED]');
  for (const value of sensitiveValues.filter(value => value.length > 0)) {
    output = output.split(value).join('[REDACTED]');
  }
  return output;
}

function redactKeyValue(value: string): string {
  const index = value.indexOf('=');
  if (index === -1) return '[REDACTED]';
  return `${value.slice(0, index + 1)}[REDACTED]`;
}
```

- [ ] **Step 5: 实现 runner**

创建 `apps/daemon/src/codex/mcp/runner.ts`：

```ts
import { spawnSync } from 'node:child_process';
import { redactMcpArgv, redactMcpText } from './redaction.js';

export type McpCommandResult = {
  command: string[];
  redactedCommand: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  redactedStdout: string;
  redactedStderr: string;
  timedOut: boolean;
  errorMessage: string | null;
};

export type RunMcpCommandInput = {
  codexBin: string;
  codexHome: string;
  args: string[];
  timeoutMs?: number;
  sensitiveValues?: string[];
};

export function runMcpCommand(input: RunMcpCommandInput): McpCommandResult {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const result = spawnSync(input.codexBin, input.args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, CODEX_HOME: input.codexHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const errorMessage = result.error?.message ?? null;
  const timedOut = errorMessage !== null && /\bETIMEDOUT\b/.test(errorMessage);
  const diagnostic = [
    timedOut ? formatDiagnostic(`timed out after ${timeoutMs}ms`) : '',
    errorMessage !== null ? formatDiagnostic(`process error: ${errorMessage}`) : '',
    result.signal !== null ? formatDiagnostic(`termination signal: ${result.signal}`) : ''
  ].join('');
  const combinedStderr = `${stderr}${diagnostic}`;

  return {
    command: input.args,
    redactedCommand: redactMcpArgv(input.args),
    exitCode: result.status,
    stdout,
    stderr: combinedStderr,
    redactedStdout: redactMcpText(stdout, input.sensitiveValues ?? []),
    redactedStderr: redactMcpText(combinedStderr, input.sensitiveValues ?? []),
    timedOut,
    errorMessage
  };
}

function formatDiagnostic(message: string): string {
  return `\n[codex-mcp] ${message}`;
}
```

- [ ] **Step 6: 运行测试和类型检查**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-mcp-redaction.test.ts test/unit/codex-mcp-runner.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/codex/mcp/redaction.ts apps/daemon/src/codex/mcp/runner.ts apps/daemon/test/unit/codex-mcp-redaction.test.ts apps/daemon/test/unit/codex-mcp-runner.test.ts
git commit -m "feat: run mcp commands with redaction"
```

---

### Task 4: MCP 输出 parser

**Files:**
- Create: `apps/daemon/src/codex/mcp/parser.ts`
- Test: `apps/daemon/test/unit/codex-mcp-parser.test.ts`

- [ ] **Step 1: 写 failing parser tests**

创建 `apps/daemon/test/unit/codex-mcp-parser.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { isMcpNotFoundOutput, parseMcpGetOutput, parseMcpListOutput } from '../../src/codex/mcp/parser.js';

describe('codex mcp parser', () => {
  it('parses json mcp get output', () => {
    expect(parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { GITHUB_TOKEN: '[REDACTED]' }
      }),
      stderr: '',
      exitCode: 0
    })).toEqual(expect.objectContaining({
      name: 'github',
      transport: 'stdio',
      status: 'configured',
      command: 'node',
      args: ['server.js'],
      envKeys: ['GITHUB_TOKEN'],
      hasSecrets: true,
      diagnostics: []
    }));
  });

  it('returns configured unknown with diagnostics for unparsed get output', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: 'github server configured somehow',
      stderr: '',
      exitCode: 0
    });

    expect(result).toMatchObject({
      name: 'github',
      transport: 'unknown',
      status: 'configured',
      raw: 'github server configured somehow',
      diagnostics: [expect.stringContaining('not fully recognized')]
    });
  });

  it('detects missing mcp servers', () => {
    expect(isMcpNotFoundOutput('server not found')).toBe(true);
    expect(isMcpNotFoundOutput('No MCP server named github is configured')).toBe(true);
    expect(isMcpNotFoundOutput('permission denied')).toBe(false);
  });

  it('parses list output best effort', () => {
    expect(parseMcpListOutput({
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify([{ name: 'github', transport: 'stdio', command: 'node', args: ['server.js'] }]),
      stderr: '',
      exitCode: 0
    }).servers).toEqual([
      expect.objectContaining({ name: 'github', transport: 'stdio', status: 'configured' })
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-mcp-parser.test.ts
```

Expected: 失败，因为 parser 模块还不存在。

- [ ] **Step 3: 实现 parser**

创建 `apps/daemon/src/codex/mcp/parser.ts`：

```ts
import type { CodexHomeMode, CodexMcpListResponse, CodexMcpServerResponse } from '@clawee/protocol';
import { redactMcpText } from './redaction.js';

export type ParseMcpGetOutputInput = {
  name: string;
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type ParseMcpListOutputInput = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export function parseMcpGetOutput(input: ParseMcpGetOutputInput): CodexMcpServerResponse {
  const output = `${input.stdout}\n${input.stderr}`.trim();
  const parsed = parseJsonValue(output);
  if (isPlainObject(parsed)) {
    return mapObjectToServer(parsed, input.name, input.codexHome, input.codexHomeMode, []);
  }

  const raw = redactMcpText(output);
  return {
    name: input.name,
    transport: 'unknown',
    status: input.exitCode === 0 ? 'configured' : 'unknown',
    envKeys: [],
    hasSecrets: false,
    codexHome: input.codexHome,
    codexHomeMode: input.codexHomeMode,
    diagnostics: ['codex mcp get output was not fully recognized'],
    ...(raw.length === 0 ? {} : { raw })
  };
}

export function parseMcpListOutput(input: ParseMcpListOutputInput): CodexMcpListResponse {
  const diagnostics: string[] = [];
  const output = `${input.stdout}\n${input.stderr}`.trim();
  const parsed = parseJsonValue(output);
  if (Array.isArray(parsed)) {
    return {
      codexHome: input.codexHome,
      codexHomeMode: input.codexHomeMode,
      requiresWriteConfirmation: input.codexHomeMode === 'global',
      servers: parsed
        .filter(isPlainObject)
        .map(value => mapObjectToServer(value, readName(value), input.codexHome, input.codexHomeMode, [])),
      diagnostics
    };
  }

  if (output.length > 0) diagnostics.push('codex mcp list output was not fully recognized');
  return {
    codexHome: input.codexHome,
    codexHomeMode: input.codexHomeMode,
    requiresWriteConfirmation: input.codexHomeMode === 'global',
    servers: [],
    diagnostics
  };
}

export function isMcpNotFoundOutput(output: string): boolean {
  return /(not found|not configured|no mcp server named|missing)/i.test(output);
}

function mapObjectToServer(
  value: Record<string, unknown>,
  fallbackName: string,
  codexHome: string,
  codexHomeMode: CodexHomeMode,
  diagnostics: string[]
): CodexMcpServerResponse {
  const env = isPlainObject(value.env) ? value.env : {};
  const envKeys = Object.keys(env).sort();
  const transport = value.transport === 'stdio' || value.transport === 'http' || value.transport === 'sse'
    ? value.transport
    : 'unknown';
  return {
    name: readName(value) || fallbackName,
    transport,
    status: 'configured',
    ...(typeof value.command === 'string' ? { command: value.command } : {}),
    ...(Array.isArray(value.args) && value.args.every(item => typeof item === 'string') ? { args: value.args } : {}),
    ...(typeof value.url === 'string' ? { url: redactMcpText(value.url) } : {}),
    envKeys,
    hasSecrets: envKeys.length > 0,
    codexHome,
    codexHomeMode,
    diagnostics
  };
}

function parseJsonValue(output: string): unknown {
  if (output.trim().length === 0) return undefined;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readName(value: Record<string, unknown>): string {
  return typeof value.name === 'string' ? value.name : 'unknown';
}
```

- [ ] **Step 4: 运行测试和类型检查**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-mcp-parser.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/codex/mcp/parser.ts apps/daemon/test/unit/codex-mcp-parser.test.ts
git commit -m "feat: parse codex mcp output"
```

---

### Task 5: MCP 操作日志 migration 和 repository

**Files:**
- Modify: `apps/daemon/src/storage/migrations.ts`
- Create: `apps/daemon/src/codex/mcp/operations.ts`
- Test: `apps/daemon/test/unit/storage.test.ts`
- Test: `apps/daemon/test/unit/codex-mcp-operations.test.ts`

- [ ] **Step 1: 写 failing migration test**

在 `apps/daemon/test/unit/storage.test.ts` 中增加：

```ts
  it('creates codex mcp operation log table', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_mcp_operations'"
      )
      .all() as Array<{ name: string }>;
    expect(tableRows).toEqual([{ name: 'codex_mcp_operations' }]);

    const indexRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_codex_mcp_operations_created_at'"
      )
      .all() as Array<{ name: string }>;
    expect(indexRows).toEqual([{ name: 'idx_codex_mcp_operations_created_at' }]);
  });
```

- [ ] **Step 2: 写 failing repository test**

创建 `apps/daemon/test/unit/codex-mcp-operations.test.ts`：

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpOperationRepository } from '../../src/codex/mcp/operations.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex mcp operations', () => {
  it('persists redacted mcp operations newest first', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-mcp-ops-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const operations = createMcpOperationRepository(db);

    const first = operations.insertOperation({
      operation: 'add',
      serverName: 'github',
      codexHome: join(tempDir, 'codex-home'),
      command: ['mcp', 'add', 'github', '--env', 'GITHUB_TOKEN=[REDACTED]', '--', 'node', 'server.js'],
      status: 'succeeded',
      exitCode: 0,
      timedOut: false
    });
    const second = operations.insertOperation({
      operation: 'remove',
      serverName: 'github',
      codexHome: join(tempDir, 'codex-home'),
      command: ['mcp', 'remove', 'github'],
      status: 'failed',
      exitCode: 1,
      timedOut: false,
      errorCode: 'MCP_COMMAND_FAILED',
      errorMessage: 'failed'
    });

    expect(first.id).toMatch(/^mcpop_/);
    expect(operations.listOperations()).toEqual([
      expect.objectContaining({ id: second.id, operation: 'remove', errorCode: 'MCP_COMMAND_FAILED' }),
      expect.objectContaining({ id: first.id, operation: 'add', command: expect.arrayContaining(['GITHUB_TOKEN=[REDACTED]']) })
    ]);
    expect(operations.listOperations(1)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/storage.test.ts test/unit/codex-mcp-operations.test.ts
```

Expected: 失败，因为表和 repository 还不存在。

- [ ] **Step 4: 增加 migration**

在 `apps/daemon/src/storage/migrations.ts` 的 `db.exec` 中，在 `codex_skill_operations` 之后增加：

```sql
    CREATE TABLE IF NOT EXISTS codex_mcp_operations (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      server_name TEXT,
      codex_home TEXT NOT NULL,
      command_json TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      timed_out INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
```

增加索引：

```sql
    CREATE INDEX IF NOT EXISTS idx_codex_mcp_operations_created_at
      ON codex_mcp_operations(created_at DESC, id DESC);
```

- [ ] **Step 5: 实现 repository**

创建 `apps/daemon/src/codex/mcp/operations.ts`：

```ts
import type { CodexMcpOperationResponse, CodexMcpOperationStatus, CodexMcpOperationType } from '@clawee/protocol';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export type InsertMcpOperationInput = {
  operation: CodexMcpOperationType;
  serverName?: string | null;
  codexHome: string;
  command: string[];
  status: CodexMcpOperationStatus;
  exitCode?: number | null;
  timedOut: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type McpOperationRepository = {
  insertOperation(input: InsertMcpOperationInput): CodexMcpOperationResponse;
  listOperations(limit?: number): CodexMcpOperationResponse[];
};

export function createMcpOperationRepository(db: Database.Database): McpOperationRepository {
  const insert = db.prepare(`
    INSERT INTO codex_mcp_operations (
      id, operation, server_name, codex_home, command_json, status,
      exit_code, timed_out, error_code, error_message
    ) VALUES (
      @id, @operation, @serverName, @codexHome, @commandJson, @status,
      @exitCode, @timedOut, @errorCode, @errorMessage
    )
  `);
  const get = db.prepare<string>('SELECT * FROM codex_mcp_operations WHERE id = ?');
  const list = db.prepare<{ limit: number }>(`
    SELECT *
    FROM codex_mcp_operations
    ORDER BY rowid DESC
    LIMIT @limit
  `);

  return {
    insertOperation(input): CodexMcpOperationResponse {
      const id = `mcpop_${nanoid()}`;
      insert.run({
        id,
        serverName: null,
        exitCode: null,
        errorCode: null,
        errorMessage: null,
        ...input,
        commandJson: JSON.stringify(input.command),
        timedOut: input.timedOut ? 1 : 0
      });
      return mapRow(get.get(id) as McpOperationRow);
    },
    listOperations(limit = 50): CodexMcpOperationResponse[] {
      return (list.all({ limit: Math.max(1, Math.min(limit, 200)) }) as McpOperationRow[]).map(mapRow);
    }
  };
}

type McpOperationRow = {
  id: string;
  operation: CodexMcpOperationType;
  server_name: string | null;
  codex_home: string;
  command_json: string;
  status: CodexMcpOperationStatus;
  exit_code: number | null;
  timed_out: 0 | 1;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

function mapRow(row: McpOperationRow): CodexMcpOperationResponse {
  return {
    id: row.id,
    operation: row.operation,
    serverName: row.server_name,
    codexHome: row.codex_home,
    command: JSON.parse(row.command_json) as string[],
    status: row.status,
    exitCode: row.exit_code,
    timedOut: row.timed_out === 1,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}
```

- [ ] **Step 6: 运行测试和类型检查**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/storage.test.ts test/unit/codex-mcp-operations.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/storage/migrations.ts apps/daemon/src/codex/mcp/operations.ts apps/daemon/test/unit/storage.test.ts apps/daemon/test/unit/codex-mcp-operations.test.ts
git commit -m "feat: log codex mcp operations"
```

---

### Task 6: MCP manager

**Files:**
- Create: `apps/daemon/src/codex/mcp/manager.ts`
- Test: `apps/daemon/test/unit/codex-mcp-manager.test.ts`

- [ ] **Step 1: 写 failing manager tests**

创建 `apps/daemon/test/unit/codex-mcp-manager.test.ts`：

```ts
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpManager } from '../../src/codex/mcp/manager.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex mcp manager', () => {
  it('adds, gets, removes, and logs mcp servers through codex commands', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-mcp-manager-'));
    const codexHome = join(tempDir, 'codex-home');
    const bin = writeMcpFakeCodex();
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createMcpManager({
      codexBin: bin,
      codexHome: { path: codexHome, mode: 'isolated', source: 'isolated', writable: true },
      db,
      capabilities: {
        mcpAddEnv: true,
        mcpAddUrl: true,
        mcpAddBearerTokenEnvVar: true,
        mcpAddOAuth: true
      },
      timeoutMs: 1000
    });

    const added = await manager.addServer({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'secret' }
    });
    expect(added.server).toMatchObject({ name: 'github', status: 'configured' });
    expect(added.operation.command).toEqual(expect.arrayContaining(['GITHUB_TOKEN=[REDACTED]']));

    const listed = await manager.listServers();
    expect(listed.servers).toEqual([expect.objectContaining({ name: 'github' })]);

    const got = await manager.getServer('github');
    expect(got).toMatchObject({ name: 'github', command: 'node', envKeys: ['GITHUB_TOKEN'] });

    const removed = await manager.removeServer('github', false);
    expect(removed.operation.operation).toBe('remove');

    expect(manager.listOperations().map(operation => operation.operation)).toEqual([
      'remove',
      'get',
      'list',
      'add'
    ]);
    expect(JSON.parse(readFileSync(join(tempDir, 'commands.json'), 'utf8'))).toContain('mcp add github --env GITHUB_TOKEN=secret -- node server.js');
  });

  it('requires confirmation for global codex mcp writes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-mcp-manager-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createMcpManager({
      codexBin: writeMcpFakeCodex(),
      codexHome: { path: join(tempDir, 'codex-home'), mode: 'global', source: 'default', writable: false },
      db,
      capabilities: { mcpAddEnv: true, mcpAddUrl: true, mcpAddBearerTokenEnvVar: true, mcpAddOAuth: true },
      timeoutMs: 1000
    });

    await expect(manager.addServer({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: [],
      env: {}
    })).rejects.toThrow('MCP_WRITE_CONFIRMATION_REQUIRED');
  });
});

function writeMcpFakeCodex(): string {
  const bin = join(tempDir, 'fake-codex.js');
  const commandsPath = join(tempDir, 'commands.json');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const commandsPath = ${JSON.stringify(commandsPath)};
const commands = fs.existsSync(commandsPath) ? JSON.parse(fs.readFileSync(commandsPath, 'utf8')) : [];
commands.push(process.argv.slice(2).join(' '));
fs.writeFileSync(commandsPath, JSON.stringify(commands));
const args = process.argv.slice(2);
if (args.join(' ') === 'mcp list') {
  console.log(JSON.stringify([{ name: 'github', transport: 'stdio', command: 'node', args: ['server.js'], env: { GITHUB_TOKEN: '[REDACTED]' } }]));
  process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'get' && args[2] === 'github') {
  console.log(JSON.stringify({ name: 'github', transport: 'stdio', command: 'node', args: ['server.js'], env: { GITHUB_TOKEN: '[REDACTED]' } }));
  process.exit(0);
}
if (args[0] === 'mcp' && ['add', 'remove', 'login', 'logout'].includes(args[1])) process.exit(0);
console.error('not found');
process.exit(1);
`);
  chmodSync(bin, 0o755);
  return bin;
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-mcp-manager.test.ts
```

Expected: 失败，因为 manager 还不存在。

- [ ] **Step 3: 实现 manager**

创建 `apps/daemon/src/codex/mcp/manager.ts`：

```ts
import type Database from 'better-sqlite3';
import type { CodexMcpListResponse, CodexMcpOperationResponse, CodexMcpServerResponse } from '@clawee/protocol';
import type { RuntimeCapabilityMatrix } from '../capabilities.js';
import type { ResolvedCodexHome } from '../home.js';
import { buildMcpAddArgs, buildMcpGetArgs, buildMcpListArgs, buildMcpLoginArgs, buildMcpLogoutArgs, buildMcpRemoveArgs } from './argv.js';
import { createMcpOperationRepository } from './operations.js';
import { isMcpNotFoundOutput, parseMcpGetOutput, parseMcpListOutput } from './parser.js';
import { runMcpCommand, type McpCommandResult } from './runner.js';
import type { AddMcpServerInput, McpAddCapabilityFlags } from './types.js';
import { assertMcpAddRequestSupported } from './validator.js';

export type McpManager = {
  listServers(): Promise<CodexMcpListResponse>;
  getServer(name: string): Promise<CodexMcpServerResponse>;
  addServer(input: AddMcpServerInput): Promise<{ server?: CodexMcpServerResponse; operation: CodexMcpOperationResponse }>;
  removeServer(name: string, confirmed: boolean): Promise<{ removed: true; operation: CodexMcpOperationResponse }>;
  loginServer(name: string, confirmed: boolean): Promise<{ operation: CodexMcpOperationResponse }>;
  logoutServer(name: string, confirmed: boolean): Promise<{ operation: CodexMcpOperationResponse }>;
  listOperations(limit?: number): CodexMcpOperationResponse[];
};

export function createMcpManager(input: {
  codexBin: string;
  codexHome: ResolvedCodexHome;
  db: Database.Database;
  capabilities: Pick<RuntimeCapabilityMatrix, keyof McpAddCapabilityFlags>;
  timeoutMs?: number;
}): McpManager {
  const operations = createMcpOperationRepository(input.db);
  const timeoutMs = input.timeoutMs ?? 30_000;
  const manager: McpManager = {
    async listServers() {
      const result = run(buildMcpListArgs());
      record('list', null, result);
      if (result.exitCode !== 0) {
        return {
          codexHome: input.codexHome.path,
          codexHomeMode: input.codexHome.mode,
          requiresWriteConfirmation: input.codexHome.mode === 'global',
          servers: [],
          diagnostics: [summarizeResult(result)]
        };
      }
      return parseMcpListOutput({
        codexHome: input.codexHome.path,
        codexHomeMode: input.codexHome.mode,
        stdout: result.redactedStdout,
        stderr: result.redactedStderr,
        exitCode: result.exitCode
      });
    },
    async getServer(name) {
      const result = run(buildMcpGetArgs(name));
      record('get', name, result, result.exitCode === 0 ? null : mapErrorCode(result));
      if (result.exitCode !== 0) throwMcpCommandError(result);
      return parseMcpGetOutput({
        name,
        codexHome: input.codexHome.path,
        codexHomeMode: input.codexHome.mode,
        stdout: result.redactedStdout,
        stderr: result.redactedStderr,
        exitCode: result.exitCode
      });
    },
    async addServer(request) {
      requireWriteConfirmation(input.codexHome, request.confirmWriteToCodexHome === true);
      const supported = assertMcpAddRequestSupported(request, input.capabilities);
      if (!supported.ok) throw new Error(`${supported.code}: ${supported.message}`);
      const result = run(buildMcpAddArgs(request));
      const operation = record('add', request.name, result, mapErrorCode(result));
      if (result.exitCode !== 0) throwMcpCommandError(result);
      let server: CodexMcpServerResponse | undefined;
      try {
        server = await manager.getServer(request.name);
      } catch {
        server = undefined;
      }
      return { server, operation };
    },
    async removeServer(name, confirmed) {
      requireWriteConfirmation(input.codexHome, confirmed);
      const result = run(buildMcpRemoveArgs(name));
      const operation = record('remove', name, result, mapErrorCode(result));
      if (result.exitCode !== 0) throwMcpCommandError(result);
      return { removed: true, operation };
    },
    async loginServer(name, confirmed) {
      requireWriteConfirmation(input.codexHome, confirmed);
      const result = run(buildMcpLoginArgs(name));
      const operation = record('login', name, result, mapErrorCode(result));
      if (result.exitCode !== 0) throwMcpCommandError(result);
      return { operation };
    },
    async logoutServer(name, confirmed) {
      requireWriteConfirmation(input.codexHome, confirmed);
      const result = run(buildMcpLogoutArgs(name));
      const operation = record('logout', name, result, mapErrorCode(result));
      if (result.exitCode !== 0) throwMcpCommandError(result);
      return { operation };
    },
    listOperations(limit) {
      return operations.listOperations(limit);
    }
  };

  function run(args: string[]): McpCommandResult {
    return runMcpCommand({
      codexBin: input.codexBin,
      codexHome: input.codexHome.path,
      args,
      timeoutMs
    });
  }

  function record(
    operation: CodexMcpOperationResponse['operation'],
    serverName: string | null,
    result: McpCommandResult,
    errorCode?: string | null
  ): CodexMcpOperationResponse {
    return operations.insertOperation({
      operation,
      serverName,
      codexHome: input.codexHome.path,
      command: result.redactedCommand,
      status: result.exitCode === 0 ? 'succeeded' : 'failed',
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      errorCode: result.exitCode === 0 ? null : errorCode ?? 'MCP_COMMAND_FAILED',
      errorMessage: result.exitCode === 0 ? null : summarizeResult(result)
    });
  }

  return manager;
}

function requireWriteConfirmation(codexHome: ResolvedCodexHome, confirmed: boolean): void {
  if (codexHome.mode === 'global' && !confirmed) {
    throw new Error('MCP_WRITE_CONFIRMATION_REQUIRED: global CODEX_HOME MCP write requires confirmation');
  }
}

function mapErrorCode(result: McpCommandResult): string {
  if (isMcpNotFoundOutput(`${result.redactedStdout}\n${result.redactedStderr}`)) return 'MCP_SERVER_NOT_FOUND';
  return 'MCP_COMMAND_FAILED';
}

function throwMcpCommandError(result: McpCommandResult): never {
  const code = mapErrorCode(result);
  throw new Error(`${code}: ${summarizeResult(result)}`);
}

function summarizeResult(result: McpCommandResult): string {
  const output = `${result.redactedStdout}\n${result.redactedStderr}`.trim();
  return output.length === 0 ? `codex mcp exited with ${result.exitCode}` : output.split(/\r?\n/).slice(0, 8).join('\n');
}
```

- [ ] **Step 4: 运行测试和类型检查**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-mcp-manager.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/codex/mcp/manager.ts apps/daemon/test/unit/codex-mcp-manager.test.ts
git commit -m "feat: manage codex mcp commands"
```

---

### Task 7: MCP API routes 和 server wiring

**Files:**
- Create: `apps/daemon/src/api/routes.mcp.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Test: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 写 failing API integration test**

在 `apps/daemon/test/integration/api.test.ts` 的 skills API tests 附近增加：

```ts
  it('lists, adds, gets, removes, and logs codex mcp servers', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome,
      codexBin: fake.bin,
      capabilities: makeResumeCapableMatrix()
    });

    const empty = await authGet('/codex/mcp');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      requiresWriteConfirmation: false,
      servers: []
    });

    const added = await authPost('/codex/mcp/add', {
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'secret' }
    });
    expect(added.statusCode).toBe(201);
    expect(JSON.stringify(added.json())).not.toContain('secret');
    expect(added.json().server).toMatchObject({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      envKeys: ['GITHUB_TOKEN']
    });

    const got = await authGet('/codex/mcp/github');
    expect(got.statusCode).toBe(200);
    expect(got.json().server).toMatchObject({ name: 'github', status: 'configured' });

    const removed = await authDelete('/codex/mcp/github');
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ removed: true });

    const operations = await authGet('/codex/mcp/operations');
    expect(operations.statusCode).toBe(200);
    expect(operations.json().operations.map((operation: { operation: string }) => operation.operation)).toEqual([
      'remove',
      'get',
      'get',
      'add',
      'list'
    ]);
    expect(JSON.stringify(operations.json())).not.toContain('secret');
    expect(fake.readCommands()).toContain('mcp add github --env GITHUB_TOKEN=secret -- node server.js');
  });
```

把 `api.test.ts` 的 `node:fs` import 扩展为包含 `chmodSync` 和 `readFileSync`。

在文件底部增加 helper：

```ts
function createFakeMcpCodex(dir: string) {
  const bin = join(dir, 'fake-mcp-codex.js');
  const commandsPath = join(dir, 'mcp-commands.json');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const commandsPath = ${JSON.stringify(commandsPath)};
const commands = fs.existsSync(commandsPath) ? JSON.parse(fs.readFileSync(commandsPath, 'utf8')) : [];
const args = process.argv.slice(2);
commands.push(args.join(' '));
fs.writeFileSync(commandsPath, JSON.stringify(commands));
if (args.join(' ') === 'mcp list') {
  console.log(JSON.stringify([]));
  process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'add') process.exit(0);
if (args[0] === 'mcp' && args[1] === 'get' && args[2] === 'github') {
  console.log(JSON.stringify({ name: 'github', transport: 'stdio', command: 'node', args: ['server.js'], env: { GITHUB_TOKEN: '[REDACTED]' } }));
  process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'remove' && args[2] === 'github') process.exit(0);
if (args[0] === 'mcp' && (args[1] === 'login' || args[1] === 'logout') && args[2] === 'github') process.exit(0);
console.error('No MCP server named ' + (args[2] || 'unknown') + ' is configured');
process.exit(1);
`);
  chmodSync(bin, 0o755);
  return {
    bin,
    readCommands(): string[] {
      return JSON.parse(readFileSync(commandsPath, 'utf8')) as string[];
    }
  };
}
```

- [ ] **Step 2: 写 failing API edge tests**

在 `api.test.ts` 增加：

```ts
  it('requires explicit confirmation for global codex mcp writes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexBin: fake.bin, capabilities: makeResumeCapableMatrix() });

    const response = await authPost('/codex/mcp/add', {
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: [],
      env: {}
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('MCP_WRITE_CONFIRMATION_REQUIRED');
  });

  it('maps invalid and missing mcp API requests', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome,
      codexBin: fake.bin,
      capabilities: makeResumeCapableMatrix()
    });

    const invalid = await authPost('/codex/mcp/add', {
      name: 'bad name',
      transport: 'stdio',
      command: 'node'
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');

    const missing = await authGet('/codex/mcp/missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('MCP_SERVER_NOT_FOUND');
  });
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
```

Expected: 失败，因为 `/codex/mcp` routes 还没注册。

- [ ] **Step 4: 实现 routes**

创建 `apps/daemon/src/api/routes.mcp.ts`：

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { McpManager } from '../codex/mcp/manager.js';
import { isValidMcpName, validateMcpAddRequest } from '../codex/mcp/validator.js';
import { apiError } from './errors.js';

export async function registerMcpRoutes(server: FastifyInstance, input: { mcpManager: McpManager }): Promise<void> {
  server.get('/codex/mcp', async () => input.mcpManager.listServers());

  server.get<{ Querystring: { limit?: string } }>('/codex/mcp/operations', async (request) => {
    return { operations: input.mcpManager.listOperations(parseLimit(request.query.limit)) };
  });

  server.get<{ Params: { name: string } }>('/codex/mcp/:name', async (request, reply) => {
    if (!isValidMcpName(request.params.name)) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'name must be a valid MCP server name'));
    }
    try {
      const serverResponse = await input.mcpManager.getServer(request.params.name);
      return { server: serverResponse };
    } catch (error) {
      return sendMcpError(error, reply);
    }
  });

  server.post<{ Body: unknown }>('/codex/mcp/add', async (request, reply) => {
    const body = validateMcpAddRequest(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
    try {
      const result = await input.mcpManager.addServer(body.value);
      return reply.code(201).send(result);
    } catch (error) {
      return sendMcpError(error, reply);
    }
  });

  server.delete<{ Params: { name: string }; Querystring: { confirmWriteToCodexHome?: string } }>(
    '/codex/mcp/:name',
    async (request, reply) => {
      if (!isValidMcpName(request.params.name)) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'name must be a valid MCP server name'));
      }
      try {
        return await input.mcpManager.removeServer(
          request.params.name,
          request.query.confirmWriteToCodexHome === 'true'
        );
      } catch (error) {
        return sendMcpError(error, reply);
      }
    }
  );

  server.post<{ Params: { name: string }; Body: { confirmWriteToCodexHome?: true } }>(
    '/codex/mcp/:name/login',
    async (request, reply) => {
      if (!isValidMcpName(request.params.name)) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'name must be a valid MCP server name'));
      }
      try {
        return await input.mcpManager.loginServer(
          request.params.name,
          request.body?.confirmWriteToCodexHome === true
        );
      } catch (error) {
        return sendMcpError(error, reply);
      }
    }
  );

  server.post<{ Params: { name: string }; Body: { confirmWriteToCodexHome?: true } }>(
    '/codex/mcp/:name/logout',
    async (request, reply) => {
      if (!isValidMcpName(request.params.name)) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'name must be a valid MCP server name'));
      }
      try {
        return await input.mcpManager.logoutServer(
          request.params.name,
          request.body?.confirmWriteToCodexHome === true
        );
      } catch (error) {
        return sendMcpError(error, reply);
      }
    }
  );
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 200));
}

function sendMcpError(error: unknown, reply: FastifyReply) {
  const code = getCodexErrorCode(error);
  if (code === 'MCP_WRITE_CONFIRMATION_REQUIRED') {
    return reply.code(409).send(apiError(code, 'Global CODEX_HOME MCP write requires confirmation'));
  }
  if (code === 'MCP_SERVER_NOT_FOUND') {
    return reply.code(404).send(apiError(code, 'MCP server not found'));
  }
  if (code === 'MCP_SERVER_EXISTS') {
    return reply.code(409).send(apiError(code, 'MCP server already exists'));
  }
  if (code === 'MCP_SERVER_INVALID') {
    return reply.code(422).send(apiError(code, getErrorMessage(error, 'MCP server is invalid')));
  }
  if (code === 'CODEX_INCOMPATIBLE') {
    return reply.code(501).send(apiError(code, getErrorMessage(error, 'Codex does not support this MCP operation')));
  }
  return reply.code(502).send(apiError('MCP_COMMAND_FAILED', getErrorMessage(error, 'Codex MCP command failed')));
}

function getCodexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.split(':', 1)[0];
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
```

- [ ] **Step 5: 接入 server**

在 `apps/daemon/src/api/server.ts` 增加 import：

```ts
import { createMcpManager } from '../codex/mcp/manager.js';
import { registerMcpRoutes } from './routes.mcp.js';
```

在 `skillManager` 之后创建：

```ts
  const mcpManager = createMcpManager({
    codexBin,
    codexHome: resolvedCodexHome,
    db,
    capabilities
  });
```

在 `registerSkillRoutes` 之后注册：

```ts
  await registerMcpRoutes(server, { mcpManager });
```

- [ ] **Step 6: 运行测试和类型检查**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
pnpm typecheck
```

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/api/routes.mcp.ts apps/daemon/src/api/server.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: expose codex mcp API"
```

### Task 8: MCP API 边界、失败映射和能力门禁

**Files:**
- Modify: `apps/daemon/test/integration/api.test.ts`
- Modify: `apps/daemon/src/api/routes.mcp.ts`
- Modify: `apps/daemon/src/codex/mcp/manager.ts`
- Modify: `apps/daemon/src/codex/mcp/runner.ts`
- Modify: `apps/daemon/src/codex/mcp/redaction.ts`

- [ ] **Step 1: 增加 API 边界 failing tests**

在 `apps/daemon/test/integration/api.test.ts` 的 MCP describe block 中增加以下测试。测试使用现有 fake Codex binary helper；如果 helper 名称与当前文件不同，保留当前 helper，只替换 fake 输出和请求断言。

```ts
it('rejects unsupported URL transport flags without executing codex', async () => {
  const server = await buildTestServer({
    fakeCodex: {
      capabilities: makeResumeCapableMatrix({
        mcpList: true,
        mcpGet: true,
        mcpAdd: true,
        mcpRemove: true,
        mcpLogin: true,
        mcpLogout: true,
        mcpAddEnv: true,
        mcpAddUrl: false,
        mcpAddBearerTokenEnvVar: false,
        mcpAddOAuth: false,
        mcpRuntimeDiscoveryVerified: false,
        mcpRuntimeBehaviorVerified: false
      })
    }
  });

  const response = await server.inject({
    method: 'POST',
    url: '/codex/mcp/add',
    payload: {
      name: 'remote-search',
      transport: 'http',
      url: 'https://mcp.example.test/sse',
      confirmWriteToCodexHome: true
    }
  });

  expect(response.statusCode).toBe(501);
  expect(response.json()).toMatchObject({
    error: { code: 'CODEX_INCOMPATIBLE' }
  });
});

it('maps codex mcp command failure to MCP_COMMAND_FAILED', async () => {
  const server = await buildTestServer({
    fakeCodex: {
      mcpResponses: [
        {
          match: ['mcp', 'add', 'broken'],
          exitCode: 1,
          stderr: 'mcp add failed: invalid transport'
        }
      ]
    }
  });

  const response = await server.inject({
    method: 'POST',
    url: '/codex/mcp/add',
    payload: {
      name: 'broken',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      confirmWriteToCodexHome: true
    }
  });

  expect(response.statusCode).toBe(502);
  expect(response.json()).toMatchObject({
    error: { code: 'MCP_COMMAND_FAILED' }
  });
});

it('does not expose env values in add response or operation history', async () => {
  const server = await buildTestServer({
    fakeCodex: {
      mcpResponses: [
        {
          match: ['mcp', 'add', 'secret-server'],
          stdout: 'Added MCP server secret-server'
        },
        {
          match: ['mcp', 'get', 'secret-server'],
          stdout: [
            'secret-server',
            '  command: node',
            '  args: server.js',
            '  env: MCP_API_TOKEN=super-secret-value'
          ].join('\n')
        }
      ]
    }
  });

  const addResponse = await server.inject({
    method: 'POST',
    url: '/codex/mcp/add',
    payload: {
      name: 'secret-server',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { MCP_API_TOKEN: 'super-secret-value' },
      confirmWriteToCodexHome: true
    }
  });

  expect(addResponse.statusCode).toBe(200);
  expect(JSON.stringify(addResponse.json())).not.toContain('super-secret-value');
  expect(JSON.stringify(addResponse.json())).toContain('MCP_API_TOKEN');

  const historyResponse = await server.inject({
    method: 'GET',
    url: '/codex/mcp/operations?limit=10'
  });

  expect(historyResponse.statusCode).toBe(200);
  expect(JSON.stringify(historyResponse.json())).not.toContain('super-secret-value');
  expect(JSON.stringify(historyResponse.json())).toContain('[REDACTED]');
});

it('records login and logout operations', async () => {
  const server = await buildTestServer({
    fakeCodex: {
      mcpResponses: [
        { match: ['mcp', 'login', 'github'], stdout: 'Login complete' },
        { match: ['mcp', 'logout', 'github'], stdout: 'Logout complete' }
      ]
    }
  });

  const loginResponse = await server.inject({
    method: 'POST',
    url: '/codex/mcp/github/login',
    payload: { confirmWriteToCodexHome: true }
  });
  expect(loginResponse.statusCode).toBe(200);

  const logoutResponse = await server.inject({
    method: 'POST',
    url: '/codex/mcp/github/logout',
    payload: { confirmWriteToCodexHome: true }
  });
  expect(logoutResponse.statusCode).toBe(200);

  const historyResponse = await server.inject({
    method: 'GET',
    url: '/codex/mcp/operations?limit=10'
  });

  expect(historyResponse.statusCode).toBe(200);
  expect(historyResponse.json().operations.map((operation: { operation: string }) => operation.operation)).toEqual(
    expect.arrayContaining(['login', 'logout'])
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts
```

Expected: 至少一个新增测试失败，失败原因应落在能力门禁、错误映射、登录登出操作日志或脱敏断言。

- [ ] **Step 3: 补强 manager 能力门禁**

在 `apps/daemon/src/codex/mcp/manager.ts` 中确保 `addServer` 对 URL、bearer token env var 和 OAuth 参数逐项检查 capability。实现应使用前面 task 已定义的 `assertMcpCapability` 或同名本地 helper：

```ts
function assertCanAddServer(input: AddCodexMcpInput, capabilities: RuntimeCapabilityMatrix): void {
  if (!capabilities.mcpAdd) {
    throw new Error('CODEX_INCOMPATIBLE: codex mcp add is not supported');
  }

  if (input.transport === 'stdio') {
    return;
  }

  if (!capabilities.mcpAddUrl) {
    throw new Error('CODEX_INCOMPATIBLE: codex mcp add --url is not supported');
  }

  if (input.bearerTokenEnvVar && !capabilities.mcpAddBearerTokenEnvVar) {
    throw new Error('CODEX_INCOMPATIBLE: codex mcp add --bearer-token-env-var is not supported');
  }

  if ((input.oauthClientId || input.oauthResource) && !capabilities.mcpAddOAuth) {
    throw new Error('CODEX_INCOMPATIBLE: codex mcp add OAuth flags are not supported');
  }
}
```

在 `addServer` 校验确认写入之后、构造 argv 之前调用：

```ts
assertCanAddServer(input, dependencies.capabilities);
```

- [ ] **Step 4: 补强 runner 失败输出和脱敏**

在 `apps/daemon/src/codex/mcp/runner.ts` 中保证所有失败路径只抛出脱敏后的 message：

```ts
if (result.timedOut) {
  throw new Error(`MCP_COMMAND_FAILED: codex mcp command timed out after ${timeoutMs}ms`);
}

if (result.exitCode !== 0) {
  const message = redactMcpText([result.stderr, result.stdout].filter(Boolean).join('\n'));
  throw new Error(`MCP_COMMAND_FAILED: ${message || 'codex mcp command failed'}`);
}
```

在 `apps/daemon/src/codex/mcp/redaction.ts` 增加 bearer/authorization 和 token-like key 的覆盖：

```ts
const TOKEN_KEY_PATTERN = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)=([^\s]+)/gi;
const AUTH_HEADER_PATTERN = /\b(authorization|bearer)\s*[:=]\s*([^\s]+)/gi;

export function redactMcpText(value: string): string {
  return value
    .replace(TOKEN_KEY_PATTERN, '$1=[REDACTED]')
    .replace(AUTH_HEADER_PATTERN, '$1: [REDACTED]')
    .replace(/([?&](?:token|secret|key|api_key|access_token)=)[^&\s]+/gi, '$1[REDACTED]');
}
```

如果 `redactMcpText` 已存在，把上述规则并入现有实现，不删除已有 env value 精确脱敏逻辑。

- [ ] **Step 5: 补强 login/logout 操作日志**

在 `apps/daemon/src/codex/mcp/manager.ts` 中确认 `loginServer` 和 `logoutServer` 的成功与失败都会调用 operation repository。形态保持与 add/remove 一致：

```ts
await operations.recordOperation({
  operation: 'login',
  serverName: name,
  codexHome,
  command: redactMcpCommand(argv),
  status: 'succeeded',
  exitCode: 0,
  timedOut: false,
  errorCode: null,
  errorMessage: null,
  createdAt: nowIso()
});
```

失败路径记录：

```ts
await operations.recordOperation({
  operation: 'login',
  serverName: name,
  codexHome,
  command: redactMcpCommand(argv),
  status: 'failed',
  exitCode: result.exitCode ?? null,
  timedOut: result.timedOut,
  errorCode: 'MCP_COMMAND_FAILED',
  errorMessage: redactMcpText(result.stderr || result.stdout || 'codex mcp login failed'),
  createdAt: nowIso()
});
```

`logout` 使用相同字段，`operation` 改为 `'logout'`。

- [ ] **Step 6: 运行边界测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-mcp-redaction.test.ts test/unit/codex-mcp-manager.test.ts test/integration/api.test.ts
```

Expected: 全部通过，失败响应和 operation history 不包含 env value。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/codex/mcp/manager.ts apps/daemon/src/codex/mcp/runner.ts apps/daemon/src/codex/mcp/redaction.ts apps/daemon/src/api/routes.mcp.ts apps/daemon/test/integration/api.test.ts
git commit -m "test: cover codex mcp API boundaries"
```

### Task 9: Gated 真实 Codex MCP smoke

**Files:**
- Modify: `apps/daemon/test/smoke/real-codex-smoke.test.ts`

- [ ] **Step 1: 增加真实 Codex MCP smoke 测试**

在 `apps/daemon/test/smoke/real-codex-smoke.test.ts` 增加一个 gate off 默认 skip 的测试。测试必须使用临时 `CODEX_HOME`，不能写用户全局 `~/.codex`。

```ts
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

const RUN_REAL_CODEX_SMOKE = process.env.CLAWEE_RUN_REAL_CODEX_SMOKE === '1';

describe.skipIf(!RUN_REAL_CODEX_SMOKE)('real codex mcp smoke', () => {
  it('adds, gets, lists, and removes a stdio MCP server through codex mcp', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'clawee-r5-codex-home-'));
    const fixtureDir = await mkdtemp(join(tmpdir(), 'clawee-r5-mcp-'));
    const serverPath = join(fixtureDir, 'echo-mcp.js');

    await writeFile(
      serverPath,
      [
        '#!/usr/bin/env node',
        "process.stdin.resume();",
        "process.stdin.on('data', chunk => {",
        "  process.stdout.write(chunk);",
        "});"
      ].join('\n'),
      'utf8'
    );

    try {
      const env = {
        ...process.env,
        CODEX_HOME: codexHome
      };

      const addResult = await execa(
        'codex',
        [
          'mcp',
          'add',
          'clawee-r5-echo',
          '--env',
          'R5_SMOKE_VALUE=visible-smoke-value',
          '--',
          process.execPath,
          serverPath
        ],
        { env, reject: false }
      );
      expect(addResult.exitCode, addResult.stderr || addResult.stdout).toBe(0);

      const getResult = await execa('codex', ['mcp', 'get', 'clawee-r5-echo'], { env, reject: false });
      expect(getResult.exitCode, getResult.stderr || getResult.stdout).toBe(0);
      expect(getResult.stdout).toContain('clawee-r5-echo');
      expect(getResult.stdout).toContain('R5_SMOKE_VALUE');

      const listResult = await execa('codex', ['mcp', 'list'], { env, reject: false });
      expect(listResult.exitCode, listResult.stderr || listResult.stdout).toBe(0);
      expect(listResult.stdout).toContain('clawee-r5-echo');

      const removeResult = await execa('codex', ['mcp', 'remove', 'clawee-r5-echo'], { env, reject: false });
      expect(removeResult.exitCode, removeResult.stderr || removeResult.stdout).toBe(0);

      const getAfterRemove = await execa('codex', ['mcp', 'get', 'clawee-r5-echo'], { env, reject: false });
      expect(getAfterRemove.exitCode).not.toBe(0);
    } finally {
      await rm(codexHome, { recursive: true, force: true });
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
```

说明：这里故意使用 `visible-smoke-value`，它不是 secret。secret 脱敏由 fake Codex unit/integration tests 覆盖，避免真实 smoke fixture 把敏感值写到命令记录或失败输出中。

- [ ] **Step 2: 运行默认 smoke，确认 gate off 时不执行真实 Codex 写操作**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: 测试进程通过；新增 `real codex mcp smoke` describe 处于 skipped 状态。

- [ ] **Step 3: 运行 gated 真实 smoke**

Run:

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected:

- 如果本机 Codex CLI 支持 `mcp add/get/list/remove`：测试通过。
- 如果 Codex CLI 命令形态改变：测试失败，保留失败输出，更新 R5 覆盖报告为 `FAIL` 并记录命令形态差异。
- 如果本机 Codex 不在 PATH：测试失败，覆盖报告写 `BLOCKED_ENV`，原因是 `codex` executable unavailable。

- [ ] **Step 4: 记录真实模型 MCP 行为边界**

不要在 R5 smoke 中强制模型调用 MCP tool。若已有真实模型 smoke 因 auth 失败，维持 `BLOCKED_ENV`；若 auth 已恢复，可以另行手动验证模型调用，但 R5 验收只要求 `codex mcp add/get/list/remove` 命令路径通过。

在测试文件注释中加入：

```ts
// R5 verifies Codex MCP configuration management. Model-time MCP tool invocation
// remains a runtime behavior smoke and is recorded separately as BLOCKED_ENV
// when local Codex auth is unavailable.
```

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/test/smoke/real-codex-smoke.test.ts
git commit -m "test: add codex mcp real smoke"
```

### Task 10: 全量验证和覆盖报告

**Files:**
- Modify: `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md`

- [ ] **Step 1: 运行 R5 focused unit/integration suite**

Run:

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/mcp-argv.test.ts \
  test/unit/codex-mcp-validator.test.ts \
  test/unit/codex-mcp-redaction.test.ts \
  test/unit/codex-mcp-runner.test.ts \
  test/unit/codex-mcp-parser.test.ts \
  test/unit/codex-mcp-operations.test.ts \
  test/unit/codex-mcp-manager.test.ts \
  test/unit/storage.test.ts \
  test/unit/codex-capabilities.test.ts \
  test/integration/api.test.ts
```

Expected: 全部通过。

- [ ] **Step 2: 运行项目级验证**

Run:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Expected:

- `pnpm typecheck` 通过。
- `pnpm test` 通过。
- `git diff --check` 无 whitespace error。

- [ ] **Step 3: 运行 gated 真实 Codex smoke**

Run:

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: 真实 Codex smoke 通过，或明确得到 `BLOCKED_ENV`/`FAIL` 结论。不能把未执行或失败的真实 smoke 写成通过。

- [ ] **Step 4: 更新覆盖报告**

在 `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md` 的 R5 区域更新为下列结构。若真实 smoke 通过，使用 `PASS`；若环境阻塞，使用 `BLOCKED_ENV` 并写明阻塞命令。

```md
### R5 MCP pass-through

Status: PASS

Scope:
- MCP 管理 API：PASS
- fake Codex MCP command coverage：PASS
- env value API/log/diagnostics 脱敏：PASS
- SQLite MCP 操作审计：PASS
- real codex mcp add/get/list/remove：PASS
- real model MCP behavior：UNVERIFIED_BEHAVIOR

Verification:
- `pnpm --filter @clawee/daemon test -- test/unit/mcp-argv.test.ts test/unit/codex-mcp-validator.test.ts test/unit/codex-mcp-redaction.test.ts test/unit/codex-mcp-runner.test.ts test/unit/codex-mcp-parser.test.ts test/unit/codex-mcp-operations.test.ts test/unit/codex-mcp-manager.test.ts test/unit/storage.test.ts test/unit/codex-capabilities.test.ts test/integration/api.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `git diff --check`
- `CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts`

Notes:
- R5 不实现自研 MCP runtime。
- R5 不托管 MCP server 进程。
- R5 不要求真实模型成功调用 MCP tool；该项归入后续 runtime behavior smoke。
```

如果真实 smoke 被环境阻塞，使用：

```md
Status: PARTIAL/BLOCKED_ENV

Scope:
- MCP 管理 API：PASS
- fake Codex MCP command coverage：PASS
- env value API/log/diagnostics 脱敏：PASS
- SQLite MCP 操作审计：PASS
- real codex mcp add/get/list/remove：BLOCKED_ENV
- real model MCP behavior：UNVERIFIED_BEHAVIOR

Blocked:
- `CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts`
- 原因：`codex executable unavailable`、`Codex CLI command shape incompatible` 或 `Codex CLI auth unavailable` 中与实际失败一致的一项；同时保留失败命令的 stderr/stdout 摘要。
```

- [ ] **Step 5: 提交覆盖报告**

```bash
git add docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md
git commit -m "docs: update R5 mcp coverage status"
```

## Self-review checklist

在开始执行本计划前，实施者必须完成下列检查：

- [ ] R5 的实现只封装 `codex mcp` 原生命令，没有自研 MCP runtime。
- [ ] `add/remove/login/logout` 对全局 `CODEX_HOME` 写入要求 `confirmWriteToCodexHome: true`。
- [ ] `list/get` 不要求写入确认。
- [ ] env value 不出现在 API response、operation history、stderr/stdout diagnostics、测试 fixture raw 输出中。
- [ ] URL、bearer token env var、OAuth 参数全部受 capability matrix gate 控制。
- [ ] SQLite 只保存 MCP operation log，不保存 MCP server 配置真相源。
- [ ] fake Codex 覆盖成功、失败、超时、not found、不可解析输出和脱敏。
- [ ] gated 真实 Codex smoke 使用临时 `CODEX_HOME`，不写用户全局 `~/.codex`。
- [ ] R5 覆盖报告区分 `PASS`、`PARTIAL/BLOCKED_ENV`、`FAIL`、`UNVERIFIED_BEHAVIOR`。
- [ ] 每个 task 完成后单独 commit；不要把用户已有文档脏改动混入提交。
