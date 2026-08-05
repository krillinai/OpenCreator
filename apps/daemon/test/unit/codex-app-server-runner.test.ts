import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startCodexAppServer } from '../../src/codex/app-server-runner.js';
import { buildCodexAppServerArgs } from '../../src/codex/app-server-host-2026-07-28.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex app-server runner', () => {
  it('places knowledge isolation flags before the app-server subcommand', () => {
    const args = buildCodexAppServerArgs({
      profile: 'default',
      builtInTools: {
        shell: false,
        fileRead: false,
        fileWrite: false,
        applyPatch: false,
        webSearch: false
      },
      mcpServers: [{
        name: 'clawee_knowledge',
        url: 'http://127.0.0.1:43123/internal/agent-tools/mcp/knowledge',
        enabledTools: ['knowledge.search'],
        required: true
      }]
    });

    expect(args).not.toContain('--ignore-user-config');
    expect(args.slice(-2)).toEqual(['app-server', '--stdio']);
    expect(args).toContain('mcp_servers.clawee_knowledge.enabled_tools=["knowledge.search"]');
  });

  it('responds to a real command approval request and completes the turn', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeAppServer(tempDir, 'accept');
    const seen: unknown[] = [];
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      prompt: 'run command',
      onNotification(notification) {
        seen.push(notification);
      },
      async onApprovalRequest(request) {
        expect(request.method).toBe('item/commandExecution/requestApproval');
        return 'approved';
      }
    });

    const result = await process.result;

    expect(result).toMatchObject({
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      turnStatus: 'completed',
      terminationReason: 'completed'
    });
    expect(seen).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'turn/started' }),
      expect.objectContaining({ method: 'turn/completed' })
    ]));
  });

  it('maps rejection to the official decline response', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeAppServer(tempDir, 'decline');
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      prompt: 'run command',
      async onApprovalRequest() {
        return 'rejected';
      }
    });

    await expect(process.result).resolves.toMatchObject({
      turnStatus: 'completed',
      terminationReason: 'completed'
    });
  });

  it('uses never approval policy and auto-approves fallback requests for full access', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeAppServer(tempDir, 'accept');
    let approvalRequested = false;
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'danger-full-access',
      prompt: 'run command without approval',
      async onApprovalRequest() {
        approvalRequested = true;
        return 'rejected';
      }
    });

    await expect(process.result).resolves.toMatchObject({
      turnStatus: 'completed',
      terminationReason: 'completed'
    });
    expect(approvalRequested).toBe(false);
    expect(readAppServerRequests(tempDir)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'thread/start',
        params: expect.objectContaining({
          sandbox: 'danger-full-access',
          approvalPolicy: 'never'
        })
      }),
      expect.objectContaining({
        method: 'turn/start',
        params: expect.objectContaining({
          approvalPolicy: 'never'
        })
      })
    ]));
  });

  it('uses never approval policy when resuming a full-access thread', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeAppServer(tempDir, 'accept');
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'danger-full-access',
      prompt: 'resume without approval',
      codexThreadId: 'codex-thread-existing'
    });

    await expect(process.result).resolves.toMatchObject({
      turnStatus: 'completed'
    });
    expect(readAppServerRequests(tempDir)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'thread/resume',
        params: expect.objectContaining({
          threadId: 'codex-thread-existing',
          sandbox: 'danger-full-access',
          approvalPolicy: 'never'
        })
      })
    ]));
  });

  it('responds to an MCP elicitation approval with the official accept payload', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeMcpElicitationAppServer(tempDir, 'accept');
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      prompt: 'create a schedule',
      inactivityTimeoutMs: 5_000,
      async onApprovalRequest(request) {
        expect(request).toMatchObject({
          method: 'mcpServer/elicitation/request',
          params: {
            serverName: 'clawee_schedule',
            mode: 'form'
          }
        });
        return 'approved';
      }
    });

    await expect(process.result).resolves.toMatchObject({
      turnStatus: 'completed',
      terminationReason: 'completed'
    });
  });

  it('auto-accepts MCP tool elicitation without creating an approval in full-access mode', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeMcpElicitationAppServer(tempDir, 'accept');
    let approvalRequested = false;
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'danger-full-access',
      prompt: 'create a schedule without approval',
      inactivityTimeoutMs: 5_000,
      async onApprovalRequest() {
        approvalRequested = true;
        return 'rejected';
      }
    });

    await expect(process.result).resolves.toMatchObject({
      turnStatus: 'completed',
      terminationReason: 'completed'
    });
    expect(approvalRequested).toBe(false);
  });

  it('maps MCP elicitation rejection to the official decline payload', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeMcpElicitationAppServer(tempDir, 'decline');
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      prompt: 'create a schedule',
      inactivityTimeoutMs: 5_000,
      async onApprovalRequest() {
        return 'rejected';
      }
    });

    await expect(process.result).resolves.toMatchObject({
      turnStatus: 'completed',
      terminationReason: 'completed'
    });
  });

  it('cancels unsupported MCP form elicitation without treating it as an approval', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeMcpElicitationAppServer(tempDir, 'cancel', false);
    let approvalRequested = false;
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      prompt: 'request user input',
      inactivityTimeoutMs: 5_000,
      async onApprovalRequest() {
        approvalRequested = true;
        return 'approved';
      }
    });

    await expect(process.result).resolves.toMatchObject({
      turnStatus: 'completed',
      terminationReason: 'completed'
    });
    expect(approvalRequested).toBe(false);
  });

  it('passes MCP config in argv and capability secrets only in the child environment', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-'));
    const fake = createFakeAppServer(tempDir, 'decline');
    const token = 'clwcap_AppServerSecret';
    const process = startCodexAppServer({
      codexBin: fake,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      prompt: 'inspect environment',
      mcpServers: [{
        name: 'clawee_schedule',
        url: 'http://127.0.0.1:43123/internal/agent-tools/mcp',
        bearerTokenEnvVar: 'CLAWEE_AGENT_CAPABILITY_TOKEN',
        enabledTools: ['clawee_schedule_get'],
        required: true
      }],
      env: {
        CLAWEE_AGENT_CAPABILITY_TOKEN: token
      },
      async onApprovalRequest() {
        return 'rejected';
      }
    });

    await expect(process.result).resolves.toMatchObject({
      turnStatus: 'completed'
    });
    const argv = JSON.parse(
      readFileSync(join(tempDir, 'app-server-argv.json'), 'utf8')
    ) as string[];
    const env = JSON.parse(
      readFileSync(join(tempDir, 'app-server-env.json'), 'utf8')
    ) as Record<string, string>;

    expect(argv).toEqual(expect.arrayContaining([
      '-c',
      'mcp_servers.clawee_schedule.url="http://127.0.0.1:43123/internal/agent-tools/mcp"',
      '-c',
      'mcp_servers.clawee_schedule.bearer_token_env_var="CLAWEE_AGENT_CAPABILITY_TOKEN"',
      '-c',
      'mcp_servers.clawee_schedule.enabled_tools=["clawee_schedule_get"]',
      'app-server',
      '--stdio'
    ]));
    expect(JSON.stringify(argv)).not.toContain(token);
    expect(env).toEqual({
      CLAWEE_AGENT_CAPABILITY_TOKEN: token
    });
  });
});

