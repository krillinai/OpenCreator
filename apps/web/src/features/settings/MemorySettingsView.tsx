import type {
  ConversationSummary,
  ConversationSummaryListResponse,
  CreateMemoryRequest,
  MemoryDisableAllResponse,
  MemoryEntry,
  MemoryListQuery,
  MemoryListResponse,
  MemoryResponse,
  MemoryScope,
  UpdateMemoryRequest
} from '@opencreator/protocol';
import {
  AlertTriangle,
  Brain,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiClientError } from '../../runtime/errors.js';

export type MemorySettingsService = {
  listMemories(query?: MemoryListQuery): Promise<MemoryListResponse>;
  createMemory(input: CreateMemoryRequest): Promise<MemoryResponse>;
  updateMemory(id: string, input: UpdateMemoryRequest): Promise<MemoryResponse>;
  deleteMemory(id: string): Promise<{ deleted: true }>;
  disableAll(): Promise<MemoryDisableAllResponse>;
  listSummaries(input?: { threadId?: string; limit?: number }): Promise<ConversationSummaryListResponse>;
  deleteSummary(id: string): Promise<{ deleted: true }>;
};

export type MemoryScopeOption = {
  key: string;
  label: string;
};

type EditorState = {
  mode: 'create' | 'edit';
  memoryId?: string;
  content: string;
  scope: MemoryScope;
  scopeKey?: string;
};

