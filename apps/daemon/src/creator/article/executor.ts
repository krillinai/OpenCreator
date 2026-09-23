import {
  wechatArticleImageStyles,
  wechatArticleLayoutStyles,
  type CreatorArtifact,
  type CreatorJson,
  type WechatArticleImagePlanItem,
  type WechatArticleImageStyleId,
  type WechatArticleLayoutStyleId,
  type WechatArticleSourceLink,
  type WechatArticleTopic
} from '@opencreator/protocol';
import {
  getWritingTemplate,
  getWritingTemplateStagePrompt,
  type WritingTemplateStage
} from '@opencreator/writing-templates';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorExecutor, CreatorExecutorResult } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { validateImageFile } from '../validators/image.js';
import { writeArticleHtml, writeArticlePdf } from './document-generator.js';
import type { ArticleImageGenerationResult } from './image-generator.js';
import type { ExtractedArticleSource } from './source-extractor.js';

export function createWechatArticleExecutor(input: {
  sourceExtractor: {
    extract(request: {
      links: WechatArticleSourceLink[];
      documents: CreatorArtifact[];
      workdir: string;
      signal: AbortSignal;
      reportProgress(progress: Record<string, string | number | null>): void;
    }): Promise<ExtractedArticleSource[]>;
  };
  model: {
    generateTopics(request: {
      sources: ExtractedArticleSource[];
      writingPrompt: string;
      templatePrompt: string;
      count: number;
      signal: AbortSignal;
    }): Promise<WechatArticleTopic[]>;
    generateOutline(request: {
      sources: ExtractedArticleSource[];
      topic: WechatArticleTopic;
      writingPrompt: string;
      templatePrompt: string;
      signal: AbortSignal;
    }): Promise<string>;
    generateArticle(request: {
      sources: ExtractedArticleSource[];
      topic: WechatArticleTopic;
      outline: string;
      writingPrompt: string;
      templatePrompt: string;
      layoutPrompt: string;
      signal: AbortSignal;
    }): Promise<string>;
    generateImagePlan?(request: {
      articleMarkdown: string;
      count: number;
      stylePrompt: string;
      customPrompt: string;
      signal: AbortSignal;
    }): Promise<WechatArticleImagePlanItem[]>;
  };
  imageGenerator?: {
    generate(request: { prompt: string; signal: AbortSignal; cwd?: string }): Promise<ArticleImageGenerationResult>;
  };
}): CreatorExecutor {
  return {
    id: 'wechat-article',
    async run(stage) {
      const state = stage.job.state;
      if (stage.stageRun.stageId === 'sources') {
        const documentIds = readStringArray(state.sourceDocumentArtifactIds);
        const documents = stage.job.artifacts.filter(artifact => (
          documentIds.includes(artifact.id)
          && artifact.kind === 'source_document'
          && artifact.status === 'completed'
        ));
        const links = readSourceLinks(state.sourceLinks);
        const sourceSignature = createSourceSignature(links, documents);
        stage.reportProgress({ phase: 'collecting_sources', percent: 5, completed: 0, failed: 0, total: links.length + documents.length });
        const sources = await input.sourceExtractor.extract({
          links,
          documents,
          workdir: stage.workdir,
          signal: stage.signal,
          reportProgress: stage.reportProgress
        });
        const sourcesPath = join(stage.workdir, 'article-sources.json');
        await writeJson(sourcesPath, sources);
        const sourceArtifactIds = documents.map(artifact => artifact.id);
        return {
          outputs: [{
            kind: 'article_sources',
            status: 'completed',
            path: sourcesPath,
            sourceArtifactIds,
            metadata: sourceMetadata(sources, sourceSignature)
          }],
          progress: { phase: 'completed', percent: 100, completed: sources.length, failed: 0, total: links.length + documents.length }
        };
      }

      if (stage.stageRun.stageId === 'topics') {
        const documentIds = readStringArray(state.sourceDocumentArtifactIds);
        const documents = stage.job.artifacts.filter(artifact => (
          documentIds.includes(artifact.id)
          && artifact.kind === 'source_document'
          && artifact.status === 'completed'
        ));
        const links = readSourceLinks(state.sourceLinks);
        const sourceSignature = createSourceSignature(links, documents);
        const cachedSourceArtifact = stage.inputArtifacts.find(artifact => (
          artifact.kind === 'article_sources'
          && artifact.status === 'completed'
          && artifact.metadata.sourceSignature === sourceSignature
        ));
        let sources: ExtractedArticleSource[];
        let sourceOutput: CreatorExecutorResult['outputs'][number] | undefined;
        if (cachedSourceArtifact !== undefined) {
          sources = await readArtifactJson<ExtractedArticleSource[]>([cachedSourceArtifact], 'article_sources');
        } else {
          stage.reportProgress({ phase: 'collecting_sources', percent: 5, completed: 0, failed: 0, total: links.length + documents.length });
          sources = await input.sourceExtractor.extract({
            links,
            documents,
            workdir: stage.workdir,
            signal: stage.signal,
            reportProgress: stage.reportProgress
          });
          const sourcesPath = join(stage.workdir, 'article-sources.json');
          await writeJson(sourcesPath, sources);
          sourceOutput = {
            kind: 'article_sources',
            status: 'completed',
            path: sourcesPath,
            sourceArtifactIds: documents.map(artifact => artifact.id),
            metadata: sourceMetadata(sources, sourceSignature)
          };
        }
        stage.reportProgress({ phase: 'generating_topics', percent: 55, completed: sources.length, failed: 0, total: links.length + documents.length });
        const topics = await input.model.generateTopics({
          sources,
          writingPrompt: readString(state.writingPrompt),
          templatePrompt: resolveTemplatePrompt(state.presetId, state.templatePrompt, 'topics'),
          count: readTopicCount(state.topicCount),
          signal: stage.signal
        });
        const topicsPath = join(stage.workdir, 'article-topics.json');
        await writeJson(topicsPath, topics);
        const sourceArtifactIds = cachedSourceArtifact === undefined
          ? documents.map(artifact => artifact.id)
          : [cachedSourceArtifact.id];
        const outputs: CreatorExecutorResult['outputs'] = [
          ...(sourceOutput === undefined ? [] : [sourceOutput]),
          {
            kind: 'article_topics',
            status: 'completed',
            path: topicsPath,
            sourceArtifactIds,
            metadata: {
              fileName: 'article-topics.json',
              mimeType: 'application/json',
              topics,
              ...templateTrace(state.presetId)
            }
          }
        ];
        return {
          outputs,
          progress: { phase: 'completed', percent: 100, completed: topics.length, failed: 0, total: topics.length }
        };
      }

      if (stage.stageRun.stageId === 'document') {
        const markdown = readString(state.articleMarkdown)
          || await readArtifactText(stage.inputArtifacts, 'article_markdown');
        if (!markdown.trim()) {
          throw new CreatorExecutorError('creator_stage_input_missing', 'Article content is required');
        }
        stage.reportProgress({ phase: 'preparing_document', percent: 20, completed: 0, failed: 0, total: 3 });
        const title = firstHeading(markdown) || readString(state.articleTitle) || '公众号文章';
        const fileStem = safeFileName(title) || 'wechat-article';
        const markdownFileName = `${fileStem}.md`;
        const htmlFileName = `${fileStem}.html`;
        const pdfFileName = `${fileStem}.pdf`;
        const markdownPath = join(stage.workdir, markdownFileName);
        const htmlPath = join(stage.workdir, htmlFileName);
        const pdfPath = join(stage.workdir, pdfFileName);
        const content = `${markdown.trim()}\n`;
        const layoutStyleId = readLayoutStyle(state.layoutStyleId);
        await writeFile(markdownPath, content, 'utf8');
        const [htmlBytes, pdfBytes] = await Promise.all([
          writeArticleHtml(htmlPath, { markdown, title, layoutStyleId, artifacts: stage.job.artifacts }),
          writeArticlePdf(pdfPath, { markdown, title, layoutStyleId, artifacts: stage.job.artifacts })
        ]);
        const sourceArtifactIds = documentSourceArtifactIds(markdown, stage.inputArtifacts, stage.job.artifacts);
        const baseMetadata = {
          title,
          characterCount: [...markdown].length,
          topicId: readString(state.selectedTopicId),
          layoutStyleId,
          ...templateTrace(state.presetId)
        };
        return {
          outputs: [
            {
              kind: 'article_document',
              status: 'completed',
              path: markdownPath,
              sourceArtifactIds,
              metadata: {
                ...baseMetadata,
                fileName: markdownFileName,
                mimeType: 'text/markdown',
                documentFormat: 'markdown',
                bytes: Buffer.byteLength(content, 'utf8')
              }
            },
            {
              kind: 'article_document',
              status: 'completed',
              path: htmlPath,
              sourceArtifactIds,
              metadata: {
                ...baseMetadata,
                fileName: htmlFileName,
                mimeType: 'text/html',
                documentFormat: 'html',
                bytes: htmlBytes
              }
            },
            {
              kind: 'article_document',
              status: 'completed',
              path: pdfPath,
              sourceArtifactIds,
              metadata: {
                ...baseMetadata,
                fileName: pdfFileName,
                mimeType: 'application/pdf',
                documentFormat: 'pdf',
                bytes: pdfBytes
              }
            }
          ],
          progress: { phase: 'completed', percent: 100, completed: 3, failed: 0, total: 3 }
        };
      }

      if (stage.stageRun.stageId === 'images') {
        if (input.model.generateImagePlan === undefined || input.imageGenerator === undefined) {
          throw new CreatorExecutorError('creator_runtime_dependency_missing', 'Article image generation is unavailable');
        }
        const markdown = readString(state.articleMarkdown)
          || await readArtifactText(stage.inputArtifacts, 'article_markdown');
        if (!markdown.trim()) {
          throw new CreatorExecutorError('creator_stage_input_missing', 'Article content is required before generating images');
        }
        const planningMarkdown = stripGeneratedArticleImages(markdown);
        const count = readArticleImageCount(state.articleImageCount);
        const style = readArticleImageStyle(state.articleImageStyleId);
        const stylePrompt = articleImageStyleInstructions(style);
        stage.reportProgress({ phase: 'planning_article_images', percent: 5, completed: 0, failed: 0, total: count });
        const plan = await input.model.generateImagePlan({
          articleMarkdown: planningMarkdown,
          count,
          stylePrompt,
          customPrompt: readString(state.articleImagePrompt),
          signal: stage.signal
        });
        if (plan.length === 0) {
          throw new CreatorExecutorError('creator_llm_empty_response', 'Article image planning returned no images');
        }
        const articleArtifact = stage.inputArtifacts.find(artifact => artifact.kind === 'article_markdown');
        const outputs: CreatorExecutorResult['outputs'] = [];
        const failures: Array<{ candidate: number; message: string }> = [];
        let firstFailure: unknown;
        for (const [index, item] of plan.slice(0, count).entries()) {
          try {
            const articleContext = articleSectionContext(planningMarkdown, item.placementHeading);
            const generated = await input.imageGenerator.generate({
              prompt: [
                stylePrompt,
                'The image must accurately represent the referenced article section. Preserve its concrete subject, setting, actions, relationships, mood, and factual meaning. Do not introduce unrelated themes or generic decorative scenes.',
                `Placement heading: ${item.placementHeading}`,
                `Caption intent: ${item.caption}`,
                `Relevant article content:\n${articleContext}`,
                'Visual plan:',
                item.prompt,
                'Landscape editorial illustration for a WeChat article, 3:2 composition.',
                'Do not render titles, paragraphs, logos, watermarks, UI, or illegible decorative text.'
              ].join('\n\n'),
              signal: stage.signal,
              cwd: stage.workdir
            });
            const extension = extensionForMime(generated.mime);
            const fileName = `article-image-${String(index + 1).padStart(2, '0')}.${extension}`;
            const path = join(stage.workdir, fileName);
            await writeFile(path, generated.content);
            const metadata = await validateImageFile(path);
            outputs.push({
              kind: 'article_image',
              status: 'completed',
              path,
              sourceArtifactIds: articleArtifact === undefined ? [] : [articleArtifact.id],
              metadata: {
                ...metadata,
                fileName,
                mimeType: generated.mime,
                imageIndex: index + 1,
                caption: item.caption,
                placementHeading: item.placementHeading,
                articleContext,
                prompt: item.prompt,
                imageStyleId: style,
                provider: generated.provider,
                model: generated.model
              }
            });
          } catch (error) {
            if (
              error instanceof CreatorExecutorError
              && (error.code === 'creator_image_config_missing' || error.code === 'creator_stage_canceled')
            ) throw error;
            firstFailure ??= error;
            failures.push({
              candidate: index + 1,
              message: error instanceof Error ? error.message : 'Article image generation failed'
            });
          }
          stage.reportProgress({
            phase: 'generating_article_images',
            percent: 10 + Math.round(((index + 1) / Math.max(1, plan.length)) * 85),
            completed: outputs.length,
            failed: failures.length,
            total: plan.length
          });
        }
        if (outputs.length === 0) {
          if (firstFailure instanceof CreatorExecutorError) throw firstFailure;
          throw new CreatorExecutorError('image_generation_failed', failures[0]?.message ?? 'Article image generation failed');
        }
        return {
          outputs,
          progress: {
            phase: 'completed',
            percent: 100,
            completed: outputs.length,
            failed: failures.length,
            total: plan.length,
            ...(failures.length > 0 ? { status: 'partial_success', failures } : {})
          }
        };
      }

      const sources = await readSources(stage.inputArtifacts);
      const topics = readTopics(state.topics).length > 0
        ? readTopics(state.topics)
        : await readArtifactJson<WechatArticleTopic[]>(stage.inputArtifacts, 'article_topics');
      const topic = selectTopic(topics, readString(state.selectedTopicId));
      if (stage.stageRun.stageId === 'outline') {
        stage.reportProgress({ phase: 'generating_outline', percent: 15 });
        const outline = await input.model.generateOutline({
          sources,
          topic,
          writingPrompt: readString(state.writingPrompt),
          templatePrompt: resolveTemplatePrompt(state.presetId, state.templatePrompt, 'outline'),
          signal: stage.signal
        });
        const path = join(stage.workdir, 'article-outline.md');
        await writeFile(path, `${outline.trim()}\n`, 'utf8');
        return {
          outputs: [{
            kind: 'article_outline',
            status: 'completed',
            path,
            metadata: {
              fileName: 'article-outline.md',
              mimeType: 'text/markdown',
              outline: outline.trim(),
              topicId: topic.id,
              ...templateTrace(state.presetId)
            }
          }],
          progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
        };
      }

      if (stage.stageRun.stageId === 'article') {
        const outline = readString(state.outline)
          || await readArtifactText(stage.inputArtifacts, 'article_outline');
        if (!outline.trim()) {
          throw new CreatorExecutorError('creator_stage_input_missing', 'Article outline is required');
        }
        stage.reportProgress({ phase: 'writing_article', percent: 10 });
        const markdown = await input.model.generateArticle({
          sources,
          topic,
          outline,
          writingPrompt: readString(state.writingPrompt),
          templatePrompt: resolveTemplatePrompt(state.presetId, state.templatePrompt, 'article'),
          layoutPrompt: layoutInstructions(readLayoutStyle(state.layoutStyleId)),
          signal: stage.signal
        });
        const path = join(stage.workdir, 'wechat-article.md');
        await writeFile(path, `${markdown.trim()}\n`, 'utf8');
        return {
          outputs: [{
            kind: 'article_markdown',
            status: 'completed',
            path,
            metadata: {
              fileName: 'wechat-article.md',
              mimeType: 'text/markdown',
              title: firstHeading(markdown) || topic.title,
              characterCount: [...markdown].length,
              topicId: topic.id,
              ...templateTrace(state.presetId)
            }
          }],
          progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
        };
      }

      throw new CreatorExecutorError('creator_stage_not_found', `Unsupported article stage: ${stage.stageRun.stageId}`);
    }
  };
}

