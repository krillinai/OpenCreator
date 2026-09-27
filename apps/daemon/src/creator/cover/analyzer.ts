import { z } from 'zod';
import type { CoverTextLanguage } from '@opencreator/protocol';
import {
  creatorServiceErrorInfo,
  fetchCreatorService,
  openAiCompatibleEndpoint
} from '../../creator-services/upstream-fetch.js';
import { coverLanguageLabel } from './styles.js';

const metadataSchema = z.object({
  id: z.string().default(''),
  title: z.string().min(1),
  description: z.string().optional(),
  uploader: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  thumbnail: z.string().url().optional(),
  tags: z.array(z.string()).optional()
}).passthrough();

const briefSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  headline: z.string().min(1),
  subheadline: z.string().default(''),
  emphasisTerms: z.array(z.string()).max(3).default([]),
  language: z.enum(['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR'])
}).strict();

export type CoverSourceMetadata = z.infer<typeof metadataSchema>;
export type CoverBrief = z.infer<typeof briefSchema>;

export function parseCoverSourceMetadata(value: unknown): CoverSourceMetadata {
  return metadataSchema.parse(value);
}

export function parseCoverBrief(value: unknown): CoverBrief {
  return briefSchema.parse(value);
}

export async function generateCoverBrief(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  proxy: string;
  metadata: CoverSourceMetadata;
  userPrompt: string;
  language: CoverTextLanguage;
  headlineOverride: string;
  subheadlineOverride: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CoverBrief> {
  const endpoint = openAiCompatibleEndpoint(input.baseUrl, 'chat/completions');
  const response = await fetchCreatorService({
    endpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: input.model,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          '根据公开视频标题和描述生成视频封面文案，只输出严格 JSON。',
          '不要设计画面、人物、场景、构图或 imagePrompt；视觉风格由后续固定模板负责。',
          `所有封面文字必须使用 ${coverLanguageLabel(input.language)}，language 字段必须是 "${input.language}"。`,
          '格式：{"title":"原视频标题","summary":"内容摘要","headline":"封面主标题","subheadline":"封面副标题","emphasisTerms":["需要视觉强调的词"],"language":"语言代码"}。',
          '主标题必须简短、有信息量并忠于视频内容；副标题可以为空，不得虚构标题和描述中不存在的事实。',
          '简体或繁体中文主标题建议 6-16 个汉字，英文主标题建议 3-8 个词，日文和韩文保持缩略图可读长度。',
          input.headlineOverride.trim()
            ? `用户指定主标题，必须逐字保留：${JSON.stringify(input.headlineOverride.trim())}`
            : '用户未指定主标题，请根据视频标题和描述生成。',
          input.subheadlineOverride.trim()
            ? `用户指定副标题，必须逐字保留：${JSON.stringify(input.subheadlineOverride.trim())}`
            : '用户未指定副标题，可以根据内容生成简短副标题或返回空字符串。',
          input.userPrompt.trim()
            ? `用户补充的内容侧重点：${input.userPrompt.trim()}`
            : '用户没有补充要求。',
          `视频元数据：${JSON.stringify({
            title: input.metadata.title,
            description: input.metadata.description?.slice(0, 6000) ?? '',
            uploader: input.metadata.uploader ?? '',
            duration: input.metadata.duration ?? null,
            tags: input.metadata.tags?.slice(0, 30) ?? []
          })}`
        ].join('\n')
      }]
    }),
    proxy: input.proxy,
    signal: input.signal,
    maxResponseBytes: 2 * 1024 * 1024,
    fetchImpl: input.fetchImpl
  });
  if (!response.ok) {
    const failure = await creatorServiceErrorInfo(response, 'Cover analysis', 'llm');
    throw Object.assign(new Error(failure.message), { publicFacts: failure.publicFacts });
  }
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('Cover analysis returned no brief');
  return parseCoverBrief(JSON.parse(content));
}
