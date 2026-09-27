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

const XIAOHONGSHU_TITLE_MAX_LENGTH = 20;
const XIAOHONGSHU_BODY_MAX_LENGTH = 1_000;

const generatedPostSchema = z.object({
  title: z.string().trim().min(1).max(XIAOHONGSHU_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(XIAOHONGSHU_BODY_MAX_LENGTH),
  hashtags: z.array(z.string().trim().min(1).max(40)).max(12).default([])
}).strict();

type XiaohongshuStyle = 'experience' | 'tutorial' | 'recommendation' | 'review';
type XiaohongshuLength = 'short' | 'medium' | 'long';

export function createXiaohongshuPostExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  fetchImpl?: typeof fetch;
}): CreatorExecutor {
  return {
    id: 'xiaohongshu-post',
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
      stage.reportProgress({ phase: 'generating_post', percent: 20 });
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
              content: postPrompt(request)
            }]
          }),
          proxy: config.proxy,
          signal: stage.signal,
          maxResponseBytes: 2 * 1024 * 1024,
          ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl })
        });
        if (!response.ok) {
          const failure = await creatorServiceErrorInfo(response, 'Post generation', 'llm');
          throw new CreatorExecutorError(
            'creator_llm_upstream_error',
            failure.message,
            {},
            failure.publicFacts
          );
        }
        const payload = await response.json() as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
          throw new CreatorExecutorError(
            'creator_llm_upstream_error',
            'Post generation returned no content'
          );
        }
        const post = generatedPostSchema.parse(JSON.parse(content));
        const markdown = formatPost(post);
        const fileName = 'OpenCreator-xiaohongshu-post.md';
        const path = join(stage.workdir, fileName);
        await writeFile(path, markdown, { encoding: 'utf8', mode: 0o600 });
        return {
          outputs: [{
            kind: 'xiaohongshu_post',
            status: 'completed',
            path,
            metadata: {
              fileName,
              mimeType: 'text/markdown',
              bytes: Buffer.byteLength(markdown),
              sha256: createHash('sha256').update(markdown).digest('hex'),
              title: post.title,
              hashtags: normalizedHashtags(post.hashtags),
              characterCount: [...post.body].length,
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
          'Post generation failed',
          {},
          publicFactsFromFailure(error, 'llm')
        );
      }
    }
  };
}

function readRequest(state: Record<string, CreatorJson>): {
  topic: string;
  audience: string;
  style: XiaohongshuStyle;
  length: XiaohongshuLength;
  extraRequirements: string;
} {
  const topic = readString(state.topic);
  if (!topic || [...topic].length > 5_000) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      'Post topic must contain between 1 and 5000 characters'
    );
  }
  const style = state.style;
  const length = state.length;
  if (!['experience', 'tutorial', 'recommendation', 'review'].includes(String(style))) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Post style is invalid');
  }
  if (!['short', 'medium', 'long'].includes(String(length))) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Post length is invalid');
  }
  return {
    topic,
    audience: readString(state.audience) ?? '',
    style: style as XiaohongshuStyle,
    length: length as XiaohongshuLength,
    extraRequirements: readString(state.extraRequirements) ?? ''
  };
}

function postPrompt(request: ReturnType<typeof readRequest>): string {
  const styleLabels: Record<XiaohongshuStyle, string> = {
    experience: '经验分享',
    tutorial: '教程干货',
    recommendation: '产品种草',
    review: '真实测评'
  };
  const lengthLabels: Record<XiaohongshuLength, string> = {
    short: '精简，约 300-500 字',
    medium: '标准，约 600-800 字',
    long: '详细，约 800-1000 字'
  };
  return [
    '生成一篇中文小红书帖子，只输出严格 JSON。',
    '格式：{"title":"标题","body":"正文","hashtags":["标签"]}。',
    `标题不超过 ${XIAOHONGSHU_TITLE_MAX_LENGTH} 个字符，正文不超过 ${XIAOHONGSHU_BODY_MAX_LENGTH} 个字符。`,
    '正文要自然、具体、便于阅读；可以分段和使用少量 emoji，但不要堆砌口号。',
    '标签不要带 #，只保留与内容直接相关的标签。',
    '必须忠于用户提供的素材，不得虚构亲身经历、产品功效、价格、数据或引用。',
    `内容类型：${styleLabels[request.style]}。`,
    `篇幅：${lengthLabels[request.length]}。`,
    request.audience ? `目标读者：${request.audience}` : '目标读者：根据主题合理判断。',
    request.extraRequirements ? `补充要求：${request.extraRequirements}` : '没有其他补充要求。',
    `主题或素材：${request.topic}`
  ].join('\n');
}

function formatPost(post: z.infer<typeof generatedPostSchema>): string {
  const tags = normalizedHashtags(post.hashtags).map(tag => `#${tag}`).join(' ');
  return `${[`# ${post.title}`, post.body, tags].filter(Boolean).join('\n\n')}\n`;
}

function normalizedHashtags(hashtags: string[]): string[] {
  return [...new Set(hashtags.map(tag => tag.replace(/^#+/, '').trim()).filter(Boolean))];
}

function readString(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
