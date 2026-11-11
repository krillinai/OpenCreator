import AppSelect from '../../components/forms/Select.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type {
  AddCodexMcpRequest,
  CodexMcpAddResponse,
  CodexMcpAuthResponse,
  CodexMcpEnableResponse,
  CodexMcpListResponse,
  CodexMcpRemoveResponse,
  CodexMcpServerDetailResponse,
  CodexMcpServerResponse
} from '@opencreator/protocol';
import {
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  Plus,
  Server,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import { IssueList } from '../issues/IssuePresenter.js';
import { usePageIssueState } from '../issues/page-issue-state.js';

export type McpSettingsService = {
  listServers(): Promise<CodexMcpListResponse>;
  getServer(name: string): Promise<CodexMcpServerDetailResponse>;
  addServer(input: AddCodexMcpRequest): Promise<CodexMcpAddResponse>;
  setServerEnabled(
    name: string,
    enabled: boolean,
    confirmWriteToCodexHome?: boolean
  ): Promise<CodexMcpEnableResponse>;
  removeServer(name: string, confirmWriteToCodexHome?: boolean): Promise<CodexMcpRemoveResponse>;
  loginServer(name: string, confirmWriteToCodexHome?: boolean): Promise<CodexMcpAuthResponse>;
  logoutServer(name: string, confirmWriteToCodexHome?: boolean): Promise<CodexMcpAuthResponse>;
};

export type McpCapabilities = Partial<{
  mcpAdd: boolean;
  mcpRemove: boolean;
  mcpLogin: boolean;
  mcpLogout: boolean;
  mcpAddEnv: boolean;
  mcpAddUrl: boolean;
  mcpAddBearerTokenEnvVar: boolean;
  mcpAddOAuth: boolean;
}>;

type EnvEntry = { id: number; key: string; value: string };

const TRENDPULSE_MCP_PRESET = {
  name: 'mcp-trendpulse',
  transport: 'stdio',
  command: 'uvx',
  args: ['mcp-trendpulse']
} satisfies AddCodexMcpRequest;

export function McpSettingsView(props: {
  connected: boolean;
  service: McpSettingsService | null;
  data?: CodexMcpListResponse;
  capabilities?: McpCapabilities;
  onDataChange?(data: CodexMcpListResponse): void;
  confirmWrite?(): boolean;
  confirmRemove?(server: CodexMcpServerResponse): boolean;
}) {
  const l = useLocalizedCopy();
  const confirm = useConfirmDialog();
  const [data, setData] = useState(props.data);
  const [loading, setLoading] = useState(
    props.data === undefined && props.connected && props.service !== null
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [busyName, setBusyName] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  const pageIssues = usePageIssueState('settings-mcp');

  useEffect(() => {
    setData(props.data);
  }, [props.data]);

  useEffect(() => {
    if (props.data !== undefined || !props.connected || props.service === null) return;
    let canceled = false;
    setLoading(true);
    props.service.listServers()
      .then(response => {
        if (!canceled) {
          updateData(response);
          pageIssues.resolveOperation('settings.mcp.load');
        }
      })
      .catch(reason => {
        if (!canceled) pageIssues.captureOperationFailure(
          'settings.mcp.load',
          reason,
          l("无法加载 MCP 服务，请重试。", "Unable to load MCP service, please try again."),
          { retryable: true }
        );
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    pageIssues.captureOperationFailure,
    pageIssues.resolveOperation,
    props.connected,
    props.data,
    props.service,
    reloadToken
  ]);

  function updateData(next: CodexMcpListResponse) {
    setData(next);
    props.onDataChange?.(next);
  }

  async function runServerAction(
    server: CodexMcpServerResponse,
    action: 'login' | 'logout' | 'remove'
  ) {
    if (props.service === null) return;
    const removeConfirmed = action !== 'remove'
      || (props.confirmRemove?.(server) ?? await confirm({
        title: '删除 MCP',
        description: `确认删除“${server.name}”？相关连接将立即停用。`,
        confirmLabel: '删除',
        destructive: true
      }));
    if (!removeConfirmed) return;
    const confirmed = !data?.requiresWriteConfirmation
      || (props.confirmWrite?.() ?? (action === 'remove' ? true : await confirm({
        title: '确认修改全局配置',
        description: '此操作会修改全局 CODEX_HOME，并影响使用同一配置目录的其他会话。',
        confirmLabel: '继续'
      })));
    if (!confirmed) return;

    setBusyName(server.name);
    const operationId = `settings.mcp.${action}:${server.name}`;
    try {
      if (action === 'login') await props.service.loginServer(server.name, data?.requiresWriteConfirmation);
      if (action === 'logout') await props.service.logoutServer(server.name, data?.requiresWriteConfirmation);
      if (action === 'remove') {
        await props.service.removeServer(server.name, data?.requiresWriteConfirmation);
        if (data !== undefined) {
          updateData({ ...data, servers: data.servers.filter(item => item.name !== server.name) });
        }
      }
      pageIssues.resolveOperation(operationId);
    } catch (reason) {
      pageIssues.captureOperationFailure(
        operationId,
        reason,
        l(`MCP ${action === 'login' ? '登录' : action === 'logout' ? '退出' : '删除'}操作未完成，请检查诊断信息后重试。`, `The MCP ${action === 'login' ? '登录' : action === 'logout' ? '退出' : '删除'} operation is not completed. Please check the diagnostic information and try again.`)
      );
    } finally {
      setBusyName(undefined);
    }
  }

  const canAdd = props.connected && props.service !== null && props.capabilities?.mcpAdd === true;

  return (
    <section className="settings-section settings-management" aria-labelledby="settings-mcp-title">
      <header className="settings-management__header">
        <div>
          <h1 id="settings-mcp-title">{l("MCP 服务", "MCP service")}</h1>
          <p>{l("管理 Codex 可连接的本机命令和远程 MCP 服务。", "Manage native commands and remote MCP services that Codex can connect to.")}</p>
        </div>
        <button
          className="settings-primary-button"
          type="button"
          disabled={!canAdd}
          onClick={() => setEditorOpen(true)}
        >
          <Plus size={16} />
          {l("新增 MCP", "Add new MCP")}</button>
      </header>

      {!props.connected || props.service === null ? (
        <p className="settings-notice">{l("本地服务连接后可以管理 MCP。", "The local service connects to manage the MCP.")}</p>
      ) : null}
      {props.connected && props.service !== null && props.capabilities?.mcpAdd !== true ? (
        <p className="settings-notice">{l("当前 Codex 版本不支持新增 MCP", "The current Codex version does not support adding new MCPs")}</p>
      ) : null}
      {data?.requiresWriteConfirmation ? (
        <p className="settings-notice">{l("写操作会修改全局 CODEX_HOME，每次操作都需要确认。", "The write operation will modify the global CODEX_HOME, and each operation requires confirmation.")}</p>
      ) : null}
      <IssueList
        issues={pageIssues.issues}
        actions={{ retryOperations: {
          'settings.mcp.load': () => setReloadToken(value => value + 1)
        } }}
        onDismiss={pageIssues.dismissIssue}
      />

      {editorOpen ? (
        <McpEditor
          capabilities={props.capabilities}
          requiresWriteConfirmation={data?.requiresWriteConfirmation === true}
          onCancel={() => setEditorOpen(false)}
          onSubmit={async input => {
            if (props.service === null) return;
            const confirmed = !data?.requiresWriteConfirmation
              || (props.confirmWrite?.() ?? await confirm({
                title: '确认修改全局配置',
                description: '此操作会修改全局 CODEX_HOME，并影响使用同一配置目录的其他会话。',
                confirmLabel: '继续'
              }));
            if (!confirmed) return;
            try {
              const result = await props.service.addServer({
                ...input,
                ...(data?.requiresWriteConfirmation ? { confirmWriteToCodexHome: true as const } : {})
              });
              const next = result.server;
              if (next !== undefined && data !== undefined) {
                updateData({
                  ...data,
                  servers: [...data.servers.filter(server => server.name !== next.name), next]
                    .sort((left, right) => left.name.localeCompare(right.name))
                });
              } else {
                updateData(await props.service.listServers());
              }
              setEditorOpen(false);
              pageIssues.resolveOperation('settings.mcp.add');
            } catch (reason) {
              pageIssues.captureOperationFailure(
                'settings.mcp.add',
                reason,
                l("无法新增 MCP，请检查配置后重试。", "Unable to add MCP, please check the configuration and try again.")
              );
            }
          }}
        />
      ) : null}

      {loading ? (
        <div className="settings-state" role="status">
          <LoaderCircle size={20} className="settings-spin" />
          {l("正在加载 MCP 服务", "Loading MCP service")}</div>
      ) : data !== undefined && data.servers.length === 0 ? (
        <div className="settings-state">
          <Server size={22} />
          {l("暂无 MCP 服务", "No MCP service yet")}</div>
      ) : (
        <ul className="settings-item-list" aria-label={l("MCP 服务列表", "MCP service list")}>
          {data?.servers.map(server => {
            const busy = busyName === server.name;
            return (
              <li className="settings-item" key={server.name}>
                <div className="settings-item__main">
                  <div className="settings-item__title">
                    <Server size={16} />
                    <h2>{server.name}</h2>
                    <span data-status={server.status}>{server.status === 'configured' ? l("已配置", "configured") : server.status}</span>
                  </div>
                  <p>{mcpEndpoint(server)}</p>
                  {server.envKeys.length > 0 ? (
                    <div className="settings-tags" aria-label={l(`${server.name} 环境变量`, `${server.name} environment variables`)}>
                      <KeyRound size={14} />
                      {server.envKeys.map(key => <code key={key}>{key}</code>)}
                    </div>
                  ) : null}
                  {server.diagnostics.map(diagnostic => (
                    <p className="settings-inline-warning" key={diagnostic}>{diagnostic}</p>
                  ))}
                </div>
                <div className="settings-item__actions">
                  <button
                    type="button"
                    aria-label={l(`登录 ${server.name}`, `Login ${server.name}`)}
                    title={l("登录", "Log in")}
                    disabled={busy || props.capabilities?.mcpLogin !== true}
                    onClick={() => void runServerAction(server, 'login')}
                  >
                    <LogIn size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={l(`退出 ${server.name}`, `Exit ${server.name}`)}
                    title={l("退出", "quit")}
                    disabled={busy || props.capabilities?.mcpLogout !== true}
                    onClick={() => void runServerAction(server, 'logout')}
                  >
                    <LogOut size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={l(`删除 ${server.name}`, `Delete ${server.name}`)}
                    title={l("删除", "Delete")}
                    disabled={busy || props.capabilities?.mcpRemove !== true}
                    onClick={() => void runServerAction(server, 'remove')}
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

export function McpEditor(props: {
  capabilities?: McpCapabilities;
  requiresWriteConfirmation: boolean;
  onCancel(): void;
  onSubmit(input: AddCodexMcpRequest): Promise<void>;
}) {
  const l = useLocalizedCopy();
  const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState('');
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthResource, setOauthResource] = useState('');
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([{ id: 1, key: '', value: '' }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return setFormError('请输入 MCP 名称');
    const env = Object.fromEntries(
      envEntries
        .map(entry => [entry.key.trim(), entry.value] as const)
        .filter(([key]) => key.length > 0)
    );
    let input: AddCodexMcpRequest;
    if (transport === 'stdio') {
      if (command.trim().length === 0) return setFormError('请输入启动命令');
      input = {
        name: trimmedName,
        transport,
        command: command.trim(),
        args: args.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        ...(Object.keys(env).length > 0 ? { env } : {})
      };
    } else {
      if (url.trim().length === 0) return setFormError('请输入 MCP URL');
      input = {
        name: trimmedName,
        transport,
        url: url.trim(),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(bearerTokenEnvVar.trim() ? { bearerTokenEnvVar: bearerTokenEnvVar.trim() } : {}),
        ...(oauthClientId.trim() ? { oauthClientId: oauthClientId.trim() } : {}),
        ...(oauthResource.trim() ? { oauthResource: oauthResource.trim() } : {})
      };
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await props.onSubmit(input);
      setEnvEntries([{ id: 1, key: '', value: '' }]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="settings-editor" aria-label={l("新增 MCP", "Add new MCP")} onSubmit={submit}>
      <header>
        <div>
          <p>{l("新增连接", "New connection")}</p>
          <h2>{l("配置 MCP 服务", "Configure MCP service")}</h2>
        </div>
        <button type="button" aria-label={l("关闭 MCP 编辑器", "Close MCP editor")} title={l("关闭", "Close")} onClick={props.onCancel}>
          <X size={17} />
        </button>
      </header>
      {formError ? <p className="settings-error" role="alert">{formError}</p> : null}
      <div className="settings-notice">
        <p>
          {l(
            "TrendPulse（Google News 和 Google Trends）通过本机 stdio 运行，需要已安装 uvx 和网络连接，不需要 API 密钥。Agent Finder 登记 URL 是服务元数据，不是 MCP 运行地址。",
            "TrendPulse (Google News and Google Trends) runs over local stdio. It requires uvx and internet access, but no API key. The Agent Finder registration URL is metadata, not an MCP endpoint."
          )}
        </p>
        <button
          className="settings-text-button"
          type="button"
          disabled={saving}
          onClick={() => {
            setTransport(TRENDPULSE_MCP_PRESET.transport);
            setName(TRENDPULSE_MCP_PRESET.name);
            setCommand(TRENDPULSE_MCP_PRESET.command);
            setArgs(TRENDPULSE_MCP_PRESET.args?.join('\n') ?? '');
            setUrl('');
            setBearerTokenEnvVar('');
            setOauthClientId('');
            setOauthResource('');
            setEnvEntries([{ id: 1, key: '', value: '' }]);
            setFormError(undefined);
          }}
        >
          {l("填写 TrendPulse 配置", "Prefill TrendPulse configuration")}
        </button>
      </div>
      <div className="settings-form-grid">
        <label>
          <span>{l("名称", "Name")}</span>
          <input aria-label={l("名称", "Name")} value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label>
          <span>{l("传输方式", "Transmission method")}</span>
          <AppSelect
            aria-label={l("传输方式", "Transmission method")}
            value={transport}
            onChange={event => setTransport(event.target.value as typeof transport)}
          >
            <option value="stdio">stdio</option>
            <option value="http" disabled={props.capabilities?.mcpAddUrl !== true}>HTTP</option>
            <option value="sse" disabled={props.capabilities?.mcpAddUrl !== true}>SSE</option>
          </AppSelect>
        </label>
        {transport === 'stdio' ? (
          <>
            <label>
              <span>{l("命令", "Command")}</span>
              <input aria-label={l("命令", "Command")} value={command} onChange={event => setCommand(event.target.value)} />
            </label>
            <label>
              <span>{l("参数（每行一个）", "Parameters (one per line)")}</span>
              <textarea aria-label={l("参数", "parameter")} rows={3} value={args} onChange={event => setArgs(event.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="settings-form-wide">
              <span>URL</span>
              <input aria-label="MCP URL" value={url} onChange={event => setUrl(event.target.value)} />
            </label>
            <label>
              <span>{l("Bearer Token 环境变量名", "Bearer Token environment variable name")}</span>
              <input
                aria-label={l("Bearer Token 环境变量名", "Bearer Token environment variable name")}
                disabled={props.capabilities?.mcpAddBearerTokenEnvVar !== true}
                value={bearerTokenEnvVar}
                onChange={event => setBearerTokenEnvVar(event.target.value)}
              />
            </label>
            <label>
              <span>OAuth Client ID</span>
              <input
                aria-label="OAuth Client ID"
                disabled={props.capabilities?.mcpAddOAuth !== true}
                value={oauthClientId}
                onChange={event => setOauthClientId(event.target.value)}
              />
            </label>
            <label>
              <span>OAuth Resource</span>
              <input
                aria-label="OAuth Resource"
                disabled={props.capabilities?.mcpAddOAuth !== true}
                value={oauthResource}
                onChange={event => setOauthResource(event.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <fieldset className="settings-env-editor" disabled={props.capabilities?.mcpAddEnv !== true}>
        <legend>{l("环境变量", "environment variables")}</legend>
        {envEntries.map((entry, index) => (
          <div key={entry.id}>
            <input
              aria-label={index === 0 ? l("环境变量名", "Environment variable name") : l(`环境变量名 ${index + 1}`, `Environment variable name ${index + 1}`)}
              placeholder={l("变量名", "variable name")}
              value={entry.key}
              onChange={event => setEnvEntries(current => current.map(item => (
                item.id === entry.id ? { ...item, key: event.target.value } : item
              )))}
            />
            <input
              aria-label={index === 0 ? l("环境变量值", "environment variable value") : l(`环境变量值 ${index + 1}`, `Environment variable value ${index + 1}`)}
              type="password"
              autoComplete="off"
              placeholder={l("仅在本次保存时使用", "Only used during this save")}
              value={entry.value}
              onChange={event => setEnvEntries(current => current.map(item => (
                item.id === entry.id ? { ...item, value: event.target.value } : item
              )))}
            />
            {envEntries.length > 1 ? (
              <button
                type="button"
                aria-label={l(`移除环境变量 ${index + 1}`, `Remove environment variable ${index + 1}`)}
                onClick={() => setEnvEntries(current => current.filter(item => item.id !== entry.id))}
              >
                <Trash2 size={15} />
              </button>
            ) : null}
          </div>
        ))}
        <button
          className="settings-text-button"
          type="button"
          onClick={() => setEnvEntries(current => [
            ...current,
            { id: Math.max(...current.map(entry => entry.id)) + 1, key: '', value: '' }
          ])}
        >
          <Plus size={15} />
          {l("添加变量", "Add variables")}</button>
      </fieldset>
      {props.requiresWriteConfirmation ? <p className="settings-notice">{l("保存时将再次确认全局写入。", "Global writes will be confirmed again when saving.")}</p> : null}
      <footer>
        <button className="settings-secondary-button" type="button" onClick={props.onCancel}>{l("取消", "Cancel")}</button>
        <button className="settings-primary-button" type="submit" disabled={saving}>
          {saving ? <LoaderCircle size={16} className="settings-spin" /> : <Server size={16} />}
          {l('保存 MCP', 'Save MCP')}
        </button>
      </footer>
    </form>
  );
}

function mcpEndpoint(server: CodexMcpServerResponse): string {
  if (server.transport === 'stdio') {
    return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ') || 'stdio';
  }
  return server.url ?? server.transport;
}
