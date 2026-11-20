import type { CreatorExecutor } from '../../src/creator/executor.js';
import type { CreatorJson, CreatorStageRun } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { spawnCreatorProcess } from '../../src/creator/process-tree.js';
import { creatorStageEventId } from '../../src/creator/events.js';

let server: FastifyInstance | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator video download', () => {
  it.skipIf(process.platform === 'win32')('resumes the same live process and stage without preparation or another dispatch', async () => {
    const fixture = await controlledDownloadFixture(true);
    const first = await fixture.queue('video-1080-1');
    await fixture.wait(first.id, 'running');
    await expect.poll(fixture.ticks).toBeGreaterThan(2);
    const pid = fixture.pids[0];
    const eventIds: string[] = [];
    for (let toggle = 0; toggle < 3; toggle++) {
      const paused = await fixture.control(first.id, 'pause');
      expect(paused.statusCode).toBe(200);
      eventIds.push(creatorStageEventId(paused.json().stage));
      expect(paused.json()).toMatchObject({ control: 'paused', stage: {
        id: first.id, status: 'running', progress: { phase: 'downloading', percent: 42, downloadControl: 'paused', bytesPerSecond: null }
      } });
      await new Promise(resolve => setTimeout(resolve, 80));
      const savedTicks = await fixture.ticks();
      const savedChildTicks = await fixture.childTicks();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(await fixture.ticks()).toBe(savedTicks);
      expect(await fixture.childTicks()).toBe(savedChildTicks);
      const resumed = await fixture.control(first.id, 'resume');
      expect(resumed.statusCode).toBe(200);
      eventIds.push(creatorStageEventId(resumed.json().stage));
      expect(resumed.json()).toMatchObject({ control: 'resumed', stage: {
        id: first.id, attempt: 1, progress: { phase: 'downloading', percent: 42, downloadControl: null }
      } });
      await expect.poll(fixture.ticks).toBeGreaterThan(savedTicks);
      await expect.poll(fixture.childTicks).toBeGreaterThan(savedChildTicks);
      expect(fixture.pids).toEqual([pid]);
    }
    expect(fixture.attempts).toHaveLength(1);
    expect(new Set(eventIds).size).toBe(eventIds.length);
    await fixture.finish();
    await fixture.wait(first.id, 'succeeded');
    const job = (await request('GET', `/creator/jobs/${fixture.jobId}`)).json().job;
    expect(job.stages.filter((stage: CreatorStageRun) => stage.stageId === 'download')).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')('cancels a suspended download and closes the daemon without leaving suspended processes', async () => {
    const fixture = await controlledDownloadFixture(true);
    const first = await fixture.queue('video-1080-1');
    await fixture.wait(first.id, 'running');
    await expect.poll(fixture.ticks).toBeGreaterThan(0);
    await fixture.control(first.id, 'pause');
    expect((await fixture.control(first.id, 'cancel')).statusCode).toBe(202);
    await fixture.wait(first.id, 'canceled');
    expect(() => process.kill(fixture.pids[0]!, 0)).toThrow();
    expect((await fixture.control(first.id, 'resume')).statusCode).toBe(409);

    const second = await fixture.queue('video-720-2');
    await fixture.wait(second.id, 'running');
    await expect.poll(() => fixture.pids.length).toBe(2);
    await fixture.control(second.id, 'pause');
    await server!.close();
    server = undefined;
    expect(() => process.kill(fixture.pids[1]!, 0)).toThrow();
  });

  it('pauses individual downloads, preserves partial files across repeated resumes, and cancels only the selected queued item', async () => {
    const fixture = await controlledDownloadFixture();
    const first = await fixture.queue('video-1080-1');
    await fixture.wait(first.id, 'running');
    const sibling = await fixture.queue('video-720-2');
    expect((await fixture.control(sibling.id, 'cancel')).statusCode).toBe(200);
    await fixture.wait(sibling.id, 'canceled');
    expect((await fixture.control(sibling.id, 'resume')).statusCode).toBe(409);
    await fixture.wait(first.id, 'running');

    expect((await fixture.control(first.id, 'pause')).statusCode).toBe(202);
    const paused = await fixture.wait(first.id, 'interrupted');
    expect(paused.progress).toMatchObject({ percent: 42, downloadControl: 'paused' });
    const resumedResponse = await fixture.control(first.id, 'resume');
    expect(resumedResponse.statusCode).toBe(202);
    const resumed = resumedResponse.json().stage;
    await fixture.wait(resumed.id, 'running');
    expect((await fixture.control(first.id, 'resume')).json().stage.id).toBe(resumed.id);
    expect((await fixture.control(first.id, 'cancel')).statusCode).toBe(409);
    expect((await fixture.control(resumed.id, 'pause')).statusCode).toBe(202);
    await fixture.wait(resumed.id, 'interrupted');
    await fixture.finish();
    const finalResponse = await fixture.control(resumed.id, 'resume');
    expect(finalResponse.statusCode).toBe(202);
    await fixture.wait(finalResponse.json().stage.id, 'succeeded');
    expect(fixture.attempts).toHaveLength(3);
    expect(fixture.attempts.map(attempt => attempt.workdir)).toEqual(Array(3).fill(fixture.attempts[0]!.workdir));
    expect(fixture.attempts.map(attempt => attempt.partial)).toEqual([null, 'downloaded-first-part', 'downloaded-first-part']);
    expect((await fixture.control(sibling.id, 'pause')).statusCode).toBe(409);
  });

  it('reuses partial downloads when continuing after Agent termination and rejects resume after explicit cancellation', async () => {
    const fixture = await controlledDownloadFixture();
    const first = await fixture.queue('video-1080-1');
    await fixture.wait(first.id, 'running');
    expect((await request('POST', `/creator/jobs/${fixture.jobId}/cancel`)).statusCode).toBe(202);
    await fixture.wait(first.id, 'canceled');
    const resumed = await request('POST', `/creator/jobs/${fixture.jobId}/resume`);
    expect(resumed.statusCode).toBe(202);
    const stage = resumed.json().stage;
    await fixture.wait(stage.id, 'running');
    expect(fixture.attempts[1]).toMatchObject({ workdir: fixture.attempts[0]!.workdir, partial: 'downloaded-first-part' });
    await fixture.control(stage.id, 'pause');
    await fixture.wait(stage.id, 'interrupted');
    expect((await fixture.control(stage.id, 'cancel')).statusCode).toBe(200);
    expect((await fixture.control(stage.id, 'resume')).statusCode).toBe(409);
    expect((await request('POST', `/creator/jobs/${fixture.jobId}/resume`)).statusCode).toBe(409);
    const other = (await request('POST', '/creator/jobs', { projectId: 'project_download', templateId: 'video-download' })).json().job;
    expect((await request('POST', `/creator/jobs/${other.id}/downloads/${stage.id}/resume`)).statusCode).toBe(404);
  });

  it('queues a probed subtitle option and serves its SRT artifact', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-subtitle-download-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome: join(tempDir, 'codex-home'), creatorExecutors: [fakeDownloadExecutor(true)] });
    const { job } = (await request('POST', '/creator/jobs', {
      projectId: 'project_download', templateId: 'video-download', creationKey: 'subtitle-flow',
      state: { sourceUrl: 'https://www.youtube.com/watch?v=download-demo' }
    })).json();
    expect((await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage', expectedRevision: job.revision, input: { stageId: 'probe' }
    })).statusCode).toBe(200);
    const probed = await waitForStage(job.id, 'probe');
    const rejected = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage', expectedRevision: probed.revision,
      input: { stageId: 'download', optionId: 'subtitle-manual-en', mediaType: 'video' }
    });
    expect(rejected.statusCode).toBe(400);
    const queued = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage', expectedRevision: probed.revision,
      input: { stageId: 'download', optionId: 'subtitle-manual-en', mediaType: 'subtitle' }
    });
    expect(queued.statusCode).toBe(200);
    const downloaded = await waitForStage(job.id, 'download');
    const artifact = downloaded.artifacts.find((item: { kind: string }) => item.kind === 'source_subtitle');
    expect(artifact).toMatchObject({ status: 'completed', metadata: { optionId: 'subtitle-manual-en', mediaType: 'subtitle' } });
    const content = await server.inject({ method: 'GET', url: `/creator/jobs/${job.id}/artifacts/${artifact.id}/content`, headers: { authorization: 'Bearer secret' } });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('application/x-subrip');
    expect(content.body).toContain('Hello subtitles');
  });

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
      templateId: 'video-download',
      creationKey: 'video-download-flow'
    });
    const initial = created.json().job;
    expect(initial.templateVersion).toBe(2);
    const preflightPath = `/creator/jobs/${initial.id}/preflight?stageId=download`;
    expect((await request('GET', preflightPath)).json()).toMatchObject({ canStart: false });
    expect((await request('GET', '/telemetry/task-events')).json().events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ task_id: initial.id })
    ]));
    expect((await request('GET', `${preflightPath}&launch=1`)).json()).toMatchObject({ canStart: false });
    await expect.poll(async () => (await request('GET', '/telemetry/task-events')).json().events).toEqual(expect.arrayContaining([
      expect.objectContaining({ task_id: initial.id, feature: 'video-download', event_type: 'task_started' }),
      expect.objectContaining({ task_id: initial.id, event_type: 'preflight_rejected', stage_id: 'download', execution_mode: 'local',
        failure: { diagnostic: expect.objectContaining({ steps: [expect.objectContaining({ code: 'input-artifact:download_probe' })] }) } })
    ]));
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
      templateId: 'video-translation',
      creationKey: 'video-download-import-translation'
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

