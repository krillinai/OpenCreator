import { AlertCircle, Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { copyToClipboard } from './clipboard.js';
import { renderTextWithWorkspaceFileLinks, type MarkdownLinkClickHandler } from './markdown-inline.js';

const CODE_COLLAPSE_LINE_THRESHOLD = 16;
const CODE_COLLAPSE_VISIBLE_LINES = 8;

export function MarkdownCodeBlock(props: {
  body: string;
  lang: string | null;
  onLinkClick?: MarkdownLinkClickHandler;
  linkifyWorkspaceFiles?: boolean;
}) {
  const lines = useMemo(() => props.body.split('\n'), [props.body]);
  const lineCount = lines.length;
  const collapsible = lineCount > CODE_COLLAPSE_LINE_THRESHOLD;
  const [collapsed, setCollapsed] = useState(collapsible);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCollapsed(collapsible);
  }, [collapsible, props.body]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  async function handleCopy() {
    const ok = await copyToClipboard(props.body);
    setCopyState(ok ? 'copied' : 'failed');
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      resetTimerRef.current = null;
    }, 1600);
  }

  const copyLabel = copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制';
  const CopyIcon = copyState === 'copied' ? Check : copyState === 'failed' ? AlertCircle : Copy;
  const linkifyTextFiles = props.linkifyWorkspaceFiles === true
    && props.onLinkClick !== undefined
    && isPlainTextLanguage(props.lang);
  const visibleBody = collapsed
    ? `${lines.slice(0, CODE_COLLAPSE_VISIBLE_LINES).join('\n')}\n…`
    : props.body;

  return (
    <div className="md-code-block" data-collapsed={collapsed ? 'true' : undefined}>
      <div className="md-code-header">
        <span className="md-code-lang">{props.lang ?? 'text'}</span>
        <div className="md-code-actions">
          {collapsible ? (
            <button
              type="button"
              className="md-code-action md-code-action-icon"
              aria-label={collapsed ? '展开代码' : '收起代码'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(value => !value)}
            >
              {collapsed ? <ChevronRight aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
            </button>
          ) : null}
          <button
            type="button"
            className="md-code-action"
            aria-label={copyLabel}
            onClick={() => {
              void handleCopy();
            }}
          >
            <CopyIcon aria-hidden="true" size={14} />
            <span>{copyLabel}</span>
          </button>
        </div>
      </div>
      <div className="md-code-body">
        <pre className="md-code">
          <code data-lang={props.lang ?? undefined}>
            {linkifyTextFiles
              ? renderTextWithWorkspaceFileLinks(visibleBody, props.onLinkClick!)
              : visibleBody}
          </code>
        </pre>
      </div>
    </div>
  );
}

function isPlainTextLanguage(lang: string | null): boolean {
  if (lang === null) return true;
  return lang === 'text' || lang === 'txt' || lang === 'plaintext';
}
