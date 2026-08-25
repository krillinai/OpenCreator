import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerResponseError } from '../../src/codex/app-server-client.js';
import { createCodexRuntimeReadiness } from '../../src/codex/runtime-readiness.js';

describe('Codex Runtime Readiness', () => {
  it('reports signed-out account separately from runtime compatibility', async () => {
    const methods: string[] = [];
    const readiness = createCodexRuntimeReadiness({
      client: fakeClient(async method => {
        methods.push(method);
        if (method === 'model/list') return { data: [{ id: 'gpt-5' }], nextCursor: null };
        if (method === 'skills/list') return { data: [] };
        if (method === 'account/read') return { account: null, requiresOpenaiAuth: true };
        throw new Error(`Unexpected method: ${method}`);
      }),
      mode: 'bundled',
      version: '0.149.0',
      commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
      binaryPath: 'D:/runtime/bin/codex.exe',
      codexHome: 'D:/user/runtime/codex/home',
      cwd: 'D:/creator',
      checkToolServer: () => ({ status: 'ready' }),
      now: () => '2026-08-21T00:00:00.000Z'
    });

    const result = await readiness.refresh();

    expect(methods).toEqual(['model/list', 'skills/list', 'account/read']);
    expect(result).toMatchObject({
      state: 'degraded',
      binary: { status: 'ready' },
      protocol: { status: 'ready' },
      models: { status: 'ready' },
      skills: { status: 'ready' },
      account: { status: 'not_authenticated', accountStatus: 'signed_out' },
      toolServer: { status: 'ready' }
    });
  });

  it('blocks the runtime when a required app-server method is absent', async () => {
    const readiness = createCodexRuntimeReadiness({
      client: fakeClient(async method => {
        if (method === 'model/list') {
          throw new CodexAppServerResponseError('Method not found', -32601);
        }
        if (method === 'skills/list') return { data: [] };
        return { account: null, requiresOpenaiAuth: true };
      }),
      mode: 'bundled',
      version: '0.149.0',
      commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
      binaryPath: 'D:/runtime/bin/codex.exe',
      codexHome: 'D:/user/runtime/codex/home',
      cwd: 'D:/creator',
      checkToolServer: () => ({ status: 'ready' })
    });

    await expect(readiness.refresh()).resolves.toMatchObject({
      state: 'blocked',
      protocol: {
        status: 'invalid',
        errorCode: 'codex_runtime_protocol_incompatible'
      }
    });
  });

  it('maps login, cancel, account read and logout through app-server', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'account/login/start') {
        return { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.example.test' };
      }
      if (method === 'account/login/cancel') return { status: 'canceled' };
      if (method === 'account/logout') return {};
      if (method === 'account/read') {
        return {
          account: { type: 'chatgpt', email: 'creator@example.test', planType: 'plus' },
          requiresOpenaiAuth: true
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const readiness = createCodexRuntimeReadiness({
      client: fakeClient(request),
      mode: 'bundled',
      version: '0.149.0',
      commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
      binaryPath: 'D:/runtime/bin/codex.exe',
      codexHome: 'D:/user/runtime/codex/home',
      cwd: 'D:/creator'
    });

    await expect(readiness.startLogin({ loginType: 'chatgpt' })).resolves.toEqual({
      loginId: 'login-1',
      status: 'pending',
      authUrl: 'https://auth.example.test'
    });
    await expect(readiness.cancelLogin({ loginId: 'login-1' })).resolves.toEqual({
      loginId: 'login-1',
      canceled: true
    });
    await expect(readiness.readAccount()).resolves.toMatchObject({
      account: {
        status: 'ready',
        accountStatus: 'signed_in',
        account: { email: 'creator@example.test', plan: 'plus' }
      }
    });
    await expect(readiness.logout()).resolves.toEqual({ signedOut: true });
  });
});

function fakeClient(
  request: (method: string, params: unknown) => Promise<unknown>
) {
  return {
    request: request as <Result>(method: string, params: unknown) => Promise<Result>,
    close: async () => undefined
  };
}
