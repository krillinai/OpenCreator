import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { CreatorArtifact, CreatorJob, CreatorServicesConfig } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { parseCreatorServicesConfig } from '../../src/creator-services/config-store.js';

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const enabled = process.env.OPENCREATOR_RUN_REAL_STICKMAN_E2E === '1';
const configPath = process.env.OPENCREATOR_STICKMAN_E2E_CONFIG;
const acceptanceSourceText = [
  '学习复杂主题可以分成三步。',
  '第一步，先明确要解决的问题。',
  '第二步，用一个具体例子验证自己的理解。',
  '第三步，复盘结果并记录下一次改进。',
  '这样做能把模糊目标转化为可执行行动。'
].join('');
const krillinRuntimeRoot = resolve(
  process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT
    ?? join(repoRoot, 'apps', 'desktop', '.pack', 'creator-runtime', 'krillinai')
);
const stickmanRuntimeRoot = resolve(
  process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT
    ?? join(repoRoot, 'apps', 'desktop', '.pack', 'stickman-runtime')
);
const execFileAsync = promisify(execFile);
let server: FastifyInstance | undefined;
let previousCreatorRuntimeRoot: string | undefined;
let previousStickmanRuntimeRoot: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  restoreEnvironment('OPENCREATOR_CREATOR_RUNTIME_ROOT', previousCreatorRuntimeRoot);
  restoreEnvironment('OPENCREATOR_STICKMAN_RUNTIME_ROOT', previousStickmanRuntimeRoot);
});

