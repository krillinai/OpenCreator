import type {
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
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  WifiOff
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  onOpenAccount(): void;
  onRefreshSession(): Promise<EnterpriseSessionResponse>;
  onSessionExpired(): void;
};

export function ConnectionsPage(props: ConnectionsPageProps) {
  const [catalog, setCatalog] = useState<EnterpriseMcpCatalogResponse>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConnectionFilter>('all');
  const [mutatingUpstreamId, setMutatingUpstreamId] = useState<string>();

  useEffect(() => {
    if (
      !props.connected
      || props.session.status !== 'signed_in'
      || props.service === null
    ) {
      setCatalog(undefined);
      setLoading(false);
      setLoadError(undefined);
      setMutatingUpstreamId(undefined);
      return;
    }

    let canceled = false;
    setLoading(true);
    setLoadError(undefined);
    void props.service.listMcpConnections()
      .then(response => {
        if (!canceled) setCatalog(response);
      })
      .catch(error => {
        if (canceled) return;
        if (isUnauthorized(error)) props.onSessionExpired();
        setLoadError(formatConnectionError(error));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    props.connected,
    props.onSessionExpired,
    props.service,
    props.session.status
  ]);

  const upstreams = catalog?.upstreams ?? [];
  const counts = useMemo(() => ({
    all: upstreams.length,
    enabled: upstreams.filter(item => item.enabled).length,
    installed: upstreams.filter(item => item.installed).length,
    available: upstreams.filter(item => !item.installed).length
  }), [upstreams]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return upstreams.filter(item => (
      matchesFilter(item, filter)
      && (
        normalized.length === 0
        || [
          item.name,
          item.domain,
          item.namespace,
          ...item.tools.flatMap(tool => [
            tool.title,
            tool.description,
            tool.name
          ])
        ].some(value => value.toLocaleLowerCase().includes(normalized))
      )
    ));
  }, [filter, query, upstreams]);

  async function refresh() {
    if (props.service === null || loading) return;
    setLoading(true);
    setLoadError(undefined);
    try {
      setCatalog(await props.service.refreshMcpConnections());
    } catch (error) {
      if (isUnauthorized(error)) props.onSessionExpired();
      setLoadError(formatConnectionError(error));
    } finally {
      setLoading(false);
    }
  }

  async function updatePreference(
    upstream: EnterpriseMcpUpstreamResponse,
    update: EnterpriseMcpPreferenceUpdateRequest
  ) {
    if (props.service === null || mutatingUpstreamId !== undefined) return;
    setMutatingUpstreamId(upstream.upstreamId);
    setLoadError(undefined);
    try {
      setCatalog(await props.service.updateMcpPreference(
        upstream.upstreamId,
        update
      ));
    } catch (error) {
      if (isUnauthorized(error)) props.onSessionExpired();
      setLoadError(formatConnectionError(error));
    } finally {
      setMutatingUpstreamId(undefined);
    }
  }

  if (!props.connected) {
    return (
      <ConnectionsGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title="正在等待本地 Runtime"
        detail="连接器暂不可用，本地项目和会话仍可继续使用。"
      />
    );
  }
  if (props.session.status === 'checking') {
    return (
      <ConnectionsGate
        icon={<LoaderCircle className="connections-spinner" size={22} aria-hidden="true" />}
        title="正在验证企业会话"
        detail="验证完成后会自动加载企业 MCP 目录。"
      />
    );
  }
  if (props.session.status === 'service_unavailable') {
    return (
      <ConnectionsGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title="企业连接服务暂时不可用"
        detail="服务恢复后可重新加载，不影响本地项目和任务。"
        actionLabel="重新加载"
        onAction={() => void props.onRefreshSession()}
      />
    );
  }
  if (props.session.status !== 'signed_in') {
    return (
      <ConnectionsGate
        icon={<LogIn size={22} aria-hidden="true" />}
        title="登录后管理连接器"
        detail="企业授权由 Gateway 管理，这里只保存当前用户的安装和开启偏好。"
        actionLabel="登录企业账户"
        onAction={props.onOpenAccount}
      />
    );
  }

  return (
    <main className="connections-page">
      <div className="connections-page__inner">
        <header className="connections-header">
          <div>
            <h1>连接器</h1>
            <p>安装并开启当前用户需要使用的企业 MCP</p>
          </div>
          <div className="connections-header__actions">
            <label className="connections-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="搜索连接器"
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索系统或工具"
                type="search"
                value={query}
              />
            </label>
            <button
              className="connections-icon-button"
              type="button"
              aria-label="刷新连接器"
              title="刷新"
              disabled={loading}
              onClick={() => void refresh()}
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
            当前 Agent 尚未签发可用的 MCP Token。安装和开启偏好会保留，但运行时暂时无法连接企业 MCP。
          </div>
        ) : null}
        {loadError !== undefined ? (
          <div className="connections-banner connections-banner--error" role="alert">
            {loadError}
          </div>
        ) : null}

        <section className="connections-summary" aria-label="连接概览">
          <div>
            <Network size={18} aria-hidden="true" />
            <span><strong>{counts.all}</strong><small>企业 MCP</small></span>
          </div>
          <div>
            <Download size={18} aria-hidden="true" />
            <span>
              <strong>{counts.installed}</strong>
              <small>已安装</small>
            </span>
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

        {loading && catalog === undefined ? (
          <div className="connections-empty">
            <LoaderCircle className="connections-spinner" size={22} aria-hidden="true" />
            <span>正在加载企业 MCP</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="connections-empty">
            {upstreams.length === 0 ? '企业目录中暂无 MCP' : '没有找到匹配的系统'}
          </div>
        ) : (
          <section className="connections-grid" aria-label="连接器目录">
            {filtered.map(upstream => (
              <ConnectionCard
                key={upstream.upstreamId}
                upstream={upstream}
                busy={mutatingUpstreamId === upstream.upstreamId}
                blocked={mutatingUpstreamId !== undefined}
                onUpdate={update => void updatePreference(upstream, update)}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function ConnectionCard(props: {
  upstream: EnterpriseMcpUpstreamResponse;
  busy: boolean;
  blocked: boolean;
  onUpdate(update: EnterpriseMcpPreferenceUpdateRequest): void;
}) {
  const description = props.upstream.tools.find(tool => (
    tool.authorized && tool.description.trim().length > 0
  ))?.description
    ?? props.upstream.tools.find(tool => tool.description.trim().length > 0)?.description
    ?? '企业连接器';
  return (
    <article
      className="connection-card"
      data-testid="enterprise-mcp-card"
      data-upstream-id={props.upstream.upstreamId}
    >
      <div className="connection-card__head">
        <span className="connection-card__icon">
          <Cable size={20} aria-hidden="true" />
        </span>
        <div>
          <h2>{props.upstream.name}</h2>
          <span>{props.upstream.domain || props.upstream.namespace}</span>
        </div>
        {props.upstream.installed ? (
          <button
            className="connection-switch"
            type="button"
            role="switch"
            aria-label={`${props.upstream.name} MCP`}
            aria-checked={props.upstream.enabled}
            disabled={props.blocked}
            onClick={() => props.onUpdate({
              enabled: !props.upstream.enabled
            })}
          />
        ) : (
          <button
            className="connection-install"
            type="button"
            disabled={props.blocked}
            onClick={() => props.onUpdate({
              installed: true,
              enabled: false
            })}
          >
            {props.busy ? (
              <LoaderCircle className="connections-spinner" size={15} aria-hidden="true" />
            ) : (
              <Download size={15} aria-hidden="true" />
            )}
            安装
          </button>
        )}
      </div>

      <p className="connection-card__description">{description}</p>
      {props.upstream.status === 'active' ? null : (
        <em className="connection-card__status">服务停用</em>
      )}
    </article>
  );
}

function ConnectionsGate(props: {
  icon: ReactNode;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="connections-page connections-gate">
      <div className="connections-gate__icon">{props.icon}</div>
      <h1>{props.title}</h1>
      <p>{props.detail}</p>
      {props.actionLabel !== undefined && props.onAction !== undefined ? (
        <button type="button" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
    </main>
  );
}

function matchesFilter(
  item: EnterpriseMcpUpstreamResponse,
  filter: ConnectionFilter
): boolean {
  if (filter === 'enabled') return item.enabled;
  if (filter === 'installed') return item.installed;
  if (filter === 'available') return !item.installed;
  return true;
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 401
    || candidate.code === 'ENTERPRISE_UNAUTHORIZED'
    || candidate.code === 'ENTERPRISE_SESSION_EXPIRED';
}

function formatConnectionError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
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
    : '连接器操作失败';
}
