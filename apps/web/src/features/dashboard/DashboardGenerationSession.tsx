import { ArrowUp, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import DashboardGenerationComposer, { type DashboardGenerationMode } from './DashboardGenerationComposer.js';
import DashboardGenerationHistory from './DashboardGenerationHistory.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import './DashboardGenerationSession.css';

export default function DashboardGenerationSession(props: {
  history: ComponentProps<typeof DashboardGenerationHistory>;
  composer: ComponentProps<typeof DashboardGenerationComposer>;
}) {
  const l = useLocalizedCopy();
  const [expanded, setExpanded] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const expandLabel = l('展开创作对话框', 'Expand composer');

  useEffect(() => {
    if (expanded && composerRef.current) composerRef.current.scrollTop = 0;
  }, [expanded]);

  return (
    <div className="dashboard-generation-session">
      <DashboardGenerationHistory {...props.history} />
      <div ref={composerRef} className={`dashboard-generation-session-composer${expanded ? ' is-expanded' : ''}`}>
        {expanded ? (
          <div className="dashboard-generation-session-composer-inner">
            <button type="button" className="dashboard-generation-session-collapse" aria-label={l('收起创作对话框', 'Collapse composer')} title={l('收起创作对话框', 'Collapse composer')} onClick={() => setExpanded(false)}>
              <ChevronDown size={17} />
            </button>
            <DashboardGenerationComposer {...props.composer} />
          </div>
        ) : (
          <div className="dashboard-generation-session-collapsed">
            <button type="button" className="dashboard-generation-session-collapsed-plus" aria-label={expandLabel} title={expandLabel} onClick={() => setExpanded(true)}><Plus size={18} /></button>
            <input
              type="text"
              readOnly
              aria-label={l('继续创作', 'Continue creating')}
              placeholder={collapsedPlaceholder(props.composer.initialMode, l)}
              onFocus={() => setExpanded(true)}
              onClick={() => setExpanded(true)}
            />
            <button type="button" className="dashboard-generation-session-expand" aria-hidden="true" tabIndex={-1} title={expandLabel} onClick={() => setExpanded(true)}>
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
