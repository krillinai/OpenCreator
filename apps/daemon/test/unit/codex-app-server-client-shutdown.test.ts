import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodexAppServerClient } from '../../src/codex/app-server-client.js';
import { spawnCodexProcess, terminateCodexProcess } from '../../src/codex/process.js';

vi.mock('../../src/codex/process.js', () => ({
  spawnCodexProcess: vi.fn(),
  terminateCodexProcess: vi.fn(async () => undefined)
}));

function createChild(pid: number) {
  const child = Object.assign(new EventEmitter(), {
    pid,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new Writable({
      write(chunk, _encoding, callback) {
        const message = JSON.parse(String(chunk)) as { id?: string; method: string };
        if (message.id !== undefined && message.method !== 'hang') {
          queueMicrotask(() => child.stdout.write(`${JSON.stringify({
            id: message.id,
            result: { pid }
          })}\n`));
        }
        callback();
      }
    })
  });
  return child as typeof child & ChildProcessWithoutNullStreams;
}

describe('Codex app-server shutdown with inherited pipes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.mocked(spawnCodexProcess).mockReset();
    vi.mocked(terminateCodexProcess).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finishes restart when the parent exits but descendants keep its pipes open', async () => {
    const oldChild = createChild(101);
    const nextChild = createChild(102);
    vi.mocked(spawnCodexProcess).mockReturnValueOnce(oldChild).mockReturnValueOnce(nextChild);
    vi.mocked(terminateCodexProcess).mockImplementation(async child => {
      Object.defineProperty(child, 'exitCode', { value: 0, writable: true });
      child.emit('exit', 0, null);
      // No close event: a descendant still owns an inherited stdout/stderr handle.
    });
    const client = createCodexAppServerClient({ codexBin: 'codex', codexHome: 'test-home' });
    await expect(client.request('config/read', {})).resolves.toEqual({ pid: 101 });

    let restarted = false;
    const restart = client.restart().then(() => { restarted = true; });
    await vi.advanceTimersByTimeAsync(0);

    expect(restarted).toBe(true);
    await restart;
    expect(oldChild.stdin.destroyed).toBe(true);
    expect(oldChild.stdout.destroyed).toBe(true);
    expect(oldChild.stderr.destroyed).toBe(true);
    await expect(client.request('config/read', {})).resolves.toEqual({ pid: 102 });
    const close = client.close();
    await vi.advanceTimersByTimeAsync(0);
    await close;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects pending requests on parent exit without waiting for pipe closure', async () => {
    const child = createChild(103);
    vi.mocked(spawnCodexProcess).mockReturnValue(child);
    const client = createCodexAppServerClient({ codexBin: 'codex', codexHome: 'test-home' });
    await client.request('config/read', {});
    let failure: Error | undefined;
    const pending = client.request('hang', {}).catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(0);

    child.exitCode = 1;
    child.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(5000);

    expect(failure?.message).toContain('exit code 1');
    await pending;
    expect(child.stdout.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects shutdown within a bounded time if forced termination cannot stop the process', async () => {
    const child = createChild(104);
    vi.mocked(spawnCodexProcess).mockReturnValue(child);
    const client = createCodexAppServerClient({ codexBin: 'codex', codexHome: 'test-home' });
    await client.request('config/read', {});
    let failure: Error | undefined;
    const close = client.close().catch(error => { failure = error; });

    await vi.advanceTimersByTimeAsync(5000);

    expect(failure?.message).toContain('did not exit');
    await close;
    expect(terminateCodexProcess).toHaveBeenCalledWith(child, 'SIGKILL');
    expect(child.stdout.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