async function controlledDownloadFixture(liveProcess = false) {
  tempDir = await mkdtemp(join(tmpdir(), 'creator-download-controls-'));
  let complete = false;
  const attempts: Array<{ workdir: string; partial: string | null }> = [];
  const pids: number[] = [];
  const base = fakeDownloadExecutor();
  const executor: CreatorExecutor = {
    id: 'download',
    supportsProcessPause: liveProcess,
    async run(stage) {
      if (stage.stageRun.stageId === 'probe') {
        const result = await base.run(stage);
        const output = result.outputs[0]!;
        output.metadata!.options = [...output.metadata!.options as CreatorJson[], {
          id: 'video-720-2', mediaType: 'video', container: 'mp4', height: 720, videoFormatId: '22'
        }];
        await writeFile(output.path!, JSON.stringify(output.metadata));
        return result;
      }
      const path = join(stage.workdir, 'source.mp4.part');
      const partial = await readFile(path, 'utf8').catch(() => null);
      attempts.push({ workdir: stage.workdir, partial });
      if (partial === null) await writeFile(path, 'downloaded-first-part');
      stage.reportProgress({ phase: 'downloading', percent: 42, bytesPerSecond: 4096 });
      if (liveProcess) await new Promise<void>((resolve, reject) => {
        const child = spawnCreatorProcess(process.execPath, ['-e', `
          const fs = require('node:fs');
          const { spawn } = require('node:child_process');
          const child = spawn(process.execPath, ['-e', \`
            const fs = require('node:fs');
            let ticks = 0;
            setInterval(() => fs.writeFileSync('child-ticks', String(++ticks)), 20);
          \`], { stdio: 'ignore' });
          fs.writeFileSync('child.pid', String(child.pid));
          let ticks = 0;
          setInterval(() => {
            fs.writeFileSync('ticks', String(++ticks));
            if (fs.existsSync('finish')) { child.kill(); process.exit(0); }
          }, 20);
        `], { cwd: stage.workdir, stdio: 'ignore' }, stage.signal, stage.processControl);
        pids.push(child.pid!);
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error('Download stopped')));
      });
      else if (!complete) await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new Error('Download stopped'));
        if (stage.signal.aborted) abort();
        else stage.signal.addEventListener('abort', abort, { once: true });
      });
      return base.run(stage);
    }
  };
  server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome: join(tempDir, 'codex-home'), creatorExecutors: [executor] });
  const job = (await request('POST', '/creator/jobs', { projectId: 'project_download', templateId: 'video-download',
    state: { sourceUrl: 'https://www.youtube.com/watch?v=download-demo' } })).json().job;
  await request('POST', `/creator/jobs/${job.id}/actions`, { action: 'run-stage', expectedRevision: job.revision, input: { stageId: 'probe' } });
  await waitForStage(job.id, 'probe');
  return {
    jobId: job.id as string,
    attempts,
    pids,
    ticks: async () => Number(await readFile(join(attempts.at(-1)!.workdir, 'ticks'), 'utf8').catch(() => '0')),
    childTicks: async () => Number(await readFile(join(attempts.at(-1)!.workdir, 'child-ticks'), 'utf8').catch(() => '0')),
    async finish() {
      complete = true;
      if (liveProcess) await writeFile(join(attempts.at(-1)!.workdir, 'finish'), 'finish');
    },
    control: (stageId: string, action: 'pause' | 'resume' | 'cancel') => request('POST', `/creator/jobs/${job.id}/downloads/${stageId}/${action}`),
    async queue(optionId: string): Promise<CreatorStageRun> {
      const current = (await request('GET', `/creator/jobs/${job.id}`)).json().job;
      const response = await request('POST', `/creator/jobs/${job.id}/actions`, { action: 'run-stage', expectedRevision: current.revision,
        input: { stageId: 'download', optionId, mediaType: 'video' } });
      expect(response.statusCode).toBe(200);
      return response.json().job.stages.at(-1);
    },
    async wait(stageId: string, status: string): Promise<CreatorStageRun> {
      let found: CreatorStageRun | undefined;
      await expect.poll(async () => {
        const current = (await request('GET', `/creator/jobs/${job.id}`)).json().job;
        found = current.stages.find((stage: CreatorStageRun) => stage.id === stageId);
        return found?.status === 'running' && found.progress.percent !== 42 ? 'starting' : found?.status;
      }, { timeout: 5000, interval: 10 }).toBe(status);
      return found!;
    }
  };
}

function fakeDownloadExecutor(subtitles = false): CreatorExecutor {
  return {
    id: 'download',
    async run(stage) {
      if (stage.stageRun.stageId === 'probe') {
        const path = join(stage.workdir, 'probe.json');
        const metadata: Record<string, CreatorJson> = {
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
          }, ...(subtitles ? [{ id: 'subtitle-manual-en', mediaType: 'subtitle', container: 'srt', subtitleLanguage: 'en', subtitleSource: 'manual' }] : [])]
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
      if (stage.stageRun.progress.mediaType === 'subtitle') {
        const path = join(stage.workdir, 'Download Demo.en.srt');
        await writeFile(path, '1\n00:00:00,000 --> 00:00:01,000\nHello subtitles\n');
        return { outputs: [{ kind: 'source_subtitle', status: 'completed', path, metadata: {
          fileName: 'Download Demo.en.srt', mimeType: 'application/x-subrip', optionId: 'subtitle-manual-en', mediaType: 'subtitle', subtitleLanguage: 'en'
        } }] };
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
