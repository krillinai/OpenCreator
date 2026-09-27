import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import {
  fetchCreatorService
} from '../../creator-services/upstream-fetch.js';
import type {
  CreatorExecutor,
  CreatorExecutorInput,
  CreatorExecutorResult
} from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { publicFactsFromFailure, publicFactsFromHttpResponse } from '../public-error-facts.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { validateImageFile } from '../validators/image.js';
import { withYtDlpProxy } from '../yt-dlp/args.js';
import type { YtDlpRuntime } from '../yt-dlp/runtime.js';
import {
  generateCoverBrief,
  parseCoverSourceMetadata
} from './analyzer.js';
import { readCoverTextLanguage } from './styles.js';

export function createCoverAnalysisExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  ytDlpPath: string;
  ytDlpPrefixArgs?: string[];
  ytDlpEnv?: NodeJS.ProcessEnv;
  getYtDlpRuntime?(): YtDlpRuntime;
}): CreatorExecutor {
  return {
    id: 'cover-analysis',
    async run(stage) {
      const sourceUrl = typeof stage.job.state.sourceUrl === 'string'
        ? stage.job.state.sourceUrl.trim()
        : '';
      if (!isYoutubeUrl(sourceUrl)) {
        throw new CreatorExecutorError(
          'unsupported_source',
          'Only public YouTube URLs are supported for cover analysis'
        );
      }
      const config = await input.configStore.read();
      if (!config.llm.apiKey.trim()) {
        throw new CreatorExecutorError(
          'creator_llm_config_missing',
          'LLM configuration is incomplete'
        );
      }

      stage.reportProgress({
        phase: 'reading_source',
        percent: null,
        retryAttempt: null,
        retryTotal: null
      });
      const metadata = parseCoverSourceMetadata(JSON.parse(
        await runYtDlp(input, sourceUrl, config.proxy, stage)
      ));
      stage.reportProgress({
        phase: 'analyzing_source',
        percent: 45,
        retryAttempt: null,
        retryTotal: null
      });
      const brief = await generateCoverBrief({
        baseUrl: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        proxy: config.proxy,
        metadata,
        userPrompt: typeof stage.job.state.prompt === 'string'
          ? stage.job.state.prompt
          : '',
        language: readCoverTextLanguage(stage.job.state.resolvedCoverTextLanguage),
        headlineOverride: typeof stage.job.state.coverHeadline === 'string'
          ? stage.job.state.coverHeadline
          : '',
        subheadlineOverride: typeof stage.job.state.coverSubheadline === 'string'
          ? stage.job.state.coverSubheadline
          : '',
        signal: stage.signal
      });
      const briefPath = join(stage.workdir, 'cover-brief.json');
      await writeFile(briefPath, `${JSON.stringify({
        source: {
          id: metadata.id,
          title: metadata.title,
          description: metadata.description ?? '',
          uploader: metadata.uploader ?? '',
          duration: metadata.duration ?? null,
          url: sourceUrl
        },
        brief
      }, null, 2)}\n`);
      const outputs: CreatorExecutorResult['outputs'] = [{
        kind: 'cover_brief',
        status: 'completed',
        path: briefPath,
        metadata: {
          sourceId: metadata.id,
          sourceTitle: metadata.title,
          sourceUrl,
          summary: brief.summary,
          headline: brief.headline,
          subheadline: brief.subheadline,
          emphasisTerms: brief.emphasisTerms,
          language: brief.language,
          fileName: 'cover-brief.json',
          mimeType: 'application/json'
        }
      }];

      if (metadata.thumbnail === undefined) {
        throw new CreatorExecutorError(
          'creator_cover_reference_missing',
          'The YouTube video does not expose a thumbnail reference'
        );
      }
      stage.reportProgress({ phase: 'downloading_thumbnail', percent: 75 });
      const thumbnail = await downloadThumbnail(
        metadata.thumbnail,
        config.proxy,
        stage.signal
      ).catch(error => {
        throw new CreatorExecutorError(
          'creator_cover_reference_missing',
          error instanceof Error
            ? `Unable to download the YouTube thumbnail: ${error.message}`
            : 'Unable to download the YouTube thumbnail',
          {},
          publicFactsFromFailure(error, 'thumbnail')
        );
      });
      const extension = extensionForMime(thumbnail.mimeType);
      const path = join(stage.workdir, `source-thumbnail.${extension}`);
      await writeFile(path, thumbnail.content);
      const image = await validateImageFile(path);
      outputs.push({
        kind: 'source_keyframe',
        status: 'completed',
        path,
        metadata: {
          ...image,
          sourceUrl,
          sourceTitle: metadata.title,
          role: 'platform-thumbnail',
          fileName: `source-thumbnail.${extension}`,
          mimeType: thumbnail.mimeType
        }
      });
      return {
        outputs,
        progress: {
          phase: 'completed',
          percent: 100,
          sourceTitle: metadata.title
        }
      };
    }
  };
}