export function MemorySettingsView(props: {
  connected: boolean;
  service: MemorySettingsService | null;
  projects: MemoryScopeOption[];
  threads: MemoryScopeOption[];
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<MemoryScope | 'all'>('all');
  const [enabled, setEnabled] = useState<boolean | 'all'>('all');
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [editor, setEditor] = useState<EditorState>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmingSensitive, setConfirmingSensitive] = useState(false);
  const [confirmingDisableAll, setConfirmingDisableAll] = useState(false);
  const available = props.connected && props.service !== null;

  useEffect(() => {
    let canceled = false;
    if (!available) {
      setMemories([]);
      setSummaries([]);
      return () => {
        canceled = true;
      };
    }
    setLoading(true);
    setError(undefined);
    Promise.all([
      props.service!.listMemories({
        query: query.trim(),
        scope,
        enabled,
        limit: 100
      }),
      props.service!.listSummaries({ limit: 100 })
    ]).then(([memoryResponse, summaryResponse]) => {
      if (canceled) return;
      setMemories(memoryResponse.memories);
      setSummaries(summaryResponse.summaries);
    }).catch(reason => {
      if (!canceled) setError(formatError(reason, '无法加载记忆'));
    }).finally(() => {
      if (!canceled) setLoading(false);
    });
    return () => {
      canceled = true;
    };
  }, [available, enabled, props.service, query, scope]);

  async function refresh() {
    if (!available) return;
    const [memoryResponse, summaryResponse] = await Promise.all([
      props.service!.listMemories({
        query: query.trim(),
        scope,
        enabled,
        limit: 100
      }),
      props.service!.listSummaries({ limit: 100 })
    ]);
    setMemories(memoryResponse.memories);
    setSummaries(summaryResponse.summaries);
  }

  function openCreate() {
    setEditor({
      mode: 'create',
      content: '',
      scope: 'global'
    });
    setConfirmingSensitive(false);
    setError(undefined);
  }

  function openEdit(memory: MemoryEntry) {
    setEditor({
      mode: 'edit',
      memoryId: memory.id,
      content: memory.content,
      scope: memory.scope,
      scopeKey: memory.scopeKey
    });
    setConfirmingSensitive(false);
    setError(undefined);
  }

  async function saveEditor(acknowledgeSensitive = false) {
    if (!available || editor === undefined) return;
    const content = editor.content.trim();
    if (content.length === 0) {
      setError('记忆内容不能为空');
      return;
    }
    if (editor.scope !== 'global' && editor.scopeKey === undefined) {
      setError('请选择范围目标');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      if (editor.mode === 'create') {
        await props.service!.createMemory({
          content,
          scope: editor.scope,
          ...(editor.scopeKey === undefined ? {} : { scopeKey: editor.scopeKey }),
          source: 'user',
          ...(acknowledgeSensitive ? { acknowledgeSensitive: true } : {})
        });
      } else {
        await props.service!.updateMemory(editor.memoryId!, {
          content,
          ...(acknowledgeSensitive ? { acknowledgeSensitive: true } : {})
        });
      }
      setEditor(undefined);
      setConfirmingSensitive(false);
      await refresh();
    } catch (reason) {
      if (
        reason instanceof ApiClientError
        && reason.code === 'MEMORY_SENSITIVE_CONFIRMATION_REQUIRED'
      ) {
        setConfirmingSensitive(true);
      } else {
        setError(formatError(reason, '保存记忆失败'));
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleMemory(memory: MemoryEntry) {
    if (!available) return;
    setError(undefined);
    try {
      await props.service!.updateMemory(memory.id, { enabled: !memory.enabled });
      await refresh();
    } catch (reason) {
      setError(formatError(reason, '更新记忆状态失败'));
    }
  }

  async function deleteMemory(id: string) {
    if (!available) return;
    setError(undefined);
    try {
      await props.service!.deleteMemory(id);
      await refresh();
    } catch (reason) {
      setError(formatError(reason, '删除记忆失败'));
    }
  }

  async function disableAll() {
    if (!available) return;
    setError(undefined);
    try {
      await props.service!.disableAll();
      setConfirmingDisableAll(false);
      await refresh();
    } catch (reason) {
      setError(formatError(reason, '全部停用失败'));
    }
  }

  async function deleteSummary(id: string) {
    if (!available) return;
    setError(undefined);
    try {
      await props.service!.deleteSummary(id);
      await refresh();
    } catch (reason) {
      setError(formatError(reason, '删除摘要失败'));
    }
  }

  return (
    <section className="settings-section settings-management memory-settings" aria-labelledby="settings-memory-title">
      <header className="settings-management__header">
        <div>
          <h1 id="settings-memory-title">记忆</h1>
          <p>只保存你明确确认的长期偏好，并记录每次 Run 实际使用的上下文快照。</p>
        </div>
        <button className="settings-primary-button" type="button" disabled={!available} onClick={openCreate}>
          <Plus aria-hidden="true" size={15} />
          新建记忆
        </button>
      </header>

      {!props.connected ? <p className="settings-notice">本地服务未连接，无法管理记忆。</p> : null}
      {props.connected && props.service === null ? <p className="settings-notice">记忆服务当前不可用。</p> : null}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}

      <div className="memory-toolbar">
        <label className="memory-search">
          <Search aria-hidden="true" size={15} />
          <input
            type="search"
            aria-label="搜索记忆"
            placeholder="搜索记忆"
            value={query}
            disabled={!available}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>范围</span>
          <select
            aria-label="筛选记忆范围"
            value={scope}
            disabled={!available}
            onChange={event => setScope(event.target.value as MemoryScope | 'all')}
          >
            <option value="all">全部范围</option>
            <option value="global">全局</option>
            <option value="project">项目</option>
            <option value="thread">线程</option>
          </select>
        </label>
        <label>
          <span>状态</span>
          <select
            aria-label="筛选记忆状态"
            value={String(enabled)}
            disabled={!available}
            onChange={event => setEnabled(
              event.target.value === 'all' ? 'all' : event.target.value === 'true'
            )}
          >
            <option value="all">全部状态</option>
            <option value="true">已启用</option>
            <option value="false">已停用</option>
          </select>
        </label>
        <button
          className="settings-secondary-button"
          type="button"
          disabled={!available || memories.length === 0}
          onClick={() => setConfirmingDisableAll(true)}
        >
          <PowerOff aria-hidden="true" size={15} />
          全部停用
        </button>
      </div>

      {editor ? (
        <MemoryEditor
          editor={editor}
          projects={props.projects}
          threads={props.threads}
          saving={saving}
          confirmingSensitive={confirmingSensitive}
          onChange={setEditor}
          onClose={() => setEditor(undefined)}
          onSave={saveEditor}
        />
      ) : null}

      {confirmingDisableAll ? (
        <section className="settings-confirmation" role="region" aria-label="确认全部停用记忆">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <strong>确认停用全部长期记忆？</strong>
            <p>记录不会删除，但后续 Run 不再注入这些记忆。</p>
          </div>
          <div className="settings-confirmation__actions">
            <button className="settings-text-button" type="button" onClick={() => setConfirmingDisableAll(false)}>
              取消
            </button>
            <button className="settings-primary-button" type="button" onClick={() => void disableAll()}>
              确认全部停用
            </button>
          </div>
        </section>
      ) : null}

      <section className="memory-block" aria-labelledby="memory-list-title">
        <div className="memory-block__header">
          <div>
            <h2 id="memory-list-title">长期记忆</h2>
            <p>{memories.length} 条</p>
          </div>
        </div>
        {loading ? (
          <div className="settings-state">正在加载记忆...</div>
        ) : memories.length === 0 ? (
          <div className="settings-state">没有符合条件的记忆</div>
        ) : (
          <ul className="memory-list">
            {memories.map(memory => (
              <li key={memory.id}>
                <div className="memory-item__main">
                  <div className="memory-item__meta">
                    <span>{memoryScopeLabel(memory.scope)}</span>
                    <span data-status={memory.enabled ? 'enabled' : 'disabled'}>
                      {memory.enabled ? '已启用' : '已停用'}
                    </span>
                    {memory.sensitive ? <span data-status="sensitive">敏感</span> : null}
                    <span>{memory.source === 'user' ? '用户保存' : 'Agent 建议'}</span>
                  </div>
                  <p>{memory.content}</p>
                  {memory.scopeKey ? <code>{scopeKeyLabel(memory, props.projects, props.threads)}</code> : null}
                </div>
                <div className="memory-item__actions">
                  <button type="button" aria-label="编辑记忆" title="编辑记忆" onClick={() => openEdit(memory)}>
                    <Pencil aria-hidden="true" size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={memory.enabled ? '停用记忆' : '启用记忆'}
                    title={memory.enabled ? '停用记忆' : '启用记忆'}
                    onClick={() => void toggleMemory(memory)}
                  >
                    {memory.enabled
                      ? <PowerOff aria-hidden="true" size={15} />
                      : <Power aria-hidden="true" size={15} />}
                  </button>
                  <button type="button" aria-label="删除记忆" title="删除记忆" onClick={() => void deleteMemory(memory.id)}>
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="memory-block" aria-labelledby="summary-list-title">
        <div className="memory-block__header">
          <div>
            <h2 id="summary-list-title">会话摘要</h2>
            <p>{summaries.length} 个版本</p>
          </div>
        </div>
        {summaries.length === 0 ? (
          <div className="settings-state">尚未生成会话摘要</div>
        ) : (
          <ul className="summary-list">
            {summaries.map(summary => (
              <li key={summary.id}>
                <header>
                  <div>
                    <strong>{optionLabel(summary.threadId, props.threads)}</strong>
                    <span>版本 {summary.version}</span>
                  </div>
                  <button type="button" aria-label="删除摘要" title="删除摘要" onClick={() => void deleteSummary(summary.id)}>
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </header>
                <p>{summary.content}</p>
                <small>
                  {summary.itemCount} 项 · {summary.coveredFromCursor} 至 {summary.coveredToCursor}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function MemoryEditor(props: {
  editor: EditorState;
  projects: MemoryScopeOption[];
  threads: MemoryScopeOption[];
  saving: boolean;
  confirmingSensitive: boolean;
  onChange(editor: EditorState): void;
  onClose(): void;
  onSave(acknowledgeSensitive?: boolean): Promise<void>;
}) {
  const options = props.editor.scope === 'project'
    ? props.projects
    : props.editor.scope === 'thread'
      ? props.threads
      : [];
  return (
    <section className="settings-editor memory-editor" aria-label={props.editor.mode === 'create' ? '新建记忆' : '编辑记忆'}>
      <header>
        <div>
          <h2>{props.editor.mode === 'create' ? '新建记忆' : '编辑记忆'}</h2>
          <p>单条最多 2000 字符，只存储在本机 Runtime 数据库。</p>
        </div>
        <button type="button" aria-label="关闭记忆编辑器" onClick={props.onClose}>
          <X aria-hidden="true" size={15} />
        </button>
      </header>
      <div className="settings-form-grid">
        <label className="settings-form-wide">
          <span>记忆内容</span>
          <textarea
            aria-label="记忆内容"
            rows={4}
            maxLength={2000}
            value={props.editor.content}
            disabled={props.saving}
            onChange={event => props.onChange({ ...props.editor, content: event.target.value })}
          />
        </label>
        <label>
          <span>范围</span>
          <select
            aria-label="记忆范围"
            value={props.editor.scope}
            disabled={props.saving || props.editor.mode === 'edit'}
            onChange={event => {
              const nextScope = event.target.value as MemoryScope;
              props.onChange({
                ...props.editor,
                scope: nextScope,
                scopeKey: nextScope === 'global'
                  ? undefined
                  : (nextScope === 'project' ? props.projects[0]?.key : props.threads[0]?.key)
              });
            }}
          >
            <option value="global">全局</option>
            <option value="project">项目</option>
            <option value="thread">线程</option>
          </select>
        </label>
        {props.editor.scope !== 'global' ? (
          <label>
            <span>目标</span>
            <select
              aria-label="范围目标"
              value={props.editor.scopeKey ?? ''}
              disabled={props.saving || props.editor.mode === 'edit'}
              onChange={event => props.onChange({ ...props.editor, scopeKey: event.target.value })}
            >
              {options.length === 0 ? <option value="">无可用目标</option> : null}
              {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {props.confirmingSensitive ? (
        <div className="settings-inline-warning memory-sensitive-warning" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>内容可能包含敏感信息，确认后才会保存到本机。</span>
          <button type="button" onClick={() => void props.onSave(true)} aria-label="确认保存敏感记忆">
            确认保存
          </button>
        </div>
      ) : null}
      <footer>
        <button className="settings-text-button" type="button" onClick={props.onClose}>取消</button>
        <button className="settings-primary-button" type="button" disabled={props.saving} onClick={() => void props.onSave()}>
          <Brain aria-hidden="true" size={15} />
          {props.saving ? '正在保存' : props.editor.mode === 'create' ? '保存记忆' : '保存修改'}
        </button>
      </footer>
    </section>
  );
}

function memoryScopeLabel(scope: MemoryScope): string {
  if (scope === 'project') return '项目';
  if (scope === 'thread') return '线程';
  return '全局';
}

function optionLabel(key: string, options: MemoryScopeOption[]): string {
  return options.find(option => option.key === key)?.label ?? key;
}

function scopeKeyLabel(
  memory: MemoryEntry,
  projects: MemoryScopeOption[],
  threads: MemoryScopeOption[]
): string {
  if (memory.scopeKey === undefined) return '';
  return optionLabel(memory.scopeKey, memory.scope === 'project' ? projects : threads);
}

function formatError(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message.length > 0 ? reason.message : fallback;
}
