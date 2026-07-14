import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startCodexAppServer } from '../../src/codex/app-server-runner.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex app-server runner', () => {
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
        command: '/usr/bin/node',
        args: ['/app/agent-tools/stdio-server.js'],
        envVars: [
          'CLAWEE_AGENT_TOOL_URL',
          'CLAWEE_AGENT_CAPABILITY_TOKEN'
        ],
        enabledTools: ['clawee_schedule_get'],
        required: true
      }],
      env: {
        CLAWEE_AGENT_TOOL_URL: 'http://127.0.0.1:43123',
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
      'mcp_servers.clawee_schedule.enabled_tools=["clawee_schedule_get"]',
      'app-server',
      '--stdio'
    ]));
    expect(JSON.stringify(argv)).not.toContain(token);
    expect(JSON.stringify(argv)).not.toContain('127.0.0.1');
    expect(env).toEqual({
      CLAWEE_AGENT_TOOL_URL: 'http://127.0.0.1:43123',
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
  CLAWEE_AGENT_TOOL_URL: process.env.CLAWEE_AGENT_TOOL_URL,
  CLAWEE_AGENT_CAPABILITY_TOKEN: process.env.CLAWEE_AGENT_CAPABILITY_TOKEN
}));
const rl = readline.createInterface({ input: process.stdin });
let approvalRequestId = 'approval-rpc-1';
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: process.env.CODEX_HOME, platformFamily: 'unix', platformOs: 'test' } });
    return;
  }
  if (message.method === 'thread/start') {
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
