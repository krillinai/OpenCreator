import {
  Captions,
  Download,
  FileAudio,
  FileVideo,
  Mic2,
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
  { value: 'video', label: '成片', icon: FileVideo },
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
  hasVideoArtifact: boolean;
  hasVoiceArtifact: boolean;
  videoOutputs: VideoResultOutput[];
  subtitleOutputs: SubtitleResultOutput[];
  voiceOutput?: VoiceResultOutput;
  subtitleDirty: boolean;
  nextVersion: number;
  affectedArtifacts: string[];
  hasPendingChanges: boolean;
  regenerationPending: boolean;
  notice?: string;
  onTabChange(tab: VideoTranslationResultTab): void;
  onVersionChange(version: number): void;
  onSubtitleChange(id: number, text: string): void;
  onSaveSubtitles(): void;
  onAdjustSettings(): void;
  onExport(type: 'video' | 'subtitles' | 'voice', artifactId?: string): void;
  onReloadVoice(): void;
  onRequestRegenerate(): void;
  onCancelRegenerate(): void;
  onConfirmRegenerate(): void;
}) {
  const l = useLocalizedCopy();
  const horizontalSubtitle = props.subtitleOutputs.find(output => output.variant === 'horizontal');
  const visibleTabs = resultTabs.filter(tab => (
    tab.value !== 'video' || props.hasVideoArtifact
  ));

  return (
    <section className="video-result-workspace" aria-label={l('视频翻译项目产出', 'Video translation project outputs')}>
      <div className="video-result-toolbar">
        <div className="video-result-tabs" role="tablist" aria-label={l('产出物类型', 'Output types')}>
          {visibleTabs.map(tab => {
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
                {tab.value === 'subtitles' && props.subtitleDirty ? (
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
              <h2>{l('翻译成片', 'Translated video')}</h2>
              <p>{l(
                `${props.targetLanguage}，当前项目版本包含 ${props.videoOutputs.length} 个成片文件`,
                `${props.targetLanguage}, ${props.videoOutputs.length} video file(s) in this project version`
              )}</p>
            </div>
          </header>
          {props.hasVideoArtifact ? (
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
          ) : (
            <div className="video-result-empty">
              <FileVideo size={26} strokeWidth={1.5} aria-hidden="true" />
              <strong>{l('当前项目版本没有成片文件', 'This project version has no video files')}</strong>
            </div>
          )}
        </div>
      ) : null}

      {props.activeTab === 'subtitles' ? (
        <div className="video-result-pane">
          <header className="video-result-pane-heading">
            <div>
              <h2>{l('字幕文件', 'Subtitle files')}</h2>
              <p>
                {l(`${props.subtitleOutputs.length} 个字幕文件`, `${props.subtitleOutputs.length} subtitle file(s)`)}
                {' · '}{l('项目', 'Project')} V{props.version}
                {horizontalSubtitle !== undefined
                  ? ` · ${props.subtitleDirty ? l('横屏字幕有未保存修改', 'Unsaved horizontal subtitle changes') : l('横屏字幕已保存', 'Horizontal subtitles saved')}`
                  : ''}
              </p>
            </div>
            {horizontalSubtitle !== undefined && !horizontalSubtitle.readOnly ? (
              <div className="video-result-pane-actions">
                <button type="button" disabled={!props.subtitleDirty} onClick={props.onSaveSubtitles}>
                  <Save size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('保存横屏字幕', 'Save horizontal subtitles')}
                </button>
              </div>
            ) : null}
          </header>
          <div className="video-result-subtitle-grid">
            {props.subtitleOutputs.map(output => {
              const variantLabel = subtitleVariantLabel(output.variant, l);
              return (
                <section className="video-result-output-column" data-variant={output.variant} key={output.artifactId}>
                  <div className="video-result-output-heading">
                    <div>
                      <h3>{variantLabel}</h3>
                      <small>
                        {l('子项', 'Item')} V{output.artifactVersion}
                        {' · '}{output.cues.length} {l('条字幕', 'subtitles')}
                        {output.readOnly ? ` · ${l('只读', 'Read only')}` : ''}
                      </small>
                    </div>
                  </div>
                  <div className="video-result-file-row">
                    <span aria-hidden="true"><Captions size={19} strokeWidth={1.7} /></span>
                    <div>
                      <strong>{output.fileName ?? `${variantLabel}-V${props.version}.srt`}</strong>
                      <small>
                        {l('子项', 'Item')} V{output.artifactVersion}
                        {' · '}{l('项目', 'Project')} V{props.version}
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
                  {output.cues.length > 0 ? (
                    <div className="video-subtitle-editor" aria-label={l(`${variantLabel}文件`, `${variantLabel} file`)}>
                      {output.cues.map((cue, index) => (
                        <label key={cue.id}>
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <small>{cue.start} - {cue.end}</small>
                          <textarea
                            rows={2}
                            value={cue.text}
                            readOnly={output.readOnly}
                            onChange={output.readOnly
                              ? undefined
                              : event => props.onSubtitleChange(cue.id, event.target.value)}
                            aria-label={`${variantLabel} ${index + 1}`}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="video-result-subtitle-empty">{l('字幕文件中没有可展示的条目', 'No subtitle cues to display')}</div>
                  )}
                </section>
              );
            })}
          </div>
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
              <p>{l('调整后会生成新版本，当前结果不会被覆盖', 'Changes create a new version without overwriting the current output')}</p>
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
              <dd>{props.subtitleOutputs.length} {l('个文件', 'files')} · {props.subtitleOutputs.reduce((total, output) => total + output.cues.length, 0)} {l('条字幕', 'subtitles')}</dd>
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

function localizeResultTab(label: string, l: LocalizeCopy): string {
  const labels: Record<string, string> = {
    '成片': 'Final video',
    '字幕': 'Subtitles',
    '配音': 'Dubbing',
    '任务设置': 'Task settings'
  };
  return l(label, labels[label] ?? label);
}
