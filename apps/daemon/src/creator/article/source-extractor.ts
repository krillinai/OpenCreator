import type { CreatorArtifact, WechatArticleSourceLink } from '@opencreator/protocol';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import { fetchCreatorService } from '../../creator-services/upstream-fetch.js';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { withYtDlpProxy } from '../yt-dlp/args.js';
import type { YtDlpRuntime } from '../yt-dlp/runtime.js';

const MAX_SOURCE_CHARS = 50_000;
const require = createRequire(import.meta.url);
let pdfParser: ((buffer: Buffer) => Promise<{ text: string }>) | undefined;

export type ExtractedArticleSource = {
  id: string;
  type: 'video' | 'webpage' | 'document';
  title: string;
  origin: string;
  content: string;
  transcriptType?: 'human' | 'automatic';
  transcriptLanguage?: string;
};

export function createArticleSourceExtractor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  getYtDlpRuntime?(): YtDlpRuntime | undefined;
  runYtDlp?: typeof runYtDlp;
  fetchService?: typeof fetchCreatorService;
}) {
  const fetchService = input.fetchService ?? fetchCreatorService;
  const readVideoMetadata = input.runYtDlp ?? runYtDlp;
  return {
    async extract(request: {
      links: WechatArticleSourceLink[];
      documents: CreatorArtifact[];
      workdir: string;
      signal: AbortSignal;
      reportProgress(progress: Record<string, string | number | null>): void;
    }): Promise<ExtractedArticleSource[]> {
      const config = await input.configStore.read();
      const total = request.links.length + request.documents.length;
      const sources: ExtractedArticleSource[] = [];
      let completed = 0;
      for (const link of request.links) {
        assertNotAborted(request.signal);
        request.reportProgress({
          phase: link.kind === 'video' ? 'reading_video' : 'reading_webpage',
          percent: total === 0 ? 25 : Math.round(10 + completed / total * 35),
          message: link.label || link.url
        });
        sources.push(link.kind === 'video'
          ? await extractVideo(
              link,
              config.proxy,
              request.signal,
              input.getYtDlpRuntime?.(),
              readVideoMetadata,
              fetchService
            )
          : await extractWebpage(link, config.proxy, request.signal, fetchService));
        completed += 1;
      }
      for (const artifact of request.documents) {
        assertNotAborted(request.signal);
        const fileName = readMetadataString(artifact.metadata.fileName) ?? 'document';
        request.reportProgress({
          phase: 'reading_document',
          percent: total === 0 ? 25 : Math.round(10 + completed / total * 35),
          message: fileName
        });
        sources.push(await extractDocument(artifact));
        completed += 1;
      }
      return sources;
    }
  };
}

async function extractWebpage(
  link: WechatArticleSourceLink,
  proxy: string,
  signal: AbortSignal,
  fetchService: typeof fetchCreatorService
): Promise<ExtractedArticleSource> {
  const endpoint = new URL(link.url);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new CreatorExecutorError('creator_source_unavailable', `Unsupported webpage URL: ${link.url}`);
  }
  const response = await fetchService({
    endpoint,
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      'User-Agent': 'OpenCreator/1.0'
    },
    proxy,
    signal,
    maxResponseBytes: 5 * 1024 * 1024
  });
  if (!response.ok) {
    throw new CreatorExecutorError(
      'creator_source_unavailable',
      `Unable to read webpage (${response.status}): ${link.url}`
    );
  }
  const html = await response.text();
  const { load } = await import('cheerio');
  const $ = load(html);
  $('script,style,noscript,svg,nav,footer,form').remove();
  const title = cleanText(
    $('meta[property="og:title"]').attr('content')
      || $('h1').first().text()
      || $('title').first().text()
  ) || link.label || link.url;
  const root = $('#js_content,.rich_media_content,article,main,[role="main"]').first();
  const content = cleanText((root.length > 0 ? root : $('body')).text()).slice(0, MAX_SOURCE_CHARS);
  if (!content) {
    throw new CreatorExecutorError('creator_source_empty', `No readable text found at ${link.url}`);
  }
  return { id: link.id, type: 'webpage', title, origin: link.url, content };
}

