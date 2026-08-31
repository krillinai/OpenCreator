import type { CreatorExecutor } from '../../src/creator/executor.js';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

let server: FastifyInstance | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator video download', () => {
  it('runs probe and download stages, then imports the video into translation', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-video-download-api-'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      creatorExecutors: [fakeDownloadExecutor()]
    });

    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_download',
      templateId: 'video-download'
    });
    const initial = created.json().job;
    expect(initial.templateVersion).toBe(2);
    const configured = await request(
      'POST',
      `/creator/jobs/${initial.id}/actions`,
      {
        action: 'update-settings',
        expectedRevision: initial.revision,
        input: {
          patch: {
            sourceUrl: 'https://www.youtube.com/watch?v=download-demo'
          }
        }
      }
    );
    const probeStarted = await request(
      'POST',
      `/creator/jobs/${initial.id}/actions`,
      {
        action: 'run-stage',
        expectedRevision: configured.json().job.revision,
        input: { stageId: 'probe' }
      }
    );
    expect(probeStarted.statusCode).toBe(200);

    const probed = await waitForStage(initial.id, 'probe');
    expect(probed).toMatchObject({
      status: 'draft',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=download-demo'
      },
      artifacts: [{
        kind: 'download_probe',
        status: 'completed',
        metadata: {
          title: 'Download Demo',
          requestedUrl: 'https://www.youtube.com/watch?v=download-demo',
          options: [expect.objectContaining({ id: 'video-1080-1' })]
        }
      }]
    });
    expect(probed.state).not.toHaveProperty('latestResultVersion');

    const selected = await request(
      'POST',
      `/creator/jobs/${initial.id}/actions`,
      {
        action: 'update-settings',
        expectedRevision: probed.revision,
        input: {
          patch: {
            mediaType: 'video',
            selectedOptionId: 'video-1080-1'
          }
        }
      }
    );
    await request(
      'POST',
      `/creator/jobs/${initial.id}/actions`,
      {
        action: 'run-stage',
        expectedRevision: selected.json().job.revision,
        input: { stageId: 'download' }
      }
    );
    const downloaded = await waitForStage(initial.id, 'download');
    const video = downloaded.artifacts.find(
      (artifact: { kind: string }) => artifact.kind === 'source_video'
    );
    expect(downloaded.status).toBe('completed');
    expect(video).toMatchObject({
      status: 'completed',
      metadata: {
        fileName: 'Download Demo.mp4',
        mimeType: 'video/mp4',
        optionId: 'video-1080-1',
        resultVersion: 1
      }
    });

    const translation = await request('POST', '/creator/jobs', {
      projectId: 'project_download',
      templateId: 'video-translation'
    });
    const imported = await request(
      'POST',
      `/creator/jobs/${translation.json().job.id}/import-artifact`,
      {
        expectedRevision: translation.json().job.revision,
        sourceJobId: initial.id,
        artifactId: video.id,
        kind: 'source_video'
      }
    );
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      job: {
        templateId: 'video-translation',
        status: 'draft',
        state: {
          sourceType: 'file',
          sourceUrl: '',
          sourceFileName: 'Download Demo.mp4'
        }
      },
      artifact: {
        kind: 'source_video',
        status: 'completed',
        sourceArtifactIds: [video.id],
        metadata: {
          source: 'artifact-import',
          importedFromJobId: initial.id,
          importedFromArtifactId: video.id
        }
      }
    });
  });
});

function fakeDownloadExecutor(): CreatorExecutor {
  return {
    id: 'download',
    async run(stage) {
      if (stage.stageRun.stageId === 'probe') {
        const path = join(stage.workdir, 'probe.json');
        const metadata = {
          id: 'download-demo',
          title: 'Download Demo',
          requestedUrl: 'https://www.youtube.com/watch?v=download-demo',
          url: 'https://www.youtube.com/watch?v=download-demo',
          platform: 'youtube',
          uploader: 'OpenCreator',
          thumbnailUrl: null,
          duration: 30,
          width: 1920,
          height: 1080,
          formats: [],
          options: [{
            id: 'video-1080-1',
            mediaType: 'video',
            container: 'mp4',
            width: 1920,
            height: 1080,
            videoFormatId: '399',
            audioFormatId: '140'
          }]
        };
        await writeFile(path, JSON.stringify(metadata));
        return {
          outputs: [{
            kind: 'download_probe',
            status: 'completed',
            path,
            metadata
          }]
        };
      }
      const path = join(stage.workdir, 'Download Demo.mp4');
      await writeFile(path, 'downloaded-video');
      return {
        outputs: [{
          kind: 'source_video',
          status: 'completed',
          path,
          metadata: {
            fileName: 'Download Demo.mp4',
            mimeType: 'video/mp4',
            size: 16,
            sha256: 'download-sha256',
            duration: 30,
            width: 1920,
            height: 1080,
            hasVideo: true,
            hasAudio: true,
            optionId: 'video-1080-1'
          }
        }]
      };
    }
  };
}

async function waitForStage(jobId: string, stageId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request('GET', `/creator/jobs/${jobId}`);
    const job = response.json().job;
    const stage = [...job.stages].reverse().find(
      (candidate: { stageId: string }) => candidate.stageId === stageId
    );
    if (stage?.status === 'succeeded') return job;
    if (stage?.status === 'failed') {
      throw new Error(`Video download stage failed: ${JSON.stringify(job)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${stageId}`);
}

async function request(
  method: 'GET' | 'POST',
  url: string,
  payload?: object
): Promise<{ statusCode: number; json(): any }> {
  return await server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer secret' },
    ...(payload === undefined ? {} : { payload })
  }) as never;
}
