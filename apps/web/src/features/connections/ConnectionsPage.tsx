import type {
  AddCodexMcpRequest,
  CodexMcpListResponse,
  CodexMcpServerResponse,
  EnterpriseMcpCatalogResponse,
  EnterpriseMcpPreferenceUpdateRequest,
  EnterpriseMcpUpstreamResponse
} from '@opencreator/protocol';
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
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
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
  service: EnterpriseMcpConnectionService | null;
  mcpService: McpSettingsService | null;
  mcpData?: CodexMcpListResponse;
  mcpCapabilities?: McpCapabilities;
  onMcpDataChange?(data: CodexMcpListResponse): void;
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
  const l = useLocalizedCopy();
  const confirm = useConfirmDialog();
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
    props.service
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
    const enterpriseWork = props.service === null
      ? Promise.resolve(undefined)
      : refreshEnterprise
        ? props.service.refreshMcpConnections()
        : props.service.listMcpConnections();
    const [nativeResult, enterpriseResult] = await Promise.allSettled([
      props.mcpService.listServers(),
      enterpriseWork
    ]);
    if (isCanceled(false)) return;

    const errors: string[] = [];
    if (nativeResult.status === 'fulfilled') {
      updateNativeData(nativeResult.value);
    } else {
      errors.push(formatConnectionError(nativeResult.reason, l('无法加载 Codex MCP', 'Could not load Codex MCP servers'), l));
    }
    if (enterpriseResult.status === 'fulfilled') {
      setCatalog(enterpriseResult.value);
    } else {
      errors.push(formatConnectionError(
        enterpriseResult.reason,
        l('无法加载连接器目录', 'Could not load the connector catalog'),
        l
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

  async function confirmGlobalWrite(): Promise<boolean> {
    return nativeData?.requiresWriteConfirmation !== true
      || confirm({
        title: l('确认修改全局配置', 'Confirm global configuration change'),
        description: l(
          '此操作会修改全局 CODEX_HOME，并影响使用同一配置目录的其他会话。',
          'This changes the global CODEX_HOME and may affect other sessions using it.'
        ),
        confirmLabel: l('继续', 'Continue')
      });
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
      && !await confirm({
        title: l('删除 MCP', 'Remove MCP'),
        description: l(
          `确认删除“${item.server.name}”？相关连接将立即停用。`,
          `Remove "${item.server.name}"? Its connection will be disabled immediately.`
        ),
        confirmLabel: l('删除', 'Remove'),
        destructive: true
      })
    ) {
      return;
    }
    if (action !== 'remove' && !await confirmGlobalWrite()) return;

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
      setLoadError(formatConnectionError(error, `${l('无法更新', 'Could not update')} ${item.name}`, l));
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
      || !await confirmGlobalWrite()
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
      setLoadError(formatConnectionError(error, `${l('无法安装', 'Could not install')} ${item.name}`, l));
    } finally {
      setBusyKey(undefined);
    }
  }

  if (!props.connected || props.mcpService === null) {
    return (
      <ConnectionsGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title={l('正在等待本地 Runtime', 'Waiting for the local runtime')}
        detail={l('连接器暂不可用，本地项目和会话仍可继续使用。', 'Connectors are temporarily unavailable. Local projects remain available.')}
      />
    );
  }

  return (
    <main className="connections-page">
      <div className="connections-page__inner">
        <header className="connections-header">
          <div>
            <h1>{l('连接器', 'Connectors')}</h1>
            <p>{l('统一管理当前 CODEX_HOME 中的 MCP 和可安装连接器', 'Manage installed MCP servers and available connectors for this CODEX_HOME')}</p>
          </div>
          <div className="connections-header__actions">
            <label className="connections-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label={l('搜索连接器', 'Search connectors')}
                onChange={event => setQuery(event.target.value)}
                placeholder={l('搜索 MCP 或工具', 'Search MCP servers or tools')}
                type="search"
                value={query}
              />
            </label>
            <button
              className="connections-icon-button"
              type="button"
              aria-label={l('新增 MCP', 'Add MCP server')}
              title={l('新增 MCP', 'Add MCP server')}
              disabled={props.mcpCapabilities?.mcpAdd !== true}
              onClick={() => setEditorOpen(true)}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              className="connections-icon-button"
              type="button"
              aria-label={l('刷新连接器', 'Refresh connectors')}
              title={l('刷新', 'Refresh')}
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

        {catalog?.tokenStatus === 'missing' ? (
          <div className="connections-banner connections-banner--warning" role="status">
            <KeyRound size={16} aria-hidden="true" />
            {l('当前设备尚未获取可用的 MCP Token。', 'No valid MCP token is available on this device.')}
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
                || !await confirmGlobalWrite()
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
                setLoadError(formatConnectionError(error, l('无法新增 MCP', 'Could not add the MCP server'), l));
              }
            }}
          />
        ) : null}

        <section className="connections-summary" aria-label={l('连接概览', 'Connector overview')}>
          <div>
            <Network size={18} aria-hidden="true" />
            <span><strong>{counts.all}</strong><small>{l('全部 MCP', 'All MCP')}</small></span>
          </div>
          <div>
            <Server size={18} aria-hidden="true" />
            <span><strong>{counts.installed}</strong><small>{l('已安装', 'Installed')}</small></span>
          </div>
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <span><strong>{counts.enabled}</strong><small>{l('已开启', 'Enabled')}</small></span>
          </div>
        </section>

        <div className="connections-toolbar" role="group" aria-label={l('连接状态', 'Connection status')}>
          {([
            ['all', l('全部', 'All'), counts.all],
            ['enabled', l('已开启', 'Enabled'), counts.enabled],
            ['installed', l('已安装', 'Installed'), counts.installed],
            ['available', l('可安装', 'Available'), counts.available]
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
            <span>{l('正在加载 MCP', 'Loading MCP servers')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="connections-empty">
            {connections.length === 0 ? l('当前没有 MCP', 'No MCP servers yet') : l('没有找到匹配的 MCP', 'No matching MCP servers')}
          </div>
        ) : (
          <section className="connections-grid" aria-label={l('连接器目录', 'Connector catalog')}>
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
  const l = useLocalizedCopy();
  const description = props.item.upstream?.tools.find(tool => (
    tool.authorized && tool.description.trim().length > 0
  ))?.description
    ?? props.item.upstream?.tools.find(tool => (
      tool.description.trim().length > 0
    ))?.description
    ?? props.item.endpoint;
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
        <em data-status={status}>{connectionStatusLabel(status, l)}</em>
      </div>

      <p className="connection-card__description">{description}</p>

      <div className="connection-card__meta">
        <span>{props.item.server?.transport ?? props.item.upstream?.namespace}</span>
        <span>
          {props.item.upstream === undefined ? l('Codex 原生配置', 'Native Codex configuration') : l('云端目录', 'Connector catalog')}
        </span>
      </div>

      <footer>
        {props.item.installed && props.item.server !== undefined ? (
          <>
            <button
              className="connection-icon-action"
              type="button"
              aria-label={`${l('登录', 'Sign in to')} ${props.item.server.name}`}
              title={l('登录', 'Sign in')}
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
              aria-label={`${l('退出', 'Sign out of')} ${props.item.server.name}`}
              title={l('退出', 'Sign out')}
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
              aria-label={`${l('删除', 'Remove')} ${props.item.server.name}`}
              title={l('删除', 'Remove')}
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
              {props.item.enabled ? l('已开启', 'Enabled') : l('已关闭', 'Disabled')}
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
            {l('安装', 'Install')}
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
  status: Exclude<ConnectionFilter, 'all'>,
  l: LocalizeCopy
): string {
  if (status === 'enabled') return l('已开启', 'Enabled');
  if (status === 'installed') return l('已安装', 'Installed');
  return l('可安装', 'Available');
}

function formatConnectionError(
  error: unknown,
  fallback: string,
  l: LocalizeCopy
): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'MCP_WRITE_CONFIRMATION_REQUIRED') {
      return l('需要确认修改全局 CODEX_HOME', 'Confirm changes to the global CODEX_HOME');
    }
    if (code === 'ENTERPRISE_MCP_TOKEN_NOT_FOUND') {
      return l('当前 Agent 尚未签发可用的 MCP Token', 'The current agent has not issued a valid MCP token');
    }
    if (code === 'ENTERPRISE_AGENT_FORBIDDEN') {
      return l('当前设备连接已停用', 'Connections are disabled on this device');
    }
    if (code === 'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE') {
      return l('系统安全凭据存储不可用，无法保存 MCP Token', 'Secure credential storage is unavailable, so the MCP token cannot be saved');
    }
    if (code === 'ENTERPRISE_SERVICE_UNAVAILABLE') {
      return l('连接服务暂时不可用', 'The connector service is temporarily unavailable');
    }
    if (
      code === 'ENTERPRISE_UNAUTHORIZED'
      || code === 'ENTERPRISE_SESSION_EXPIRED'
    ) {
      return l('连接服务暂时不可用', 'The connector service is temporarily unavailable');
    }
    if (code === 'ENTERPRISE_PROTOCOL_ERROR') {
      return l('连接服务返回了无法识别的数据', 'The connector service returned unrecognized data');
    }
  }
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}
