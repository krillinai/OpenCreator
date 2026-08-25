import { describe, expect, it } from 'vitest';

describe('creator protocol contract', () => {
  it('exports runtime-neutral creator statuses and event kinds', async () => {
    const protocol = await import('../src/index.js');

    expect(protocol.creatorJobStatuses).toEqual([
      'draft',
      'running',
      'needs_input',
      'completed',
      'failed',
      'canceled'
    ]);
    expect(protocol.creatorArtifactStatuses).toEqual([
      'draft',
      'technical_preview',
      'completed',
      'stale'
    ]);
    expect(protocol.creatorEventKinds).toEqual([
      'snapshot_changed',
      'activity_changed',
      'stage_progress',
      'agent_turn_changed',
      'agent_item_changed',
      'agent_approval_changed'
    ]);
  });

  it('freezes the persistent agent state machine and rejects unknown states', async () => {
    const protocol = await import('../src/index.js');

    expect(protocol.creatorAgentTurnStatuses).toEqual([
      'queued',
      'running',
      'waiting_approval',
      'completed',
      'failed',
      'canceled',
      'interrupted',
      'needs_user_resolution'
    ]);
    expect(protocol.creatorAgentApprovalStatuses).toEqual([
      'pending',
      'approved',
      'rejected',
      'expired',
      'canceled'
    ]);
    expect(protocol.isCreatorAgentTurnStatus('waiting_approval')).toBe(true);
    expect(protocol.isCreatorAgentTurnStatus('demo_completed')).toBe(false);
    expect(protocol.isCreatorAgentApprovalStatus('pending')).toBe(true);
    expect(protocol.isCreatorAgentApprovalStatus('waiting')).toBe(false);
  });
});
