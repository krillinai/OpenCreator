import type {
  CodexMcpListResponse,
  CodexMcpServerResponse
} from '@opencreator/protocol';
import {
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
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import {
  McpEditor,
  type McpCapabilities,
  type McpSettingsService
} from '../settings/McpSettingsView.js';
import '../settings/settings-management.css';
import './connections.css';
import { IssueList } from '../issues/IssuePresenter.js';
import { usePageIssueState } from '../issues/page-issue-state.js';

type ConnectionFilter = 'all' | 'enabled' | 'disabled';

export type ConnectionsPageProps = {
  connected: boolean;
  mcpService: McpSettingsService | null;
  mcpData?: CodexMcpListResponse;
  mcpCapabilities?: McpCapabilities;
  onMcpDataChange?(data: CodexMcpListResponse): void;
};

export function ConnectionsPage(props: ConnectionsPageProps) {
  const l = useLocalizedCopy();
  const confirm = useConfirmDialog();
  const [data, setData] = useState(props.mcpData);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConnectionFilter>('all');
  const [busyKey, setBusyKey] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const pageIssues = usePageIssueState('connections');

  useEffect(() => {
    setData(props.mcpData);
  }, [props.mcpData]);

  useEffect(() => {
    if (!props.connected || props.mcpService === null) {
      setData(undefined);
      setLoading(false);
      setBusyKey(undefined);
      return;
    }
    let canceled = false;
    void loadConnections(() => canceled);
    return () => {
      canceled = true;
    };
  }, [props.connected, props.mcpService]);

  function updateData(next: CodexMcpListResponse) {
    setData(next);
    props.onMcpDataChange?.(next);
  }

  async function loadConnections(isCanceled: () => boolean = () => false) {
    if (props.mcpService === null) return;
    setLoading(true);
    try {
      const response = await props.mcpService.listServers();
      if (!isCanceled()) {
        updateData(response);
        pageIssues.resolveOperation('connections.load');
      }
    } catch (error) {
      if (!isCanceled()) {
        pageIssues.captureOperationFailure('connections.load', error, l('无法加载 MCP 连接，请重试。', 'Could not load MCP connections. Try again.'), { retryable: true });
      }
    } finally {
      if (!isCanceled()) setLoading(false);
    }
  }

  const connections = useMemo(
    () => [...(data?.servers ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [data?.servers]
  );
  const counts = useMemo(() => ({
    all: connections.length,
    enabled: connections.filter(item => item.enabled).length,
    disabled: connections.filter(item => !item.enabled).length
  }), [connections]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return connections.filter(item => (
      matchesFilter(item, filter)
      && (
        normalized.length === 0
        || [
          item.name,
          item.transport,
          mcpEndpoint(item)
        ].some(value => value.toLocaleLowerCase().includes(normalized))
      )
    ));
  }, [connections, filter, query]);

  async function confirmGlobalWrite(): Promise<boolean> {
    return data?.requiresWriteConfirmation !== true
      || confirm({
        title: l('确认修改全局配置', 'Confirm global configuration change'),
        description: l(
          '此操作会修改全局 CODEX_HOME，并影响使用同一配置目录的其他会话。',
          'This changes the global CODEX_HOME and may affect other sessions using it.'
        ),
        confirmLabel: l('继续', 'Continue')
      });
  }

  async function runAction(
    server: CodexMcpServerResponse,
    action: 'enable' | 'disable' | 'login' | 'logout' | 'remove'
  ) {
    if (
      props.mcpService === null
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
          `确认删除“${server.name}”？相关连接将立即停用。`,
          `Remove "${server.name}"? Its connection will be disabled immediately.`
        ),
        confirmLabel: l('删除', 'Remove'),
        destructive: true
      })
    ) {
      return;
    }
    if (action !== 'remove' && !await confirmGlobalWrite()) return;

    setBusyKey(server.name);
    try {
      const confirmed = data?.requiresWriteConfirmation === true;
      if (action === 'enable' || action === 'disable') {
        await props.mcpService.setServerEnabled(
          server.name,
          action === 'enable',
          confirmed
        );
      } else if (action === 'login') {
        await props.mcpService.loginServer(server.name, confirmed);
      } else if (action === 'logout') {
        await props.mcpService.logoutServer(server.name, confirmed);
      } else {
        await props.mcpService.removeServer(server.name, confirmed);
      }
      await loadConnections();
      pageIssues.resolveOperation('connections.action');
    } catch (error) {
      pageIssues.captureOperationFailure('connections.action', error, l('MCP 操作未完成，请重试。', 'The MCP operation did not complete. Try again.'));
    } finally {
      setBusyKey(undefined);
    }
  }

  if (!props.connected || props.mcpService === null) {
    return (
      <ConnectionsGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title={l('正在等待本地 Runtime', 'Waiting for the local runtime')}
        detail={l(
          '本地 MCP 暂不可用，本地项目和会话仍可继续使用。',
          'Local MCP servers are temporarily unavailable. Local projects remain available.'
        )}
      />
    );
  }

  return (
    <main className="connections-page">
      <div className="connections-page__inner">
        <header className="connections-header">
          <div>
            <h1>{l('MCP', 'MCP')}</h1>
            <p>{l(
              '管理当前 CODEX_HOME 中配置的本地 MCP 服务',
              'Manage MCP servers configured in the current CODEX_HOME'
            )}</p>
          </div>
          <div className="connections-header__actions">
            <label className="connections-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label={l('搜索 MCP', 'Search MCP servers')}
                onChange={event => setQuery(event.target.value)}
                placeholder={l('搜索名称或地址', 'Search names or endpoints')}
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
              aria-label={l('刷新 MCP', 'Refresh MCP servers')}
              title={l('刷新', 'Refresh')}
              disabled={loading}
              onClick={() => void loadConnections()}
            >
              <RefreshCw
                className={loading ? 'connections-spinner' : undefined}
                size={16}
                aria-hidden="true"
              />
            </button>
          </div>
        </header>

        <IssueList
          issues={pageIssues.issues}
          actions={{ retryOperations: { 'connections.load': () => loadConnections() } }}
          onDismiss={pageIssues.dismissIssue}
        />


        {editorOpen ? (
          <McpEditor
            capabilities={props.mcpCapabilities}
            requiresWriteConfirmation={data?.requiresWriteConfirmation === true}
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
                  ...(data?.requiresWriteConfirmation === true
                    ? { confirmWriteToCodexHome: true as const }
                    : {})
                });
                await loadConnections();
                pageIssues.resolveOperation('connections.save');
                setEditorOpen(false);
              } catch (error) {
                pageIssues.captureOperationFailure('connections.save', error, l('MCP 配置保存失败，请重试。', 'Could not save the MCP configuration. Try again.'));
              }
            }}
          />
        ) : null}

        <section className="connections-summary" aria-label={l('MCP 概览', 'MCP overview')}>
          <div>
            <Network size={18} aria-hidden="true" />
            <span><strong>{counts.all}</strong><small>{l('全部 MCP', 'All MCP')}</small></span>
          </div>
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <span><strong>{counts.enabled}</strong><small>{l('已开启', 'Enabled')}</small></span>
          </div>
          <div>
            <Server size={18} aria-hidden="true" />
            <span><strong>{counts.disabled}</strong><small>{l('已关闭', 'Disabled')}</small></span>
          </div>
        </section>

        <div className="connections-toolbar" role="group" aria-label={l('MCP 状态', 'MCP status')}>
          {([
            ['all', l('全部', 'All'), counts.all],
            ['enabled', l('已开启', 'Enabled'), counts.enabled],
            ['disabled', l('已关闭', 'Disabled'), counts.disabled]
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

        {loading && data === undefined ? (
          <div className="connections-empty">
            <LoaderCircle className="connections-spinner" size={22} aria-hidden="true" />
            <span>{l('正在加载 MCP', 'Loading MCP servers')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="connections-empty">
            {connections.length === 0
              ? l('当前没有 MCP', 'No MCP servers yet')
              : l('没有找到匹配的 MCP', 'No matching MCP servers')}
          </div>
        ) : (
          <section className="connections-grid" aria-label={l('MCP 列表', 'MCP servers')}>
            {filtered.map(server => (
              <ConnectionCard
                key={server.name}
                server={server}
                busy={busyKey === server.name}
                blocked={busyKey !== undefined}
                capabilities={props.mcpCapabilities}
                onAction={action => void runAction(server, action)}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function ConnectionCard(props: {
  server: CodexMcpServerResponse;
  busy: boolean;
  blocked: boolean;
  capabilities?: McpCapabilities;
  onAction(action: 'enable' | 'disable' | 'login' | 'logout' | 'remove'): void;
}) {
  const l = useLocalizedCopy();
  return (
    <article
      className="connection-card"
      data-testid="mcp-card"
      data-connection-key={`native:${props.server.name}`}
    >
      <div className="connection-card__head">
        <span className="connection-card__icon">
          <Server size={20} aria-hidden="true" />
        </span>
        <div>
          <h2>{props.server.name}</h2>
          <span>{props.server.name}</span>
        </div>
        <em data-status={props.server.enabled ? 'enabled' : 'installed'}>
          {props.server.enabled ? l('已开启', 'Enabled') : l('已关闭', 'Disabled')}
        </em>
      </div>

      <p className="connection-card__description">{mcpEndpoint(props.server)}</p>

      <div className="connection-card__meta">
        <span>{props.server.transport}</span>
        <span>{l('Codex 原生配置', 'Native Codex configuration')}</span>
      </div>

      <footer>
        <button
          className="connection-icon-action"
          type="button"
          aria-label={`${l('登录', 'Sign in to')} ${props.server.name}`}
          title={l('登录', 'Sign in')}
          disabled={props.blocked || props.capabilities?.mcpLogin !== true}
          onClick={() => props.onAction('login')}
        >
          <LogIn size={15} aria-hidden="true" />
        </button>
        <button
          className="connection-icon-action"
          type="button"
          aria-label={`${l('退出', 'Sign out of')} ${props.server.name}`}
          title={l('退出', 'Sign out')}
          disabled={props.blocked || props.capabilities?.mcpLogout !== true}
          onClick={() => props.onAction('logout')}
        >
          <LogOut size={15} aria-hidden="true" />
        </button>
        <button
          className="connection-icon-action connection-icon-action--danger"
          type="button"
          aria-label={`${l('删除', 'Remove')} ${props.server.name}`}
          title={l('删除', 'Remove')}
          disabled={props.blocked || props.capabilities?.mcpRemove !== true}
          onClick={() => props.onAction('remove')}
        >
          {props.busy
            ? <LoaderCircle className="connections-spinner" size={15} aria-hidden="true" />
            : <Trash2 size={15} aria-hidden="true" />}
        </button>
        <span className="connection-toggle-label">
          {props.server.enabled ? l('已开启', 'Enabled') : l('已关闭', 'Disabled')}
        </span>
        <button
          className="connection-switch"
          type="button"
          role="switch"
          aria-label={`${props.server.name} MCP`}
          aria-checked={props.server.enabled}
          disabled={props.blocked}
          onClick={() => props.onAction(props.server.enabled ? 'disable' : 'enable')}
        />
      </footer>
    </article>
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
  server: CodexMcpServerResponse,
  filter: ConnectionFilter
): boolean {
  if (filter === 'enabled') return server.enabled;
  if (filter === 'disabled') return !server.enabled;
  return true;
}