async function extractVideo(
  link: WechatArticleSourceLink,
  proxy: string,
  signal: AbortSignal,
  runtime: YtDlpRuntime | undefined,
  readVideoMetadata: typeof runYtDlp,
  fetchService: typeof fetchCreatorService
): Promise<ExtractedArticleSource> {
  if (runtime === undefined) {
    throw new CreatorExecutorError(
      'creator_runtime_dependency_missing',
      'Video sources require the yt-dlp runtime component'
    );
  }
  const payload = JSON.parse(await readVideoMetadata(runtime, link.url, proxy, signal)) as Record<string, unknown>;
  const title = readString(payload.title) ?? link.label ?? link.url;
  const description = readString(payload.description) ?? '';
  const humanCaption = chooseCaption(payload.subtitles);
  const automaticCaption = chooseCaption(payload.automatic_captions);
  const caption = humanCaption ?? automaticCaption;
  if (caption === undefined) {
    throw new CreatorExecutorError(
      'creator_source_transcript_missing',
      `No subtitles are available for video: ${link.url}`
    );
  }
  const response = await fetchService({
    endpoint: new URL(caption.url),
    method: 'GET',
    headers: { Accept: 'text/vtt,text/plain,application/json,application/xml,*/*' },
    proxy,
    signal,
    maxResponseBytes: 8 * 1024 * 1024
  });
  if (!response.ok) {
    throw new CreatorExecutorError(
      'creator_source_unavailable',
      `Unable to download subtitles (${response.status}): ${link.url}`
    );
  }
  const captions = await parseCaptions(await response.text(), caption.ext);
  if (!captions) {
    throw new CreatorExecutorError(
      'creator_source_transcript_missing',
      `No readable subtitles are available for video: ${link.url}`
    );
  }
  const content = [description, captions].filter(Boolean).join('\n\n').slice(0, MAX_SOURCE_CHARS);
  return {
    id: link.id,
    type: 'video',
    title,
    origin: link.url,
    content,
    transcriptType: humanCaption === undefined ? 'automatic' : 'human',
    transcriptLanguage: caption.language
  };
}

async function extractDocument(artifact: CreatorArtifact): Promise<ExtractedArticleSource> {
  if (artifact.path === null) {
    throw new CreatorExecutorError('creator_source_unavailable', 'Source document file is missing');
  }
  const fileName = readMetadataString(artifact.metadata.fileName) ?? 'document';
  const extension = extname(fileName).toLowerCase();
  const buffer = await readFile(artifact.path);
  let content: string;
  if (extension === '.pdf') {
    pdfParser ??= require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
    content = cleanText((await pdfParser(buffer)).text);
  } else if (extension === '.html' || extension === '.htm') {
    const { load } = await import('cheerio');
    const $ = load(buffer.toString('utf8'));
    $('script,style,noscript,svg,nav,footer,form').remove();
    content = cleanText($('article,main,[role="main"]').first().text() || $('body').text());
  } else {
    content = buffer.toString('utf8').trim();
  }
  if (!content) {
    throw new CreatorExecutorError('creator_source_empty', `No readable text found in ${fileName}`);
  }
  return {
    id: artifact.id,
    type: 'document',
    title: fileName,
    origin: fileName,
    content: content.slice(0, MAX_SOURCE_CHARS)
  };
}

function runYtDlp(
  runtime: YtDlpRuntime,
  url: string,
  proxy: string,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCreatorProcess(runtime.executable, [
      ...runtime.prefixArgs,
      ...withYtDlpProxy(['--dump-single-json', '--no-playlist', url], proxy)
    ], {
      env: { ...process.env, ...runtime.env },
      stdio: ['ignore', 'pipe', 'pipe']
    }, signal);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0 && stdout.trim()) resolve(stdout);
      else reject(new CreatorExecutorError(
        'creator_source_unavailable',
        stderr.trim().slice(-500) || `Unable to read video source: ${url}`
      ));
    });
  });
}

function chooseCaption(value: unknown): { url: string; ext: string; language: string } | undefined {
  if (!isRecord(value)) return undefined;
  const languages = [...new Set(['zh-Hans', 'zh-CN', 'zh', 'en-US', 'en', ...Object.keys(value)])];
  for (const language of languages) {
    const formats = value[language];
    if (!Array.isArray(formats)) continue;
    const candidates = formats.filter(isRecord);
    const preferred = ['vtt', 'json3', 'srv3', 'ttml', 'srt', 'ass']
      .flatMap(ext => candidates.filter(item => item.ext === ext))
      .at(0) ?? candidates[0];
    if (preferred !== undefined && typeof preferred.url === 'string') {
      return {
        url: preferred.url,
        ext: typeof preferred.ext === 'string' ? preferred.ext : '',
        language
      };
    }
  }
  return undefined;
}

async function parseCaptions(value: string, extension: string): Promise<string> {
  if (extension === 'json3') {
    try {
      const payload = JSON.parse(value) as { events?: Array<{ segs?: Array<{ utf8?: unknown }> }> };
      return (payload.events ?? [])
        .flatMap(event => event.segs ?? [])
        .map(segment => typeof segment.utf8 === 'string' ? segment.utf8 : '')
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_SOURCE_CHARS);
    } catch {
      return '';
    }
  }
  if (extension === 'srv3' || extension === 'ttml' || /^\s*</.test(value)) {
    const { load } = await import('cheerio');
    const $ = load(value, { xmlMode: true });
    return cleanText($.root().text()).slice(0, MAX_SOURCE_CHARS);
  }
  return cleanCaptions(value);
}

function cleanCaptions(value: string): string {
  return value
    .replace(/^WEBVTT[^\n]*\n/i, '')
    .replace(/^\d\d:\d\d(?::\d\d)?[.,]\d+\s+-->.*$/gm, '')
    .replace(/^\d+$/gm, '')
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter((line, index, lines) => line && line !== lines[index - 1])
    .join('\n')
    .slice(0, MAX_SOURCE_CHARS);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function readMetadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
  }
}
