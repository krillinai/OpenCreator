import {
  Captions,
  Download,
  FileAudio,
  FileVideo,
  Mic2,
  Save,
  Settings2
} from 'lucide-react';
import VideoSourcePreview from './VideoSourcePreview.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';

export type VideoTranslationResultTab = 'video' | 'subtitles' | 'voice' | 'settings';

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
  file: File | null;
  sourceType: 'url' | 'file';
  url: string;
  targetLanguage: string;
  outputLabel: string;
  subtitleStyleLabel: string;
  dubbing: boolean;
  subtitleCues: SubtitleCue[];
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
  onExport(type: 'video' | 'subtitles' | 'voice'): void;
  onRequestRegenerate(): void;
  onCancelRegenerate(): void;
  onConfirmRegenerate(): void;
}) {
  const l = useLocalizedCopy();
  const outputName = `视频翻译-${props.targetLanguage}-V${props.version}.mp4`;

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
              <p>{l(`${props.targetLanguage}，${props.outputLabel}`, `${props.targetLanguage}, ${props.outputLabel}`)}</p>
            </div>
            <button type="button" onClick={() => props.onExport('video')}>
              <Download size={15} strokeWidth={1.8} aria-hidden="true" />
              {l('导出成片', 'Export video')}
            </button>
          </header>
          <div className="video-result-preview">
            <VideoSourcePreview
              file={props.file}
              sourceType={props.sourceType}
              url={props.url}
              onChooseFile={() => undefined}
              onClear={() => undefined}
              readOnly
              displayLabel={outputName}
              displayDetail={`V${props.version} · ${l('已完成', 'Completed')}`}
            />
          </div>
        </div>
      ) : null}

      {props.activeTab === 'subtitles' ? (
        <div className="video-result-pane">
          <header className="video-result-pane-heading">
            <div>
              <h2>{l('字幕编辑', 'Subtitle editor')}</h2>
              <p>{props.subtitleDirty ? l('有未保存修改', 'Unsaved changes') : l('所有修改已保存', 'All changes saved')}</p>
            </div>
            <div className="video-result-pane-actions">
              <button type="button" onClick={() => props.onExport('subtitles')}>
                <Download size={15} strokeWidth={1.8} aria-hidden="true" />
                {l('下载 SRT', 'Download SRT')}
              </button>
              <button type="button" disabled={!props.subtitleDirty} onClick={props.onSaveSubtitles}>
                <Save size={15} strokeWidth={1.8} aria-hidden="true" />
                {l('保存字幕', 'Save subtitles')}
              </button>
            </div>
          </header>
          <div className="video-subtitle-editor" aria-label={l('字幕文件编辑器', 'Subtitle file editor')}>
            {props.subtitleCues.map((cue, index) => (
              <label key={cue.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <small>{cue.start} - {cue.end}</small>
                <textarea
                  rows={2}
                  value={cue.text}
                  onChange={event => props.onSubtitleChange(cue.id, event.target.value)}
                  aria-label={`${l('字幕', 'Subtitle')} ${index + 1}`}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {props.activeTab === 'voice' ? (
        <div className="video-result-pane">
          <header className="video-result-pane-heading">
            <div>
              <h2>{l('目标语言配音', 'Target-language dubbing')}</h2>
              <p>{props.dubbing ? l('配音文件已生成', 'Dubbing file generated') : l('当前版本未生成配音', 'No dubbing was generated for this version')}</p>
            </div>
          </header>
          {props.dubbing ? (
            <div className="video-result-file-row">
              <span aria-hidden="true"><FileAudio size={19} strokeWidth={1.7} /></span>
              <div>
                <strong>{l('目标语言配音', 'Target-language-dubbing')}-V{props.version}.wav</strong>
                <small>{props.targetLanguage}, {l('匹配原片语速', 'matched to the original pacing')}</small>
              </div>
              <button type="button" onClick={() => props.onExport('voice')} aria-label={l('下载配音文件', 'Download dubbing file')} title={l('下载配音文件', 'Download dubbing file')}>
                <Download size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
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
            <div><dt>{l('字幕文件', 'Subtitle file')}</dt><dd>{props.subtitleCues.length} {l('条字幕', 'subtitles')}</dd></div>
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

function localizeResultTab(label: string, l: LocalizeCopy): string {
  const labels: Record<string, string> = {
    '成片': 'Final video',
    '字幕': 'Subtitles',
    '配音': 'Dubbing',
    '任务设置': 'Task settings'
  };
  return l(label, labels[label] ?? label);
}
