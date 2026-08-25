import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorArtifact, CreatorJson } from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorExecutor, CreatorExecutorInput, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { createOpenAiCompatibleImageProvider } from '../image/openai-compatible-provider.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { validateImageFile } from '../validators/image.js';
import { validateMediaFile } from '../validators/media.js';
import { generateStickmanScript, parseStickmanScript, type StickmanScriptSegment } from './script-generator.js';
import { generateStickmanStoryboard } from './storyboard-generator.js';

export function createStickmanExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  ffmpegPath: string;
  ffprobePath: string;
}): CreatorExecutor {
  return {
    id: 'stickman',
    async run(stage) {
      switch (stage.stageRun.stageId) {
        case 'script': return runScript(input.configStore, stage);
        case 'storyboard': return runStoryboard(input.configStore, stage);
        case 'narration': return runNarration(input.configStore, input.ffprobePath, stage);
        case 'render': return runRender(input.ffmpegPath, input.ffprobePath, stage);
        default: throw new CreatorExecutorError('creator_stage_not_supported', 'Unsupported stickman stage');
      }
    }
  };
}

async function runScript(
  configStore: Pick<CreatorServicesConfigStore, 'read'>,
  stage: CreatorExecutorInput
) {
  const config = await configStore.read();
  if (!config.llm.apiKey) throw new CreatorExecutorError('creator_llm_config_missing', 'LLM configuration is incomplete');
  const topic = readStateString(stage, 'topic');
  const targetDurationSeconds = readStateNumber(stage, 'targetDurationSeconds', 30);
  const script = await generateStickmanScript({ ...config.llm, topic, targetDurationSeconds });
  const manifestPath = join(stage.workdir, 'script.json');
  await writeFile(manifestPath, `${JSON.stringify(script, null, 2)}\n`);
  const srtPath = join(stage.workdir, 'narration.srt');
  await writeFile(srtPath, createSrt(script.segments));
  const outputs: CreatorExecutorOutput[] = [
    { kind: 'script_manifest', status: 'completed', path: manifestPath, metadata: { title: script.title, segmentCount: script.segments.length } },
    { kind: 'target_subtitle', status: 'completed', path: srtPath, metadata: { generatedFor: 'stickman' } },
    ...script.segments.map(segment => ({
      kind: 'script_segment',
      status: 'completed' as const,
      path: null,
      metadata: segment as unknown as Record<string, CreatorJson>
    }))
  ];
  return {
    outputs
  };
}

async function runStoryboard(
  configStore: Pick<CreatorServicesConfigStore, 'read'>,
  stage: CreatorExecutorInput
) {
  const config = await configStore.read();
  if (!config.llm.apiKey || !config.image.openai.apiKey) {
    throw new CreatorExecutorError('creator_image_config_missing', 'LLM and image configuration are required');
  }
  const segments = currentSegments(stage.job.artifacts);
  if (segments.length === 0) throw new CreatorExecutorError('creator_stage_input_missing', 'Script segments are required');
  const shots = await generateStickmanStoryboard({
    ...config.llm,
    style: readStateString(stage, 'style', '极简黑白线稿'),
    characterPrompt: readStateString(stage, 'characterPrompt', '统一的极简火柴人角色'),
    segments
  });
  const provider = createOpenAiCompatibleImageProvider(config.image.openai);
  const ratio = readRatio(stage);
  const outputs: CreatorExecutorOutput[] = [];
  const manifest: Array<{ segmentId: string; path: string; motion: string }> = [];
  for (const shot of shots) {
    const segmentArtifact = latestSegmentArtifact(stage.job.artifacts, shot.segmentId);
    const result = await provider.generate({ prompt: shot.imagePrompt, ratio }, stage.signal);
    const path = join(stage.workdir, `${safeName(shot.segmentId)}.${result.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`);
    await writeFile(path, result.bytes);
    const metadata = await validateImageFile(path);
    manifest.push({ segmentId: shot.segmentId, path, motion: shot.motion });
    outputs.push({
      kind: 'storyboard_image',
      status: 'completed',
      path,
      sourceArtifactIds: segmentArtifact ? [segmentArtifact.id] : [],
      metadata: { ...metadata, segmentId: shot.segmentId, motion: shot.motion, prompt: shot.imagePrompt }
    });
  }
  const manifestPath = join(stage.workdir, 'storyboard.json');
  await writeFile(manifestPath, `${JSON.stringify({ shots: manifest }, null, 2)}\n`);
  outputs.unshift({
    kind: 'storyboard_manifest',
    status: 'completed',
    path: manifestPath,
    sourceArtifactIds: currentSegmentArtifacts(stage.job.artifacts).map(artifact => artifact.id),
    metadata: { shotCount: manifest.length, ratio }
  });
  return { outputs };
}

