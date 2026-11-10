import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileVideo, Link2, LoaderCircle, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { supportedVideoSourcePlatform, parseBilibiliVideoSource, type VideoMetadataResponse } from '@opencreator/protocol';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';

type VideoSource =
  | { kind: 'youtube'; embedUrl: string; thumbnailUrl: string; url: string; label: string }
  | { kind: 'bilibili'; embedUrl: string; url: string; label: string; partIndex?: number }
  | { kind: 'direct'; url: string; label: string }
  | { kind: 'link'; url: string; hostname: string; label: string }
  | { kind: 'invalid'; label: string };

export type SourcePlaybackPreview = {
  src?: string;
  pending: boolean;
  blocked?: boolean;
  error?: string;
  onPrepare?(): void;
};

export function parseVideoSource(value: string): VideoSource {
  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { kind: 'invalid', label: trimmed };
    }

    const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    let youtubeId = '';
    if (hostname === 'youtu.be') {
      youtubeId = url.pathname.split('/').filter(Boolean)[0] ?? '';
    } else if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      youtubeId = url.searchParams.get('v') ?? '';
      if (!youtubeId) {
        const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
        youtubeId = match?.[1] ?? '';
      }
    }
    if (youtubeId) {
      const encodedId = encodeURIComponent(youtubeId);
      return {
        kind: 'youtube',
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodedId}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${encodedId}/hqdefault.jpg`,
        url: url.toString(),
        label: 'YouTube 视频'
      };
    }

    if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) {
      const bilibili = parseBilibiliVideoSource(trimmed);
      if (bilibili) {
        const { videoId, partIndex } = bilibili;
        const idParam = videoId.toLowerCase().startsWith('av')
          ? `aid=${encodeURIComponent(videoId.slice(2))}`
          : `bvid=${encodeURIComponent(videoId)}`;
        return {
          kind: 'bilibili',
          embedUrl: `https://player.bilibili.com/player.html?${idParam}&p=${partIndex ?? 1}&high_quality=1&danmaku=0`,
          url: bilibili.url,
          label: 'Bilibili 视频',
          ...(partIndex === undefined ? {} : { partIndex })
        };
      }
      return { kind: 'invalid', label: trimmed };
    }

    if (/\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(`${url.pathname}${url.search}${url.hash}`)) {
      return { kind: 'direct', url: url.toString(), label: '视频直链' };
    }

    return { kind: 'link', url: url.toString(), hostname, label: '视频链接' };
  } catch {
    return { kind: 'invalid', label: trimmed };
  }
}

export function LocalVideoPreview(props: { file: File; onDimensions?(width: number, height: number): void }) {
  const l = useLocalizedCopy();
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const nextObjectUrl = URL.createObjectURL(props.file);
    setObjectUrl(nextObjectUrl);
    return () => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(nextObjectUrl);
    };
  }, [props.file]);

  if (!objectUrl) {
    return <FileVideo size={34} strokeWidth={1.5} aria-hidden="true" />;
  }

  return props.file.type.startsWith('audio/') ? (
    <audio controls src={objectUrl} aria-label={l('本地音频预览', 'Local audio preview')} />
  ) : (
    <PreviewVideo key={objectUrl} src={objectUrl} label={l('本地视频预览', 'Local video preview')} onDimensions={props.onDimensions} />
  );
}

function PreviewVideo(props: { src: string; label: string; poster?: string; onReady?(): void; onError?(): void; onDimensions?(width: number, height: number): void }) {
  const [aspectRatio, setAspectRatio] = useState<string>();

  return (
    <video
      controls
      playsInline
      preload="metadata"
      src={props.src}
      poster={props.poster}
      onError={props.onError}
      onLoadedData={props.onReady}
      aria-label={props.label}
      style={aspectRatio ? { aspectRatio } : undefined}
      onLoadedMetadata={event => {
        const { videoWidth, videoHeight } = event.currentTarget;
        if (videoWidth > 0 && videoHeight > 0) {
          setAspectRatio(`${videoWidth} / ${videoHeight}`);
          props.onDimensions?.(videoWidth, videoHeight);
        }
      }}
    />
  );
}

