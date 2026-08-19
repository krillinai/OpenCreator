import type {
  CodexProfileConfig,
  CodexProfileDeleteResponse,
  CodexProfileDetailResponse,
  CodexProfileListResponse,
  CodexProfileMutationResponse,
  CodexProfileResponse,
  CreateCodexProfileRequest,
  UpdateCodexProfileRequest
} from '@opencreator/protocol';
import {
  FileSliders,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import { ApiClientError } from '../../runtime/errors.js';

export type ProfileSettingsService = {
  listProfiles(): Promise<CodexProfileListResponse>;
  getProfile(name: string): Promise<CodexProfileDetailResponse>;
  createProfile(input: CreateCodexProfileRequest): Promise<CodexProfileMutationResponse>;
  updateProfile(name: string, input: UpdateCodexProfileRequest): Promise<CodexProfileMutationResponse>;
  deleteProfile(name: string): Promise<CodexProfileDeleteResponse>;
};

type ProfileEditorState =
  | { mode: 'create' }
  | { mode: 'edit'; name: string; profile?: CodexProfileResponse; loading: boolean };

const knownKeys = new Set(['model', 'model_reasoning_effort', 'sandbox_mode']);

export function ProfileSettingsView(props: {
  connected: boolean;
  service: ProfileSettingsService | null;
  data?: CodexProfileListResponse;
  onDataChange?(data: CodexProfileListResponse): void;
  confirmDelete?(profile: CodexProfileResponse): boolean;
}) {
  const confirm = useConfirmDialog();
  const [data, setData] = useState(props.data);
  const [loading, setLoading] = useState(
    props.data === undefined && props.connected && props.service !== null
  );
  const [error, setError] = useState<string>();
  const [editor, setEditor] = useState<ProfileEditorState>();
  const [saving, setSaving] = useState(false);
  const [busyName, setBusyName] = useState<string>();

  useEffect(() => {
    setData(props.data);
  }, [props.data]);

  useEffect(() => {
    if (props.data !== undefined || !props.connected || props.service === null) return;
    let canceled = false;
    setLoading(true);
    props.service.listProfiles()
      .then(response => {
        if (!canceled) updateData(response);
      })
      .catch(reason => {
        if (!canceled) setError(formatProfileError(reason, '无法加载 Profiles'));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [props.connected, props.data, props.service]);

  function updateData(next: CodexProfileListResponse) {
    setData(next);
    props.onDataChange?.(next);
  }

  function upsertProfile(profile: CodexProfileResponse) {
    if (data === undefined) return;
    updateData({
      ...data,
      profiles: [...data.profiles.filter(item => item.name !== profile.name), profile]
        .sort((left, right) => left.name.localeCompare(right.name))
    });
  }

  async function openEdit(profile: CodexProfileResponse) {
    if (props.service === null) return;
    setEditor({ mode: 'edit', name: profile.name, loading: true });
    setError(undefined);
    try {
      const detail = await props.service.getProfile(profile.name);
      if (containsSensitiveConfig(detail.profile.config)) {
        setEditor(undefined);
        setError('CODEX_PROFILE_SENSITIVE：该 Profile 含敏感配置，请直接编辑本机配置文件');
        return;
      }
      setEditor({ mode: 'edit', name: profile.name, profile: detail.profile, loading: false });
    } catch (reason) {
      setEditor(undefined);
      setError(formatProfileError(reason, '无法加载 Profile 详情'));
    }
  }

  async function deleteProfile(profile: CodexProfileResponse) {
    if (props.service === null) return;
    const confirmed = props.confirmDelete?.(profile) ?? await confirm({
      title: '删除 Profile',
      description: `确认删除“${profile.name}”？删除后无法恢复。`,
      confirmLabel: '删除',
      destructive: true
    });
    if (!confirmed) return;
    setBusyName(profile.name);
    setError(undefined);
    try {
      await props.service.deleteProfile(profile.name);
      if (data !== undefined) {
        updateData({ ...data, profiles: data.profiles.filter(item => item.name !== profile.name) });
      }
    } catch (reason) {
      setError(formatProfileError(reason, '无法删除 Profile'));
    } finally {
      setBusyName(undefined);
    }
  }

  const writable = props.connected
    && props.service !== null
    && data?.writable === true
    && data.baseConfigValid;

  return (
    <section className="settings-section settings-management" aria-labelledby="settings-profiles-title">
      <header className="settings-management__header">
        <div>
          <h1 id="settings-profiles-title">Profiles</h1>
          <p>维护会话和计划任务可复用的 Codex 配置。</p>
        </div>
        <button
          className="settings-primary-button"
          type="button"
          disabled={!writable}
          onClick={() => setEditor({ mode: 'create' })}
        >
          <Plus size={16} />
          新建 Profile
        </button>
      </header>

      {!props.connected || props.service === null ? (
        <p className="settings-notice">本地服务连接后可以管理 Profile。</p>
      ) : null}
      {data !== undefined && !data.writable ? (
        <p className="settings-notice">当前 CODEX_HOME 为只读，无法修改 Profile</p>
      ) : null}
      {data !== undefined && !data.baseConfigValid ? (
        <p className="settings-notice">基础 config.toml 无效，请先修复配置</p>
      ) : null}
      {data?.diagnostics.map(diagnostic => (
        <p className="settings-inline-warning" key={diagnostic}>{diagnostic}</p>
      ))}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}

      {editor ? (
        <ProfileEditor
          state={editor}
          saving={saving}
          onCancel={() => setEditor(undefined)}
          onSubmit={async (name, config) => {
            if (props.service === null) return;
            setSaving(true);
            setError(undefined);
            try {
              const response = editor.mode === 'create'
                ? await props.service.createProfile({ name, config })
                : await props.service.updateProfile(editor.name, { config });
              upsertProfile(response.profile);
              setEditor(undefined);
            } catch (reason) {
              setError(formatProfileError(reason, '无法保存 Profile'));
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      {loading ? (
        <div className="settings-state" role="status">
          <LoaderCircle size={20} className="settings-spin" />
          正在加载 Profiles
        </div>
      ) : data !== undefined && data.profiles.length === 0 ? (
        <div className="settings-state">
          <FileSliders size={22} />
          暂无 Profile
        </div>
      ) : (
        <ul className="settings-item-list" aria-label="Profile 列表">
          {data?.profiles.map(profile => {
            const busy = busyName === profile.name;
            return (
              <li className="settings-item" key={profile.name}>
                <div className="settings-item__main">
                  <div className="settings-item__title">
                    <FileSliders size={16} />
                    <h2>{profile.name}</h2>
                    <span data-status={profile.status}>{profile.status === 'valid' ? '有效' : '无效'}</span>
                  </div>
                  <p>{profileSummary(profile)}</p>
                  {profile.diagnostics.map(diagnostic => (
                    <p className="settings-inline-warning" key={diagnostic}>{diagnostic}</p>
                  ))}
                </div>
                <div className="settings-item__actions">
                  <button
                    type="button"
                    aria-label={`编辑 ${profile.name}`}
                    title="编辑"
                    disabled={!writable || busy}
                    onClick={() => void openEdit(profile)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${profile.name}`}
                    title="删除"
                    disabled={!writable || busy}
                    onClick={() => void deleteProfile(profile)}
                  >
                    {busy ? <LoaderCircle size={16} className="settings-spin" /> : <Trash2 size={16} />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ProfileEditor(props: {
  state: ProfileEditorState;
  saving: boolean;
  onCancel(): void;
  onSubmit(name: string, config: CodexProfileConfig): Promise<void>;
}) {
  const profile = props.state.mode === 'edit' ? props.state.profile : undefined;
  const [name, setName] = useState(profile?.name ?? '');
  const [model, setModel] = useState(readString(profile?.config.model));
  const [reasoning, setReasoning] = useState(readString(profile?.config.model_reasoning_effort));
  const [sandbox, setSandbox] = useState(readString(profile?.config.sandbox_mode));
  const [advanced, setAdvanced] = useState(() => JSON.stringify(advancedConfig(profile?.config), null, 2));
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    setName(profile?.name ?? '');
    setModel(readString(profile?.config.model));
    setReasoning(readString(profile?.config.model_reasoning_effort));
    setSandbox(readString(profile?.config.sandbox_mode));
    setAdvanced(JSON.stringify(advancedConfig(profile?.config), null, 2));
  }, [profile]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length === 0) return setFormError('请输入 Profile 名称');
    if (!/^[A-Za-z0-9_.-]+$/.test(name.trim())) {
      return setFormError('Profile 名称只能包含字母、数字、下划线、点和短横线');
    }
    const parsed = parseAdvancedConfig(advanced);
    if (!parsed.ok) return setFormError(parsed.message);
    const config: CodexProfileConfig = { ...parsed.config };
    if (model.trim()) config.model = model.trim();
    if (reasoning) config.model_reasoning_effort = reasoning;
    if (sandbox) config.sandbox_mode = sandbox;
    setFormError(undefined);
    await props.onSubmit(name.trim(), config);
  }

  if (props.state.mode === 'edit' && props.state.loading) {
    return (
      <div className="settings-editor settings-state" role="status">
        <LoaderCircle size={20} className="settings-spin" />
        正在加载 Profile 详情
      </div>
    );
  }

  return (
    <form className="settings-editor" aria-label={props.state.mode === 'create' ? '新建 Profile' : `编辑 ${name}`} onSubmit={submit}>
      <header>
        <div>
          <p>{props.state.mode === 'create' ? '新建配置' : '编辑配置'}</p>
          <h2>{props.state.mode === 'create' ? '配置 Codex Profile' : name}</h2>
        </div>
        <button type="button" aria-label="关闭 Profile 编辑器" title="关闭" onClick={props.onCancel}>
          <X size={17} />
        </button>
      </header>
      {formError ? <p className="settings-error" role="alert">{formError}</p> : null}
      <div className="settings-form-grid">
        <label>
          <span>Profile 名称</span>
          <input
            aria-label="Profile 名称"
            disabled={props.state.mode === 'edit'}
            value={name}
            onChange={event => setName(event.target.value)}
          />
        </label>
        <label>
          <span>模型</span>
          <input
            aria-label="模型"
            placeholder="使用 Codex 默认模型"
            value={model}
            onChange={event => setModel(event.target.value)}
          />
        </label>
        <label>
          <span>推理级别</span>
          <select aria-label="推理级别" value={reasoning} onChange={event => setReasoning(event.target.value)}>
            <option value="">使用默认值</option>
            <option value="default">默认</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="xhigh">超高</option>
          </select>
        </label>
        <label>
          <span>Sandbox</span>
          <select aria-label="Sandbox" value={sandbox} onChange={event => setSandbox(event.target.value)}>
            <option value="">使用默认值</option>
            <option value="read-only">只读</option>
            <option value="workspace-write">工作区可写</option>
            <option value="danger-full-access">完全访问</option>
          </select>
        </label>
        <label className="settings-form-wide">
          <span>高级配置 JSON</span>
          <textarea
            aria-label="高级配置 JSON"
            rows={7}
            spellCheck={false}
            value={advanced}
            onChange={event => setAdvanced(event.target.value)}
          />
          <small>仅支持字符串、有限数字、布尔值和同类型数组。</small>
        </label>
      </div>
      <footer>
        <button className="settings-secondary-button" type="button" onClick={props.onCancel}>取消</button>
        <button className="settings-primary-button" type="submit" disabled={props.saving}>
          {props.saving ? <LoaderCircle size={16} className="settings-spin" /> : <Save size={16} />}
          保存 Profile
        </button>
      </footer>
    </form>
  );
}

function advancedConfig(config: CodexProfileConfig | undefined): CodexProfileConfig {
  if (config === undefined) return {};
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !knownKeys.has(key) && !isSensitiveKey(key))
  );
}

function parseAdvancedConfig(value: string):
  | { ok: true; config: CodexProfileConfig }
  | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}');
  } catch {
    return { ok: false, message: '高级配置必须是有效 JSON' };
  }
  if (!isPlainObject(parsed)) return { ok: false, message: '高级配置必须是 JSON 对象' };
  for (const [key, entry] of Object.entries(parsed)) {
    if (knownKeys.has(key)) return { ok: false, message: `${key} 请使用上方专用字段配置` };
    if (isSensitiveKey(key)) return { ok: false, message: `${key} 属于敏感配置，不能在 Web 页面中编辑` };
    if (!isProfileValue(entry)) return { ok: false, message: `${key} 不是支持的 Profile 配置值` };
  }
  return { ok: true, config: parsed as CodexProfileConfig };
}

function isProfileValue(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const type = typeof value[0];
  if (type !== 'string' && type !== 'boolean' && type !== 'number') return false;
  if (type === 'number' && value.some(item => typeof item !== 'number' || !Number.isFinite(item))) return false;
  return value.every(item => typeof item === type);
}

function isSensitiveKey(key: string): boolean {
  return /(?:secret|token|password|api[_-]?key|bearer|credential)/i.test(key);
}

function containsSensitiveConfig(config: CodexProfileConfig): boolean {
  return Object.keys(config).some(isSensitiveKey);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function profileSummary(profile: CodexProfileResponse): string {
  const model = readString(profile.config.model) || '默认模型';
  const reasoning = readString(profile.config.model_reasoning_effort) || '默认推理';
  const sandbox = readString(profile.config.sandbox_mode) || '默认 Sandbox';
  const advancedCount = Object.keys(profile.config).filter(key => !knownKeys.has(key)).length;
  return [model, reasoning, sandbox, advancedCount > 0 ? `${advancedCount} 项高级配置` : '']
    .filter(Boolean)
    .join(' · ');
}

function formatProfileError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.code === 'CODEX_PROFILE_IN_USE') {
    const threadCount = Array.isArray(error.details?.threads) ? error.details.threads.length : 0;
    const scheduleCount = Array.isArray(error.details?.schedules) ? error.details.schedules.length : 0;
    return `${error.code}：仍被 ${threadCount} 个会话和 ${scheduleCount} 个计划任务使用`;
  }
  const hints: Record<string, string> = {
    CODEX_HOME_READ_ONLY: '当前 CODEX_HOME 不允许写入',
    CODEX_PROFILE_EXISTS: '请更换 Profile 名称',
    CODEX_PROFILE_NOT_FOUND: '该 Profile 已不存在，请重新加载',
    CODEX_CONFIG_INVALID: '请先修复基础 config.toml',
    CODEX_PROFILE_INVALID: '请检查 Profile 字段和值',
    CODEX_CONFIG_WRITE_FAILED: '请检查配置目录权限和磁盘状态'
  };
  return `${error.code}：${hints[error.code] ?? error.message}`;
}