function createFakeAppServer(dir: string, expectedDecision: 'accept' | 'decline'): string {
  const bin = join(dir, 'fake-codex.js');
  writeFileSync(bin, `#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(join(dir, 'app-server-argv.json'))}, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(${JSON.stringify(join(dir, 'app-server-env.json'))}, JSON.stringify({
  CLAWEE_AGENT_CAPABILITY_TOKEN: process.env.CLAWEE_AGENT_CAPABILITY_TOKEN
}));
const rl = readline.createInterface({ input: process.stdin });
let approvalRequestId = 'approval-rpc-1';
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const message = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(join(dir, 'app-server-messages.ndjson'))}, JSON.stringify(message) + '\\n');
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: process.env.CODEX_HOME, platformFamily: 'unix', platformOs: 'test' } });
    return;
  }
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    send({ id: message.id, result: { thread: { id: 'codex-thread-1' } } });
    return;
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: 'codex-thread-1', turn: { id: 'turn-1', status: 'inProgress' } } });
    send({
      id: approvalRequestId,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        startedAtMs: Date.now(),
        command: 'rm -rf build',
        cwd: process.cwd(),
        reason: 'test'
      }
    });
    return;
  }
  if (message.id === approvalRequestId) {
    const expected = ${JSON.stringify(expectedDecision)};
    if (!message.result || message.result.decision !== expected) {
      process.stderr.write('unexpected approval response\\n');
      process.exit(2);
      return;
    }
    send({ method: 'serverRequest/resolved', params: { threadId: 'codex-thread-1', requestId: approvalRequestId } });
    send({ method: 'turn/completed', params: { threadId: 'codex-thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  }
});
`, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function readAppServerRequests(dir: string): Array<Record<string, unknown>> {
  return readFileSync(join(dir, 'app-server-messages.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

function createFakeMcpElicitationAppServer(
  dir: string,
  expectedAction: 'accept' | 'decline' | 'cancel',
  approvalRequest = true
): string {
  const bin = join(dir, 'fake-mcp-elicitation-codex.js');
  writeFileSync(bin, `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const requestId = 'mcp-approval-rpc-1';
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: process.env.CODEX_HOME, platformFamily: 'unix', platformOs: 'test' } });
    return;
  }
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'codex-thread-mcp' } } });
    return;
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-mcp', status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: 'codex-thread-mcp', turn: { id: 'turn-mcp', status: 'inProgress' } } });
    send({
      id: requestId,
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'codex-thread-mcp',
        turnId: 'turn-mcp',
        serverName: 'clawee_schedule',
        mode: 'form',
        _meta: {
          ${approvalRequest ? "codex_approval_kind: 'mcp_tool_call'," : ''}
          message: 'Allow the clawee_schedule MCP server to run tool "clawee_schedule_create"?',
          tool_description: '创建一个 Clawee 定时任务。',
          tool_params: {
            name: '武汉天气每5分钟简报'
          }
        },
        requestedSchema: {
          type: 'object',
          properties: {}
        }
      }
    });
    return;
  }
  if (message.id === requestId) {
    const expectedAction = ${JSON.stringify(expectedAction)};
    const expectedContent = expectedAction === 'accept' ? {} : null;
    if (
      !message.result
      || message.result.action !== expectedAction
      || JSON.stringify(message.result.content) !== JSON.stringify(expectedContent)
      || message.result._meta !== null
    ) {
      process.stderr.write('unexpected MCP elicitation response: ' + JSON.stringify(message) + '\\n');
      process.exit(2);
      return;
    }
    send({ method: 'serverRequest/resolved', params: { threadId: 'codex-thread-mcp', requestId } });
    send({ method: 'turn/completed', params: { threadId: 'codex-thread-mcp', turn: { id: 'turn-mcp', status: 'completed' } } });
  }
});
`, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}
