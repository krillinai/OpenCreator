import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorArtifact, CreatorJson } from '@opencreator/protocol';
import type { CreatorExecutor, CreatorExecutorInput, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import {
  stickmanContentPlanSchema,
  stickmanPublishCopySchema,
  stickmanScriptManifestSchema,
  stickmanShotSpecSchema,
  stickmanSourceBriefSchema
} from './contracts.js';

type CompleteJson = (input: {
  stageId: string;
  prompt: string;
  signal: AbortSignal;
}) => Promise<unknown>;

export function createStickmanContentExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  completeJson?: CompleteJson;
}): CreatorExecutor {
  return {
    id: 'stickman-content',
    async run(stage) {
      const completeJson = input.completeJson ?? createConfiguredCompletion(input.configStore);
      switch (stage.stageRun.stageId) {
        case 'source-brief': return sourceBrief(stage, completeJson);
        case 'content-plan': return contentPlan(stage, completeJson);
        case 'script': return script(stage, completeJson);
        case 'storyboard': return storyboard(stage, completeJson);
        case 'publish-copy': return publishCopy(stage, completeJson);
        default: throw new CreatorExecutorError(
          'creator_stage_not_supported',
          `Unsupported stickman content stage: ${stage.stageRun.stageId}`
        );
      }
    }
  };
}

async function sourceBrief(stage: CreatorExecutorInput, complete: CompleteJson) {
  const source = requireArtifact(stage, 'source_subtitle');
  const transcript = source.path === null ? '' : await readFile(source.path, 'utf8');
  const value = stickmanSourceBriefSchema.parse(await complete({
    stageId: 'source-brief',
    prompt: `请将以下来源内容整理为严格 JSON 的标题、摘要和关键点。\n${transcript}`,
    signal: stage.signal
  }));
  return jsonOutput(stage, 'source_brief', 'source-brief.json', value, [source.id]);
}

async function contentPlan(stage: CreatorExecutorInput, complete: CompleteJson) {
  const source = requireArtifact(stage, 'source_brief');
  const brief = await readJson(source);
  const value = stickmanContentPlanSchema.parse(await complete({
    stageId: 'content-plan',
    prompt: `请把来源摘要规划为火柴人知识视频内容方案，返回严格 JSON。\n${JSON.stringify(brief)}`,
    signal: stage.signal
  }));
  return jsonOutput(stage, 'content_plan', 'content-plan.json', value, [source.id]);
}

async function script(stage: CreatorExecutorInput, complete: CompleteJson) {
  const source = requireArtifact(stage, 'content_plan');
  const plan = await readJson(source);
  const value = stickmanScriptManifestSchema.parse(await complete({
    stageId: 'script',
    prompt: `请生成完整火柴人视频旁白脚本，segment ID 必须稳定且以 segment- 开头。\n${JSON.stringify(plan)}`,
    signal: stage.signal
  }));
  const manifestPath = await writeJsonArtifact(stage, 'script-manifest.json', value);
  const subtitlePath = join(stage.workdir, 'narration.srt');
  await writeAtomic(subtitlePath, scriptSrt(value.segments));
  const outputs: CreatorExecutorOutput[] = [
    {
      kind: 'script_manifest',
      status: 'completed',
      path: manifestPath,
      sourceArtifactIds: [source.id],
      metadata: { contract: 'script_manifest-v1', segmentCount: value.segments.length }
    },
    {
      kind: 'narration_subtitle',
      status: 'completed',
      path: subtitlePath,
      sourceArtifactIds: [source.id],
      metadata: { cueCount: value.segments.length }
    }
  ];
  return {
    outputs
  };
}

async function storyboard(stage: CreatorExecutorInput, complete: CompleteJson) {
  const scriptArtifact = requireArtifact(stage, 'script_manifest');
  const scriptValue = stickmanScriptManifestSchema.parse(await readJson(scriptArtifact));
  const generated = await complete({
    stageId: 'storyboard',
    prompt: [
      '请为每个脚本段生成且只生成一个镜头，shot ID 以 shot- 开头，保留旁白、时长并生成图像提示词和运动方式。',
      JSON.stringify(scriptValue)
    ].join('\n'),
    signal: stage.signal
  });
  const raw = generated !== null && typeof generated === 'object' && !Array.isArray(generated)
    ? generated as Record<string, unknown>
    : {};
  const value = stickmanShotSpecSchema.parse({
    ...raw,
    scriptArtifactId: scriptArtifact.id
  });
  const shotSpec = await writeJsonArtifact(stage, 'shot-spec.json', value);
  const outputs: CreatorExecutorOutput[] = [
    {
      kind: 'shot_spec',
      status: 'completed',
      path: shotSpec,
      sourceArtifactIds: [scriptArtifact.id],
      metadata: { shotCount: value.shots.length, contract: 'stickman-shot-spec-v1' }
    },
    {
      kind: 'character_reference',
      status: 'completed',
      path: null,
      sourceArtifactIds: [scriptArtifact.id],
      metadata: {
        prompt: readStateString(stage, 'characterPrompt', '统一的极简火柴人角色'),
        style: readStateString(stage, 'style', '极简黑白线稿')
      }
    }
  ];
  return {
    outputs
  };
}

