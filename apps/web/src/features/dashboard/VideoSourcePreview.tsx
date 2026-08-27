import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileVideo, Link2, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { VideoMetadataResponse } from '@opencreator/protocol';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';

type VideoSource =
  | { kind: 'youtube'; embedUrl: string; thumbnailUrl: string; url: string; label: string }
  | { kind: 'bilibili'; embedUrl: string; url: string; label: string }
  | { kind: 'direct'; url: string; label: string }
  | { kind: 'link'; url: string; hostname: string; label: string }
  | { kind: 'invalid'; label: string };

function parseVideoSource(value: string): VideoSource {
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
      const videoId = url.pathname.match(/\/(BV[\w]+|av\d+)(?:[/?#]|$)/i)?.[1];
      if (videoId) {
        const idParam = videoId.toLowerCase().startsWith('av')
          ? `aid=${encodeURIComponent(videoId.slice(2))}`
          : `bvid=${encodeURIComponent(videoId)}`;
        return {
          kind: 'bilibili',
          embedUrl: `https://player.bilibili.com/player.html?${idParam}&page=1&high_quality=1&danmaku=0`,
          url: url.toString(),
          label: 'Bilibili 视频'
        };
      }
    }

    if (/\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(`${url.pathname}${url.search}${url.hash}`)) {
      return { kind: 'direct', url: url.toString(), label: '视频直链' };
    }

    return { kind: 'link', url: url.toString(), hostname, label: '视频链接' };
  } catch {
    return { kind: 'invalid', label: trimmed };
  }
}

function LocalVideoPreview(props: { file: File; onDimensions?(width: number, height: number): void }) {
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

function PreviewVideo(props: { src: string; label: string; onDimensions?(width: number, height: number): void }) {
  const [aspectRatio, setAspectRatio] = useState<string>();

  return (
    <video
      controls
      src={props.src}
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
  onDimensions?(width: number, height: number): void;
}) {
  const l = useLocalizedCopy();
  const [showYouTubePlayer, setShowYouTubePlayer] = useState(false);
  const [metadata, setMetadata] = useState<VideoMetadataResponse>();
  const [mediaDimensions, setMediaDimensions] = useState<{ width: number; height: number }>();
  const source = useMemo(() => parseVideoSource(props.url), [props.url]);
  const localFile = props.sourceType === 'file' ? props.file : null;
  const registeredFile = props.sourceType === 'file' ? props.registeredFile : undefined;
  const isLocal = localFile !== null || registeredFile !== undefined;
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
    localFile?.name ?? registeredFile?.name ?? metadata?.title ?? localizedLabel
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
  }, [props.sourceType, props.url]);

  useEffect(() => {
    setMediaDimensions(undefined);
  }, [localFile]);

  function updateMediaDimensions(width: number, height: number) {
    setMediaDimensions({ width, height });
    props.onDimensions?.(width, height);
  }

  useEffect(() => {
    let active = true;
    setMetadata(undefined);
    if ((source.kind !== 'youtube' && source.kind !== 'bilibili') || props.metadataService === undefined) return undefined;
    void props.metadataService.getVideoMetadata(props.url).then(result => {
      if (!active) return;
      setMetadata(result);
      if (result.width !== undefined && result.height !== undefined) {
        updateMediaDimensions(result.width, result.height);
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [props.metadataService, props.url, source.kind]);

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
        {!isLocal && ((source.kind === 'youtube' && showYouTubePlayer) || source.kind === 'bilibili') ? (
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
        {!isLocal && (source.kind === 'link' || source.kind === 'invalid') ? (
          <div className="video-source-link-preview">
            <span><Link2 size={26} strokeWidth={1.6} aria-hidden="true" /></span>
            <strong>{source.kind === 'invalid' ? l('暂时无法预览此链接', 'This link cannot be previewed') : l('此平台暂不支持内嵌预览', 'Embedded preview is not supported for this platform')}</strong>
            <p>{sourceDetail}</p>
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
            {!isLocal && (source.kind === 'youtube' || source.kind === 'bilibili') ? (
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