describe('stickman real provider pipeline', () => {
  it.skipIf(!enabled)(
    '通过公开 Creator API 生成并验证火柴人视频与旁白字幕',
    async () => {
      if (configPath === undefined) {
        throw new Error('真实火柴人 E2E 需要 OPENCREATOR_STICKMAN_E2E_CONFIG');
      }
      for (const path of [configPath, krillinRuntimeRoot, stickmanRuntimeRoot]) {
        if (!existsSync(path)) throw new Error(`真实火柴人 E2E 依赖不存在：${path}`);
      }

      const config = readPrivateConfig(configPath);
      const tts = configuredTts(config);
      const imageConfig = configuredImage(config);
      const evidenceRoot = createEvidenceRoot();
      previousCreatorRuntimeRoot = process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT;
      previousStickmanRuntimeRoot = process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT;
      process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT = krillinRuntimeRoot;
      process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT = stickmanRuntimeRoot;
      server = await buildServer({
        token: 'stickman-real-e2e',
        dataDir: join(evidenceRoot, 'runtime'),
        creatorServicesConfigStore: inMemoryConfigStore(config),
        codexProviderCredentialStore: {
          async readApiKey() { return undefined; },
          async writeApiKey() {}
        }
      });

      const created = await request('POST', '/creator/jobs', {
        projectId: 'project_stickman_real_e2e',
        templateId: 'stickman-video',
        state: {
          sourceType: 'text',
          sourceText: acceptanceSourceText,
          characterAsset: { assetId: 'stickman.character.student', revision: 1 },
          styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 },
          ratio: '16:9',
          targetDurationSeconds: 30,
          targetLanguage: 'zh-CN',
          ttsProvider: tts.provider,
          ttsModel: tts.model,
          voiceCode: tts.voiceId,
          voiceName: tts.voiceId,
          quality: 'medium'
        }
      });
      expect(created.statusCode).toBe(201);
      const jobId = created.json().job.id as string;

      const started = await request('POST', `/creator/jobs/${jobId}/actions`, {
        action: 'run-stage',
        expectedRevision: 0,
        input: { stageId: 'ingest-text' }
      });
      expect(started.statusCode).toBe(200);

      const finalScriptGate = await waitForReview(jobId, 'approve-script');
      await approve(jobId, finalScriptGate);
      const audioReady = await waitForJob(jobId, job => (
        latestCurrentArtifactOrUndefined(job, 'audio_timing') !== undefined
        && !job.stages.some(stage => stage.stageId === 'storyboard')
      ), 30 * 60_000);
      await continueAfterArtifact(jobId, audioReady, 'audio_timing', 'continue-after-audio');
      const visualsReady = await waitForJob(jobId, job => (
        latestCurrentArtifactOrUndefined(job, 'visual_validation') !== undefined
        && !job.stages.some(stage => stage.stageId === 'timeline')
      ), 30 * 60_000);
      await continueAfterArtifact(jobId, visualsReady, 'visual_validation', 'continue-after-visuals');
      const completed = await waitForJob(jobId, job => job.status === 'completed', 45 * 60_000);

      const ffprobePath = findRuntimeExecutable(krillinRuntimeRoot, /(?:^|\/)ffprobe(?:\.exe)?$/i);
      const stageById = new Map(completed.stages.map(stage => [stage.id, stage]));
      expect(completed.activities.filter(activity => activity.action === 'approve-script')).toHaveLength(1);
      expect(completed.activities.some(activity => activity.action === 'approve-visuals')).toBe(false);

      const scriptArtifact = latestCurrentArtifact(completed, 'script_manifest');
      const script = JSON.parse(readFileSync(scriptArtifact.path!, 'utf8')) as {
        title: string;
        language: string;
        reviewStatus: string;
        contentLocked: boolean;
        totalNarrationUnits: number;
        estimatedTotalDurationSeconds: number;
        narrationBudget: { minUnits: number; maxUnits: number };
        segments: Array<{
          id: string;
          narration: string;
          estimatedDurationSeconds: number;
          claimIds: string[];
          sourceSpanIds: string[];
        }>;
      };
      expect(script).toMatchObject({
        reviewStatus: 'approved',
        contentLocked: true,
        narrationBudget: { minUnits: 108, maxUnits: 132 }
      });
      expect(script.segments.length).toBeGreaterThan(0);
      expect(new Set(script.segments.map(segment => segment.id)).size).toBe(script.segments.length);
      expect(script.estimatedTotalDurationSeconds)
        .toBeGreaterThanOrEqual(27);
      expect(script.estimatedTotalDurationSeconds)
        .toBeLessThanOrEqual(33);
      const sourceBrief = readArtifactJson(completed, 'source_brief') as {
        claims: Array<{ id: string; sourceSpanIds: string[] }>;
        sourceSpans: Array<{ id: string }>;
      };
      const contentPlan = readArtifactJson(completed, 'content_plan') as {
        retainedClaimIds: string[];
        discardedClaimIds: string[];
      };
      const claimIds = new Set(sourceBrief.claims.map(claim => claim.id));
      const plannedClaimIds = new Set([
        ...contentPlan.retainedClaimIds,
        ...contentPlan.discardedClaimIds
      ]);
      expect(plannedClaimIds).toEqual(claimIds);
      expect(new Set(sourceBrief.claims.flatMap(claim => claim.sourceSpanIds))).toEqual(
        new Set(sourceBrief.sourceSpans.map(span => span.id))
      );
      const validSourceSpanIds = new Set(sourceBrief.sourceSpans.map(span => span.id));
      const claimSourceSpanIds = new Map(sourceBrief.claims.map(claim => [
        claim.id,
        new Set(claim.sourceSpanIds)
      ]));
      const retainedClaimIds = new Set(contentPlan.retainedClaimIds);
      const coveredClaimIds = new Set(script.segments.flatMap(segment => segment.claimIds));
      expect(coveredClaimIds).toEqual(retainedClaimIds);
      expect(script.segments.every(segment => (
        segment.claimIds.length > 0
        && segment.claimIds.every(claimId => retainedClaimIds.has(claimId))
        && segment.sourceSpanIds.length > 0
        && segment.sourceSpanIds.every(sourceSpanId => validSourceSpanIds.has(sourceSpanId))
        && segment.sourceSpanIds.every(sourceSpanId => segment.claimIds.some(claimId => (
          claimSourceSpanIds.get(claimId)?.has(sourceSpanId) === true
        )))
        && segment.estimatedDurationSeconds <= 5
      ))).toBe(true);
      expect(script.segments.map(segment => segment.narration).join('\n'))
        .not.toMatch(/火柴人|镜头|画面|动画|字幕|配音|提示词|旁白/);
      expect(completed.stages.some(stage => stage.stageId === 'semantic-review')).toBe(false);

      const narrationRuns = completed.stages.filter(stage => stage.stageId === 'narration');
      expect(narrationRuns).toHaveLength(script.segments.length);
      expect(narrationRuns.map(stage => stage.scopeKey)).toEqual(script.segments.map(segment => segment.id));
      for (const [index, stage] of narrationRuns.entries()) {
        expect(stage.status).toBe('succeeded');
        if (index > 0) {
          expect(Date.parse(stage.startedAt!)).toBeGreaterThanOrEqual(
            Date.parse(narrationRuns[index - 1]!.finishedAt!)
          );
        }
      }
      const narrationRequests = completed.providerRequests.filter(request => (
        stageById.get(request.stageRunId)?.stageId === 'narration'
      ));
      expect(narrationRequests).toHaveLength(script.segments.length);
      expect(narrationRequests.every(request => request.status === 'succeeded')).toBe(true);

      const narrationArtifacts = completed.artifacts.filter(artifact => (
        artifact.kind === 'narration_audio' && artifact.status === 'completed'
      ));
      expect(narrationArtifacts).toHaveLength(script.segments.length);
      expect(narrationArtifacts.map(artifact => artifact.scopeKey)).toEqual(
        script.segments.map(segment => segment.id)
      );
      for (const artifact of narrationArtifacts) {
        expect(artifact.sourceArtifactIds).toContain(scriptArtifact.id);
        expect(hashFile(artifact.path!)).toBe(artifact.sha256);
      }

      const timingArtifact = latestCurrentArtifact(completed, 'audio_timing');
      const timing = JSON.parse(readFileSync(timingArtifact.path!, 'utf8')) as {
        scriptArtifactId: string;
        timingSource: string;
        totalDurationSeconds: number;
        segments: Array<{
          segmentId: string;
          startSeconds: number;
          endSeconds: number;
          durationSeconds: number;
          audioArtifactId: string;
          audioSha256: string;
        }>;
      };
      expect(timing).toMatchObject({
        scriptArtifactId: scriptArtifact.id,
        timingSource: 'ffprobe_cumulative_tts_duration'
      });
      expect(timing.totalDurationSeconds).toBeGreaterThanOrEqual(27);
      expect(timing.totalDurationSeconds).toBeLessThanOrEqual(33);
      expect(timing.segments).toHaveLength(script.segments.length);
      let timingCursor = 0;
      for (const row of timing.segments) {
        const audio = narrationArtifacts.find(artifact => artifact.id === row.audioArtifactId)!;
        const probe = await probeMedia(ffprobePath, audio.path!);
        expect(row.segmentId).toBe(audio.scopeKey);
        expect(row.audioSha256).toBe(audio.sha256);
        expect(Math.abs(row.startSeconds - timingCursor)).toBeLessThan(0.002);
        expect(Math.abs(row.durationSeconds - probe.duration)).toBeLessThan(0.08);
        expect(Math.abs(row.endSeconds - row.startSeconds - row.durationSeconds)).toBeLessThan(0.002);
        timingCursor = row.endSeconds;
      }
      expect(Math.abs(timing.totalDurationSeconds - timingCursor)).toBeLessThan(0.002);

      const audioTimingRun = completed.stages.find(stage => stage.stageId === 'audio-timing')!;
      const storyboardRuns = completed.stages.filter(stage => stage.stageId === 'storyboard');
      expect(storyboardRuns).toHaveLength(1);
      expect(Date.parse(storyboardRuns[0]!.startedAt!)).toBeGreaterThanOrEqual(
        Date.parse(audioTimingRun.finishedAt!)
      );
      const shotSpecArtifact = latestCurrentArtifact(completed, 'shot_spec');
      const shotSpec = JSON.parse(readFileSync(shotSpecArtifact.path!, 'utf8')) as {
        scriptArtifactId: string;
        audioTimingArtifactId: string;
        timingSource: string;
        shots: Array<{
          id: string;
          sourceSegmentId: string;
          semanticAnchor: string;
          visualDescription: string;
          compositionAndAction: string;
          keyObjects: string[];
          continuityReason: string;
          motionReason: string;
          startSeconds: number;
          endSeconds: number;
          durationSeconds: number;
        }>;
      };
      expect(shotSpec.scriptArtifactId).toBe(scriptArtifact.id);
      expect(shotSpec.audioTimingArtifactId).toBe(timingArtifact.id);
      expect(shotSpec.timingSource).toBe('ffprobe_cumulative_tts_duration');
      expect(shotSpec.shots).toHaveLength(script.segments.length);
      expect(shotSpec.shots.every(shot => (
        shot.semanticAnchor.trim().length > 0
        && shot.visualDescription.trim().length > 0
        && shot.compositionAndAction.trim().length > 0
        && shot.keyObjects.length > 0
        && shot.motionReason.trim().length > 0
      ))).toBe(true);
      expect(shotSpec.shots.map(shot => ({
        segmentId: shot.sourceSegmentId,
        startSeconds: shot.startSeconds,
        endSeconds: shot.endSeconds,
        durationSeconds: shot.durationSeconds
      }))).toEqual(timing.segments.map(row => ({
        segmentId: row.segmentId,
        startSeconds: row.startSeconds,
        endSeconds: row.endSeconds,
        durationSeconds: row.durationSeconds
      })));

      const studentPath = join(stickmanRuntimeRoot, 'characters', 'student.png');
      const studentSha256 = hashFile(studentPath);
      const character = latestCurrentArtifact(completed, 'character_reference');
      expect(character.metadata).toMatchObject({
        assetId: 'stickman.character.student',
        revision: 1
      });
      expect(character.sha256).toBe(studentSha256);
      expect(hashFile(character.path!)).toBe(studentSha256);

      const shotImages = completed.artifacts.filter(artifact => (
        artifact.kind === 'shot_image' && artifact.status === 'completed'
      ));
      const shotImageByScope = new Map(shotImages.map(image => [image.scopeKey, image]));
      expect(shotImages).toHaveLength(script.segments.length);
      expect(new Set(shotImages.map(artifact => artifact.sha256)).size).toBe(shotImages.length);
      for (const [shotIndex, shot] of shotSpec.shots.entries()) {
        const image = shotImageByScope.get(shot.id)!;
        const previousImage = shotIndex > 0 && shot.continuityReason.trim().length > 0
          ? shotImageByScope.get(shotSpec.shots[shotIndex - 1]!.id)
          : undefined;
        const referenceImages = [{
          role: 'character_identity',
          sha256: studentSha256,
          mimeType: 'image/png',
          artifactId: character.id
        }, ...(previousImage === undefined ? [] : [{
          role: 'previous_shot',
          sha256: previousImage.sha256,
          mimeType: 'image/png',
          artifactId: previousImage.id
        }])];
        const requestReferenceSha256 = createHash('sha256')
          .update(referenceImages.map(reference => `${reference.role}:${reference.sha256}`).join('\n'))
          .digest('hex');
        const dimensions = await sharp(image.path!).metadata();
        expect(dimensions.width).toBeTruthy();
        expect(dimensions.height).toBeTruthy();
        expect(Math.abs(dimensions.width! / dimensions.height! - 16 / 9)).toBeLessThan(0.03);
        expect(image.metadata).toMatchObject({
          characterReferenceArtifactId: character.id,
          characterReferenceSha256: studentSha256,
          requestReferenceSha256,
          referenceImages,
          ...(previousImage === undefined ? {} : {
            previousShotArtifactId: previousImage.id,
            previousShotSha256: previousImage.sha256
          }),
          characterAssetId: 'stickman.character.student',
          styleAssetId: 'stickman.style.minimal-ink',
          referenceImagePreparation: 'original-bytes-v2',
          imagePromptContract: 'stickman-visual-profile-prompt-v2',
          provider: imageConfig.provider,
          model: imageConfig.model
        });
      }
      const imageRequests = completed.providerRequests.filter(request => (
        stageById.get(request.stageRunId)?.stageId === 'images'
      ));
      expect(imageRequests.length).toBeGreaterThanOrEqual(script.segments.length);
      expect(imageRequests.every(request => request.status === 'succeeded')).toBe(true);
      for (const [shotIndex, shot] of shotSpec.shots.entries()) {
        const image = shotImageByScope.get(shot.id)!;
        const previousImage = shotIndex > 0 && shot.continuityReason.trim().length > 0
          ? shotImageByScope.get(shotSpec.shots[shotIndex - 1]!.id)
          : undefined;
        const referenceImages = [{
          role: 'character_identity',
          sha256: studentSha256,
          mimeType: 'image/png',
          artifactId: character.id
        }, ...(previousImage === undefined ? [] : [{
          role: 'previous_shot',
          sha256: previousImage.sha256,
          mimeType: 'image/png',
          artifactId: previousImage.id
        }])];
        const requestReferenceSha256 = createHash('sha256')
          .update(referenceImages.map(reference => `${reference.role}:${reference.sha256}`).join('\n'))
          .digest('hex');
        const expectedRequestHash = hashRequest({
          prompt: String(image.metadata.prompt),
          provider: imageConfig.provider,
          size: '1536x1024',
          quality: 'medium',
          count: 1,
          model: imageConfig.model,
          characterReferenceSha256: studentSha256,
          requestReferenceSha256,
          characterReferenceMime: 'image/png',
          referenceImages,
          characterAsset: { assetId: 'stickman.character.student', revision: 1 },
          styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 },
          referenceImagePreparation: 'original-bytes-v2',
          imagePromptContract: 'stickman-visual-profile-prompt-v2'
        });
        expect(imageRequests.some(request => (
          request.scopeKey === image.scopeKey && request.requestHash === expectedRequestHash
        ))).toBe(true);
      }

      const timelineArtifact = latestCurrentArtifact(completed, 'timeline_manifest');
      const timeline = JSON.parse(readFileSync(timelineArtifact.path!, 'utf8')) as {
        fps: number;
        width: number;
        height: number;
        totalFrames: number;
        shots: Array<{
          shotId: string;
          imageArtifactId: string;
          audioArtifactId: string;
          imageSha256: string;
          audioSha256: string;
        }>;
      };
      expect(timeline).toMatchObject({
        width: 1280,
        height: 720
      });
      expect(timeline).not.toHaveProperty('assets');
      expect(timeline.shots).toHaveLength(script.segments.length);
      for (const shot of timeline.shots) {
        const image = shotImages.find(artifact => artifact.id === shot.imageArtifactId)!;
        const audio = narrationArtifacts.find(artifact => artifact.id === shot.audioArtifactId)!;
        expect(shot.imageSha256).toBe(image.sha256);
        expect(shot.audioSha256).toBe(audio.sha256);
      }
      const narrationSubtitle = readFileSync(
        latestCurrentArtifact(completed, 'narration_subtitle').path!,
        'utf8'
      );
      const narrationCues = parseSrtCues(narrationSubtitle);
      expect(narrationCues).toHaveLength(script.segments.length);
      for (const [index, cue] of narrationCues.entries()) {
        expect(Math.abs(cue.startSeconds - timing.segments[index]!.startSeconds)).toBeLessThan(0.002);
        expect(Math.abs(cue.endSeconds - timing.segments[index]!.endSeconds)).toBeLessThan(0.002);
        expect(cue.text).toBe(script.segments[index]!.narration);
      }

      const mediaValidation = readArtifactJson(completed, 'media_validation') as {
        ok: boolean;
        validation: string;
        cleanVideoArtifactId: string;
        cleanVideoSha256: string;
        sampledFrames: Array<{ sha256: string; width: number; height: number }>;
      };
      expect(mediaValidation).toMatchObject({
        ok: true,
        validation: 'ffprobe_and_three_frame_sampling'
      });
      expect(mediaValidation.sampledFrames).toHaveLength(3);
      expect(mediaValidation.sampledFrames.every(frame => (
        frame.width === 1280 && frame.height === 720 && /^[a-f0-9]{64}$/i.test(frame.sha256)
      ))).toBe(true);

      const deliveryKinds = [
        'clean_video',
        'narration_subtitle'
      ] as const;
      const deliveries = deliveryKinds.map(kind => requireDelivery(completed, kind));
      for (const artifact of deliveries) {
        expect(artifact.path, `${artifact.kind} 路径`).toBeTruthy();
        expect(statSync(artifact.path!).size, `${artifact.kind} 文件大小`).toBeGreaterThan(0);
        expect(hashFile(artifact.path!), `${artifact.kind} Artifact 哈希`).toBe(artifact.sha256);
      }
      const video = requireDelivery(completed, 'clean_video');
      const probe = await probeMedia(ffprobePath, video.path!);
      expect(probe.streams).toEqual(expect.arrayContaining([
        expect.objectContaining({ codec_type: 'video', width: 1280, height: 720 }),
        expect.objectContaining({ codec_type: 'audio' })
      ]));
      expect(probe.duration).toBeGreaterThan(0);
      const subtitle = readFileSync(
        requireDelivery(completed, 'narration_subtitle').path!,
        'utf8'
      );
      expect(subtitle).toMatch(/\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} --> /);
      expect(subtitle.split(/\r?\n/).filter(line => line.trim().length > 0).length)
        .toBeGreaterThanOrEqual(4);

      const manifestArtifact = latestCurrentArtifact(completed, 'delivery_manifest');
      const manifest = JSON.parse(readFileSync(manifestArtifact.path!, 'utf8')) as {
        packageStatus: string;
        placeholderAssets: string[];
        blockingChecks: string[];
        files: Array<{
          name: string;
          relativePath: string;
          sha256: string;
          bytes: number;
          sourceArtifactId: string;
        }>;
      };
      expect(manifest).toMatchObject({
        packageStatus: 'publishable',
        placeholderAssets: [],
        blockingChecks: []
      });
      expect(manifest.files).toHaveLength(2);
      for (const file of manifest.files) {
        const source = completed.artifacts.find(item => item.id === file.sourceArtifactId);
        const delivery = deliveries.find(item => item.sha256 === file.sha256);
        expect(source, `Manifest 来源 ${file.sourceArtifactId}`).toBeDefined();
        expect(delivery, `Manifest 交付 ${file.name}`).toBeDefined();
        expect(file.sha256).toBe(source!.sha256);
        expect(file.bytes).toBe(statSync(source!.path!).size);
      }

      const summary = {
        jobId,
        evidenceRoot,
        providerRequestCount: completed.providerRequests.length,
        billingRequestCount: completed.providerRequests.filter(item => item.billingSideEffect).length,
        deliveries: Object.fromEntries(deliveries.map(item => [item.kind, {
          path: item.path,
          sha256: item.sha256,
          bytes: statSync(item.path!).size
        }])),
        manifest: {
          path: manifestArtifact.path,
          sha256: manifestArtifact.sha256,
          files: manifest.files
        }
      };
      writeFileSync(
        join(evidenceRoot, 'stickman-real-pipeline-summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
        'utf8'
      );
      console.info(
        `真实火柴人流水线证据：${evidenceRoot}；Provider 请求 ${summary.providerRequestCount} 次，`
        + `计费请求 ${summary.billingRequestCount} 次`
      );
    },
    50 * 60_000
  );
});

