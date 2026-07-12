import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
});

function createFakeAppServer(dir: string, expectedDecision: 'accept' | 'decline'): string {
  const bin = join(dir, 'fake-codex.js');
  writeFileSync(bin, `#!/usr/bin/env node
const readline = require('node:readline');
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
