import { ArrowUp, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import DashboardGenerationComposer, { type DashboardGenerationMode } from './DashboardGenerationComposer.js';
import DashboardGenerationHistory from './DashboardGenerationHistory.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import './DashboardGenerationSession.css';

export default function DashboardGenerationSession(props: {
  history: ComponentProps<typeof DashboardGenerationHistory>;
  composer: ComponentProps<typeof DashboardGenerationComposer>;
  onResumeCreating?(): void;
}) {
  const l = useLocalizedCopy();
  const [expanded, setExpanded] = useState(false);
  const [historyType, setHistoryType] = useState(props.history.initialType ?? 'all');
  const composerRef = useRef<HTMLDivElement>(null);
  const expandLabel = l('展开创作对话框', 'Expand composer');
  const initialMode = historyType === 'all' ? 'image'
    : historyType === 'image' ? props.composer.initialMode === 'cover' || props.composer.initialMode === 'image-edit' ? props.composer.initialMode : 'image'
    : historyType === 'video' ? props.composer.initialMode && ['video', 'image-to-video', 'translation', 'translation-subtitles', 'voiceover', 'transcription', 'download', 'clips'].includes(props.composer.initialMode) ? props.composer.initialMode : 'video'
    : historyType === 'text' ? 'script' : 'speech';
  const modeGroup = historyType === 'all' ? undefined : historyType;

  useEffect(() => {
    if (expanded && composerRef.current) composerRef.current.scrollTop = 0;
  }, [expanded]);

  useEffect(() => {
    if (!props.history.submittedTask) return;
    setHistoryType(props.history.submittedTask.type);
    setExpanded(false);
  }, [props.history.submittedTask]);

  const expandComposer = () => {
    props.onResumeCreating?.();
    setExpanded(true);
  };

  return (
    <div className="dashboard-generation-session">
      <DashboardGenerationHistory {...props.history} onViewChange={view => {
        props.history.onViewChange?.(view);
        setHistoryType(view.type);
      }} />
      <div ref={composerRef} className={`dashboard-generation-session-composer${expanded ? ' is-expanded' : ''}`}>
        {expanded ? (
          <div className="dashboard-generation-session-composer-inner">
            <div className="dashboard-generation-session-toolbar">
              <button type="button" className="dashboard-generation-session-collapse" aria-label={l('收起创作对话框', 'Collapse composer')} title={l('收起创作对话框', 'Collapse composer')} onClick={() => setExpanded(false)}>
                <ChevronDown size={17} />
              </button>
            </div>
            <DashboardGenerationComposer {...props.composer} initialMode={initialMode} modeGroup={modeGroup} showExtendedModes={historyType !== 'all'} onOpenHistory={undefined} />
          </div>
        ) : (
          <div className="dashboard-generation-session-collapsed">
            <button type="button" className="dashboard-generation-session-collapsed-plus" aria-label={expandLabel} title={expandLabel} onClick={expandComposer}><Plus size={18} /></button>
            <input
              type="text"
              readOnly
              aria-label={l('继续创作', 'Continue creating')}
              placeholder={collapsedPlaceholder(initialMode, l)}
              onFocus={expandComposer}
              onClick={expandComposer}
            />
            <button type="button" className="dashboard-generation-session-expand" aria-hidden="true" tabIndex={-1} title={expandLabel} onClick={expandComposer}>
              <ArrowUp size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function collapsedPlaceholder(mode: DashboardGenerationMode | undefined, l: LocalizeCopy): string {
  if (mode === 'image' || mode === 'image-edit') return l('描述你想生成的画面…', 'Describe the image you want to generate…');
  if (mode === 'cover') return l('描述你想生成的封面…', 'Describe the cover you want to generate…');
  if (mode === 'video' || mode === 'image-to-video') return l('描述你想生成的视频…', 'Describe the video you want to generate…');
  if (mode === 'speech') return l('输入要转换成语音的文本…', 'Enter text to convert to speech…');
  if (mode === 'script') return l('描述你想创作的短视频…', 'Describe the short video you want to create…');
  return l('粘贴一个公开视频链接…', 'Paste a public video link…');
}
