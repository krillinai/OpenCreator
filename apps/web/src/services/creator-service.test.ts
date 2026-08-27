import { describe, expect, it, vi } from 'vitest';
import { createCreatorService } from './creator-service.js';

describe('creator web service', () => {
  it('uses the public creator endpoints', async () => {
    const client = {
      get: vi.fn(async () => ({ jobs: [] })),
      post: vi.fn(async () => ({ job: { id: 'job_1' } })),
      postBinary: vi.fn(async () => ({
        job: { id: 'job_1' },
        artifact: { id: 'artifact_source_1' },
        deduplicated: false
      })),
      rawGet: vi.fn(async () => new Response('artifact'))
    };
    const service = createCreatorService(client);

    await service.listJobs('project 1');
    await service.listJobs();
    await service.createJob({
      projectId: 'project 1',
      templateId: 'video-translation',
      creationKey: 'create-key-1'
    });
    await service.applyAction('job_1', {
      action: 'update-settings',
      expectedRevision: 0,
      input: { patch: { targetLanguage: 'ja' } }
    });
    await service.startAgentTurn('job_1', { message: '开始', clientMessageId: 'message-1' });
    await service.steerAgentTurn('job_1', { message: '调整', clientMessageId: 'message-2' });
    await service.interruptAgentTurn('job_1');
    await service.respondAgentApproval('job_1', 'approval 1', {
      decision: 'approved',
      processGeneration: 3
    });
    await service.getAgentTimeline('job_1');
    await service.uploadSourceVideo('job_1', {
      file: new File(['video'], 'sample.webm', {
        type: 'video/webm',
        lastModified: 123
      }),
      expectedRevision: 7
    });
    await service.openProjectCover('job_1');
    await service.openArtifact('job_1', 'artifact 1');

    expect(client.get).toHaveBeenCalledWith('/creator/jobs?projectId=project%201');
    expect(client.get).toHaveBeenCalledWith('/creator/jobs');
    expect(client.post).toHaveBeenNthCalledWith(1, '/creator/jobs', {
      projectId: 'project 1',
      templateId: 'video-translation',
      creationKey: 'create-key-1'
    });
    expect(client.post).toHaveBeenNthCalledWith(2, '/creator/jobs/job_1/actions', expect.any(Object));
    expect(client.post).toHaveBeenNthCalledWith(3, '/creator/jobs/job_1/agent-turns', expect.any(Object));
    expect(client.post).toHaveBeenNthCalledWith(4, '/creator/jobs/job_1/agent-steer', expect.any(Object));
    expect(client.post).toHaveBeenNthCalledWith(5, '/creator/jobs/job_1/agent-interrupt');
    expect(client.post).toHaveBeenNthCalledWith(
      6,
      '/creator/jobs/job_1/agent-approvals/approval%201',
      expect.any(Object)
    );
    expect(client.get).toHaveBeenCalledWith('/creator/jobs/job_1/agent-timeline');
    expect(client.postBinary).toHaveBeenCalledWith(
      '/creator/jobs/job_1/source-video?expectedRevision=7&fileName=sample.webm&mime=video%2Fwebm&lastModified=123',
      expect.any(File),
      'application/vnd.opencreator.creator-source'
    );
    expect(client.rawGet).toHaveBeenCalledWith('/creator/jobs/job_1/cover');
    expect(client.rawGet).toHaveBeenCalledWith('/creator/jobs/job_1/artifacts/artifact%201/content');
  });

  it('deduplicates stable SSE ids and reconnects with the last cursor', async () => {
    const event = {
      id: 'agent:1',
      jobId: 'job_1',
      revision: 2,
      kind: 'agent_item_changed',
      payload: {},
      createdAt: '2026-08-21T00:00:00.000Z'
    } as const;
    const frame = `id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
    const rawGet = vi.fn()
      .mockResolvedValueOnce(new Response(frame + frame))
      .mockResolvedValueOnce(new Response(frame));
    const service = createCreatorService({
      get: vi.fn(),
      post: vi.fn(),
      rawGet
    });
    const received: string[] = [];

    await subscribeUntilDisconnect(service, 'job_1', event => received.push(event.id));
    await subscribeUntilDisconnect(service, 'job_1', event => received.push(event.id));

    expect(received).toEqual(['agent:1']);
    expect(rawGet).toHaveBeenNthCalledWith(1, '/creator/jobs/job_1/events');
    expect(rawGet).toHaveBeenNthCalledWith(2, '/creator/jobs/job_1/events?cursor=agent%3A1');
  });
});

function subscribeUntilDisconnect(
  service: ReturnType<typeof createCreatorService>,
  jobId: string,
  onEvent: Parameters<ReturnType<typeof createCreatorService>['subscribeJobEvents']>[1]
): Promise<void> {
  return new Promise(resolve => {
    service.subscribeJobEvents(jobId, onEvent, resolve);
  });
}
