import type {
  AddCodexMcpRequest,
  CodexMcpListResponse,
  CodexMcpServerResponse,
  EnterpriseMcpCatalogResponse,
  EnterpriseMcpPreferenceUpdateRequest,
  EnterpriseMcpUpstreamResponse,
  EnterpriseSessionResponse
} from '@clawee/protocol';
import {
  Cable,
  Download,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  WifiOff
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  McpEditor,
  type McpCapabilities,
  type McpSettingsService
} from '../settings/McpSettingsView.js';
import '../settings/settings-management.css';
import './connections.css';

type ConnectionFilter = 'all' | 'enabled' | 'installed' | 'available';

export type EnterpriseMcpConnectionService = {
  listMcpConnections(): Promise<EnterpriseMcpCatalogResponse>;
  refreshMcpConnections(): Promise<EnterpriseMcpCatalogResponse>;
  updateMcpPreference(
    upstreamId: string,
    input: EnterpriseMcpPreferenceUpdateRequest
  ): Promise<EnterpriseMcpCatalogResponse>;
};

export type ConnectionsPageProps = {
  connected: boolean;
  session: EnterpriseSessionResponse;
  service: EnterpriseMcpConnectionService | null;
  mcpService: McpSettingsService | null;
  mcpData?: CodexMcpListResponse;
  mcpCapabilities?: McpCapabilities;
  onMcpDataChange?(data: CodexMcpListResponse): void;
  onOpenAccount(): void;
  onRefreshSession(): Promise<EnterpriseSessionResponse>;
  onSessionExpired(): void;
};

type UnifiedConnection = {
  key: string;
  name: string;
  subtitle: string;
  endpoint: string;
  installed: boolean;
  enabled: boolean;
  server?: CodexMcpServerResponse;
  upstream?: EnterpriseMcpUpstreamResponse;
};

