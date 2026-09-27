import type { WechatArticleImagePlanItem, WechatArticleTopic } from '@opencreator/protocol';
import { z } from 'zod';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import {
  creatorServiceErrorInfo,
  fetchCreatorService,
  openAiCompatibleEndpoint
} from '../../creator-services/upstream-fetch.js';
import { CreatorExecutorError } from '../executor.js';
import type { ExtractedArticleSource } from './source-extractor.js';

const topicsSchema = z.object({
  topics: z.array(z.object({
    title: z.string().min(1).max(160),
    angle: z.string().max(500).default(''),
    summary: z.string().max(1_000).default('')
  }).strict()).min(1).max(10)
}).strict();

const imagePlanSchema = z.object({
  images: z.array(z.object({
    caption: z.string().min(1).max(200),
    placementHeading: z.string().min(1).max(200),
    prompt: z.string().min(1).max(2_000)
  }).strict()).min(1).max(10)
}).strict();

export function createWechatArticleModel(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  fetchImpl?: typeof fetch;
}) {
  async function complete(request: {
    prompt: string;
    signal: AbortSignal;
    json?: boolean;
  }): Promise<string> {
    const config = await input.configStore.read();
    if (!config.llm.apiKey.trim() || !config.llm.model.trim()) {
      throw new CreatorExecutorError('creator_llm_config_missing', 'LLM configuration is incomplete');
    }
    const response = await fetchCreatorService({
      endpoint: openAiCompatibleEndpoint(config.llm.baseUrl, 'chat/completions'),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.llm.model,
        ...(request.json && config.llm.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'user', content: request.prompt }]
      }),
      proxy: config.proxy,
      signal: request.signal,
      maxResponseBytes: 4 * 1024 * 1024,
      fetchImpl: input.fetchImpl
    });
    if (!response.ok) {
      const failure = await creatorServiceErrorInfo(response, 'Article writing', 'llm');
      throw new CreatorExecutorError(
        'creator_llm_upstream_error',
        failure.message,
        {},
        failure.publicFacts
      );
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    const raw = payload.choices?.[0]?.message?.content;
    const content = typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map(item => item.text ?? '').join('')
        : '';
    if (!content.trim()) {
      throw new CreatorExecutorError('creator_llm_empty_response', 'Article writing returned no content');
    }
    return content.trim();
  }

  return {
    async generateTopics(request: {
      sources: ExtractedArticleSource[];
      writingPrompt: string;
      templatePrompt: string;
      count: number;
      signal: AbortSignal;
    }): Promise<WechatArticleTopic[]> {
      const parsed = topicsSchema.parse(parseJson(await complete({
        json: true,
        signal: request.signal,
        prompt: [
          '你是一名资深微信公众号主编。请根据来源和用户要求提出可直接写作的选题。',
          `生成 ${request.count} 个差异明显的选题，只输出严格 JSON：{"topics":[{"title":"标题","angle":"核心切入角度","summary":"文章内容摘要"}]}`,
          '标题要具体、克制、有信息量，不使用虚假数据或来源没有支持的结论。',
          request.templatePrompt.trim() ? `文章模板规则：\n${request.templatePrompt}` : '',
          request.writingPrompt.trim() ? `用户写作要求：${request.writingPrompt}` : '用户没有额外写作要求。',
          sourcePrompt(request.sources)
        ].filter(Boolean).join('\n\n')
      })));
      return parsed.topics.slice(0, request.count).map((topic, index) => ({
        id: `topic-${index + 1}`,
        ...topic
      }));
    },
    generateOutline(request: {
      sources: ExtractedArticleSource[];
      topic: WechatArticleTopic;
      writingPrompt: string;
      templatePrompt: string;
      signal: AbortSignal;
    }): Promise<string> {
      return complete({
        signal: request.signal,
        prompt: [
          '你是一名资深微信公众号主编。请为选定选题生成可编辑的文章大纲。',
          '使用 Markdown。第一行是文章标题，随后列出导语、二到五个主体章节及每节要点、结尾。',
          '大纲要形成完整论证或叙事推进，明确哪些事实来自素材，禁止虚构。不要直接写成全文。',
          `选题：${JSON.stringify(request.topic)}`,
          request.templatePrompt.trim() ? `文章模板规则：\n${request.templatePrompt}` : '',
          request.writingPrompt.trim() ? `用户写作要求：${request.writingPrompt}` : '用户没有额外写作要求。',
          sourcePrompt(request.sources)
        ].filter(Boolean).join('\n\n')
      });
    },
    generateArticle(request: {
      sources: ExtractedArticleSource[];
      topic: WechatArticleTopic;
      outline: string;
      writingPrompt: string;
      templatePrompt: string;
      layoutPrompt: string;
      signal: AbortSignal;
    }): Promise<string> {
      return complete({
        signal: request.signal,
        prompt: [
          '你是一名资深微信公众号作者。请按选题和大纲完成一篇可直接编辑发布的中文文章。',
          '只输出 Markdown 正文，从一级标题开始。保持事实边界，来源没有的信息不要编造；不要输出写作说明。',
          `选题：${JSON.stringify(request.topic)}`,
          `大纲：\n${request.outline}`,
          request.templatePrompt.trim() ? `文章模板要求：${request.templatePrompt}` : '',
          request.layoutPrompt.trim() ? `Markdown 排版要求：${request.layoutPrompt}` : '',
          request.writingPrompt.trim() ? `用户写作要求：${request.writingPrompt}` : '',
          sourcePrompt(request.sources)
        ].filter(Boolean).join('\n\n')
      });
    },
    async generateImagePlan(request: {
      articleMarkdown: string;
      count: number;
      stylePrompt: string;
      customPrompt: string;
      signal: AbortSignal;
    }): Promise<WechatArticleImagePlanItem[]> {
      const parsed = imagePlanSchema.parse(parseJson(await complete({
        json: true,
        signal: request.signal,
        prompt: [
          '你是一名资深视觉编辑。请为下面这篇微信公众号文章规划内容互不重复的配图。',
          `生成 ${request.count} 张配图，只输出严格 JSON：{"images":[{"caption":"图片说明","placementHeading":"建议放在哪个章节标题之后","prompt":"可直接用于图像生成模型的完整英文提示词"}]}`,
          'placementHeading 必须原样复制文章中真实存在的 Markdown 标题，优先选择二级或三级标题。',
          '每张图必须服务于所选章节的具体内容，并覆盖不同的核心段落。prompt 要准确呈现该章节中的人物、对象、场景、动作、关系或数据含义；抽象内容可以使用贴合原意的视觉隐喻，但禁止生成与正文无关的装饰性画面。',
          '主体、场景和视觉隐喻要具体。不要把文章标题、段落文字、Logo、水印或大段可见文字放进画面。',
          `统一视觉风格：${request.stylePrompt}`,
          request.customPrompt.trim() ? `用户补充的配图要求：${request.customPrompt}` : '',
          `文章正文：\n${request.articleMarkdown.slice(0, 100_000)}`
        ].filter(Boolean).join('\n\n')
      })));
      return parsed.images.slice(0, request.count).map((item, index) => ({
        id: `article-image-${index + 1}`,
        ...item
      }));
    }
  };
}

function sourcePrompt(sources: ExtractedArticleSource[]): string {
  if (sources.length === 0) return '本次没有内容来源，请基于用户要求写作，并避免捏造具体事实和数据。';
  let remaining = 120_000;
  const sections: string[] = [];
  for (const [index, source] of sources.entries()) {
    if (remaining <= 0) break;
    const header = `[来源 ${index + 1}] ${source.title}\n出处：${source.origin}\n`;
    const content = source.content.slice(0, Math.max(0, remaining - header.length));
    sections.push(`${header}${content}`);
    remaining -= header.length + content.length;
  }
  return `内容来源：\n${sections.join('\n\n')}`;
}

function parseJson(value: string): unknown {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value.trim());
  return JSON.parse(fenced?.[1] ?? value);
}
