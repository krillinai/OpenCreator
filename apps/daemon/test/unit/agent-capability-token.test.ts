import { describe, expect, it, vi } from 'vitest';
import {
  AgentCapabilityTokenError,
  createAgentCapabilityTokenStore
} from '../../src/agent-tools/capability-token.js';

describe('agent capability token store', () => {
  it('binds a token to one run, thread, and explicit scope set', () => {
    const store = createAgentCapabilityTokenStore();
    const issued = store.issue({
      runId: 'run-1',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get', 'schedule:update']
    });

    expect(issued.token).toMatch(/^clwcap_[A-Za-z0-9_-]+$/);
    expect(store.authorize(issued.token, {
      scope: 'schedule:get',
      runId: 'run-1',
      threadId: 'thread-1'
    })).toMatchObject({
      runId: 'run-1',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get', 'schedule:update']
    });

    expectCapabilityError(
      () => store.authorize(issued.token, { scope: 'schedule:create' }),
      'CAPABILITY_SCOPE_FORBIDDEN',
      403
    );
    expectCapabilityError(
      () => store.authorize(issued.token, {
        scope: 'schedule:get',
        runId: 'run-2'
      }),
      'CAPABILITY_RUN_FORBIDDEN',
      403
    );
    expectCapabilityError(
      () => store.authorize(issued.token, {
        scope: 'schedule:get',
        threadId: 'thread-2'
      }),
      'CAPABILITY_THREAD_FORBIDDEN',
      403
    );

    store.close();
  });

  it('rejects missing, malformed, expired, revoked, and closed tokens', () => {
    let now = 1_000;
    const store = createAgentCapabilityTokenStore({
      clock: { now: () => now },
      ttlMs: 500
    });
    const expired = store.issue({
      runId: 'run-expired',
      threadId: 'thread-expired',
      createdBy: 'api',
      scopes: ['schedule:get']
    });

    expectCapabilityError(
      () => store.authorize(undefined, { scope: 'schedule:get' }),
      'CAPABILITY_TOKEN_MISSING',
      401
    );
    expectCapabilityError(
      () => store.authorize('not-a-capability', { scope: 'schedule:get' }),
      'CAPABILITY_TOKEN_INVALID',
      401
    );

    now = 1_501;
    expectCapabilityError(
      () => store.authorize(expired.token, { scope: 'schedule:get' }),
      'CAPABILITY_TOKEN_EXPIRED',
      401
    );

    const revoked = store.issue({
      runId: 'run-revoked',
      threadId: 'thread-revoked',
      createdBy: 'api',
      scopes: ['schedule:get']
    });
    expect(store.revokeRun('run-revoked')).toBe(1);
    expectCapabilityError(
      () => store.authorize(revoked.token, { scope: 'schedule:get' }),
      'CAPABILITY_TOKEN_REVOKED',
      401
    );

    store.close();
    expectCapabilityError(
      () => store.authorize(revoked.token, { scope: 'schedule:get' }),
      'CAPABILITY_TOKEN_INVALID',
      401
    );
  });

  it('does not grant mutation scopes to automatic schedule runs', () => {
    const store = createAgentCapabilityTokenStore();

    expect(() => store.issue({
      runId: 'run-schedule',
      threadId: 'thread-schedule',
      createdBy: 'schedule',
      scopes: ['schedule:get']
    })).not.toThrow();
    expectCapabilityError(
      () => store.issue({
        runId: 'run-schedule',
        threadId: 'thread-schedule',
        createdBy: 'schedule',
        scopes: ['schedule:update']
      }),
      'CAPABILITY_SCOPE_FORBIDDEN',
      403
    );

    store.close();
  });

  it('uses an unref cleanup timer and clears it on close', () => {
    const unref = vi.fn();
    const clearInterval = vi.fn();
    const handle = { unref };
    const store = createAgentCapabilityTokenStore({
      timers: {
        setInterval: vi.fn(() => handle),
        clearInterval
      }
    });

    expect(unref).toHaveBeenCalledTimes(1);
    store.close();
    store.close();
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });
});

function expectCapabilityError(
  operation: () => unknown,
  code: AgentCapabilityTokenError['code'],
  statusCode: number
): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AgentCapabilityTokenError);
    expect(error).toMatchObject({ code, statusCode });
  }
}