function readSourceLinks(value: CreatorJson | undefined): WechatArticleSourceLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.url !== 'string') return [];
    if (item.kind !== 'video' && item.kind !== 'webpage') return [];
    return [{
      id: item.id,
      url: item.url,
      kind: item.kind,
      label: typeof item.label === 'string' ? item.label : ''
    }];
  });
}

function readTopics(value: CreatorJson | undefined): WechatArticleTopic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return [];
    return [{
      id: item.id,
      title: item.title,
      angle: typeof item.angle === 'string' ? item.angle : '',
      summary: typeof item.summary === 'string' ? item.summary : ''
    }];
  });
}

function selectTopic(topics: WechatArticleTopic[], selectedId: string): WechatArticleTopic {
  const topic = topics.find(candidate => candidate.id === selectedId) ?? (topics.length === 1 ? topics[0] : undefined);
  if (topic === undefined) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Select an article topic before continuing');
  }
  return topic;
}

async function readSources(artifacts: CreatorArtifact[]): Promise<ExtractedArticleSource[]> {
  return readArtifactJson<ExtractedArticleSource[]>(artifacts, 'article_sources');
}

function documentSourceArtifactIds(
  markdown: string,
  inputArtifacts: CreatorArtifact[],
  jobArtifacts: CreatorArtifact[]
): string[] {
  const ids = new Set(inputArtifacts
    .filter(artifact => artifact.kind === 'article_markdown')
    .map(artifact => artifact.id));
  for (const artifact of jobArtifacts) {
    if (artifact.kind !== 'article_image' || artifact.status !== 'completed') continue;
    const fileName = readString(artifact.metadata.fileName);
    if (fileName && (markdown.includes(`](${fileName})`) || markdown.includes(`](./${fileName})`))) {
      ids.add(artifact.id);
    }
  }
  return [...ids];
}