function readPrivateConfig(path: string): CreatorServicesConfig {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const candidate = isRecord(parsed) && 'config' in parsed ? parsed.config : parsed;
  const config = parseCreatorServicesConfig(candidate);
  if (
    (config.llm.source === 'custom' && !config.llm.apiKey.trim())
  ) {
    throw new Error('真实火柴人 E2E 配置必须包含可用的真实 LLM');
  }
  configuredImage(config);
  return config;
}

function configuredImage(config: CreatorServicesConfig): {
  provider: 'openai' | 'gemini';
  model: string;
} {
  const provider = config.image.provider;
  if (provider !== 'openai' && provider !== 'gemini') {
    throw new Error('真实火柴人 E2E 的生图服务必须支持角色参考图（OpenAI 或 Gemini）');
  }
  const providerConfig = config.image[provider];
  if (!providerConfig.apiKey.trim() || !providerConfig.model.trim()) {
    throw new Error(`真实火柴人 E2E 的 ${provider} 生图服务必须配置 API Key 和模型`);
  }
  return { provider, model: providerConfig.model.trim() };
}

function inMemoryConfigStore(config: CreatorServicesConfig) {
  let current = structuredClone(config);
  return {
    async read() { return structuredClone(current); },
    async write(next: CreatorServicesConfig) {
      current = structuredClone(next);
      return structuredClone(current);
    },
    async reset() {
      current = structuredClone(config);
      return structuredClone(current);
    }
  };
}

