import {
  useEffect,
  useRef,
  useState
} from 'react';
import {
  Captions,
  Download,
  FileAudio,
  FileVideo,
  Mic2,
  PackageOpen,
  RotateCcw,
  Save,
  Settings2
} from 'lucide-react';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';

export type VideoTranslationResultTab = 'video' | 'subtitles' | 'voice' | 'settings';
export type VideoResultVariant = 'horizontal' | 'vertical' | 'dubbed';
export type SubtitleResultVariant = 'horizontal' | 'vertical';

export type SubtitleCue = {
  id: number;
  start: string;
  end: string;
  text: string;
  sourceText?: string;
};

type VersionItem = {
  value: number;
  description: string;
};

export type VideoResultOutput = {
  artifactId: string;
  variant: VideoResultVariant;
  artifactVersion: number;
  fileName?: string;
  src?: string;
  previewLoading?: boolean;
  previewError?: string;
};

export type SubtitleResultOutput = {
  artifactId: string;
  variant: SubtitleResultVariant;
  artifactVersion: number;
  fileName?: string;
  cues: SubtitleCue[];
  readOnly: boolean;
  translationPosition?: 'top' | 'bottom';
};

export type SubtitleVideoPreview = {
  artifactId: string;
  src?: string;
  previewLoading?: boolean;
  previewError?: string;
  source: boolean;
};

export type VoiceResultOutput = {
  artifactId: string;
  artifactVersion: number;
  fileName?: string;
  src?: string;
  previewLoading?: boolean;
  previewError?: string;
};

const resultTabs: Array<{
  value: VideoTranslationResultTab;
  label: string;
  icon: typeof FileVideo;
}> = [
  { value: 'video', label: '作品', icon: PackageOpen },
  { value: 'subtitles', label: '字幕', icon: Captions },
  { value: 'voice', label: '配音', icon: Mic2 },
  { value: 'settings', label: '任务设置', icon: Settings2 }
];

