import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react';
import { beginPaneResize } from '../../components/layout/pane-resize-2026-07-29.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

const WORKSPACE_MIN_WIDTH = 390;
const AGENT_MIN_WIDTH = 280;
const RESIZE_HANDLE_WIDTH = 7;
const RESIZE_KEY_STEP = 32;

export default function CreatorResizableLayout(props: {
  workspace: ReactNode;
  agentPanel: ReactNode;
  className?: string;
}) {
  const l = useLocalizedCopy();
  const layoutRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState<number>();
  const [mobilePane, setMobilePane] = useState<'workspace' | 'agent'>('workspace');
  const session = useOptionalCreatorSession();
  const latestIssueId = session?.issues.filter(issue => issue.status === 'open').at(-1)?.id;

  useEffect(() => {
    if (latestIssueId !== undefined) setMobilePane('agent');
  }, [latestIssueId]);

  function widthBounds() {
    const rect = layoutRef.current?.getBoundingClientRect();
    const fallbackWidth = 900;
    return {
      fallback: rect ? Math.round(rect.width * 0.68) : fallbackWidth,
      max: rect
        ? Math.max(WORKSPACE_MIN_WIDTH, rect.width - AGENT_MIN_WIDTH - RESIZE_HANDLE_WIDTH)
        : fallbackWidth
    };
  }

  function updateWorkspaceWidth(clientX: number) {
    const rect = layoutRef.current?.getBoundingClientRect();
    if (!rect) return;
    setWorkspaceWidth(Math.max(
      WORKSPACE_MIN_WIDTH,
      Math.min(rect.width - AGENT_MIN_WIDTH - RESIZE_HANDLE_WIDTH, clientX - rect.left)
    ));
  }

  function adjustWorkspaceWidth(delta: number) {
    const bounds = widthBounds();
    setWorkspaceWidth(previous => Math.max(
      WORKSPACE_MIN_WIDTH,
      Math.min(bounds.max, (previous ?? bounds.fallback) + delta)
    ));
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    beginPaneResize(event, updateWorkspaceWidth, { updateOnStart: false });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustWorkspaceWidth(-RESIZE_KEY_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      adjustWorkspaceWidth(RESIZE_KEY_STEP);
    }
  }

  const style = workspaceWidth === undefined
    ? undefined
    : ({ '--creator-workspace-pane-width': `${workspaceWidth}px` } as CSSProperties);

  return (
    <div
      className={`creator-resizable-layout${props.className ? ` ${props.className}` : ''}`}
      ref={layoutRef}
      style={style}
      data-mobile-pane={mobilePane}
    >
      <div className="creator-mobile-tabs" role="tablist" aria-label={l('创作视图', 'Creator views')}>
        <button type="button" role="tab" aria-selected={mobilePane === 'workspace'} onClick={() => setMobilePane('workspace')}>{l('创作', 'Workspace')}</button>
        <button type="button" role="tab" aria-selected={mobilePane === 'agent'} onClick={() => setMobilePane('agent')}>Agent</button>
      </div>
      {props.workspace}
      <div
        className="pane-resize-handle creator-pane-resize"
        role="separator"
        aria-label={l('调整操作区和对话区宽度', 'Resize workspace and conversation panels')}
        aria-orientation="vertical"
        aria-valuemin={WORKSPACE_MIN_WIDTH}
        aria-valuenow={workspaceWidth}
        aria-valuetext={workspaceWidth === undefined
          ? l('默认宽度', 'Default width')
          : l(`操作区宽度 ${workspaceWidth} 像素`, `Workspace width ${workspaceWidth} pixels`)}
        tabIndex={0}
        title={l('拖动调整宽度，双击恢复默认', 'Drag to resize. Double-click to restore the default.')}
        onDoubleClick={() => setWorkspaceWidth(undefined)}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
      />
      {props.agentPanel}
    </div>
  );
}
