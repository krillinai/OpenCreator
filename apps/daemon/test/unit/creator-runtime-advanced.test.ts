import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapCreatorAgentRuntime } from '../../src/creator/agent/bootstrap.js';
import { createCreatorAgentService } from '../../src/creator/agent/agent-service.js';
import { createAgentContextBuilder } from '../../src/creator/agent/context-builder.js';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import type { AgentRuntimeAdapter } from '../../src/creator/agent/runtime-adapter.js';
import { parseClipCandidates } from '../../src/creator/clip/analyzer.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { parseDownloadProbe } from '../../src/creator/download/probe-parser.js';
import { CreatorExecutorError, type CreatorExecutor } from '../../src/creator/executor.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-runtime-advanced-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const agentRepository = createCreatorAgentRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const dispatcher = createCreatorCommandDispatcher({
    service,
    repository,
    receipts: agentRepository
  });
  return { db, repository, agentRepository, dispatcher, service, templates };
}

describe('creator runtime advanced contracts', () => {
  it('does not start an executor when required inputs are missing and retry creates a new run', async () => {
    const { db, repository, service, templates } = setup();
    const run = vi.fn<CreatorExecutor['run']>().mockResolvedValue({ outputs: [] });
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{ id: 'clip', run }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({ projectId: 'p1', templateId: 'auto-clip' });
    const first = await runner.run(job.id, 'analyze');
    expect(first).toMatchObject({ status: 'failed', errorCode: 'creator_stage_input_missing' });
    expect(run).not.toHaveBeenCalled();
    const second = await runner.retry(first.id);
    expect(second.id).not.toBe(first.id);
    expect(service.getJob(job.id)?.stages).toHaveLength(2);
    await runner.close();
    db.close();
  });

  it('keeps provider configuration failures actionable as needs_input jobs', async () => {
    const { db, repository, service, templates } = setup();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'krillinai',
        async run() {
          throw new CreatorExecutorError(
            'creator_transcription_config_missing',
            'OpenAI transcription API key is required'
          );
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=no-captions',
        sourceLanguage: 'en',
        targetLanguage: 'zh_cn'
      }
    });

    const stage = await runner.run(job.id, 'subtitle');

    expect(stage).toMatchObject({
      status: 'failed',
      errorCode: 'creator_transcription_config_missing'
    });
    expect(service.getJob(job.id)).toMatchObject({
      status: 'needs_input',
      state: {
        needsInput: {
          code: 'creator_transcription_config_missing',
          deepLink: '/settings/ai-services?section=transcription'
        }
      }
    });
    await runner.close();
    db.close();
  });

  it('links missing image credentials to the image service settings', async () => {
    const { db, repository, service, templates } = setup();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'image',
        async run() {
          throw new CreatorExecutorError(
            'creator_image_config_missing',
            'OpenAI image API key is required'
          );
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'image-generation',
      state: { prompt: 'A bright creative studio' }
    });

    const stage = await runner.run(job.id, 'generate');

    expect(stage).toMatchObject({
      status: 'failed',
      errorCode: 'creator_image_config_missing'
    });
    expect(service.getJob(job.id)).toMatchObject({
      status: 'needs_input',
      state: {
        needsInput: {
          code: 'creator_image_config_missing',
          deepLink: '/settings/ai-services?section=image'
        }
      }
    });
    await runner.close();
    db.close();
  });

  it('creates project snapshots that reuse unchanged artifact files across child outputs', async () => {
    const { db, repository, service, templates } = setup();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'krillinai',
        async run({ stageRun }) {
          if (stageRun.stageId === 'subtitle') {
            return {
              outputs: [{
                kind: 'target_subtitle',
                status: 'completed' as const,
                path: join(tempDir, 'subtitle-v1.srt'),
                metadata: { cues: [] }
              }]
            };
          }
          if (stageRun.stageId === 'render-horizontal') {
            return {
              outputs: [{
                kind: 'horizontal_video',
                status: 'completed' as const,
                path: join(tempDir, 'horizontal-v1.mp4')
              }]
            };
          }
          return {
            outputs: [{
              kind: 'dubbed_audio',
              status: 'completed' as const,
              path: join(tempDir, 'voice-v1.wav')
            }]
          };
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'video-translation',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=test',
        resultVersion: 1
      }
    });
    repository.insertArtifact({
      jobId: job.id,
      kind: 'source_video',
      status: 'completed',
      path: join(tempDir, 'source.mp4'),
      sourceArtifactIds: [],
      metadata: {}
    });

    await runner.run(job.id, 'subtitle');
    const afterSubtitle = service.getJob(job.id)!;
    service.applyAction(job.id, {
      action: 'run-stage',
      expectedRevision: afterSubtitle.revision,
      input: { stageId: 'tts' }
    });
    await runner.run(job.id, 'tts');

    const afterVoice = service.getJob(job.id)!;
    service.applyAction(job.id, {
      action: 'run-stage',
      expectedRevision: afterVoice.revision,
      input: { stageId: 'render-horizontal' }
    });
    await runner.run(job.id, 'render-horizontal');

    const afterVideo = service.getJob(job.id)!;
    service.applyAction(job.id, {
      action: 'run-stage',
      expectedRevision: afterVideo.revision,
      input: { stageId: 'subtitle' }
    });
    await runner.run(job.id, 'subtitle');

    const completed = service.getJob(job.id)!;
    const snapshots = completed.state.resultSnapshots as Array<{
      version: number;
      artifactRefs: Record<string, string[]>;
    }>;
    const subtitle = completed.artifacts.find(artifact => artifact.kind === 'target_subtitle')!;
    const voice = completed.artifacts.find(artifact => artifact.kind === 'dubbed_audio')!;
    const video = completed.artifacts.find(artifact => artifact.kind === 'horizontal_video')!;
    const latestSubtitle = completed.artifacts.filter(artifact => artifact.kind === 'target_subtitle').at(-1)!;
    expect(snapshots).toHaveLength(4);
    expect(snapshots[0]).toMatchObject({
      version: 1,
      artifactRefs: { target_subtitle: [subtitle.id] }
    });
    expect(snapshots[1]).toMatchObject({
      version: 2,
      artifactRefs: {
        target_subtitle: [subtitle.id],
        dubbed_audio: [voice.id]
      }
    });
    expect(snapshots[2]).toMatchObject({
      version: 3,
      artifactRefs: {
        target_subtitle: [subtitle.id],
        dubbed_audio: [voice.id],
        horizontal_video: [video.id]
      }
    });
    expect(snapshots[3]).toMatchObject({
      version: 4,
      artifactRefs: {
        target_subtitle: [latestSubtitle.id],
        dubbed_audio: [voice.id],
        horizontal_video: [video.id]
      }
    });
    expect((completed.state.resultSnapshots as Array<{ staleArtifactIds: string[] }>)[3]?.staleArtifactIds)
      .toEqual(expect.arrayContaining([voice.id, video.id]));
    expect(subtitle).toMatchObject({ version: 1, metadata: { resultVersion: 1 } });
    expect(voice).toMatchObject({ version: 1, metadata: { resultVersion: 2 } });
    expect(video).toMatchObject({ version: 1, metadata: { resultVersion: 3 } });
    expect(latestSubtitle).toMatchObject({ version: 2, metadata: { resultVersion: 4 } });
    expect(completed.state.resultVersion).toBe(4);
    await runner.close();
    db.close();
  });

  it('re-reads once after an agent revision conflict and then applies with actor=agent', async () => {
    const { db, agentRepository, dispatcher, service, templates } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'cover' });
    let calls = 0;
    const runtime: AgentRuntimeAdapter = {
      id: 'fake', available: true,
      async runTurn(input) {
        calls += 1;
        if (calls === 1) {
          service.applyAction(job.id, {
            actor: 'user', action: 'update-settings', expectedRevision: input.context.revision,
            input: { patch: { ratio: '1:1' } }
          });
        }
        return {
          content: '已调整封面提示词',
          action: {
            action: 'update-settings',
            expectedRevision: input.context.revision,
            input: { patch: { prompt: '清晰的人物主体' } }
          }
        };
      }
    };
    const agent = createCreatorAgentService({
      creator: service,
      dispatcher,
      repository: agentRepository,
      contextBuilder: createAgentContextBuilder({ templates }),
      runtime,
      threads: {
        createThread: () => ({ id: 'creator-thread' }) as never,
        getThread: () => ({ id: 'creator-thread' }) as never,
        updateThread: () => ({ id: 'creator-thread' }) as never
      }
    });
    const result = await agent.runTurn(job.id, { message: '调整提示词' });
    expect(calls).toBe(2);
    expect(result.turn.audit.map(item => item.result)).toEqual([
      'ok', 'creator_revision_conflict', 'ok', 'ok'
    ]);
    expect(result.action?.receipt.actor).toBe('agent');
    expect(result.action?.job.state).toMatchObject({ ratio: '1:1', prompt: '清晰的人物主体' });
    db.close();
  });

  it('stops after a second agent conflict and asks for user resolution', async () => {
    const { db, agentRepository, dispatcher, service, templates } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'cover' });
    const runtime: AgentRuntimeAdapter = {
      id: 'fake', available: true,
      async runTurn(input) {
        service.applyAction(job.id, {
          actor: 'user', action: 'update-settings', expectedRevision: input.context.revision,
          input: { patch: { prompt: `用户修改-${input.conflictAttempt}` } }
        });
        return {
          content: '状态持续变化，需要确认',
          action: {
            action: 'update-settings', expectedRevision: input.context.revision,
            input: { patch: { prompt: 'Agent 修改' } }
          }
        };
      }
    };
    const agent = createCreatorAgentService({
      creator: service,
      dispatcher,
      repository: agentRepository,
      contextBuilder: createAgentContextBuilder({ templates }),
      runtime,
      threads: {
        createThread: () => ({ id: 'creator-thread' }) as never,
        getThread: () => ({ id: 'creator-thread' }) as never,
        updateThread: () => ({ id: 'creator-thread' }) as never
      }
    });
    const result = await agent.runTurn(job.id, { message: '修改' });
    expect(result.turn.status).toBe('needs_user_resolution');
    expect(result.turn.audit.filter(item => item.result === 'creator_revision_conflict')).toHaveLength(2);
    expect(result.action).toBeUndefined();
    db.close();
  });

  it('installs and repairs the isolated opencreator runtime skill without touching the source home', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-bootstrap-'));
    const sourceHome = join(tempDir, 'source-home');
    const bundled = join(tempDir, 'bundled');
    const runtimeRoot = join(tempDir, 'runtime');
    mkdirSync(sourceHome, { recursive: true });
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(sourceHome, 'auth.json'), '{"token":"sentinel"}');
    writeFileSync(join(bundled, 'SKILL.md'), '# OpenCreator Runtime\n');
    writeFileSync(join(bundled, 'manifest.json'), '{"version":2}\n');
    const first = bootstrapCreatorAgentRuntime({ sourceCodexHome: sourceHome, runtimeRoot, bundledSkillDir: bundled });
    expect(first).toMatchObject({ available: true, guideVersion: 2 });
    writeFileSync(join(first.skillPath, 'SKILL.md'), 'damaged');
    writeFileSync(join(first.skillPath, '.opencreator-hash'), 'damaged');
    const repaired = bootstrapCreatorAgentRuntime({ sourceCodexHome: sourceHome, runtimeRoot, bundledSkillDir: bundled });
    expect(readFileSync(join(repaired.skillPath, 'SKILL.md'), 'utf8')).toBe('# OpenCreator Runtime\n');
    expect(readFileSync(join(sourceHome, 'auth.json'), 'utf8')).toBe('{"token":"sentinel"}');
  });

  it('normalizes probe formats and rejects invalid clip ranges before ffmpeg', () => {
    const probe = parseDownloadProbe({
      id: 'v1', title: 'Demo', webpage_url: 'https://www.bilibili.com/video/BV1',
      extractor_key: 'BiliBili', duration: 12,
      formats: [{ format_id: '1080', ext: 'mp4', width: 1920, height: 1080, filesize: 42, vcodec: 'h264', acodec: 'none' }]
    });
    expect(probe).toMatchObject({ platform: 'bilibili', formats: [{ id: '1080', hasVideo: true, hasAudio: false }] });
    expect(() => parseClipCandidates({ candidates: [{
      id: 'bad', start: 8, end: 13, reason: '越界',
      scores: { hook: 8, information: 8, emotion: 8, completeness: 8 }
    }] }, 12)).toThrow(/invalid_clip_range/);
  });

  it('stales only the edited stickman segment assets and the final render', () => {
    const { db, repository, service } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video', state: { topic: '测试' } });
    const segmentA = repository.insertArtifact({ jobId: job.id, kind: 'script_segment', status: 'completed', path: null, sourceArtifactIds: [], metadata: { id: 's1', narration: 'A', visualPrompt: 'A', durationSeconds: 2 } });
    const segmentB = repository.insertArtifact({ jobId: job.id, kind: 'script_segment', status: 'completed', path: null, sourceArtifactIds: [], metadata: { id: 's2', narration: 'B', visualPrompt: 'B', durationSeconds: 2 } });
    const imageA = repository.insertArtifact({ jobId: job.id, kind: 'storyboard_image', status: 'completed', path: 'a.png', sourceArtifactIds: [segmentA.id], metadata: { segmentId: 's1' } });
    const imageB = repository.insertArtifact({ jobId: job.id, kind: 'storyboard_image', status: 'completed', path: 'b.png', sourceArtifactIds: [segmentB.id], metadata: { segmentId: 's2' } });
    const audioA = repository.insertArtifact({ jobId: job.id, kind: 'segment_audio', status: 'completed', path: 'a.mp3', sourceArtifactIds: [segmentA.id], metadata: { segmentId: 's1' } });
    const audioB = repository.insertArtifact({ jobId: job.id, kind: 'segment_audio', status: 'completed', path: 'b.mp3', sourceArtifactIds: [segmentB.id], metadata: { segmentId: 's2' } });
    const final = repository.insertArtifact({ jobId: job.id, kind: 'stickman_video', status: 'completed', path: 'final.mp4', sourceArtifactIds: [imageA.id, imageB.id, audioA.id, audioB.id], metadata: {} });
    service.applyAction(job.id, {
      actor: 'user', action: 'edit-script-segment', expectedRevision: 0,
      input: { artifactId: segmentB.id, narration: 'B2' }
    });
    const artifacts = service.getJob(job.id)!.artifacts;
    expect(artifacts.find(item => item.id === imageA.id)?.status).toBe('completed');
    expect(artifacts.find(item => item.id === audioA.id)?.status).toBe('completed');
    expect(artifacts.find(item => item.id === imageB.id)?.status).toBe('stale');
    expect(artifacts.find(item => item.id === audioB.id)?.status).toBe('stale');
    expect(artifacts.find(item => item.id === final.id)?.status).toBe('stale');
    db.close();
  });
});
