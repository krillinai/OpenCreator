import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorArtifact, CreatorServicesConfig } from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { KrillinTtsService } from '../krillin/tts-service.js';
import type { CreatorExecutor, CreatorExecutorInput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { CreatorProviderRequestLedger } from '../provider-requests.js';
import { validateMediaFile, type MediaProbe } from '../validators/media.js';
import {
  stickmanAudioTimingSchema,
  stickmanScriptManifestSchema
} from './contracts.js';

type Synthesize = Pick<KrillinTtsService, 'synthesize'>['synthesize'];

export function createStickmanAudioExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  ttsService: Pick<KrillinTtsService, 'synthesize'>;
  ledger: CreatorProviderRequestLedger;
  ffprobePath: string;
  synthesize?: Synthesize;
  probe?: (path: string, ffprobe: string) => Promise<MediaProbe>;
}): CreatorExecutor {
  const synthesize = input.synthesize ?? (request => input.ttsService.synthesize(request));
  const probe = input.probe ?? validateMediaFile;
  return {
    id: 'stickman-audio',
    async run(stage) {
      if (stage.stageRun.stageId === 'narration') {
        return synthesizeSegment(stage, input, synthesize, probe);
      }
      if (stage.stageRun.stageId === 'audio-timing') {
        return buildAudioTiming(stage, probe, input.ffprobePath);
      }
      throw new CreatorExecutorError(
        'creator_stage_not_supported',
        `Unsupported stickman audio stage: ${stage.stageRun.stageId}`
      );
    }
  };
}

async function synthesizeSegment(
  stage: CreatorExecutorInput,
  input: {
    configStore: Pick<CreatorServicesConfigStore, 'read'>;
    ledger: CreatorProviderRequestLedger;
    ffprobePath: string;
  },
  synthesize: Synthesize,
  probe: (path: string, ffprobe: string) => Promise<MediaProbe>
) {
  const scopeKey = stage.stageRun.scopeKey;
  const fingerprint = stage.stageRun.inputFingerprint;
  if (scopeKey === null || fingerprint === null) {
    throw new CreatorExecutorError(
      'creator_stage_scope_missing',
      'Narration segment scope and fingerprint are required'
    );
  }
  const scriptArtifact = requireArtifact(stage.inputArtifacts, 'script_manifest');
  if (scriptArtifact.path === null) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Script file is required');
  }
  const script = stickmanScriptManifestSchema.parse(JSON.parse(
    await readFile(scriptArtifact.path, 'utf8')
  ));
  if (
    stage.job.state.approvedScriptArtifactId !== scriptArtifact.id
    || !script.contentLocked
    || script.reviewStatus !== 'approved'
  ) {
    throw new CreatorExecutorError(
      'creator_script_approval_required',
      'Narration requires the current locked script'
    );
  }
  const segment = script.segments.find(candidate => candidate.id === scopeKey);
  if (segment === undefined) {
    throw new CreatorExecutorError('creator_narration_segment_missing', `Script segment ${scopeKey} was not found`);
  }
  const segmentIndex = script.segments.findIndex(candidate => candidate.id === scopeKey);
  const segmentCount = script.segments.length;
  const config = await input.configStore.read();
  const selection = resolveTtsSelection(stage, config);
  const requestKey = `${stage.job.id}:narration:${scopeKey}:${fingerprint}`;
  const ledger = input.ledger.registerBeforeSubmit({
    jobId: stage.job.id,
    provider: selection.provider,
    stageRunId: stage.stageRun.id,
    scopeKey,
    requestKey,
    request: {
      textSha256: createHash('sha256').update(segment.narration).digest('hex'),
      provider: selection.provider,
      model: selection.model,
      voiceId: selection.voiceId,
      format: 'wav'
    }
  });
  input.ledger.markSubmitting(ledger.id);
  stage.reportProgress({
    phase: 'synthesizing',
    percent: Math.round(((segmentIndex + 0.1) / segmentCount) * 100),
    completed: segmentIndex,
    failed: 0,
    total: segmentCount,
    ledgerId: ledger.id
  });
  try {
    const result = await synthesize({
      text: segment.narration,
      provider: selection.provider,
      model: selection.model,
      voiceId: selection.voiceId,
      format: 'wav',
      signal: stage.signal
    });
    const path = join(stage.workdir, `${scopeKey}.wav`);
    await writeFile(path, result.content);
    const media = await probe(path, input.ffprobePath);
    if (!media.hasAudio || media.duration <= 0) {
      throw new CreatorExecutorError(
        'creator_audio_invalid',
        `Narration for ${scopeKey} is not a valid audio file`
      );
    }
    input.ledger.markSucceeded(ledger.id);
    return {
      outputs: [{
        kind: 'narration_audio',
        status: 'completed' as const,
        path,
        scopeKey,
        inputFingerprint: fingerprint,
        sourceArtifactIds: [scriptArtifact.id],
        metadata: {
          segmentId: scopeKey,
          duration: media.duration,
          hasAudio: media.hasAudio,
          provider: result.provider,
          model: result.model,
          voiceId: result.voiceId,
          mimeType: result.mime,
          ledgerId: ledger.id,
          timingSource: 'ffprobe'
        }
      }],
      progress: {
        phase: 'completed',
        percent: Math.round(((segmentIndex + 1) / segmentCount) * 100),
        completed: segmentIndex + 1,
        failed: 0,
        total: segmentCount,
        ledgerId: ledger.id
      }
    };
  } catch (error) {
    input.ledger.markFailed(ledger.id);
    if (error instanceof CreatorExecutorError) throw error;
    if (hasErrorCode(error)) {
      throw new CreatorExecutorError(error.code, error.message);
    }
    throw error;
  }
}