function configuredTts(config: CreatorServicesConfig): {
  provider: 'openai' | 'aliyun' | 'minimax';
  model: string;
  voiceId: string;
} {
  const provider = config.tts.provider;
  if (provider === 'edge-tts') {
    throw new Error('真实火柴人 E2E 必须配置真实配音服务，不能使用本地 edge-tts');
  }
  const providerConfig = config.tts[provider];
  if (!providerConfig.defaultVoiceId.trim()) {
    throw new Error('真实火柴人 E2E 的配音服务必须配置默认音色');
  }
  return {
    provider,
    model: providerConfig.model,
    voiceId: providerConfig.defaultVoiceId
  };
}

async function approve(
  jobId: string,
  job: CreatorJob
): Promise<void> {
  const needsInput = readNeedsInput(job);
  const response = await request('POST', `/creator/jobs/${jobId}/actions`, {
    action: 'approve-script',
    expectedRevision: job.revision,
    input: {
      artifactId: needsInput.artifactId,
      revision: job.revision
    }
  });
  expect(response.statusCode).toBe(200);
}

async function continueAfterArtifact(
  jobId: string,
  job: CreatorJob,
  artifactKind: 'audio_timing' | 'visual_validation',
  action: 'continue-after-audio' | 'continue-after-visuals'
): Promise<void> {
  const artifact = latestCurrentArtifact(job, artifactKind);
  const response = await request('POST', `/creator/jobs/${jobId}/actions`, {
    action,
    expectedRevision: job.revision,
    input: { artifactId: artifact.id, revision: job.revision }
  });
  expect(response.statusCode).toBe(200);
}