export default function VideoSourcePreview(props: {
  file: File | null;
  registeredFile?: { name: string; size: number; mime: string };
  sourceType: 'url' | 'file';
  url: string;
  onChooseFile(): void;
  onClear(): void;
  readOnly?: boolean;
  displayLabel?: string;
  displayDetail?: string;
  metadataService?: VideoMetadataService;
  metadata?: VideoMetadataResponse;
  previewEnabled?: boolean;
  playbackPreview?: SourcePlaybackPreview;
  onDimensions?(width: number, height: number): void;
  onMetadata?(url: string, metadata: VideoMetadataResponse): void;
}) {
  const l = useLocalizedCopy();
  const [showYouTubePlayer, setShowYouTubePlayer] = useState(false);
  const [fetchedMetadata, setFetchedMetadata] = useState<{ url: string; value: VideoMetadataResponse }>();
  const metadata = props.metadata ?? (fetchedMetadata?.url === props.url ? fetchedMetadata.value : undefined);
  const [mediaDimensions, setMediaDimensions] = useState<{ width: number; height: number }>();
  const [onlinePreviewState, setOnlinePreviewState] = useState<{ url: string; pending: boolean }>();
  const [onlinePreviewReload, setOnlinePreviewReload] = useState(0);
  const [failedPlayback, setFailedPlayback] = useState<{ url: string; src: string }>();
  const [readyPlayback, setReadyPlayback] = useState<{ url: string; src: string }>();
  const source = useMemo(() => parseVideoSource(props.url), [props.url]);
  const localFile = props.sourceType === 'file' ? props.file : null;
  const registeredFile = props.sourceType === 'file' ? props.registeredFile : undefined;
  const isLocal = localFile !== null || registeredFile !== undefined;
  const canResolveOnline = !isLocal && source.kind === 'link'
    && !props.playbackPreview?.src && supportedVideoSourcePlatform(props.url) !== null && props.metadataService !== undefined;
  const onlinePreviewPending = canResolveOnline && !props.playbackPreview?.src && !props.playbackPreview?.pending
    && (onlinePreviewState?.url !== props.url || onlinePreviewState.pending);
  const linkPlaybackSrc = props.playbackPreview?.src ?? metadata?.previewUrl;
  const playbackFailed = failedPlayback?.url === props.url && failedPlayback.src === linkPlaybackSrc;
  const localizedLabel = source.kind === 'youtube'
    ? l('YouTube 视频', 'YouTube video')
    : source.kind === 'bilibili'
      ? l('Bilibili 视频', 'Bilibili video')
      : source.kind === 'direct'
        ? l('视频直链', 'Direct video link')
        : source.kind === 'link'
          ? l('视频链接', 'Video link')
          : source.label;
  const sourceLabel = props.displayLabel ?? (
    localFile?.name ?? registeredFile?.name ?? (metadata?.selectedPart && (metadata.parts?.length ?? 0) > 1
      ? `${metadata.title} · P${metadata.selectedPart.index} ${metadata.selectedPart.title}`
      : metadata?.title) ?? localizedLabel
  );
  const sourceDetail = props.displayDetail ?? (localFile
    ? `${localFile.type.startsWith('audio/') ? l('本地音频', 'Local audio') : l('本地视频', 'Local video')} · ${formatFileSize(localFile.size)}`
    : registeredFile
      ? `${registeredFile.mime.startsWith('audio/') ? l('本地音频', 'Local audio') : l('本地视频', 'Local video')} · ${formatFileSize(registeredFile.size)}`
    : metadata
      ? `${localizedLabel}${metadata.authorName ? ` · ${metadata.authorName}` : ''}`
    : source.kind === 'link'
      ? source.hostname
      : source.kind === 'invalid'
        ? l('请检查链接是否完整', 'Check that the link is complete')
        : localizedLabel);

  useEffect(() => {
    setShowYouTubePlayer(false);
    setMediaDimensions(undefined);
    setFailedPlayback(undefined);
    setReadyPlayback(undefined);
    setOnlinePreviewReload(0);
  }, [props.sourceType, props.url]);

  useEffect(() => {
    setMediaDimensions(undefined);
  }, [localFile]);

  useEffect(() => {
    if (source.kind !== 'link' || !linkPlaybackSrc || props.playbackPreview?.src || playbackFailed
      || readyPlayback?.url === props.url && readyPlayback.src === linkPlaybackSrc) return;
    const timeout = setTimeout(() => setFailedPlayback({ url: props.url, src: linkPlaybackSrc }), 15_000);
    return () => clearTimeout(timeout);
  }, [source.kind, props.url, linkPlaybackSrc, props.playbackPreview?.src, playbackFailed, readyPlayback]);

  useEffect(() => {
    if (!canResolveOnline || props.playbackPreview?.src || props.playbackPreview?.pending) return;
    let active = true;
    setOnlinePreviewState({ url: props.url, pending: true });
    const timeout = setTimeout(() => {
      void props.metadataService!.getVideoMetadata(props.url).then(result => {
        if (!active) return;
        setFailedPlayback(undefined);
        setFetchedMetadata({ url: props.url, value: result });
        props.onMetadata?.(props.url, result);
        setOnlinePreviewState({ url: props.url, pending: false });
        if (result.width !== undefined && result.height !== undefined) updateMediaDimensions(result.width, result.height);
      }).catch(() => {
        if (active) setOnlinePreviewState({ url: props.url, pending: false });
      });
    }, 250);
    return () => { active = false; clearTimeout(timeout); };
  }, [canResolveOnline, props.metadataService, props.url, props.playbackPreview?.src, props.playbackPreview?.pending, onlinePreviewReload]);

  function updateMediaDimensions(width: number, height: number) {
    setMediaDimensions({ width, height });
    props.onDimensions?.(width, height);
  }

  useEffect(() => {
    let active = true;
    if ((source.kind !== 'youtube' && source.kind !== 'bilibili') || props.metadataService === undefined) return undefined;
    void props.metadataService.getVideoMetadata(props.url).then(result => {
      if (!active) return;
      setFetchedMetadata({ url: props.url, value: result });
      props.onMetadata?.(props.url, result);
      if (result.width !== undefined && result.height !== undefined) {
        updateMediaDimensions(result.width, result.height);
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [props.metadataService, props.url, source.kind]);

  useEffect(() => {
    if (props.metadata?.width !== undefined && props.metadata.height !== undefined) {
      updateMediaDimensions(props.metadata.width, props.metadata.height);
    }
  }, [props.metadata]);

  const needsPartSelection = source.kind === 'bilibili'
    && (props.previewEnabled === false || ((metadata?.parts?.length ?? 0) > 1 && metadata?.selectedPart === undefined));

  return (
    <div
      className="video-source-preview"
      data-orientation={mediaDimensions === undefined
        ? undefined
        : mediaDimensions.height > mediaDimensions.width ? 'portrait' : 'landscape'}
    >
      <div
        className="video-source-preview-media"
        style={mediaDimensions ? { aspectRatio: `${mediaDimensions.width} / ${mediaDimensions.height}` } : undefined}
      >
        {localFile ? <LocalVideoPreview file={localFile} onDimensions={updateMediaDimensions} /> : null}
        {!localFile && registeredFile ? (
          <div className="video-source-link-preview">
            <span><FileVideo size={34} strokeWidth={1.5} aria-hidden="true" /></span>
            <strong>{l('本地视频已上传', 'Local video uploaded')}</strong>
            <p>{sourceDetail}</p>
          </div>
        ) : null}
        {!isLocal && source.kind === 'youtube' && !showYouTubePlayer ? (
          <button
            className="video-source-youtube-poster"
            type="button"
            onClick={() => setShowYouTubePlayer(true)}
            aria-label={l('播放 YouTube 视频预览', 'Play YouTube video preview')}
          >
            <img src={source.thumbnailUrl} alt={l('YouTube 视频缩略图', 'YouTube video thumbnail')} />
            <span aria-hidden="true"><Play size={24} fill="currentColor" /></span>
          </button>
        ) : null}
        {!isLocal && needsPartSelection ? (
          <div className="video-source-link-preview">
            <strong>{metadata === undefined
              ? l('正在确认视频分集', 'Checking the selected video part')
              : l('选择分集后预览视频', 'Select a part to preview the video')}</strong>
          </div>
        ) : null}
        {!isLocal && ((source.kind === 'youtube' && showYouTubePlayer) || (source.kind === 'bilibili' && !needsPartSelection)) ? (
          <iframe
            src={source.embedUrl}
            title={l(`${localizedLabel}预览`, `${localizedLabel} preview`)}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : null}
        {!isLocal && source.kind === 'direct' ? (
          <PreviewVideo key={source.url} src={source.url} label={l('视频链接预览', 'Video link preview')} onDimensions={updateMediaDimensions} />
        ) : null}
        {!isLocal && source.kind === 'link' && linkPlaybackSrc && !playbackFailed ? (
          <PreviewVideo key={linkPlaybackSrc} src={linkPlaybackSrc} poster={metadata?.thumbnailUrl}
            label={props.playbackPreview?.src ? l('原视频预览', 'Source video preview') : l('在线视频预览', 'Online video preview')}
            onReady={() => setReadyPlayback({ url: props.url, src: linkPlaybackSrc })}
            onError={() => setFailedPlayback({ url: props.url, src: linkPlaybackSrc })} onDimensions={updateMediaDimensions} />
        ) : null}
        {!isLocal && ((source.kind === 'link' && (!linkPlaybackSrc || playbackFailed)) || source.kind === 'invalid') ? (
          <div className="video-source-link-preview">
            {!props.playbackPreview?.pending && !onlinePreviewPending && metadata?.thumbnailUrl ? (
              <img className="video-source-preview-thumbnail" src={metadata.thumbnailUrl} alt={l('视频封面', 'Video poster')} />
            ) : <span>{props.playbackPreview?.pending || onlinePreviewPending ? <LoaderCircle className="video-source-preview-spinner" size={26} aria-hidden="true" /> : <Link2 size={26} strokeWidth={1.6} aria-hidden="true" />}</span>}
            <strong role={props.playbackPreview?.pending || onlinePreviewPending ? 'status' : undefined}>{source.kind === 'invalid'
              ? l('暂时无法预览此链接', 'This link cannot be previewed')
              : onlinePreviewPending
                ? l('正在获取视频预览', 'Loading online video preview')
              : props.playbackPreview?.pending
                ? l('正在准备视频预览', 'Preparing video preview')
                : props.playbackPreview?.error
                  ? l('视频预览准备失败', 'Video preview preparation failed')
                  : canResolveOnline || playbackFailed
                    ? l('在线播放暂不可用', 'Online playback is unavailable')
                  : props.playbackPreview?.onPrepare
                    ? l('原视频预览', 'Source video preview')
                    : l('此平台暂不支持内嵌预览', 'Embedded preview is not supported for this platform')}</strong>
            <p>{sourceDetail}</p>
            {source.kind === 'link' && props.playbackPreview?.error ? <p className="video-source-preview-error" role="alert">{props.playbackPreview.error}</p> : null}
            {source.kind === 'link' && props.playbackPreview?.onPrepare && !onlinePreviewPending ? (
              <button type="button" className="video-source-prepare-preview" disabled={props.playbackPreview.pending || props.playbackPreview.blocked} onClick={props.playbackPreview.onPrepare}>
                <Download size={14} aria-hidden="true" />
                {props.playbackPreview.pending ? l('正在准备…', 'Preparing…') : props.playbackPreview.error ? l('重试视频预览', 'Retry video preview') : l('下载并预览', 'Download and preview')}
              </button>
            ) : null}
            {source.kind === 'link' && canResolveOnline && !onlinePreviewPending && !props.playbackPreview?.pending ? (
              <button type="button" className="video-source-retry-online" title={l('重试在线播放', 'Retry online playback')} aria-label={l('重试在线播放', 'Retry online playback')}
                onClick={() => {
                  setFetchedMetadata(undefined);
                  setReadyPlayback(undefined);
                  setOnlinePreviewState({ url: props.url, pending: true });
                  setOnlinePreviewReload(value => value + 1);
                }}>
                <RotateCcw size={15} aria-hidden="true" />
              </button>
            ) : null}
            {source.kind === 'link' ? (
              <a href={source.url} target="_blank" rel="noreferrer">
                {l('打开原始链接', 'Open original link')}
                <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="video-source-preview-footer">
        <span className="video-source-preview-icon" aria-hidden="true">
          {isLocal ? <FileVideo size={17} strokeWidth={1.7} /> : <Link2 size={17} strokeWidth={1.7} />}
        </span>
        <span className="video-source-preview-copy">
          <strong title={sourceLabel}>{sourceLabel}</strong>
          <small>{sourceDetail}</small>
        </span>
        {!props.readOnly ? (
          <div className="video-source-preview-actions">
            {!isLocal && (source.kind === 'youtube' || source.kind === 'bilibili' || (source.kind === 'link' && linkPlaybackSrc && !playbackFailed)) ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                aria-label={l('在浏览器中打开原视频', 'Open the original video in a browser')}
                title={l('预览无法播放时打开原视频', 'Open the original video if the preview cannot play')}
              >
                <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />
              </a>
            ) : null}
            {isLocal ? (
              <button type="button" onClick={props.onChooseFile}>
                <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
                {l('重新选择', 'Change')}
              </button>
            ) : null}
            <button type="button" onClick={props.onClear} aria-label={l('清除当前视频来源', 'Clear current video source')} title={l('清除当前视频来源', 'Clear current video source')}>
              <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
