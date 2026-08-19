import type { CreateMemoryRequest, MemoryScope } from '@opencreator/protocol';
import { AlertTriangle, Brain, Check, X } from 'lucide-react';
import { useState } from 'react';
import { ApiClientError } from '../../runtime/errors.js';

export function MemorySuggestion(props: {
  content: string;
  projectKey?: string;
  threadKey?: string;
  onSave(input: CreateMemoryRequest): Promise<void>;
  onDismiss(): void;
}) {
  const [content, setContent] = useState(props.content);
  const [scope, setScope] = useState<MemoryScope>(props.threadKey === undefined ? 'global' : 'thread');
  const [saving, setSaving] = useState(false);
  const [confirmingSensitive, setConfirmingSensitive] = useState(false);
  const [error, setError] = useState<string>();

  async function save(acknowledgeSensitive = false) {
    const normalized = content.trim();
    const scopeKey = scope === 'thread'
      ? props.threadKey
      : scope === 'project'
        ? props.projectKey
        : undefined;
    if (normalized.length === 0) {
      setError('记忆内容不能为空');
      return;
    }
    if (scope !== 'global' && scopeKey === undefined) {
      setError('当前范围不可用，请选择其他范围');
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      await props.onSave({
        content: normalized,
        scope,
        ...(scopeKey === undefined ? {} : { scopeKey }),
        source: 'agent_suggestion',
        ...(acknowledgeSensitive ? { acknowledgeSensitive: true } : {})
      });
      props.onDismiss();
    } catch (reason) {
      if (
        reason instanceof ApiClientError
        && reason.code === 'MEMORY_SENSITIVE_CONFIRMATION_REQUIRED'
      ) {
        setConfirmingSensitive(true);
      } else {
        setError(reason instanceof Error ? reason.message : '保存记忆失败');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="memory-suggestion" aria-label="记忆建议">
      <div className="memory-suggestion__title">
        <Brain aria-hidden="true" size={16} />
        <strong>保存为长期记忆？</strong>
      </div>
      <textarea
        aria-label="记忆建议内容"
        maxLength={2000}
        value={content}
        disabled={saving}
        onChange={event => setContent(event.target.value)}
      />
      <div className="memory-suggestion__actions">
        <label>
          <span>范围</span>
          <select
            aria-label="记忆建议范围"
            value={scope}
            disabled={saving}
            onChange={event => setScope(event.target.value as MemoryScope)}
          >
            {props.threadKey !== undefined ? <option value="thread">当前线程</option> : null}
            {props.projectKey !== undefined ? <option value="project">当前项目</option> : null}
            <option value="global">全局</option>
          </select>
        </label>
        <button type="button" disabled={saving} aria-label="忽略记忆建议" onClick={props.onDismiss}>
          <X aria-hidden="true" size={15} />
          忽略
        </button>
        <button
          className="memory-suggestion__save"
          type="button"
          disabled={saving}
          aria-label="保存记忆建议"
          onClick={() => void save()}
        >
          <Check aria-hidden="true" size={15} />
          {saving ? '正在保存' : '保存记忆'}
        </button>
      </div>
      {confirmingSensitive ? (
        <div className="memory-suggestion__warning" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>内容可能包含敏感信息，仅在确认后保存到本机。</span>
          <button type="button" onClick={() => void save(true)} aria-label="确认保存敏感建议">
            确认保存
          </button>
        </div>
      ) : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section>
  );
}
