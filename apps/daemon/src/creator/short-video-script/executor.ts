import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { CreatorJson } from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import {
  creatorServiceErrorInfo,
  fetchCreatorService,
  openAiCompatibleEndpoint
} from '../../creator-services/upstream-fetch.js';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { publicFactsFromFailure } from '../public-error-facts.js';

const scriptRequestSchema = z.object({
  topic: z.string().trim().min(1).max(5_000),
  audience: z.string().trim().max(500).default(''),
  platform: z.enum(['douyin', 'xiaohongshu', 'wechat-channels', 'bilibili', 'generic']),
  targetDurationSeconds: z.number().int().min(15).max(600),
  tone: z.enum(['natural', 'professional', 'energetic', 'storytelling']),
  extraRequirements: z.string().trim().max(2_000).default('')
}).passthrough();

const scriptBeatSchema = z.object({
  narration: z.string().trim().min(1).max(2_000),
  visualSuggestion: z.string().trim().min(1).max(1_000),
  durationSeconds: z.number().int().positive().max(180)
}).strict();

const generatedScriptSchema = z.object({
  title: z.string().trim().min(1).max(100).regex(/^[^\r\n]+$/),
  hook: scriptBeatSchema,
  segments: z.array(scriptBeatSchema).min(1).max(28),
  cta: scriptBeatSchema
}).strict();

const chatCompletionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().min(1) }).passthrough()
  }).passthrough()).min(1)
}).passthrough();

type ScriptRequest = z.infer<typeof scriptRequestSchema>;
type GeneratedScript = z.infer<typeof generatedScriptSchema>;
type ScriptBeat = z.infer<typeof scriptBeatSchema>;

const durationToleranceRatio = 0.1;

const platformLabels: Record<ScriptRequest['platform'], string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  'wechat-channels': '视频号',
  bilibili: 'Bilibili',
  generic: '通用短视频'
};

const toneLabels: Record<ScriptRequest['tone'], string> = {
  natural: '自然口语',
  professional: '专业清晰',
  energetic: '活泼有感染力',
  storytelling: '有故事感'
};

export function createShortVideoScriptExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  fetchImpl?: typeof fetch;
}): CreatorExecutor {
  return {
    id: 'short-video-script',
    async run(stage) {
      stage.reportProgress({ phase: 'validating', percent: 5 });
      const request = readRequest(stage.job.state);
      const config = await input.configStore.read();
      if (!config.llm.apiKey.trim()) {
        throw new CreatorExecutorError(
          'creator_llm_config_missing',
          'LLM configuration is incomplete'
        );
      }
      stage.reportProgress({ phase: 'generating_script', percent: 20 });
      try {
        const response = await fetchCreatorService({
          endpoint: openAiCompatibleEndpoint(config.llm.baseUrl, 'chat/completions'),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.llm.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.llm.model,
            response_format: { type: 'json_object' },
            messages: [{
              role: 'user',
              content: scriptPrompt(request)
            }]
          }),
          proxy: config.proxy,
          signal: stage.signal,
          maxResponseBytes: 2 * 1024 * 1024,
          ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl })
        });
        if (!response.ok) {
          const failure = await creatorServiceErrorInfo(response, 'Script generation', 'llm');
          throw new CreatorExecutorError(
            'creator_llm_upstream_error',
            failure.message,
            {},
            failure.publicFacts
          );
        }
        const payload = chatCompletionSchema.parse(await response.json() as unknown);
        const rawScript: unknown = JSON.parse(payload.choices[0]!.message.content);
        const script = generatedScriptSchema.parse(rawScript);
        const actualDurationSeconds = scriptBeats(script)
          .reduce((total, item) => total + item.beat.durationSeconds, 0);
        const toleranceSeconds = request.targetDurationSeconds * durationToleranceRatio;
        if (Math.abs(actualDurationSeconds - request.targetDurationSeconds) > toleranceSeconds) {
          throw new CreatorExecutorError(
            'creator_llm_upstream_error',
            `脚本总时长 ${actualDurationSeconds} 秒偏离目标 ${request.targetDurationSeconds} 秒，允许误差为 ±${toleranceSeconds} 秒，请重新生成。`
          );
        }
        const markdown = formatScript(script, request);
        const fileName = 'OpenCreator-short-video-script.md';
        const path = join(stage.workdir, fileName);
        await writeFile(path, markdown, { encoding: 'utf8', mode: 0o600 });
        return {
          outputs: [{
            kind: 'short_video_script',
            status: 'completed',
            path,
            metadata: {
              fileName,
              mimeType: 'text/markdown',
              bytes: Buffer.byteLength(markdown),
              sha256: createHash('sha256').update(markdown).digest('hex'),
              title: script.title,
              platform: request.platform,
              tone: request.tone,
              targetDurationSeconds: request.targetDurationSeconds,
              actualDurationSeconds,
              model: config.llm.model,
              settingsSnapshot: stage.job.state
            }
          }],
          progress: {
            phase: 'completed',
            percent: 100,
            completed: 1,
            failed: 0,
            total: 1
          }
        };
      } catch (error) {
        if (stage.signal.aborted) {
          throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
        }
        if (error instanceof CreatorExecutorError) throw error;
        throw new CreatorExecutorError(
          'creator_llm_upstream_error',
          'Script generation failed',
          {},
          publicFactsFromFailure(error, 'llm')
        );
      }
    }
  };
}