async function buildAudioTiming(
  stage: CreatorExecutorInput,
  probe: (path: string, ffprobe: string) => Promise<MediaProbe>,
  ffprobePath: string
) {
  const scriptArtifact = requireArtifact(stage.inputArtifacts, 'script_manifest');
  if (scriptArtifact.path === null) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Script file is required');
  }
  const script = stickmanScriptManifestSchema.parse(JSON.parse(
    await readFile(scriptArtifact.path, 'utf8')
  ));
  const audioArtifacts = stage.inputArtifacts.filter(artifact => (
    artifact.kind === 'narration_audio' && artifact.status === 'completed'
  ));
  const segments = [];
  let cursor = 0;
  for (const segment of script.segments) {
    const candidates = audioArtifacts.filter(artifact => artifact.scopeKey === segment.id);
    if (candidates.length !== 1) {
      throw new CreatorExecutorError(
        'creator_narration_incomplete',
        `Exactly one current narration artifact is required for ${segment.id}`
      );
    }
    const audio = candidates[0]!;
    if (audio.path === null || audio.sha256 === null) {
      throw new CreatorExecutorError(
        'creator_artifact_hash_missing',
        `Narration artifact for ${segment.id} is incomplete`
      );
    }
    const media = await probe(audio.path, ffprobePath);
    if (!media.hasAudio || media.duration <= 0) {
      throw new CreatorExecutorError('creator_audio_invalid', `Narration for ${segment.id} is invalid`);
    }
    const startSeconds = roundSeconds(cursor);
    const endSeconds = roundSeconds(startSeconds + media.duration);
    segments.push({
      segmentId: segment.id,
      startSeconds,
      endSeconds,
      durationSeconds: roundSeconds(endSeconds - startSeconds),
      audioArtifactId: audio.id,
      audioSha256: audio.sha256
    });
    cursor = endSeconds;
  }
  const timing = stickmanAudioTimingSchema.parse({
    scriptArtifactId: scriptArtifact.id,
    timingSource: 'ffprobe_cumulative_tts_duration',
    segments,
    totalDurationSeconds: roundSeconds(cursor)
  });
  const targetDurationSeconds = script.targetDurationSeconds;
  const minimumTargetSeconds = roundSeconds(targetDurationSeconds * 0.9);
  const maximumTargetSeconds = roundSeconds(targetDurationSeconds * 1.1);
  const path = join(stage.workdir, 'audio-timing.json');
  await writeFile(path, `${JSON.stringify(timing, null, 2)}\n`, 'utf8');
  return {
    outputs: [{
      kind: 'audio_timing',
      status: 'completed' as const,
      path,
      sourceArtifactIds: [scriptArtifact.id, ...audioArtifacts.map(artifact => artifact.id)],
      metadata: {
        timingSource: timing.timingSource,
        segmentCount: timing.segments.length,
        duration: timing.totalDurationSeconds,
        targetDurationSeconds,
        durationDeltaSeconds: roundSeconds(timing.totalDurationSeconds - targetDurationSeconds),
        durationWithinTargetRange: timing.totalDurationSeconds >= minimumTargetSeconds
          && timing.totalDurationSeconds <= maximumTargetSeconds
      }
    }],
    progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
  };
}

function resolveTtsSelection(stage: CreatorExecutorInput, config: CreatorServicesConfig) {
  const provider = stage.job.state.ttsProvider === 'openai'
    || stage.job.state.ttsProvider === 'aliyun'
    || stage.job.state.ttsProvider === 'minimax'
    ? stage.job.state.ttsProvider
    : config.tts.provider === 'edge-tts'
      ? undefined
      : config.tts.provider;
  if (provider === undefined) {
    throw new CreatorExecutorError(
      'creator_tts_config_missing',
      '请先在 AI 服务的配音服务中配置可用的配音 Provider'
    );
  }
  const providerConfig = config.tts[provider];
  const model = typeof stage.job.state.ttsModel === 'string' && stage.job.state.ttsModel.trim()
    ? stage.job.state.ttsModel.trim()
    : providerConfig.model;
  const voiceId = typeof stage.job.state.voiceCode === 'string' && stage.job.state.voiceCode.trim()
    ? stage.job.state.voiceCode.trim()
    : providerConfig.defaultVoiceId;
  if (!voiceId) {
    throw new CreatorExecutorError(
      'creator_tts_config_missing',
      '请先在 AI 服务的配音服务中选择默认音色'
    );
  }
  return { provider, model, voiceId };
}

function requireArtifact(artifacts: CreatorArtifact[], kind: string): CreatorArtifact {
  const artifact = artifacts.find(item => item.kind === kind && item.status === 'completed');
  if (artifact === undefined) {
    throw new CreatorExecutorError('creator_stage_input_missing', `${kind} artifact is required`);
  }
  return artifact;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function hasErrorCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error
    && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string';
}
