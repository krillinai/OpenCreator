import { Sparkles, type LucideIcon } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

type SummaryItem = {
  label: string;
  value: string;
};

export default function CreatorTaskSummary(props: {
  sourceIcon: LucideIcon;
  sourceLabel: string;
  sourceValue: string;
  items: SummaryItem[];
  note?: string;
  noteIcon?: LucideIcon;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const SourceIcon = props.sourceIcon;
  const NoteIcon = props.noteIcon;
  const presetTitle = session?.job.presetOrigin?.title.trim();

  return (
    <aside
      className="video-translation-summary creator-task-summary"
      aria-label={l('任务摘要', 'Task summary')}
    >
      <div className="video-translation-summary-heading">
        <span><Sparkles size={16} strokeWidth={1.8} aria-hidden="true" /></span>
        <h2>{l('任务摘要', 'Task summary')}</h2>
      </div>
      <div className="video-translation-source-summary">
        <SourceIcon size={16} strokeWidth={1.7} aria-hidden="true" />
        <span>
          <small>{props.sourceLabel}</small>
          <strong title={props.sourceValue}>{props.sourceValue}</strong>
        </span>
      </div>
      <dl>
        {presetTitle ? (
          <div>
            <dt>{l('模板来源', 'Preset')}</dt>
            <dd title={presetTitle}>{presetTitle}</dd>
          </div>
        ) : null}
        {props.items.map(item => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {props.note ? <p>{NoteIcon ? <NoteIcon size={14} strokeWidth={1.8} aria-hidden="true" /> : null}{props.note}</p> : null}
    </aside>
  );
}