function readRequest(state: Record<string, CreatorJson>): ScriptRequest {
  const parsed = scriptRequestSchema.safeParse(state);
  if (!parsed.success) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      'Script settings are incomplete or invalid'
    );
  }
  return parsed.data;
}

function scriptPrompt(request: ScriptRequest): string {
  return [
    '生成一份可直接拍摄的短视频脚本，只输出严格 JSON。',
    '格式：{"title":"标题","hook":{"narration":"口播或对白","visualSuggestion":"画面建议","durationSeconds":3},"segments":[{"narration":"口播或对白","visualSuggestion":"画面建议","durationSeconds":10}],"cta":{"narration":"行动引导或收束语","visualSuggestion":"画面建议","durationSeconds":5}}。',
    'hook 必须快速进入主题；segments 要完整承载内容；cta 要自然，不得强行营销。',
    `各段 durationSeconds 必须是整数，总时长与目标时长的偏差不得超过 ${durationToleranceRatio * 100}%。`,
    '口播或对白要自然、可朗读；画面建议要具体，但不要生成图片提示词或视频提示词。',
    '必须忠于用户提供的素材，不得虚构事实、经历、数据、产品功效或引用。',
    '默认使用中文；如果素材明确要求其他语言，则按素材要求输出。',
    `发布平台或场景：${platformLabels[request.platform]}。`,
    `目标时长：${request.targetDurationSeconds} 秒。`,
    `表达语气：${toneLabels[request.tone]}。`,
    request.audience ? `目标受众：${request.audience}` : '目标受众：根据主题合理判断。',
    request.extraRequirements ? `补充要求：${request.extraRequirements}` : '没有其他补充要求。',
    `主题或素材：${request.topic}`
  ].join('\n');
}

function formatScript(script: GeneratedScript, request: ScriptRequest): string {
  let elapsed = 0;
  const rows = scriptBeats(script).map(({ label, beat }) => {
    const start = elapsed;
    elapsed += beat.durationSeconds;
    return `| ${label} | ${formatTimestamp(start)}-${formatTimestamp(elapsed)} | ${escapeTableCell(beat.narration)} | ${escapeTableCell(beat.visualSuggestion)} |`;
  });
  return [
    `# ${script.title}`,
    '',
    `> 平台：${platformLabels[request.platform]} · 目标时长：${request.targetDurationSeconds} 秒 · 语气：${toneLabels[request.tone]}`,
    '',
    '## 分段脚本',
    '',
    '| 段落 | 时间 | 口播 / 对白 | 画面建议 |',
    '| --- | --- | --- | --- |',
    ...rows,
    ''
  ].join('\n');
}

function scriptBeats(script: GeneratedScript): Array<{ label: string; beat: ScriptBeat }> {
  return [
    { label: '开场钩子', beat: script.hook },
    ...script.segments.map((beat, index) => ({ label: `内容 ${index + 1}`, beat })),
    { label: '行动引导', beat: script.cta }
  ];
}

function formatTimestamp(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
}
