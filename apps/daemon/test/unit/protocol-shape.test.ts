import { describe, expect, it } from 'vitest';
import type { AgentEventEnvelope, RunRequest, RuntimeErrorCode } from '@clawee/protocol';

describe('protocol shape', () => {
  it('allows a minimal run request', () => {
    const request: RunRequest = {
      prompt: 'hello',
      sandbox: 'read-only'
    };
    expect(request.prompt).toBe('hello');
  });

  it('allows a done event envelope', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_1',
      runId: 'run_1',
      seq: 1,
      ts: '2026-07-04T00:00:00.000Z',
      type: 'done',
      payload: {
        type: 'done',
        status: 'succeeded',
        terminationReason: 'completed'
      },
      normalizerVersion: 1
    };
    expect(event.payload.status).toBe('succeeded');
  });

  it('keeps error codes as closed string literals', () => {
    const code: RuntimeErrorCode = 'CODEX_NOT_FOUND';
    expect(code).toBe('CODEX_NOT_FOUND');
  });
});
