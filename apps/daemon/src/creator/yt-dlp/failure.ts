import { sanitizePublicErrorFacts } from '@opencreator/protocol';
import { CreatorExecutorError } from '../executor.js';
import { sanitizeIssueDetail } from '../issues.js';

export function classifyYtDlpFailure(
  stderr: string,
  exitCode: number | null,
  fallbackCode = 'download_failed'
): CreatorExecutorError {
  const text = stderr.toLowerCase();
  const douyin = /\[douyin(?:\+[^\]]+)?\]/.test(text);
  const failure = (
    code: string,
    message: string,
    kind: NonNullable<CreatorExecutorError['publicFacts']>['kind'],
    httpStatus?: number,
    upstreamMessage?: string
  ) => new CreatorExecutorError(code, message, {}, {
    ...sanitizePublicErrorFacts({ kind, upstreamMessage }),
    kind,
    provider: 'yt-dlp',
    ...(httpStatus === undefined ? {} : { httpStatus })
  });
  if (douyin && text.includes('douyin request signature is required')) {
    return failure('platform_request_signature_required',
      'Douyin rejected the downloader because its required browser request signature is not supported. Reconnecting cookies alone cannot fix this; use a local video file.',
      'unsupported', 403, stderr);
  }
  if (douyin && (text.includes('fresh cookies') || text.includes('douyin browser identity was rejected'))) {
    const status = /http error\s+(\d{3})\b/i.exec(stderr);
    return failure('platform_session_required',
      'Douyin did not accept the browser session or requires website verification. Reconnect Douyin in Settings > Platform connections and retry; signing in is not necessarily required.',
      'unauthorized', status === null ? undefined : Number(status[1]), stderr);
  }
  if (fallbackCode === 'cover_source_analysis_failed') {
    if (text.includes('sign in') || text.includes('login')) {
      return failure('login_required', 'yt-dlp reports that platform login or fresh cookies are required.', 'unauthorized');
    }
    if (text.includes('private video')) return failure('source_private', 'The video is private.', 'unauthorized');
  }
  if (/bilibili risk control (?:rejected the media request|blocked media extraction)/.test(text)
    || (text.includes('bilibili risk control') && text.includes('no video formats found'))) {
    return failure('download_failed', 'Bilibili risk control rejected the media request. Wait and retry, or use a local video file.', 'http-rejected');
  }
  if (/proxyerror|proxy connection|proxy (?:server )?(?:timed out|refused|unreachable|failed)/.test(text)) {
    const reason = /timed out|timeout/.test(text) ? 'timed out' : /refused/.test(text) ? 'was refused' : 'failed';
    return failure('network_unavailable', `yt-dlp proxy connection ${reason}. Check the proxy address and whether the proxy service is running.`,
      reason === 'timed out' ? 'timeout' : reason === 'was refused' ? 'connection-refused' : 'unavailable');
  }
  if (/temporary failure in name resolution|name or service not known|no address associated|nodename nor servname|dns error|failed to resolve/.test(text)) {
    return failure('network_unavailable', 'yt-dlp could not resolve the video platform host. Check DNS, network, and proxy settings.', 'dns');
  }
  if (text.includes('connection timed out') || text.includes('connect timeout') || text.includes('timed out')) {
    return failure('network_unavailable', 'yt-dlp connection to the video platform timed out. Check the network or proxy settings.', 'timeout');
  }
  if (text.includes('network is unreachable') || text.includes('unable to connect')
    || text.includes('connection refused') || text.includes('connection reset')) {
    const kind = text.includes('refused') ? 'connection-refused'
      : text.includes('reset') ? 'connection-reset' : 'unavailable';
    const reason = kind === 'connection-refused' ? 'the connection was refused'
      : kind === 'connection-reset' ? 'the connection was reset' : 'the network is unavailable';
    return failure('network_unavailable', `yt-dlp could not connect to the video platform: ${reason}. Check the network or proxy settings.`, kind);
  }
  if (fallbackCode === 'cover_source_analysis_failed' && (text.includes('copyright') || text.includes('not available'))) {
    return failure('region_or_copyright_restricted', 'yt-dlp reports that the video is region or copyright restricted.', 'unauthorized');
  }
  const httpStatus = /http error\s+(\d{3})\b/i.exec(stderr);
  if (httpStatus !== null) {
    const status = Number(httpStatus[1]);
    const kind = status === 429 ? 'rate-limited'
      : status === 401 || status === 403 ? 'unauthorized'
        : status >= 500 ? 'unavailable' : 'http-rejected';
    return failure('download_http_error', `The video platform returned HTTP ${status} to yt-dlp.`, kind, status);
  }
  if (text.includes('requested format is not available') || text.includes('no video formats found')) {
    return failure('format_unavailable', 'yt-dlp could not find the requested video or audio format.', 'not-found');
  }
  if (text.includes('sign in') || text.includes('login') || text.includes('cookies')) {
    return failure('login_required', 'yt-dlp reports that platform login or fresh cookies are required.', 'unauthorized');
  }
  if (text.includes('copyright') || text.includes('not available in your country') || text.includes('geo-restricted')) {
    return failure('region_or_copyright_restricted', 'yt-dlp reports that the video is region or copyright restricted.', 'unauthorized');
  }
  if (text.includes('please update') || text.includes('confirm you are on the latest version')
    || text.includes('signature extraction failed') || text.includes('nsig extraction failed')
    || text.includes('unable to extract') || text.includes('extractor error')) {
    return failure('yt_dlp_update_recommended', 'yt-dlp could not extract this video; its platform extractor may be outdated.', 'unsupported');
  }
  if (text.includes('no space left')) {
    return failure('disk_full', 'yt-dlp could not save the video because disk space is exhausted.', 'storage');
  }
  const detail = publicYtDlpErrorLine(stderr);
  return failure(fallbackCode, detail === undefined
    ? `yt-dlp exited with code ${exitCode ?? 'unknown'} without a usable error detail.`
    : `yt-dlp exited with code ${exitCode ?? 'unknown'}: ${detail}`, 'unknown');
}

export function embeddedYtDlpFailure(code: string, message: string): CreatorExecutorError | undefined {
  if (!/^(?:platform_caption_access_failed|prepare_(?:media|audio_fallback)_failed)$/.test(code)
    || !/(?:yt-dlp|downloadYouTubeSubtitle)/i.test(message)
    || /cookies? (?:are )?no longer valid|cookies? (?:have |has )?expired/i.test(message)) return undefined;
  const lastError = message.match(/ERROR:[^\r\n]*/gi)?.at(-1) ?? message;
  const classified = classifyYtDlpFailure(lastError, null);
  return classified.code === 'network_unavailable' || classified.code === 'yt_dlp_update_recommended'
    ? classified : undefined;
}

function publicYtDlpErrorLine(stderr: string): string | undefined {
  const line = stderr.split(/\r?\n/).reverse().find(candidate => /^\s*ERROR:/i.test(candidate));
  if (line === undefined) return undefined;
  const redacted = line
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/(?:https?|ftp):\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[local path]')
    .replace(/\b(?:cookie|token|authorization|password)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_=-]{32,}\b/g, '[redacted]');
  return sanitizeIssueDetail(redacted, 300);
}
