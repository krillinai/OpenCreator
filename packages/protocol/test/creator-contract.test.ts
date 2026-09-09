import { describe, expect, it } from 'vitest';

describe('creator protocol contract', () => {
  it('exports the six public creator preset workspaces', async () => {
    const protocol = await import('../src/index.js');

    expect(protocol.creatorRuntimeWorkspaces).toEqual([
      'video-translation',
      'video-download',
      'image-generation',
      'video-generation',
      'cover-generator',
      'smart-dubbing'
    ]);
  });

  it('accepts blank or preset creation requests and rejects mixed fields', async () => {
    const protocol = await import('../src/index.js');

    expect(protocol.isCreateCreatorJobRequest({
      projectId: 'project-1',
      templateId: 'image-generation',
      templateVersion: 2,
      state: { prompt: 'demo' },
      creationKey: 'blank-1'
    })).toBe(true);
    expect(protocol.isCreateCreatorJobRequest({
      projectId: 'project-1',
      preset: {
        module: 'image-generation',
        id: 'ecommerce-product',
        version: 1
      },
      locale: 'zh-CN',
      creationKey: 'preset-1'
    })).toBe(true);
    expect(protocol.isCreateCreatorJobRequest({
      projectId: 'project-1',
      preset: {
        module: 'image-generation',
        id: 'ecommerce-product',
        version: 1
      },
      locale: 'zh-CN',
      state: {},
      creationKey: 'mixed-1'
    })).toBe(false);
    expect(protocol.isCreateCreatorJobRequest({
      projectId: 'project-1',
      preset: {
        module: 'image-generation',
        id: 'ecommerce-product',
        version: 1
      },
      locale: 'zh-CN',
      templateId: 'image-generation',
      creationKey: 'mixed-2'
    })).toBe(false);
    expect(protocol.isCreateCreatorJobRequest({
      projectId: 'project-1',
      templateId: 'image-generation',
      locale: 'en-US',
      creationKey: 'mixed-3'
    })).toBe(false);
    expect(protocol.isCreateCreatorJobRequest({
      projectId: 'project-1',
      templateId: 'image-generation',
      state: { prompt: undefined },
      creationKey: 'invalid-json'
    })).toBe(false);
  });

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