async function runNarration(
  configStore: Pick<CreatorServicesConfigStore, 'read'>,
  ffprobePath: string,
  stage: CreatorExecutorInput
) {
  const config = await configStore.read();
  if (config.tts.provider !== 'openai' || !config.tts.openai.apiKey) {
    throw new CreatorExecutorError('creator_tts_config_missing', '火柴人逐段配音当前需要 OpenAI-compatible TTS 配置');
  }
  const segments = currentSegments(stage.job.artifacts);
  const outputs: CreatorExecutorOutput[] = [];
  const manifest: Array<{ segmentId: string; path: string; duration: number }> = [];
  for (const segment of segments) {
    const response = await fetch(`${config.tts.openai.baseUrl.replace(/\/$/, '') || 'https://api.openai.com/v1'}/audio/speech`, {
      method: 'POST',
      signal: stage.signal,
      headers: { authorization: `Bearer ${config.tts.openai.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.tts.openai.model, voice: readStateString(stage, 'voice', 'alloy'), input: segment.narration, format: 'mp3' })
    });
    if (!response.ok) throw new CreatorExecutorError('creator_tts_failed', `TTS failed: HTTP ${response.status}`);
    const path = join(stage.workdir, `${safeName(segment.id)}.mp3`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    const media = await validateMediaFile(path, ffprobePath);
    const segmentArtifact = latestSegmentArtifact(stage.job.artifacts, segment.id);
    manifest.push({ segmentId: segment.id, path, duration: media.duration });
    outputs.push({
      kind: 'segment_audio', status: 'completed', path,
      sourceArtifactIds: segmentArtifact ? [segmentArtifact.id] : [],
      metadata: { ...media, segmentId: segment.id }
    });
  }
  const manifestPath = join(stage.workdir, 'narration.json');
  await writeFile(manifestPath, `${JSON.stringify({ segments: manifest }, null, 2)}\n`);
  outputs.unshift({
    kind: 'narration_manifest', status: 'completed', path: manifestPath,
    sourceArtifactIds: currentSegmentArtifacts(stage.job.artifacts).map(artifact => artifact.id),
    metadata: { segmentCount: manifest.length }
  });
  return { outputs };
}

async function runRender(ffmpegPath: string, ffprobePath: string, stage: CreatorExecutorInput) {
  const images = latestPerSegment(stage.job.artifacts, 'storyboard_image');
  const audios = latestPerSegment(stage.job.artifacts, 'segment_audio');
  const segments = currentSegments(stage.job.artifacts);
  if (images.size === 0 || audios.size === 0 || segments.length === 0) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Storyboard images and narration audio are required');
  }
  const dimensions = readRatio(stage) === '9:16' ? { width: 1080, height: 1920 }
    : readRatio(stage) === '1:1' ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 };
  const args: string[] = ['-y'];
  for (const segment of segments) {
    const image = images.get(segment.id)?.path;
    const audio = audios.get(segment.id)?.path;
    if (!image || !audio) throw new CreatorExecutorError('creator_stage_input_missing', `Missing assets for segment ${segment.id}`);
    args.push('-loop', '1', '-i', image, '-i', audio);
  }
  const filters: string[] = [];
  const concatInputs: string[] = [];
  segments.forEach((segment, index) => {
    const imageIndex = index * 2;
    const audioIndex = imageIndex + 1;
    filters.push(`[${imageIndex}:v]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${segment.durationSeconds},setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${audioIndex}:a]atrim=duration=${segment.durationSeconds},asetpts=PTS-STARTPTS[a${index}]`);
    concatInputs.push(`[v${index}][a${index}]`);
  });
  filters.push(`${concatInputs.join('')}concat=n=${segments.length}:v=1:a=1[outv][outa]`);
  const output = join(stage.workdir, 'stickman-video.mp4');
  args.push('-filter_complex', filters.join(';'), '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', output);
  await runProcess(ffmpegPath, args, stage.signal);
  return {
    outputs: [{
      kind: 'stickman_video', status: 'completed' as const, path: output,
      sourceArtifactIds: [...images.values(), ...audios.values()].map(artifact => artifact.id),
      metadata: await validateMediaFile(output, ffprobePath)
    }]
  };
}

function currentSegments(artifacts: CreatorArtifact[]): StickmanScriptSegment[] {
  return [...latestPerSegment(artifacts, 'script_segment').values()]
    .map(artifact => artifact.metadata as unknown as StickmanScriptSegment)
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
}

function currentSegmentArtifacts(artifacts: CreatorArtifact[]): CreatorArtifact[] {
  return [...latestPerSegment(artifacts, 'script_segment').values()];
}

function latestSegmentArtifact(artifacts: CreatorArtifact[], segmentId: string): CreatorArtifact | undefined {
  return latestPerSegment(artifacts, 'script_segment').get(segmentId);
}

function latestPerSegment(artifacts: CreatorArtifact[], kind: string): Map<string, CreatorArtifact> {
  const result = new Map<string, CreatorArtifact>();
  for (const artifact of artifacts) {
    if (artifact.kind !== kind || artifact.status !== 'completed') continue;
    const segmentId = artifact.metadata.segmentId ?? artifact.metadata.id;
    if (typeof segmentId === 'string') result.set(segmentId, artifact);
  }
  return result;
}

function createSrt(segments: StickmanScriptSegment[]): string {
  let cursor = 0;
  return `${segments.map((segment, index) => {
    const start = cursor;
    cursor += segment.durationSeconds * 1000;
    return `${index + 1}\n${formatSrt(start)} --> ${formatSrt(cursor)}\n${segment.narration}`;
  }).join('\n\n')}\n`;
}

function formatSrt(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = Math.floor(milliseconds % 1_000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}

function readStateString(stage: CreatorExecutorInput, key: string, fallback?: string): string {
  const value = stage.job.state[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new CreatorExecutorError('creator_stage_input_missing', `${key} is required`);
}

function readStateNumber(stage: CreatorExecutorInput, key: string, fallback: number): number {
  const value = stage.job.state[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readRatio(stage: CreatorExecutorInput): '16:9' | '1:1' | '9:16' {
  return stage.job.state.ratio === '1:1' || stage.job.state.ratio === '9:16' ? stage.job.state.ratio : '16:9';
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'segment';
}

function runProcess(binary: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnCreatorProcess(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] }, signal);
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new CreatorExecutorError('stickman_render_failed', stderr.slice(-2000))));
  });
}
