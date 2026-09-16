import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, CircleCheck } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { readCreatorResultSnapshots } from '@opencreator/protocol';
import { useOptionalCreatorSession } from './creator-session-store.js';

export type CreatorResultVersionItem = {
  value: number;
  description: string;
};

export default function CreatorResultVersionMenu(props: {
  version: number;
  versions: CreatorResultVersionItem[];
  onVersionChange(version: number): void;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const snapshots = readCreatorResultSnapshots(session?.job.state.resultSnapshots);
  const selected = snapshots.find(snapshot => snapshot.version === props.version);
  const stale = selected !== undefined && (selected.staleArtifactIds.length > 0 ||
    session?.job.artifacts.some(artifact => artifact.status === 'stale' && selected.artifactRefs[artifact.kind]?.includes(artifact.id)));
  const [historyOpen, setHistoryOpen] = useState(false);
  const versionMenuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  async function select(version: number) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      if (session && snapshots.some(snapshot => snapshot.version === version)) {
        await session.applyAction({ action: 'select-result-version', input: { version } });
      }
      props.onVersionChange(version);
      setHistoryOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (!historyOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!versionMenuRef.current?.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [historyOpen]);

  return (
    <div className="video-result-version" ref={versionMenuRef}>
      <button
        type="button"
        aria-expanded={historyOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setHistoryOpen(open => !open)}
      >
        {!stale ? <CircleCheck size={15} strokeWidth={2} aria-hidden="true" /> : null}
        <span>{l(`项目 V${props.version}`, `Project V${props.version}`)}</span>
        <ChevronDown className="video-result-version-chevron" size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {historyOpen ? (
        <div id={menuId} role="menu">
          {props.versions.map(item => (
            <button
              type="button"
              role="menuitem"
              aria-current={item.value === props.version ? 'true' : undefined}
              key={item.value}
              disabled={pending || session?.job.stages.some(stage => ['queued', 'running'].includes(stage.status))
                || (session !== null && !snapshots.some(snapshot => snapshot.version === item.value))}
              title={session !== null && !snapshots.some(snapshot => snapshot.version === item.value)
                ? l('无项目快照，请在产物版本与来源中浏览或下载', 'No project snapshot. Browse or download in artifact details.')
                : undefined}
              onClick={() => void select(item.value)}
            >
              <span>
                <strong>{l(`项目 V${item.value}`, `Project V${item.value}`)}</strong>
                <small>{item.description}{item.value === props.version ? l('，当前查看', ', currently viewing') : ''}</small>
              </span>
              {item.value === props.version ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {stale ? <small role="status">{l('包含过期结果', 'Contains stale results')}</small> : null}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