async function readArtifactJson<T>(artifacts: CreatorArtifact[], kind: string): Promise<T> {
  const text = await readArtifactText(artifacts, kind);
  return JSON.parse(text) as T;
}

async function readArtifactText(artifacts: CreatorArtifact[], kind: string): Promise<string> {
  const artifact = artifacts.find(candidate => candidate.kind === kind && candidate.path !== null);
  if (artifact?.path === null || artifact === undefined) {
    throw new CreatorExecutorError('creator_stage_input_missing', `Missing ${kind} artifact`);
  }
  return readFile(artifact.path, 'utf8');
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: CreatorJson | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readTopicCount(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(3, Math.min(10, value))
    : 5;
}

function readLayoutStyle(value: CreatorJson | undefined): WechatArticleLayoutStyleId {
  return wechatArticleLayoutStyles.some(style => style.id === value)
    ? value as WechatArticleLayoutStyleId
    : 'minimal';
}

function readArticleImageCount(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(1, Math.min(10, value))
    : 5;
}

function readArticleImageStyle(value: CreatorJson | undefined): WechatArticleImageStyleId {
  return wechatArticleImageStyles.some(style => style.id === value)
    ? value as WechatArticleImageStyleId
    : 'editorial';
}

function articleImageStyleInstructions(id: WechatArticleImageStyleId): string {
  return wechatArticleImageStyles.find(style => style.id === id)?.instructions ?? '';
}

function stripGeneratedArticleImages(markdown: string): string {
  return markdown
    .replace(/^[ \t]*!\[[^\]\n]*\]\((?:\.\/)?article-image-\d+\.(?:png|jpe?g|webp)\)[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function articleSectionContext(markdown: string, placementHeading: string): string {
  const lines = markdown.split('\n');
  const requestedHeading = normalizeArticleHeading(placementHeading);
  const headings = lines.flatMap((line, lineIndex) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match === null
      ? []
      : [{ lineIndex, level: match[1]!.length, normalized: normalizeArticleHeading(match[2]!) }];
  });
  const matched = headings.find(heading => heading.normalized === requestedHeading)
    ?? headings.find(heading => (
      requestedHeading.length > 0
      && (heading.normalized.includes(requestedHeading) || requestedHeading.includes(heading.normalized))
    ));
  if (matched === undefined) return markdown.trim().slice(0, 2_000);

  const nextHeading = headings.find(heading => (
    heading.lineIndex > matched.lineIndex
    && heading.level <= matched.level
  ));
  const section = lines
    .slice(matched.lineIndex, nextHeading?.lineIndex ?? lines.length)
    .join('\n')
    .trim();
  return (section || markdown.trim()).slice(0, 2_000);
}

function normalizeArticleHeading(value: string): string {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/[\s*_`\[\]()（）【】《》:：,.，。!?！？-]+/g, '')
    .toLocaleLowerCase();
}

function extensionForMime(mime: ArticleImageGenerationResult['mime']): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function layoutInstructions(id: WechatArticleLayoutStyleId): string {
  return wechatArticleLayoutStyles.find(style => style.id === id)?.instructions ?? '';
}

function resolveTemplatePrompt(
  presetValue: CreatorJson | undefined,
  customValue: CreatorJson | undefined,
  stage: WritingTemplateStage
): string {
  const presetId = readString(presetValue);
  const template = presetId ? getWritingTemplate(presetId) : undefined;
  const packagedPrompt = template ? getWritingTemplateStagePrompt(template.id, stage) : '';
  const customPrompt = readString(customValue);
  if (!customPrompt || customPrompt === template?.instructions) return packagedPrompt;
  return [packagedPrompt, `用户补充的模板要求：\n${customPrompt}`].filter(Boolean).join('\n\n');
}

function templateTrace(presetValue: CreatorJson | undefined) {
  const template = getWritingTemplate(readString(presetValue));
  return {
    writingTemplateId: template?.id ?? null,
    writingTemplateVersion: template?.version ?? null,
    writingTemplateRevision: template?.source.revision ?? null,
    writingTemplateHash: template?.contentHash ?? null
  };
}

function firstHeading(markdown: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? '';
}

function safeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80);
}

function isRecord(value: CreatorJson): value is Record<string, CreatorJson> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createSourceSignature(
  links: WechatArticleSourceLink[],
  documents: CreatorArtifact[]
): string {
  const payload = {
    links: links.map(link => ({ id: link.id, url: link.url, kind: link.kind })),
    documents: documents.map(artifact => ({
      id: artifact.id,
      fileName: artifact.metadata.fileName ?? null,
      bytes: artifact.metadata.bytes ?? null,
      sha256: artifact.metadata.sha256 ?? null
    }))
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function sourceMetadata(sources: ExtractedArticleSource[], sourceSignature: string) {
  return {
    fileName: 'article-sources.json',
    mimeType: 'application/json',
    sourceSignature,
    sourceCount: sources.length,
    sourceTitles: sources.map(source => source.title),
    automaticTranscriptCount: sources.filter(source => source.transcriptType === 'automatic').length
  };
}
