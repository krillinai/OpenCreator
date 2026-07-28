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
    expect(store.inspect(issued.token)).toMatchObject({
      runId: 'run-1',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get', 'schedule:update']
    });
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
      () => store.inspect(undefined),
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

  it('keeps a process lease inactive until one user run is activated', () => {
    const store = createAgentCapabilityTokenStore();
    const lease = store.issueProcess({
      createdBy: 'api',
      maxScopes: ['schedule:get', 'schedule:update']
    });

    expect(lease.token).toMatch(/^clwcap_[A-Za-z0-9_-]+$/);
    expectCapabilityError(
      () => store.inspect(lease.token),
      'CAPABILITY_CONTEXT_INACTIVE',
      403
    );

    const grant = lease.activate({
      runId: 'run-1',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get']
    });
    expect(grant).toMatchObject({
      runId: 'run-1',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get']
    });
    expect(store.authorize(lease.token, {
      scope: 'schedule:get',
      runId: 'run-1',
      threadId: 'thread-1'
    })).toMatchObject({
      runId: 'run-1',
      threadId: 'thread-1'
    });
    expectCapabilityError(
      () => lease.activate({
        runId: 'run-2',
        threadId: 'thread-2',
        createdBy: 'api',
        scopes: ['schedule:get']
      }),
      'CAPABILITY_CONTEXT_ACTIVE',
      409
    );
    expectCapabilityError(
      () => store.authorize(lease.token, { scope: 'schedule:update' }),
      'CAPABILITY_SCOPE_FORBIDDEN',
      403
    );
    expectCapabilityError(
      () => lease.activate({
        runId: 'run-2',
        threadId: 'thread-2',
        createdBy: 'api',
        scopes: ['schedule:create']
      }),
      'CAPABILITY_CONTEXT_ACTIVE',
      409
    );

    expect(lease.deactivate('run-other')).toBe(false);
    expect(lease.deactivate('run-1')).toBe(true);
    expectCapabilityError(
      () => store.inspect(lease.token),
      'CAPABILITY_CONTEXT_INACTIVE',
      403
    );
    store.close();
  });

  it('reuses one process token without leaking a previous run binding', () => {
    const store = createAgentCapabilityTokenStore();
    const lease = store.issueProcess({
      createdBy: 'api',
      maxScopes: ['schedule:get', 'schedule:update']
    });

    lease.activate({
      runId: 'run-1',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get']
    });
    expect(lease.deactivate('run-1')).toBe(true);
    lease.activate({
      runId: 'run-2',
      threadId: 'thread-2',
      createdBy: 'api',
      scopes: ['schedule:update']
    });

    expect(lease.deactivate('run-1')).toBe(false);
    expect(store.inspect(lease.token)).toMatchObject({
      runId: 'run-2',
      threadId: 'thread-2',
      scopes: ['schedule:update']
    });
    expect(store.revokeRun('run-1')).toBe(0);
    expect(store.revokeRun('run-2')).toBe(1);
    expectCapabilityError(
      () => store.inspect(lease.token),
      'CAPABILITY_CONTEXT_INACTIVE',
      403
    );
    store.close();
  });

  it('keeps the process token after an active grant expires', () => {
    let now = 1_000;
    const store = createAgentCapabilityTokenStore({
      clock: { now: () => now },
      ttlMs: 500
    });
    const lease = store.issueProcess({
      createdBy: 'api',
      maxScopes: ['schedule:get']
    });

    lease.activate({
      runId: 'run-1',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get']
    });
    now = 1_501;
    expectCapabilityError(
      () => store.inspect(lease.token),
      'CAPABILITY_CONTEXT_INACTIVE',
      403
    );

    lease.activate({
      runId: 'run-2',
      threadId: 'thread-2',
      createdBy: 'api',
      scopes: ['schedule:get']
    });
    expect(store.inspect(lease.token)).toMatchObject({
      runId: 'run-2',
      threadId: 'thread-2'
    });
    expect(lease.revoke()).toBe(true);
    expect(lease.revoke()).toBe(false);
    expectCapabilityError(
      () => store.inspect(lease.token),
      'CAPABILITY_TOKEN_INVALID',
      401
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
