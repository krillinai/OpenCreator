import { z } from 'zod';
import {
  creatorServiceErrorMessage,
  fetchCreatorService,
  openAiCompatibleEndpoint
} from '../../creator-services/upstream-fetch.js';

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
  headline: z.string().default(''),
  imagePrompt: z.string().min(1),
  negativePrompt: z.string().default('')
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
          '根据公开视频元数据生成封面设计 brief，只输出严格 JSON。',
          '格式：{"title":"视频标题","summary":"内容摘要","headline":"封面短标题","imagePrompt":"可直接用于图像生成的完整英文提示词","negativePrompt":"应避免的元素"}。',
          'imagePrompt 必须描述主体、环境、构图、光线、色彩、视觉层级，并要求画面中不要生成不可控的文字。',
          input.userPrompt.trim()
            ? `用户补充要求：${input.userPrompt.trim()}`
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
    throw new Error(await creatorServiceErrorMessage(response, 'Cover analysis'));
  }
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('Cover analysis returned no brief');
  return parseCoverBrief(JSON.parse(content));
}
