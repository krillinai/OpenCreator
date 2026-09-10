import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig, type CreatorArtifact } from '@opencreator/protocol';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createStickmanAudioExecutor } from '../../src/creator/stickman/audio-executor.js';
import { stickmanNarrationFingerprint } from '../../src/creator/stickman/lineage.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('stickman audio executor', () => {
  it('synthesizes one scoped audio per segment and builds contiguous ffprobe timing', async () => {
    const { db, repository, service, templates, script } = setupConfiguredJob();
    const synthesize = vi.fn(async (request: { text: string; voiceId?: string }) => ({
      content: Buffer.from(`wave:${request.text}`),
      mime: 'audio/wav' as const,
      provider: 'openai' as const,
      model: 'gpt-4o-mini-tts',
      voiceId: request.voiceId ?? 'alloy',
      format: 'wav' as const
    }));
    const probe = vi.fn(async (path: string) => ({
      duration: path.includes('segment-01') ? 1.25 : 2.75,
      hasVideo: false,
      hasAudio: true
    }));
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      executors: [createStickmanAudioExecutor({
        configStore: { read: async () => configuredTts() },
        ttsService: { synthesize },
        ledger: new CreatorProviderRequestLedger(repository),
        ffprobePath: 'ffprobe-test',
        synthesize,
        probe
      })]
    });

    for (const [index, scopeKey] of ['segment-01', 'segment-02'].entries()) {
      const run = repository.createStageRun({
        jobId: script.jobId,
        stageId: 'narration',
        executor: 'stickman-audio',
        status: 'queued',
        scopeKey,
        inputFingerprint: String(index + 1).repeat(64)
      });
      expect((await runner.runStageRun(run.id)).status).toBe('succeeded');
    }
    const timingRun = repository.createStageRun({
      jobId: script.jobId,
      stageId: 'audio-timing',
      executor: 'stickman-audio',
      status: 'queued'
    });
    expect((await runner.runStageRun(timingRun.id)).status).toBe('succeeded');

    const completed = service.getJob(script.jobId)!;
    const narration = completed.artifacts.filter(artifact => artifact.kind === 'narration_audio');
    expect(narration.map(artifact => artifact.scopeKey)).toEqual(['segment-01', 'segment-02']);
    expect(synthesize.mock.calls.map(([request]) => ({
      text: request.text,
      voiceId: request.voiceId
    }))).toEqual([
      { text: '第一段旁白', voiceId: 'alloy' },
      { text: '第二段旁白', voiceId: 'alloy' }
    ]);
    expect(completed.providerRequests).toHaveLength(2);
    const timingArtifact = completed.artifacts.find(artifact => artifact.kind === 'audio_timing')!;
    expect(JSON.parse(readFileSync(timingArtifact.path!, 'utf8'))).toMatchObject({
      timingSource: 'ffprobe_cumulative_tts_duration',
      segments: [
        { segmentId: 'segment-01', startSeconds: 0, endSeconds: 1.25, durationSeconds: 1.25 },
        { segmentId: 'segment-02', startSeconds: 1.25, endSeconds: 4, durationSeconds: 2.75 }
      ],
      totalDurationSeconds: 4
    });
    expect(probe).toHaveBeenCalledTimes(4);
    await runner.close();
    db.close();
  });

  it('changes the narration fingerprint when the selected voice changes', () => {
    const script = {
      sha256: 'a'.repeat(64)
    } as CreatorArtifact;
    const base = {
      segment: { id: 'segment-01', narration: '同一段旁白' },
      script,
      settings: { provider: 'openai', model: 'gpt-4o-mini-tts', voiceId: 'alloy' }
    };
    expect(stickmanNarrationFingerprint(base)).not.toBe(stickmanNarrationFingerprint({
      ...base,
      settings: { ...base.settings, voiceId: 'nova' }
    }));
  });

  it('keeps real TTS timing outside the target window as a non-blocking measurement', async () => {
    const { db, repository, service, templates, script } = setupConfiguredJob({
      targetDurationSeconds: 30
    });
    const synthesize = vi.fn(async (request: { text: string; voiceId?: string }) => ({
      content: Buffer.from(`wave:${request.text}`),
      mime: 'audio/wav' as const,
      provider: 'openai' as const,
      model: 'gpt-4o-mini-tts',
      voiceId: request.voiceId ?? 'alloy',
      format: 'wav' as const
    }));
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      executors: [createStickmanAudioExecutor({
        configStore: { read: async () => configuredTts() },
        ttsService: { synthesize },
        ledger: new CreatorProviderRequestLedger(repository),
        ffprobePath: 'ffprobe-test',
        synthesize,
        probe: async () => ({ duration: 12.36, hasVideo: false, hasAudio: true })
      })]
    });

    for (const [index, scopeKey] of ['segment-01', 'segment-02'].entries()) {
      const run = repository.createStageRun({
        jobId: script.jobId,
        stageId: 'narration',
        executor: 'stickman-audio',
        status: 'queued',
        scopeKey,
        inputFingerprint: String(index + 1).repeat(64)
      });
      expect((await runner.runStageRun(run.id)).status).toBe('succeeded');
    }
    const timingRun = repository.createStageRun({
      jobId: script.jobId,
      stageId: 'audio-timing',
      executor: 'stickman-audio',
      status: 'queued'
    });

    expect(await runner.runStageRun(timingRun.id)).toMatchObject({ status: 'succeeded' });
    const timingArtifact = service.getJob(script.jobId)!.artifacts.find(artifact => (
      artifact.kind === 'audio_timing' && artifact.status === 'completed'
    ));
    expect(timingArtifact).toMatchObject({
      metadata: {
        duration: 24.72,
        targetDurationSeconds: 30,
        durationDeltaSeconds: -5.28,
        durationWithinTargetRange: false
      }
    });
    expect(JSON.parse(readFileSync(timingArtifact!.path!, 'utf8'))).toMatchObject({
      totalDurationSeconds: 24.72
    });
    await runner.close();
    db.close();
  });

  it('fails before synthesis when no supported TTS provider is configured', async () => {
    const { db, repository, templates, script } = setupConfiguredJob({ configured: false });
    const synthesize = vi.fn();
    const config = createDefaultCreatorServicesConfig();
    config.tts.provider = 'edge-tts';
    const run = repository.createStageRun({
      jobId: script.jobId,
      stageId: 'narration',
      executor: 'stickman-audio',
      status: 'queued',
      scopeKey: 'segment-01',
      inputFingerprint: '1'.repeat(64)
    });
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      executors: [createStickmanAudioExecutor({
        configStore: { read: async () => config },
        ttsService: { synthesize: synthesize as never },
        ledger: new CreatorProviderRequestLedger(repository),
        ffprobePath: 'ffprobe-test',
        synthesize: synthesize as never,
        probe: async () => ({ duration: 1, hasVideo: false, hasAudio: true })
      })]
    });

    expect(await runner.runStageRun(run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'creator_tts_config_missing'
    });
    expect(synthesize).not.toHaveBeenCalled();
    await runner.close();
    db.close();
  });

  it('does not publish a narration artifact when the generated bytes are not valid audio', async () => {
    const { db, repository, service, templates, script } = setupConfiguredJob();
    const synthesize = vi.fn(async () => ({
      content: Buffer.from('not an audio file'),
      mime: 'audio/wav' as const,
      provider: 'openai' as const,
      model: 'gpt-4o-mini-tts',
      voiceId: 'alloy',
      format: 'wav' as const
    }));
    const run = repository.createStageRun({
      jobId: script.jobId,
      stageId: 'narration',
      executor: 'stickman-audio',
      status: 'queued',
      scopeKey: 'segment-01',
      inputFingerprint: '1'.repeat(64)
    });
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      executors: [createStickmanAudioExecutor({
        configStore: { read: async () => configuredTts() },
        ttsService: { synthesize },
        ledger: new CreatorProviderRequestLedger(repository),
        ffprobePath: 'ffprobe-test',
        synthesize,
        probe: async () => ({ duration: 0, hasVideo: false, hasAudio: false })
      })]
    });

    expect(await runner.runStageRun(run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'creator_audio_invalid'
    });
    expect(service.getJob(script.jobId)!.artifacts.filter(artifact => artifact.kind === 'narration_audio'))
      .toHaveLength(0);
    await runner.close();
    db.close();
  });
});