export default function VideoTranslationResultWorkspace(props: {
  activeTab: VideoTranslationResultTab;
  version: number;
  versions: VersionItem[];
  targetLanguage: string;
  outputLabel: string;
  subtitleStyleLabel: string;
  dubbing: boolean;
  hasVoiceArtifact: boolean;
  videoOutputs: VideoResultOutput[];
  subtitleOutputs: SubtitleResultOutput[];
  subtitleVideoPreviews: Partial<Record<SubtitleResultVariant, SubtitleVideoPreview>>;
  voiceOutput?: VoiceResultOutput;
  subtitleDirty: boolean;
  subtitleDirtyByVariant: Partial<Record<SubtitleResultVariant, boolean>>;
  subtitleSavePending?: boolean;
  nextVersion: number;
  affectedArtifacts: string[];
  hasPendingChanges: boolean;
  regenerationPending: boolean;
  notice?: string;
  onTabChange(tab: VideoTranslationResultTab): void;
  onVersionChange(version: number): void;
  onSubtitleChange(variant: SubtitleResultVariant, id: number, text: string, field?: 'text' | 'sourceText'): void;
  onSaveSubtitles(variant: SubtitleResultVariant): void;
  onAdjustSettings(): void;
  onExport(type: 'video' | 'subtitles' | 'voice', artifactId?: string): void;
  onReloadVoice(): void;
  onRequestRegenerate(): void;
  onCancelRegenerate(): void;
  onConfirmRegenerate(): void;
}) {
  const l = useLocalizedCopy();
  const availableSubtitleVariants = props.subtitleOutputs.map(output => output.variant);
  const availableSubtitleVariantKey = availableSubtitleVariants.join('|');
  const [selectedSubtitleVariant, setSelectedSubtitleVariant] = useState<SubtitleResultVariant>('horizontal');
  const [subtitlePlaybackTime, setSubtitlePlaybackTime] = useState(0);
  const subtitleVideoRef = useRef<HTMLVideoElement>(null);
  const subtitleCueRefs = useRef(new Map<number, HTMLElement>());
  const activeSubtitleVariant = availableSubtitleVariants.includes(selectedSubtitleVariant)
    ? selectedSubtitleVariant
    : availableSubtitleVariants.includes('horizontal')
      ? 'horizontal'
      : availableSubtitleVariants[0];
  const activeSubtitleOutput = props.subtitleOutputs.find(output => output.variant === activeSubtitleVariant);
  const activeSubtitleDirty = activeSubtitleVariant === undefined
    ? false
    : props.subtitleDirtyByVariant[activeSubtitleVariant] === true;
  const hasSubtitleDrafts = Object.values(props.subtitleDirtyByVariant).some(Boolean);
  const activeSubtitleVideo = activeSubtitleVariant === undefined
    ? undefined
    : props.subtitleVideoPreviews[activeSubtitleVariant];
  const activeSubtitleCues = activeSubtitleOutput?.cues.filter(cue => (
    subtitlePlaybackTime >= subtitleTimestampSeconds(cue.start)
    && subtitlePlaybackTime < subtitleTimestampSeconds(cue.end)
  )) ?? [];
  const activeSubtitleCueIds = new Set(activeSubtitleCues.map(cue => cue.id));
  const activeSubtitleCueKey = activeSubtitleCues.map(cue => cue.id).join('|');
  const subtitleCueGroups = activeSubtitleOutput === undefined
    ? []
    : groupSubtitleCues(activeSubtitleOutput.cues, activeSubtitleOutput.variant);
  const subtitleCueCount = props.subtitleOutputs.reduce((total, output) => total + output.cues.length, 0);
  const generatedArtifactCount = props.videoOutputs.length
    + props.subtitleOutputs.length
    + (props.voiceOutput === undefined ? 0 : 1);

  useEffect(() => {
    setSelectedSubtitleVariant(availableSubtitleVariants.includes('horizontal')
      ? 'horizontal'
      : availableSubtitleVariants[0] ?? 'horizontal');
  }, [availableSubtitleVariantKey, props.version]);

  useEffect(() => {
    setSubtitlePlaybackTime(0);
  }, [activeSubtitleVariant, activeSubtitleVideo?.src, props.version]);

  useEffect(() => {
    if (activeSubtitleCues.length === 0) return;
    subtitleCueRefs.current.get(activeSubtitleCues[0]!.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeSubtitleCueKey]);

  const seekToSubtitleCue = (cue: SubtitleCue) => {
    const start = subtitleTimestampSeconds(cue.start);
    if (!Number.isFinite(start)) return;
    if (subtitleVideoRef.current !== null) subtitleVideoRef.current.currentTime = start;
    setSubtitlePlaybackTime(start);
  };

  return (
    <section className="video-result-workspace" aria-label={l('视频翻译项目产出', 'Video translation project outputs')}>
      <div className="video-result-toolbar">
        <div className="video-result-tabs" role="tablist" aria-label={l('产出物类型', 'Output types')}>
          {resultTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={props.activeTab === tab.value}
                key={tab.value}
                onClick={() => props.onTabChange(tab.value)}
              >
                <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                {localizeResultTab(tab.label, l)}
                {tab.value === 'subtitles' && hasSubtitleDrafts ? (
                  <span className="video-result-unsaved" aria-label={l('有未保存的字幕修改', 'Unsaved subtitle changes')} />
                ) : null}
              </button>
            );
          })}
        </div>

        <CreatorResultVersionMenu
          version={props.version}
          versions={props.versions}
          onVersionChange={props.onVersionChange}
        />
      </div>

      {props.notice ? <p className="video-result-notice" role="status">{props.notice}</p> : null}

      {props.activeTab === 'video' ? (
        <div className="video-result-pane">
          <header className="video-result-pane-heading">
            <div>
              <h2>{l('作品', 'Works')}</h2>
              <p>{l(
                `项目 V${props.version} · ${generatedArtifactCount} 个文件`,
                `Project V${props.version} · ${generatedArtifactCount} file(s)`
              )}</p>
            </div>
          </header>
          {generatedArtifactCount > 0 ? (
            <div className="video-result-generated-sections">
              {props.videoOutputs.length > 0 ? (
                <section className="video-result-generated-section">
                  <h3>{l('成片', 'Videos')}</h3>
                  <div className="video-result-video-grid">
                    {props.videoOutputs.map(output => {
                      const artifactLabel = videoVariantArtifactLabel(output.variant, l);
                      return (
                        <section className="video-result-output-column" data-variant={output.variant} key={output.artifactId}>
                          <div className="video-result-output-heading">
                            <div>
                              <h3>{artifactLabel}</h3>
                              <small>{videoVariantFormatLabel(output.variant, l)} · {l('子项', 'Item')} V{output.artifactVersion}</small>
                            </div>
                          </div>
                          <div className="video-result-player-frame" data-ratio={output.variant === 'vertical' ? '9:16' : '16:9'}>
                            {output.src !== undefined ? (
                              <video
                                className="video-result-player"
                                src={output.src}
                                controls
                                preload="metadata"
                                aria-label={l(`${artifactLabel}预览`, `${artifactLabel} preview`)}
                              />
                            ) : (
                              <div className="video-result-player-status" role="status">
                                {output.previewLoading
                                  ? l(`正在加载${artifactLabel}...`, `Loading ${artifactLabel}...`)
                                  : output.previewError ?? l('成片预览暂时不可用，可直接下载文件。', 'Video preview is unavailable. You can still download the file.')}
                              </div>
                            )}
                          </div>
                          <div className="video-result-file-row">
                            <span aria-hidden="true"><FileVideo size={19} strokeWidth={1.7} /></span>
                            <div>
                              <strong>{output.fileName ?? `${artifactLabel}-${props.targetLanguage}-V${props.version}.mp4`}</strong>
                              <small>
                                {l('子项', 'Item')} V{output.artifactVersion}
                                {' · '}{l('项目', 'Project')} V{props.version}
                              </small>
                            </div>
                            <button
                              type="button"
                              onClick={() => props.onExport('video', output.artifactId)}
                              aria-label={l(`下载${artifactLabel}`, `Download ${artifactLabel}`)}
                              title={l(`下载${artifactLabel}`, `Download ${artifactLabel}`)}
                            >
                              <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {props.subtitleOutputs.length > 0 ? (
                <section className="video-result-generated-section">
                  <h3>{l('字幕', 'Subtitles')}</h3>
                  <div className="video-result-generated-file-grid">
                    {props.subtitleOutputs.map(output => {
                      const variantLabel = subtitleVariantLabel(output.variant, l);
                      return (
                        <div className="video-result-file-row" key={output.artifactId}>
                          <span aria-hidden="true"><Captions size={19} strokeWidth={1.7} /></span>
                          <div>
                            <strong>{output.fileName ?? `${variantLabel}-V${props.version}.srt`}</strong>
                            <small>
                              {variantLabel} · {l('子项', 'Item')} V{output.artifactVersion}
                            </small>
                          </div>
                          <button
                            type="button"
                            onClick={() => props.onExport('subtitles', output.artifactId)}
                            aria-label={l(`下载${variantLabel}`, `Download ${variantLabel}`)}
                            title={l(`下载${variantLabel}`, `Download ${variantLabel}`)}
                          >
                            <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {props.voiceOutput !== undefined ? (
                <section className="video-result-generated-section">
                  <h3>{l('配音', 'Dubbing')}</h3>
                  <div className="video-result-generated-file-grid">
                    <div className="video-result-file-row">
                      <span aria-hidden="true"><FileAudio size={19} strokeWidth={1.7} /></span>
                      <div>
                        <strong>{props.voiceOutput.fileName ?? `${l('目标语言配音', 'Target-language-dubbing')}-V${props.version}.wav`}</strong>
                        <small>
                          {l('配音', 'Dubbing')} V{props.voiceOutput.artifactVersion}
                          {' · '}{l('项目', 'Project')} V{props.version}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => props.onExport('voice', props.voiceOutput?.artifactId)}
                        aria-label={l('下载配音文件', 'Download dubbing file')}
                        title={l('下载配音文件', 'Download dubbing file')}
                      >
                        <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="video-result-empty">
              <PackageOpen size={26} strokeWidth={1.5} aria-hidden="true" />
              <strong>{l('当前项目版本没有作品', 'This project version has no works')}</strong>
            </div>
          )}
        </div>
      ) : null}

      {props.activeTab === 'subtitles' ? (
        <div className="video-result-pane video-result-subtitle-pane">
          <header className="video-result-pane-heading">
            <div>
              <h2>{l('字幕', 'Subtitles')}</h2>
              <p>
                {l('项目', 'Project')} V{props.version}
                {' · '}{activeSubtitleOutput?.cues.length ?? 0} {l('条字幕', 'subtitles')}
                {activeSubtitleOutput === undefined
                  ? ''
                  : ` · ${activeSubtitleDirty
                    ? l('有未保存修改', 'Unsaved changes')
                    : l('已保存', 'Saved')}`}
                {activeSubtitleOutput?.readOnly ? ` · ${l('只读', 'Read only')}` : ''}
              </p>
            </div>
            <div className="video-result-pane-actions">
              {availableSubtitleVariants.length > 1 ? (
                <div className="video-result-subtitle-variants" role="radiogroup" aria-label={l('字幕画幅', 'Subtitle format')}>
                  {availableSubtitleVariants.map(variant => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={activeSubtitleVariant === variant}
                      key={variant}
                      onClick={() => setSelectedSubtitleVariant(variant)}
                    >
                      {variant === 'horizontal' ? l('横屏', 'Horizontal') : l('竖屏', 'Vertical')}
                    </button>
                  ))}
                </div>
              ) : null}
              {activeSubtitleOutput !== undefined && !activeSubtitleOutput.readOnly ? (
                <button
                  type="button"
                  disabled={!activeSubtitleDirty || props.subtitleSavePending}
                  onClick={() => props.onSaveSubtitles(activeSubtitleOutput.variant)}
                >
                  <Save size={15} strokeWidth={1.8} aria-hidden="true" />
                  {props.subtitleSavePending
                    ? l('正在保存...', 'Saving...')
                    : l(
                        `保存${activeSubtitleOutput.variant === 'horizontal' ? '横屏' : '竖屏'}字幕`,
                        `Save ${activeSubtitleOutput.variant === 'horizontal' ? 'horizontal' : 'vertical'} subtitles`
                      )}
                </button>
              ) : null}
            </div>
          </header>
          {activeSubtitleOutput !== undefined ? (
            <div className="video-result-subtitle-preview-layout">
              <section className="video-result-subtitle-video" aria-label={l('同步视频预览', 'Synchronized video preview')}>
                <div
                  className="video-result-player-frame"
                  data-ratio={activeSubtitleOutput.variant === 'vertical' ? '9:16' : '16:9'}
                >
                  {activeSubtitleVideo?.src !== undefined ? (
                    <>
                      <video
                        className="video-result-player"
                        key={`${props.version}-${activeSubtitleVariant}-${activeSubtitleVideo.src}`}
                        ref={subtitleVideoRef}
                        src={activeSubtitleVideo.src}
                        controls
                        preload="metadata"
                        onLoadedMetadata={event => setSubtitlePlaybackTime(event.currentTarget.currentTime)}
                        onSeeked={event => setSubtitlePlaybackTime(event.currentTarget.currentTime)}
                        onTimeUpdate={event => setSubtitlePlaybackTime(event.currentTarget.currentTime)}
                        aria-label={l(
                          `${subtitleVariantLabel(activeSubtitleOutput.variant, l)}视频预览`,
                          `${subtitleVariantLabel(activeSubtitleOutput.variant, l)} video preview`
                        )}
                      />
                      {activeSubtitleCues.length > 0 ? (
                        <div className="video-result-subtitle-overlay" aria-hidden="true">
                          {activeSubtitleCues.map(cue => (
                            <span key={cue.id}>
                              {subtitleCueDisplayText(cue, activeSubtitleOutput.translationPosition)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="video-result-player-status" role="status">
                      {activeSubtitleVideo?.previewLoading
                        ? l('正在加载视频...', 'Loading video...')
                        : activeSubtitleVideo?.previewError
                          ?? l('当前版本没有可用于字幕同步预览的视频。', 'This version has no video available for synchronized subtitle preview.')}
                    </div>
                  )}
                </div>
                {activeSubtitleVideo?.source ? (
                  <small>{l('当前使用原视频同步预览', 'Using the source video for synchronized preview')}</small>
                ) : null}
              </section>

              <section className="video-result-output-column" data-variant={activeSubtitleOutput.variant}>
                {activeSubtitleOutput.cues.length > 0 ? (
                  <div
                    className="video-subtitle-editor"
                    role="list"
                    aria-label={l(
                      `${subtitleVariantLabel(activeSubtitleOutput.variant, l)}内容`,
                      `${subtitleVariantLabel(activeSubtitleOutput.variant, l)} content`
                    )}
                  >
                    {subtitleCueGroups.map((group, groupIndex) => {
                      const firstCue = group[0]!.cue;
                      return (
                        <div
                          className="video-subtitle-cue"
                          role="listitem"
                          data-active={group.some(({ cue }) => activeSubtitleCueIds.has(cue.id))}
                          data-subtitle-cue="true"
                          key={firstCue.id}
                          ref={node => {
                            for (const { cue } of group) {
                              if (node === null) subtitleCueRefs.current.delete(cue.id);
                              else subtitleCueRefs.current.set(cue.id, node);
                            }
                          }}
                        >
                          <button
                            type="button"
                            className="video-subtitle-cue-time"
                            onClick={() => seekToSubtitleCue(firstCue)}
                            aria-label={l(`跳转到 ${firstCue.start}`, `Jump to ${firstCue.start}`)}
                          >
                            <span>{String(groupIndex + 1).padStart(2, '0')}</span>
                            <small title={`${firstCue.start} - ${firstCue.end}`}>
                              {subtitleCueShortTime(firstCue.start)}–{subtitleCueShortTime(firstCue.end)}
                            </small>
                          </button>
                          <div className="video-subtitle-cue-lines">
                            {group.map(({ cue, index }, lineIndex) => {
                              const sourceLine = cue.sourceText === undefined ? null : (
                                <textarea
                                  className="video-subtitle-cue-source"
                                  rows={1}
                                  value={cue.sourceText}
                                  readOnly={activeSubtitleOutput.readOnly}
                                  onChange={activeSubtitleOutput.readOnly ? undefined : event => props.onSubtitleChange(
                                    activeSubtitleOutput.variant, cue.id, event.target.value, 'sourceText'
                                  )}
                                  aria-label={l(
                                    `${subtitleVariantLabel(activeSubtitleOutput.variant, l)}原文 ${index + 1}`,
                                    `${subtitleVariantLabel(activeSubtitleOutput.variant, l)} source ${index + 1}`
                                  )}
                                />
                              );
                              const translationLine = (
                                <textarea
                                  className={lineIndex > 0 ? 'video-subtitle-cue-source' : 'video-subtitle-cue-translation'}
                                  rows={1}
                                  value={cue.text}
                                  readOnly={activeSubtitleOutput.readOnly}
                                  onChange={activeSubtitleOutput.readOnly
                                    ? undefined
                                    : event => props.onSubtitleChange(
                                        activeSubtitleOutput.variant,
                                        cue.id,
                                        event.target.value
                                      )}
                                  aria-label={`${subtitleVariantLabel(activeSubtitleOutput.variant, l)} ${index + 1}`}
                                />
                              );
                              return (
                                <div className="video-subtitle-cue-pair" key={cue.id}>
                                  {activeSubtitleOutput.translationPosition === 'bottom' ? sourceLine : null}
                                  {translationLine}
                                  {activeSubtitleOutput.translationPosition !== 'bottom' ? sourceLine : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="video-result-subtitle-empty">{l('当前版本没有可展示的字幕', 'No subtitle cues to display')}</div>
                )}
              </section>
            </div>
          ) : (
            <div className="video-result-subtitle-empty">{l('当前版本没有可展示的字幕', 'No subtitles to display for this version')}</div>
          )}
        </div>
      ) : null}

      {props.activeTab === 'voice' ? (
        <div className="video-result-pane">
          <header className="video-result-pane-heading">
            <div>
              <h2>{l('目标语言配音', 'Target-language dubbing')}</h2>
              <p>{props.hasVoiceArtifact ? l('配音文件已生成', 'Dubbing file generated') : l('当前版本未生成配音', 'No dubbing was generated for this version')}</p>
            </div>
          </header>
          {props.hasVoiceArtifact && props.voiceOutput !== undefined ? (
            <div className="video-result-voice-output">
              <div className="video-result-audio-preview">
                {props.voiceOutput.src !== undefined ? (
                  <audio
                    controls
                    preload="metadata"
                    src={props.voiceOutput.src}
                    aria-label={l('目标语言配音试听', 'Target-language dubbing preview')}
                  />
                ) : (
                  <div className="video-result-audio-status" role="status">
                    <span>
                      {props.voiceOutput.previewLoading
                        ? l('正在加载配音...', 'Loading dubbing...')
                        : props.voiceOutput.previewError ?? l('配音试听暂时不可用，可直接下载文件。', 'Dubbing preview is unavailable. You can still download the file.')}
                    </span>
                    {!props.voiceOutput.previewLoading && props.voiceOutput.previewError !== undefined ? (
                      <button type="button" onClick={props.onReloadVoice}>
                        <RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />
                        {l('重新加载配音', 'Reload dubbing')}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="video-result-file-row">
                <span aria-hidden="true"><FileAudio size={19} strokeWidth={1.7} /></span>
                <div>
                  <strong>{props.voiceOutput.fileName ?? `${l('目标语言配音', 'Target-language-dubbing')}-V${props.version}.wav`}</strong>
                  <small>
                    {l('配音', 'Dubbing')} V{props.voiceOutput.artifactVersion}
                    {' · '}{l('项目', 'Project')} V{props.version}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => props.onExport('voice', props.voiceOutput?.artifactId)}
                  aria-label={l('下载配音文件', 'Download dubbing file')}
                  title={l('下载配音文件', 'Download dubbing file')}
                >
                  <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <div className="video-result-empty">
              <FileAudio size={26} strokeWidth={1.5} aria-hidden="true" />
              <strong>{l('这个版本没有配音文件', 'This version has no dubbing file')}</strong>
              <button type="button" onClick={props.onAdjustSettings}>{l('开启配音并生成新版本', 'Enable dubbing and generate a new version')}</button>
            </div>
          )}
        </div>
      ) : null}

      {props.activeTab === 'settings' ? (
        <div className="video-result-pane">
          <header className="video-result-pane-heading">
            <div>
              <h2>{l('当前版本设置', 'Current version settings')}</h2>
            </div>
            <button type="button" onClick={props.onAdjustSettings}>
              <Settings2 size={15} strokeWidth={1.8} aria-hidden="true" />
              {l('调整设置', 'Adjust settings')}
            </button>
          </header>
          <dl className="video-result-settings">
            <div><dt>{l('目标语言', 'Target language')}</dt><dd>{props.targetLanguage}</dd></div>
            <div><dt>{l('字幕样式', 'Subtitle style')}</dt><dd>{props.subtitleStyleLabel}</dd></div>
            <div><dt>{l('配音', 'Dubbing')}</dt><dd>{props.dubbing ? l('已开启', 'Enabled') : l('未开启', 'Disabled')}</dd></div>
            <div><dt>{l('输出内容', 'Output')}</dt><dd>{props.outputLabel}</dd></div>
            <div>
              <dt>{l('字幕文件', 'Subtitle files')}</dt>
              <dd>{props.subtitleOutputs.length} {l('个文件', 'files')} · {subtitleCueCount} {l('条字幕', 'subtitles')}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {props.hasPendingChanges || props.regenerationPending ? (
        <div
          className="video-result-regenerate"
          data-confirming={props.regenerationPending}
          role={props.regenerationPending ? 'group' : 'region'}
          aria-label={props.regenerationPending ? l('确认生成新版本', 'Confirm new version') : l('生成新版本', 'Generate new version')}
        >
          {props.regenerationPending ? (
            <>
              <span className="app-visually-hidden">
                {l(
                  `将更新${props.affectedArtifacts.join('、')}，V${props.version} 的全部产出会保留`,
                  `Will update ${props.affectedArtifacts.join(', ')}. All V${props.version} outputs will be preserved`
                )}
              </span>
              <div className="video-result-regenerate-actions">
                <button type="button" onClick={props.onCancelRegenerate}>{l('取消', 'Cancel')}</button>
                <button type="button" onClick={props.onConfirmRegenerate}>{l(`确认生成 V${props.nextVersion}`, `Confirm and generate V${props.nextVersion}`)}</button>
              </div>
            </>
          ) : (
            <button type="button" onClick={props.onRequestRegenerate}>
              {props.subtitleDirty ? l(`保存并生成 V${props.nextVersion}`, `Save and generate V${props.nextVersion}`) : l(`生成 V${props.nextVersion}`, `Generate V${props.nextVersion}`)}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function videoVariantFormatLabel(variant: VideoResultVariant, l: LocalizeCopy): string {
  return ({
    horizontal: l('横屏 16:9', 'Horizontal 16:9'),
    vertical: l('竖屏 9:16', 'Vertical 9:16'),
    dubbed: l('配音视频', 'Dubbed video')
  } as const)[variant];
}

function videoVariantArtifactLabel(variant: VideoResultVariant, l: LocalizeCopy): string {
  return ({
    horizontal: l('横屏成片', 'Horizontal video'),
    vertical: l('竖屏成片', 'Vertical video'),
    dubbed: l('配音视频', 'Dubbed video')
  } as const)[variant];
}

function subtitleVariantLabel(variant: SubtitleResultVariant, l: LocalizeCopy): string {
  return variant === 'horizontal'
    ? l('横屏字幕', 'Horizontal subtitles')
    : l('竖屏字幕', 'Vertical subtitles');
}

function subtitleCueDisplayText(
  cue: SubtitleCue,
  translationPosition: SubtitleResultOutput['translationPosition']
): string {
  if (cue.sourceText === undefined) return cue.text;
  return translationPosition === 'bottom'
    ? `${cue.sourceText}\n${cue.text}`
    : `${cue.text}\n${cue.sourceText}`;
}

function localizeResultTab(label: string, l: LocalizeCopy): string {
  const labels: Record<string, string> = {
    '作品': 'Works',
    '字幕': 'Subtitles',
    '配音': 'Dubbing',
    '任务设置': 'Task settings'
  };
  return l(label, labels[label] ?? label);
}

function subtitleTimestampSeconds(value: string): number {
  const match = /^(\d+):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/.exec(value.trim());
  if (match === null) return Number.NaN;
  const milliseconds = Number((match[4] ?? '').padEnd(3, '0'));
  return Number(match[1]) * 3600
    + Number(match[2]) * 60
    + Number(match[3])
    + milliseconds / 1000;
}

function subtitleCueShortTime(value: string): string {
  const match = /^(\d+):(\d{2}):(\d{2})/.exec(value.trim());
  if (match === null) return value;
  return Number(match[1]) === 0
    ? `${match[2]}:${match[3]}`
    : `${match[1]}:${match[2]}:${match[3]}`;
}

function groupSubtitleCues(cues: SubtitleCue[], variant: SubtitleResultVariant) {
  const groups: Array<Array<{ cue: SubtitleCue; index: number }>> = [];
  cues.forEach((cue, index) => {
    const previous = groups[groups.length - 1];
    const firstCue = previous?.[0]?.cue;
    const firstStart = subtitleTimestampSeconds(firstCue?.start ?? '');
    const firstEnd = subtitleTimestampSeconds(firstCue?.end ?? '');
    const start = subtitleTimestampSeconds(cue.start);
    const end = subtitleTimestampSeconds(cue.end);
    const sameTime = firstStart === start && firstEnd === end;
    if (variant === 'vertical' && previous !== undefined
      && Number.isFinite(firstStart) && Number.isFinite(firstEnd)
      && Number.isFinite(start) && Number.isFinite(end) && end > start
      && start >= firstStart && end <= firstEnd
      && (!sameTime || previous.length === 1)) {
      previous.push({ cue, index });
    } else {
      groups.push([{ cue, index }]);
    }
  });
  return groups;
}