export function ConnectionsPage(props: ConnectionsPageProps) {
  const [nativeData, setNativeData] = useState(props.mcpData);
  const [catalog, setCatalog] = useState<EnterpriseMcpCatalogResponse>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConnectionFilter>('all');
  const [busyKey, setBusyKey] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    setNativeData(props.mcpData);
  }, [props.mcpData]);

  useEffect(() => {
    if (!props.connected || props.mcpService === null) {
      setNativeData(undefined);
      setCatalog(undefined);
      setLoading(false);
      setLoadError(undefined);
      setBusyKey(undefined);
      return;
    }
    let canceled = false;
    void loadConnections(false, canceledRef => canceledRef || canceled);
    return () => {
      canceled = true;
    };
  }, [
    props.connected,
    props.mcpService,
    props.onSessionExpired,
    props.service,
    props.session.status
  ]);

  function updateNativeData(next: CodexMcpListResponse) {
    setNativeData(next);
    props.onMcpDataChange?.(next);
  }

  async function loadConnections(
    refreshEnterprise: boolean,
    isCanceled: (value: boolean) => boolean = value => value
  ) {
    if (props.mcpService === null) return;
    setLoading(true);
    setLoadError(undefined);
    const enterpriseWork =
      props.session.status === 'signed_in' && props.service !== null
        ? refreshEnterprise
          ? props.service.refreshMcpConnections()
          : props.service.listMcpConnections()
        : Promise.resolve(undefined);
    const [nativeResult, enterpriseResult] = await Promise.allSettled([
      props.mcpService.listServers(),
      enterpriseWork
    ]);
    if (isCanceled(false)) return;

    const errors: string[] = [];
    if (nativeResult.status === 'fulfilled') {
      updateNativeData(nativeResult.value);
    } else {
      errors.push(formatConnectionError(nativeResult.reason, '无法加载 Codex MCP'));
    }
    if (enterpriseResult.status === 'fulfilled') {
      setCatalog(enterpriseResult.value);
    } else {
      if (isUnauthorized(enterpriseResult.reason)) props.onSessionExpired();
      errors.push(formatConnectionError(
        enterpriseResult.reason,
        '无法加载企业 MCP 目录'
      ));
    }
    setLoadError(errors.length === 0 ? undefined : errors.join('；'));
    setLoading(false);
  }

  const connections = useMemo(
    () => mergeConnections(nativeData?.servers ?? [], catalog?.upstreams ?? []),
    [catalog?.upstreams, nativeData?.servers]
  );
  const counts = useMemo(() => ({
    all: connections.length,
    enabled: connections.filter(item => item.enabled).length,
    installed: connections.filter(item => item.installed).length,
    available: connections.filter(item => !item.installed).length
  }), [connections]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return connections.filter(item => (
      matchesFilter(item, filter)
      && (
        normalized.length === 0
        || [
          item.name,
          item.subtitle,
          item.endpoint,
          ...(item.upstream?.tools.flatMap(tool => [
            tool.title,
            tool.description,
            tool.name
          ]) ?? [])
        ].some(value => value.toLocaleLowerCase().includes(normalized))
      )
    ));
  }, [connections, filter, query]);

  function confirmGlobalWrite(): boolean {
    return nativeData?.requiresWriteConfirmation !== true
      || window.confirm('此操作会修改全局 CODEX_HOME，是否继续？');
  }

  async function runNativeAction(
    item: UnifiedConnection,
    action: 'enable' | 'disable' | 'login' | 'logout' | 'remove'
  ) {
    if (
      props.mcpService === null
      || item.server === undefined
      || busyKey !== undefined
      || !nativeActionAvailable(props.mcpCapabilities, action)
    ) {
      return;
    }
    if (
      action === 'remove'
      && !window.confirm(`删除 MCP ${item.server.name}？`)
    ) {
      return;
    }
    if (!confirmGlobalWrite()) return;

    setBusyKey(item.key);
    setLoadError(undefined);
    try {
      const confirmed = nativeData?.requiresWriteConfirmation === true;
      if (action === 'enable' || action === 'disable') {
        await props.mcpService.setServerEnabled(
          item.server.name,
          action === 'enable',
          confirmed
        );
      } else if (action === 'login') {
        await props.mcpService.loginServer(item.server.name, confirmed);
      } else if (action === 'logout') {
        await props.mcpService.logoutServer(item.server.name, confirmed);
      } else {
        await props.mcpService.removeServer(item.server.name, confirmed);
      }
      await loadConnections(false);
    } catch (error) {
      setLoadError(formatConnectionError(error, `无法更新 ${item.name}`));
    } finally {
      setBusyKey(undefined);
    }
  }

  async function installEnterprise(item: UnifiedConnection) {
    if (
      props.service === null
      || item.upstream === undefined
      || busyKey !== undefined
      || props.mcpCapabilities?.mcpAdd !== true
      || !confirmGlobalWrite()
    ) {
      return;
    }
    setBusyKey(item.key);
    setLoadError(undefined);
    try {
      setCatalog(await props.service.updateMcpPreference(
        item.upstream.upstreamId,
        {
          installed: true,
          enabled: false,
          ...(nativeData?.requiresWriteConfirmation === true
            ? { confirmWriteToCodexHome: true }
            : {})
        }
      ));
      await loadConnections(false);
    } catch (error) {
      if (isUnauthorized(error)) props.onSessionExpired();
      setLoadError(formatConnectionError(error, `无法安装 ${item.name}`));
    } finally {
      setBusyKey(undefined);
    }
  }

  if (!props.connected || props.mcpService === null) {
    return (
      <ConnectionsGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title="正在等待本地 Runtime"
        detail="系统连接暂不可用，本地项目和会话仍可继续使用。"
      />
    );
  }

  return (
    <main className="connections-page">
      <div className="connections-page__inner">
        <header className="connections-header">
          <div>
            <h1>系统连接</h1>
            <p>统一管理当前 CODEX_HOME 中的 MCP，企业目录仅提供可安装来源</p>
          </div>
          <div className="connections-header__actions">
            <label className="connections-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="搜索系统连接"
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索 MCP 或工具"
                type="search"
                value={query}
              />
            </label>
            <button
              className="connections-icon-button"
              type="button"
              aria-label="新增 MCP"
              title="新增 MCP"
              disabled={props.mcpCapabilities?.mcpAdd !== true}
              onClick={() => setEditorOpen(true)}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              className="connections-icon-button"
              type="button"
              aria-label="刷新系统连接"
              title="刷新"
              disabled={loading}
              onClick={() => void loadConnections(true)}
            >
              <RefreshCw
                className={loading ? 'connections-spinner' : undefined}
                size={16}
                aria-hidden="true"
              />
            </button>
          </div>
        </header>

        {props.session.status === 'signed_out' ? (
          <div className="connections-banner" role="status">
            <LogIn size={16} aria-hidden="true" />
            <span>登录企业账户后可查看企业 MCP 目录，本地 MCP 不受影响。</span>
            <button type="button" onClick={props.onOpenAccount}>登录</button>
          </div>
        ) : null}
        {props.session.status === 'checking' ? (
          <div className="connections-banner" role="status">
            <LoaderCircle className="connections-spinner" size={16} aria-hidden="true" />
            正在验证企业会话，本地 MCP 已可管理。
          </div>
        ) : null}
        {props.session.status === 'service_unavailable' ? (
          <div className="connections-banner connections-banner--warning" role="status">
            <WifiOff size={16} aria-hidden="true" />
            <span>企业目录暂时不可用，本地 MCP 仍可管理。</span>
            <button type="button" onClick={() => void props.onRefreshSession()}>
              重试
            </button>
          </div>
        ) : null}
        {catalog?.tokenStatus === 'missing' ? (
          <div className="connections-banner connections-banner--warning" role="status">
            <KeyRound size={16} aria-hidden="true" />
            当前 Agent 尚未签发可用的企业 MCP Token。
          </div>
        ) : null}
        {loadError !== undefined ? (
          <div className="connections-banner connections-banner--error" role="alert">
            {loadError}
          </div>
        ) : null}

        {editorOpen ? (
          <McpEditor
            capabilities={props.mcpCapabilities}
            requiresWriteConfirmation={nativeData?.requiresWriteConfirmation === true}
            onCancel={() => setEditorOpen(false)}
            onSubmit={async input => {
              if (
                props.mcpService === null
                || props.mcpCapabilities?.mcpAdd !== true
                || !confirmGlobalWrite()
              ) {
                return;
              }
              try {
                await props.mcpService.addServer({
                  ...input,
                  ...(nativeData?.requiresWriteConfirmation === true
                    ? { confirmWriteToCodexHome: true as const }
                    : {})
                });
                await loadConnections(false);
                setEditorOpen(false);
              } catch (error) {
                setLoadError(formatConnectionError(error, '无法新增 MCP'));
              }
            }}
          />
        ) : null}

        <section className="connections-summary" aria-label="连接概览">
          <div>
            <Network size={18} aria-hidden="true" />
            <span><strong>{counts.all}</strong><small>全部 MCP</small></span>
          </div>
          <div>
            <Server size={18} aria-hidden="true" />
            <span><strong>{counts.installed}</strong><small>已安装</small></span>
          </div>
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <span><strong>{counts.enabled}</strong><small>已开启</small></span>
          </div>
        </section>

        <div className="connections-toolbar" role="group" aria-label="连接状态">
          {([
            ['all', '全部', counts.all],
            ['enabled', '已开启', counts.enabled],
            ['installed', '已安装', counts.installed],
            ['available', '可安装', counts.available]
          ] as const).map(([id, label, count]) => (
            <button
              aria-pressed={filter === id}
              key={id}
              onClick={() => setFilter(id)}
              type="button"
            >
              <span>{label}</span><b>{count}</b>
            </button>
          ))}
        </div>

        {loading && nativeData === undefined ? (
          <div className="connections-empty">
            <LoaderCircle className="connections-spinner" size={22} aria-hidden="true" />
            <span>正在加载 MCP</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="connections-empty">
            {connections.length === 0 ? '当前没有 MCP' : '没有找到匹配的 MCP'}
          </div>
        ) : (
          <section className="connections-grid" aria-label="系统连接目录">
            {filtered.map(item => (
              <ConnectionCard
                key={item.key}
                item={item}
                busy={busyKey === item.key}
                blocked={busyKey !== undefined}
                capabilities={props.mcpCapabilities}
                onInstall={() => void installEnterprise(item)}
                onAction={action => void runNativeAction(item, action)}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function ConnectionCard(props: {
  item: UnifiedConnection;
  busy: boolean;
  blocked: boolean;
  capabilities?: McpCapabilities;
  onInstall(): void;
  onAction(action: 'enable' | 'disable' | 'login' | 'logout' | 'remove'): void;
}) {
  const visibleTools = props.item.upstream?.tools.slice(0, 4) ?? [];
  const remainingTools =
    (props.item.upstream?.tools.length ?? 0) - visibleTools.length;
  const authorizedTools =
    props.item.upstream?.tools.filter(tool => tool.authorized).length ?? 0;
  const status = props.item.enabled
    ? 'enabled'
    : props.item.installed
      ? 'installed'
      : 'available';

  return (
    <article
      className="connection-card"
      data-testid="mcp-card"
      data-connection-key={props.item.key}
    >
      <div className="connection-card__head">
        <span className="connection-card__icon">
          {props.item.upstream === undefined
            ? <Server size={20} aria-hidden="true" />
            : <Cable size={20} aria-hidden="true" />}
        </span>
        <div>
          <h2>{props.item.name}</h2>
          <span>{props.item.subtitle}</span>
        </div>
        <em data-status={status}>{connectionStatusLabel(status)}</em>
      </div>

      <div className="connection-card__meta">
        <span>{props.item.server?.transport ?? props.item.upstream?.namespace}</span>
        <span>
          {props.item.upstream === undefined ? 'Codex 原生配置' : '企业目录'}
        </span>
      </div>

      <div className="connection-card__endpoint" title={props.item.endpoint}>
        {props.item.endpoint}
      </div>

      {props.item.upstream !== undefined ? (
        <>
          <div className="connection-card__capabilities">
            {visibleTools.map(tool => (
              <span key={tool.toolId} title={tool.description || tool.name}>
                {tool.title || tool.name}
              </span>
            ))}
            {remainingTools > 0 ? <span>+{remainingTools}</span> : null}
            {props.item.upstream.tools.length === 0 ? <span>暂无工具</span> : null}
          </div>
          <p className="connection-card__authorization">
            企业授权：{authorizedTools}/{props.item.upstream.tools.length} 项工具
          </p>
        </>
      ) : props.item.server?.envKeys.length ? (
        <div className="connection-card__capabilities">
          {props.item.server.envKeys.map(key => <span key={key}>{key}</span>)}
        </div>
      ) : null}

      <footer>
        {props.item.installed && props.item.server !== undefined ? (
          <>
            <button
              className="connection-icon-action"
              type="button"
              aria-label={`登录 ${props.item.server.name}`}
              title="登录"
              disabled={
                props.blocked
                || props.capabilities?.mcpLogin !== true
              }
              onClick={() => props.onAction('login')}
            >
              <LogIn size={15} aria-hidden="true" />
            </button>
            <button
              className="connection-icon-action"
              type="button"
              aria-label={`退出 ${props.item.server.name}`}
              title="退出"
              disabled={
                props.blocked
                || props.capabilities?.mcpLogout !== true
              }
              onClick={() => props.onAction('logout')}
            >
              <LogOut size={15} aria-hidden="true" />
            </button>
            <button
              className="connection-icon-action connection-icon-action--danger"
              type="button"
              aria-label={`删除 ${props.item.server.name}`}
              title="删除"
              disabled={
                props.blocked
                || props.capabilities?.mcpRemove !== true
              }
              onClick={() => props.onAction('remove')}
            >
              {props.busy
                ? <LoaderCircle className="connections-spinner" size={15} aria-hidden="true" />
                : <Trash2 size={15} aria-hidden="true" />}
            </button>
            <span className="connection-toggle-label">
              {props.item.enabled ? '已开启' : '已关闭'}
            </span>
            <button
              className="connection-switch"
              type="button"
              role="switch"
              aria-label={`${props.item.name} MCP`}
              aria-checked={props.item.enabled}
              disabled={props.blocked}
              onClick={() => props.onAction(
                props.item.enabled ? 'disable' : 'enable'
              )}
            />
          </>
        ) : (
          <button
            className="connection-install"
            type="button"
            disabled={
              props.blocked
              || props.capabilities?.mcpAdd !== true
            }
            onClick={props.onInstall}
          >
            {props.busy
              ? <LoaderCircle className="connections-spinner" size={15} aria-hidden="true" />
              : <Download size={15} aria-hidden="true" />}
            安装
          </button>
        )}
      </footer>
    </article>
  );
}

function mergeConnections(
  servers: CodexMcpServerResponse[],
  upstreams: EnterpriseMcpUpstreamResponse[]
): UnifiedConnection[] {
  const matchedUpstreamIds = new Set<string>();
  const installed = servers.map(server => {
    const upstream = upstreams.find(candidate => (
      candidate.installedServerName === server.name
      || candidate.endpoint === server.url
      || candidate.codexServerName === server.name
    ));
    if (upstream !== undefined) matchedUpstreamIds.add(upstream.upstreamId);
    return {
      key: `native:${server.name}`,
      name: upstream?.name ?? server.name,
      subtitle: upstream === undefined
        ? server.name
        : `${upstream.domain || upstream.namespace} · ${server.name}`,
      endpoint: mcpEndpoint(server),
      installed: true,
      enabled: server.enabled,
      server,
      ...(upstream === undefined ? {} : { upstream })
    };
  });
  const available = upstreams
    .filter(upstream => !matchedUpstreamIds.has(upstream.upstreamId))
    .map(upstream => ({
      key: `enterprise:${upstream.upstreamId}`,
      name: upstream.name,
      subtitle: upstream.domain || upstream.namespace,
      endpoint: upstream.endpoint,
      installed: false,
      enabled: false,
      upstream
    }));
  return [...installed, ...available].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

function mcpEndpoint(server: CodexMcpServerResponse): string {
  if (server.transport === 'stdio') {
    return [server.command, ...(server.args ?? [])]
      .filter(Boolean)
      .join(' ') || 'stdio';
  }
  return server.url ?? server.transport;
}

function nativeActionAvailable(
  capabilities: McpCapabilities | undefined,
  action: 'enable' | 'disable' | 'login' | 'logout' | 'remove'
): boolean {
  if (action === 'login') return capabilities?.mcpLogin === true;
  if (action === 'logout') return capabilities?.mcpLogout === true;
  if (action === 'remove') return capabilities?.mcpRemove === true;
  return true;
}

function ConnectionsGate(props: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <main className="connections-page connections-gate">
      <div className="connections-gate__icon">{props.icon}</div>
      <h1>{props.title}</h1>
      <p>{props.detail}</p>
    </main>
  );
}

function matchesFilter(
  item: UnifiedConnection,
  filter: ConnectionFilter
): boolean {
  if (filter === 'enabled') return item.enabled;
  if (filter === 'installed') return item.installed;
  if (filter === 'available') return !item.installed;
  return true;
}

function connectionStatusLabel(
  status: Exclude<ConnectionFilter, 'all'>
): string {
  if (status === 'enabled') return '已开启';
  if (status === 'installed') return '已安装';
  return '可安装';
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 401
    || candidate.code === 'ENTERPRISE_UNAUTHORIZED'
    || candidate.code === 'ENTERPRISE_SESSION_EXPIRED';
}

function formatConnectionError(
  error: unknown,
  fallback = '系统连接操作失败'
): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'MCP_WRITE_CONFIRMATION_REQUIRED') {
      return '需要确认修改全局 CODEX_HOME';
    }
    if (code === 'ENTERPRISE_MCP_TOKEN_NOT_FOUND') {
      return '当前 Agent 尚未签发可用的 MCP Token';
    }
    if (code === 'ENTERPRISE_AGENT_FORBIDDEN') {
      return '当前设备的企业 Agent 已停用，请联系管理员';
    }
    if (code === 'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE') {
      return '系统安全凭据存储不可用，无法保存 MCP Token';
    }
    if (code === 'ENTERPRISE_SERVICE_UNAVAILABLE') {
      return '企业连接服务暂时不可用';
    }
    if (code === 'ENTERPRISE_PROTOCOL_ERROR') {
      return '企业连接服务返回了无法识别的数据';
    }
  }
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}