async function publishCopy(stage: CreatorExecutorInput, complete: CompleteJson) {
  const plan = requireArtifact(stage, 'content_plan');
  const scriptArtifact = requireArtifact(stage, 'script_manifest');
  const value = stickmanPublishCopySchema.parse(await complete({
    stageId: 'publish-copy',
    prompt: `请生成 YouTube 发布文案 JSON，包含 title、description、tags。\n${JSON.stringify(await readJson(plan))}\n${JSON.stringify(await readJson(scriptArtifact))}`,
    signal: stage.signal
  }));
  const path = join(stage.workdir, 'publish-copy-youtube.md');
  await writeAtomic(path, `# ${value.title}\n\n${value.description}\n\n## Tags\n\n${value.tags.map(tag => `- ${tag}`).join('\n')}\n`);
  return {
    outputs: [{
      kind: 'publish_copy',
      status: 'completed' as const,
      path,
      sourceArtifactIds: [plan.id, scriptArtifact.id],
      metadata: {
        title: value.title,
        tagCount: value.tags.length,
        fileName: 'publish-copy-youtube.md'
      }
    }]
  };
}

async function jsonOutput(
  stage: CreatorExecutorInput,
  kind: string,
  fileName: string,
  value: Record<string, unknown>,
  sourceArtifactIds: string[]
) {
  const path = await writeJsonArtifact(stage, fileName, value);
  return {
    outputs: [{
      kind,
      status: 'completed' as const,
      path,
      sourceArtifactIds,
      metadata: { contract: `${kind}-v1` }
    }]
  };
}

async function writeJsonArtifact(
  stage: CreatorExecutorInput,
  fileName: string,
  value: unknown
): Promise<string> {
  const path = join(stage.workdir, fileName);
  await writeAtomic(path, `${canonicalJson(value)}\n`);
  return path;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)])
  );
}

function requireArtifact(stage: CreatorExecutorInput, kind: string): CreatorArtifact {
  const artifact = stage.inputArtifacts.find(item => item.kind === kind && item.status === 'completed');
  if (artifact === undefined) {
    throw new CreatorExecutorError('creator_stage_input_missing', `${kind} artifact is required`);
  }
  return artifact;
}

async function readJson(artifact: CreatorArtifact): Promise<unknown> {
  if (artifact.path === null) {
    throw new CreatorExecutorError('creator_stage_input_missing', `${artifact.kind} file is required`);
  }
  return JSON.parse(await readFile(artifact.path, 'utf8'));
}

function readStateString(stage: CreatorExecutorInput, key: string, fallback: string): string {
  const value = stage.job.state[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function createConfiguredCompletion(
  configStore: Pick<CreatorServicesConfigStore, 'read'>
): CompleteJson {
  return async ({ prompt, signal }) => {
    const config = await configStore.read();
    if (!config.llm.apiKey.trim()) {
      throw new CreatorExecutorError('creator_llm_config_missing', 'LLM configuration is incomplete');
    }
    const response = await fetch(
      `${config.llm.baseUrl.replace(/\/$/, '') || 'https://api.openai.com/v1'}/chat/completions`,
      {
        method: 'POST',
        signal,
        headers: {
          authorization: `Bearer ${config.llm.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: config.llm.model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        })
      }
    );
    if (!response.ok) {
      throw new CreatorExecutorError('creator_llm_failed', `LLM request failed: HTTP ${response.status}`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new CreatorExecutorError('creator_llm_invalid_response', 'LLM response did not contain JSON');
    }
    try {
      return JSON.parse(content) as Record<string, CreatorJson>;
    } catch {
      throw new CreatorExecutorError('creator_llm_invalid_response', 'LLM response was not valid JSON');
    }
  };
}

function scriptSrt(segments: Array<{ narration: string; durationSeconds: number }>): string {
  let cursor = 0;
  return `${segments.map((segment, index) => {
    const start = cursor;
    cursor += Math.round(segment.durationSeconds * 1_000);
    return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(cursor)}\n${segment.narration}`;
  }).join('\n\n')}\n`;
}

function srtTimestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}
