import type { AgentEventEnvelope } from '@clawee/protocol';
import { describe, expect, it } from 'vitest';
import { eventToTimelineItem } from './timeline-model.js';

describe('timeline model', () => {
  it('maps assistant_message events', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_1',
      runId: 'run_1',
      seq: 1,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'assistant_message',
      payload: { type: 'assistant_message', text: 'hello', format: 'plain_text', delivery: 'message' },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'assistant_message',
      text: 'hello',
      source: 'runtime'
    });
  });
});