function setupConfiguredJob(options: {
  configured?: boolean;
  targetDurationSeconds?: number;
} = {}) {
  const targetDurationSeconds = options.targetDurationSeconds ?? 60;
  tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-audio-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const job = service.createJob({
    projectId: 'p1',
    templateId: 'stickman-video',
    state: options.configured === false
      ? {}
      : {
          ttsProvider: 'openai',
          ttsModel: 'gpt-4o-mini-tts',
          voiceCode: 'alloy',
          targetDurationSeconds
        }
  });
  const path = join(tempDir, 'script.json');
  writeFileSync(path, JSON.stringify({
    contract: 'stickman-narration-script-v2',
    reviewStatus: 'approved',
    contentLocked: true,
    title: '音频测试',
    language: 'zh-CN',
    targetDurationSeconds,
    narrationBudget: { unit: 'characters', unitsPerMinute: 240, minUnits: 1, maxUnits: 20 },
    segmentCount: 2,
    totalNarrationUnits: 10,
    estimatedTotalDurationSeconds: 2.5,
    segments: [
      { id: 'segment-01', order: 1, narration: '第一段旁白', claimIds: ['claim-001'], sourceSpanIds: ['source-001'], narrationUnits: 5, estimatedDurationSeconds: 1.25 },
      { id: 'segment-02', order: 2, narration: '第二段旁白', claimIds: ['claim-002'], sourceSpanIds: ['source-002'], narrationUnits: 5, estimatedDurationSeconds: 1.25 }
    ]
  }));
  const script = repository.insertArtifact({
    jobId: job.id,
    kind: 'script_manifest',
    status: 'completed',
    path,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    sourceArtifactIds: [],
    metadata: {}
  });
  repository.updateJob({
    id: job.id,
    status: job.status,
    revision: job.revision,
    state: { ...job.state, approvedScriptArtifactId: script.id }
  });
  return { db, repository, service, templates, script };
}

function configuredTts() {
  const config = createDefaultCreatorServicesConfig();
  config.tts.provider = 'openai';
  config.tts.openai.model = 'gpt-4o-mini-tts';
  config.tts.openai.defaultVoiceId = 'alloy';
  return config;
}
