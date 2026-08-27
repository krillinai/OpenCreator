import { useRef, useState, type DragEvent } from 'react';
import { Link2, UploadCloud } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';
import VideoSourcePreview from './VideoSourcePreview.js';

export default function VideoSourceInput(props: {
  file: File | null;
  registeredFile?: { name: string; size: number; mime: string };
  sourceType: 'url' | 'file';
  url: string;
  hasSource: boolean;
  invalid?: boolean;
  metadataService?: VideoMetadataService;
  onFileChange(file: File | null): void;
  onUrlChange(url: string): void;
  onClear(): void;
  onDimensions?(width: number, height: number): void;
}) {
  const l = useLocalizedCopy();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function openFilePicker() {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }

  function dropVideo(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    props.onFileChange(event.dataTransfer.files[0] ?? null);
  }

  return (
    <section
      className="video-translation-step-panel video-translation-source-step"
      aria-label={props.hasSource ? l('视频预览', 'Video preview') : undefined}
      aria-labelledby={props.hasSource ? undefined : 'add-video-title'}
    >
      <div
        className={props.hasSource ? 'video-translation-preview-drop-target' : 'video-translation-dropzone'}
        data-dragging={dragActive}
        onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={dropVideo}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*"
          onChange={event => props.onFileChange(event.target.files?.[0] ?? null)}
          aria-label={l('上传本地视频', 'Upload a local video')}
        />
        {props.hasSource ? (
          <VideoSourcePreview
            file={props.file}
            registeredFile={props.registeredFile}
            sourceType={props.sourceType}
            url={props.url}
            metadataService={props.metadataService}
            onChooseFile={openFilePicker}
            onClear={props.onClear}
            onDimensions={props.onDimensions}
          />
        ) : (
          <>
            <span className="video-translation-dropzone-icon" aria-hidden="true">
              <UploadCloud size={25} strokeWidth={1.6} />
            </span>
            <h2 id="add-video-title">{l('拖放视频到这里', 'Drop a video here')}</h2>
            <p>{l('支持常见视频与音频格式', 'Supports common video and audio formats')}</p>
            <button className="video-translation-browse" type="button" onClick={openFilePicker}>
              {l('选择本地视频', 'Choose a local video')}
            </button>
          </>
        )}
      </div>

      {!props.hasSource ? (
        <>
          <div className="video-translation-or"><span>{l('或', 'or')}</span></div>

          <label className="video-translation-field video-translation-url-field">
            <span>{l('视频链接', 'Video link')}</span>
            <div>
              <Link2 size={17} strokeWidth={1.7} aria-hidden="true" />
              <input
                type="url"
                value={props.url}
                onChange={event => props.onUrlChange(event.target.value)}
                placeholder={l('粘贴 YouTube、Bilibili 或其他视频链接', 'Paste a YouTube, Bilibili, or other video link')}
                aria-invalid={props.invalid}
              />
            </div>
          </label>
        </>
      ) : null}
    </section>
  );
}