async function waitForReview(
  jobId: string,
  kind: 'approve-script'
): Promise<CreatorJob> {
  return waitForJob(jobId, job => (
    job.status === 'needs_input' && readNeedsInput(job).kind === kind
  ), 30 * 60_000);
}

async function waitForJob(
  jobId: string,
  predicate: (job: CreatorJob) => boolean,
  timeoutMs: number
): Promise<CreatorJob> {
  const deadline = Date.now() + timeoutMs;
  let latest: CreatorJob | undefined;
  while (Date.now() < deadline) {
    const response = await request('GET', `/creator/jobs/${jobId}`);
    expect(response.statusCode).toBe(200);
    latest = response.json().job as CreatorJob;
    if (predicate(latest)) return latest;
    if (latest.status === 'failed' || latest.status === 'canceled') {
      const stage = latest.stages.at(-1);
      throw new Error(
        `真实火柴人流水线提前终止：${latest.status} ${stage?.stageId ?? ''} `
        + `${stage?.errorCode ?? ''} ${stage?.errorMessage ?? ''}`
      );
    }
    const needsInput = latest.state.needsInput;
    if (latest.status === 'needs_input' && isRecord(needsInput)) {
      throw new Error(
        `真实火柴人流水线需要额外输入：${String(needsInput.code ?? needsInput.kind ?? 'unknown')} `
        + `${String(needsInput.message ?? '')}`
      );
    }
    if (
      isRecord(needsInput)
      && needsInput.code === 'creator_provider_resolution_required'
    ) {
      throw new Error(`真实 Provider 接受状态未知，需要人工处置：${JSON.stringify(needsInput)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `等待真实火柴人流水线超时：${jobId} ${latest?.status ?? 'unknown'} `
    + `${latest?.stages.at(-1)?.stageId ?? ''}`
  );
}

function readNeedsInput(job: CreatorJob): { kind: string; artifactId: string } {
  const value = job.state.needsInput;
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.artifactId !== 'string') {
    return { kind: '', artifactId: '' };
  }
  return { kind: value.kind, artifactId: value.artifactId };
}

function requireDelivery(job: CreatorJob, kind: string): CreatorArtifact {
  const candidates = job.artifacts.filter(item => (
    item.kind === kind
    && item.status === 'completed'
    && item.metadata.delivery === true
  ));
  if (candidates.length !== 1) {
    throw new Error(`真实交付 ${kind} 数量错误：${candidates.length}`);
  }
  return candidates[0]!;
}

function latestCurrentArtifact(job: CreatorJob, kind: string): CreatorArtifact {
  const artifact = latestCurrentArtifactOrUndefined(job, kind);
  if (artifact?.path === null || artifact === undefined) {
    throw new Error(`缺少当前真实工件：${kind}`);
  }
  return artifact;
}

function latestCurrentArtifactOrUndefined(
  job: CreatorJob,
  kind: string
): CreatorArtifact | undefined {
  return [...job.artifacts].reverse().find(item => (
    item.kind === kind && item.status === 'completed'
  ));
}

function readArtifactJson(job: CreatorJob, kind: string): unknown {
  return JSON.parse(readFileSync(latestCurrentArtifact(job, kind).path!, 'utf8')) as unknown;
}

async function probeMedia(ffprobePath: string, path: string): Promise<{
  streams: Array<{ codec_type?: string; width?: number; height?: number }>;
  duration: number;
}> {
  const value = JSON.parse((await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'json',
    path
  ], { windowsHide: true })).stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  return {
    streams: value.streams ?? [],
    duration: Number(value.format?.duration ?? 0)
  };
}

function parseSrtCues(content: string): Array<{
  startSeconds: number;
  endSeconds: number;
  text: string;
}> {
  return content.trim().split(/\r?\n\r?\n/).map(block => {
    const lines = block.split(/\r?\n/);
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(lines[1] ?? '');
    if (match === null) throw new Error(`无效的旁白 SRT cue：${block}`);
    return {
      startSeconds: srtTime(match.slice(1, 5).map(Number)),
      endSeconds: srtTime(match.slice(5, 9).map(Number)),
      text: lines.slice(2).join('\n').trim()
    };
  });
}

function srtTime(parts: number[]): number {
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]! + parts[3]! / 1000;
}

function hashRequest(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, sortJson(entry)]));
}

function findRuntimeExecutable(runtimeRoot: string, pattern: RegExp): string {
  const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8')) as {
    resources: Array<{ path: string; kind: string }>;
  };
  const resource = manifest.resources.find(item => item.kind === 'executable' && pattern.test(item.path));
  if (resource === undefined) throw new Error(`Runtime 缺少可执行文件：${pattern}`);
  return resolve(runtimeRoot, resource.path);
}

function createEvidenceRoot(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = resolve(
    process.env.OPENCREATOR_STICKMAN_E2E_EVIDENCE_DIR
      ?? join(repoRoot, 'test-results', 'stickman-real-pipeline', timestamp)
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function request(
  method: 'GET' | 'POST',
  url: string,
  payload?: object
): Promise<{ statusCode: number; json(): any }> {
  return await server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer stickman-real-e2e' },
    ...(payload === undefined ? {} : { payload })
  }) as unknown as { statusCode: number; json(): any };
}