function runYtDlp(
  input: {
    ytDlpPath: string;
    ytDlpPrefixArgs?: string[];
    ytDlpEnv?: NodeJS.ProcessEnv;
    getYtDlpRuntime?(): YtDlpRuntime;
  },
  url: string,
  proxy: string,
  stage: CreatorExecutorInput
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ytDlp = input.getYtDlpRuntime?.() ?? {
      version: 'configured',
      executable: input.ytDlpPath,
      prefixArgs: input.ytDlpPrefixArgs ?? [],
      env: input.ytDlpEnv ?? {}
    };
    const child = spawnCreatorProcess(
      ytDlp.executable,
      [
        ...ytDlp.prefixArgs,
        ...withYtDlpProxy([
          '--dump-single-json',
          '--no-playlist',
          url
        ], proxy)
      ],
      {
        cwd: stage.workdir,
        env: {
          ...process.env,
          ...ytDlp.env
        },
        stdio: ['ignore', 'pipe', 'pipe']
      },
      stage.signal
    );
    let stdout = '';
    let stderr = '';
    let pendingStderr = '';
    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', chunk => {
      const text = String(chunk);
      stderr += text;
      pendingStderr += text;
      const lines = pendingStderr.split(/\r?\n/);
      pendingStderr = lines.pop() ?? '';
      for (const line of lines) reportYtDlpRetry(line, stage);
    });
    child.once('error', reject);
    child.once('close', code => {
      if (pendingStderr) reportYtDlpRetry(pendingStderr, stage);
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
        return;
      }
      reject(new CreatorExecutorError(
        classifyYtDlpError(stderr),
        stderr.trim().slice(-2000) || 'Unable to read YouTube metadata'
      ));
    });
  });
}

async function downloadThumbnail(
  url: string,
  proxy: string,
  signal: AbortSignal
): Promise<{ content: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }> {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error('Unsupported thumbnail URL');
  }
  const response = await fetchCreatorService({
    endpoint,
    method: 'GET',
    headers: {},
    proxy,
    signal,
    maxResponseBytes: 20 * 1024 * 1024
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Thumbnail request failed: HTTP ${response.status}`), {
      publicFacts: publicFactsFromHttpResponse(response.status, 'thumbnail')
    });
  }
  const content = Buffer.from(await response.arrayBuffer());
  const mimeType = imageMime(response.headers.get('content-type'), content);
  return { content, mimeType };
}

function imageMime(
  contentType: string | null,
  content: Buffer
): 'image/png' | 'image/jpeg' | 'image/webp' {
  const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') {
    return normalized;
  }
  if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    content.subarray(0, 4).toString('ascii') === 'RIFF'
    && content.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  throw new Error('Unsupported thumbnail image');
}

function extensionForMime(mimeType: 'image/png' | 'image/jpeg' | 'image/webp') {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function classifyYtDlpError(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes('sign in') || text.includes('login')) return 'login_required';
  if (text.includes('private video')) return 'source_private';
  if (
    text.includes('operation timed out')
    || text.includes('connection timed out')
    || text.includes('network is unreachable')
    || text.includes('connection refused')
    || text.includes('unable to connect')
    || text.includes('temporary failure in name resolution')
  ) {
    return 'network_unavailable';
  }
  if (text.includes('copyright') || text.includes('not available')) {
    return 'region_or_copyright_restricted';
  }
  if (
    text.includes('please update')
    || text.includes('confirm you are on the latest version')
    || text.includes('signature extraction failed')
    || text.includes('nsig extraction failed')
    || text.includes('unable to extract')
    || text.includes('extractor error')
  ) {
    return 'yt_dlp_update_recommended';
  }
  return 'cover_source_analysis_failed';
}

function reportYtDlpRetry(line: string, stage: CreatorExecutorInput): void {
  const retry = /Retrying \((\d+)\/(\d+)\)/i.exec(line);
  if (retry === null) return;
  stage.reportProgress({
    phase: 'reading_source_retry',
    percent: null,
    retryAttempt: Number(retry[1]),
    retryTotal: Number(retry[2])
  });
}

function isYoutubeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'youtu.be' || host.endsWith('youtube.com');
  } catch {
    return false;
  }
}
