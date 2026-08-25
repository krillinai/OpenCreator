import { describe, expect, it } from 'vitest';

describe('codex runtime public contract', () => {
  it('keeps readiness and account states runtime-neutral', async () => {
    const protocol = await import('../src/index.js');

    expect(protocol.codexRuntimeModes).toEqual(['bundled', 'external']);
    expect(protocol.codexRuntimeReadinessStates).toEqual(['ready', 'degraded', 'blocked']);
    expect(protocol.codexRuntimeComponentStatuses).toEqual([
      'ready',
      'missing',
      'invalid',
      'unavailable',
      'not_authenticated',
      'not_checked'
    ]);
    expect(protocol.codexAccountStatuses).toEqual([
      'signed_out',
      'authenticating',
      'signed_in',
      'expired',
      'unavailable'
    ]);
  });

  it('does not export app-server JSON-RPC method types through the creator contract', async () => {
    const protocol = await import('../src/index.js');

    expect('ThreadStartParams' in protocol).toBe(false);
    expect('TurnStartParams' in protocol).toBe(false);
    expect('JsonRpcRequest' in protocol).toBe(false);
  });
});
