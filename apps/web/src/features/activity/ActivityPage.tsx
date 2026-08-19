import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Bot,
  ChevronRight,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users
} from 'lucide-react';
import type { AppRoute } from '../../app/routes.js';
import {
  createActivityChatAnswer,
  getActivityChatSuggestions,
  getActivityRangeLabel
} from './activity-chat-model.js';
import {
  activitySnapshots,
  findAgentFixture,
  formatTokenUsage,
  type ActivitySnapshot,
  type ActivityRange,
  type TokenUsage
} from './activity-model.js';
import './activity.css';

type ActivityRoute = Extract<AppRoute, { view: 'activity' | 'activity-agent' }>;
type ActivityMode = 'overview' | 'conversation';

type ActivityChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  evidence?: string[];
};

const rangeOptions: Array<{ value: ActivityRange; label: string }> = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' }
];

export function ActivityPage(props: {
  route: ActivityRoute;
  onNavigate(route: AppRoute): void;
}) {
  const [mode, setMode] = useState<ActivityMode>('overview');
  if (props.route.view === 'activity-agent') {
    return <AgentDetail route={props.route} onNavigate={props.onNavigate} />;
  }
  return (
    <main className="activity-page">
      <div className="activity-page__inner">
        <header className="activity-header">
          <div>
            <div className="activity-title-row">
              <h1>Agent动态</h1>
              <span className="activity-static-label">静态原型</span>
              <span className="activity-partial-label">部分数据</span>
            </div>
            <p>{mode === 'conversation' ? '通过对话分析 Agent 用量与执行情况' : '团队 Agent 用量与执行概览'}</p>
          </div>
          <div className="activity-header__controls">
            <button
              className="activity-conversation-toggle"
              type="button"
              aria-pressed={mode === 'conversation'}
              onClick={() => setMode(current => current === 'overview' ? 'conversation' : 'overview')}
            >
              {mode === 'conversation' ? <BarChart3 size={15} aria-hidden="true" /> : <MessageSquareText size={15} aria-hidden="true" />}
              {mode === 'conversation' ? '返回数据视图' : '对话分析'}
            </button>
            <RangeControl range={props.route.range} onChange={range => props.onNavigate({ view: 'activity', range })} />
          </div>
        </header>
        <div className="activity-partial-banner" role="status">
          当前展示静态采样数据；管理员汇总中，陈默的聚合 Token 用量尚未上报。
        </div>
        {mode === 'conversation' ? (
          <ActivityConversation key={props.route.range} range={props.route.range} />
        ) : (
          <AdminView range={props.route.range} onNavigate={props.onNavigate} />
        )}
      </div>
    </main>
  );
}

function ActivityConversation(props: { range: ActivityRange }) {
  const nextMessageId = useRef(0);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ActivityChatMessage[]>(() => [
    createActivityWelcome(props.range)
  ]);
  const suggestions = getActivityChatSuggestions('admin');
  const rangeLabel = getActivityRangeLabel(props.range);
  const scopes = ['组织 Token 汇总', '员工用量', 'Skill 使用', 'MCP 使用', 'Agent 执行'];

  function sendQuestion(value: string) {
    const question = value.trim();
    if (question.length === 0) return;
    const answer = createActivityChatAnswer('admin', props.range, question);
    const id = `admin-${props.range}-${nextMessageId.current++}`;
    setMessages(current => [
      ...current,
      { id: `${id}-user`, role: 'user', text: question },
      { id: `${id}-assistant`, role: 'assistant', text: answer.text, evidence: answer.evidence }
    ]);
    setDraft('');
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendQuestion(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    sendQuestion(draft);
  }

  return (
    <div className="activity-conversation-dashboard">
      <section className="activity-conversation" aria-label="Agent动态对话">
        <div className="activity-conversation__body" role="log" aria-live="polite">
          <div className="activity-conversation__intro">
            <span><Sparkles size={15} aria-hidden="true" />按当前范围提问</span>
            <div className="activity-conversation__suggestions">
              {suggestions.map(suggestion => (
                <button key={suggestion} type="button" onClick={() => sendQuestion(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
          <div className="activity-conversation__messages">
            {messages.map(message => (
              <article className="activity-conversation-message" data-role={message.role} key={message.id}>
                <span className="activity-conversation-message__avatar" aria-hidden="true">
                  {message.role === 'assistant' ? <Bot size={17} /> : <UserRound size={16} />}
                </span>
                <div className="activity-conversation-message__content">
                  <strong>{message.role === 'assistant' ? '活动助手' : '管理员'}</strong>
                  <p>{message.text}</p>
                  {message.evidence && message.evidence.length > 0 ? (
                    <div className="activity-conversation-evidence" aria-label="回答依据">
                      {message.evidence.map(item => <span key={item}>{item}</span>)}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
        <form className="activity-conversation-composer" onSubmit={submitQuestion}>
          <textarea
            aria-label="询问 Agent动态"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="询问 Token、Skill、MCP 或 Agent 执行情况"
            rows={2}
            value={draft}
          />
          <button type="submit" aria-label="发送" disabled={draft.trim().length === 0} title="发送">
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </form>
      </section>
      <aside className="activity-conversation-context" aria-label="当前分析范围">
        <header>
          <span aria-hidden="true"><ShieldCheck size={18} /></span>
          <div><strong>管理员视图</strong><small>{rangeLabel} · 静态采样</small></div>
        </header>
        <div className="activity-conversation-context__status">回答已按当前身份过滤</div>
        <div className="activity-conversation-context__heading"><h2>可分析数据</h2><span>{scopes.length} 类</span></div>
        <ul>{scopes.map(scope => <li key={scope}>{scope}</li>)}</ul>
        <p>可分析组织汇总和员工用量。</p>
      </aside>
    </div>
  );
}

function createActivityWelcome(range: ActivityRange): ActivityChatMessage {
  const rangeLabel = getActivityRangeLabel(range);
  return {
    id: `welcome-admin-${range}`,
    role: 'assistant',
    text: `${rangeLabel}组织活动数据已准备好。你可以询问 Token、员工用量、Skill、MCP 和 Agent 执行情况。`
  };
}

function AdminView(props: { range: ActivityRange; onNavigate(route: AppRoute): void }) {
  const [query, setQuery] = useState('');
  const snapshot = activitySnapshots[props.range];
  const filtered = snapshot.employees.filter(employee => (
    `${employee.employeeName}${employee.team}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  return (
    <div className="activity-content">
      <MetricGrid metrics={[
        ['总 Token', formatTokenUsage(snapshot.organization.usage)],
        ['活跃员工', String(snapshot.organization.activeEmployees)],
        ['活跃 Agent', String(snapshot.organization.activeAgents)],
        ['完成轮次', String(snapshot.organization.completedTurns)]
      ]} />
      <div className="activity-overview-grid">
        <TrendPanel title="Token 趋势" trend={snapshot.trend} />
        <TokenBreakdown usage={snapshot.organization.usage} />
      </div>
      <div className="activity-usage-grid">
        <UsageDistribution title="Skill 使用分布" items={snapshot.organization.skillDistribution} />
        <UsageDistribution title="MCP 使用分布" items={snapshot.organization.mcpDistribution} />
      </div>
      <section className="activity-section">
        <div className="activity-section__header">
          <div><h2>员工用量</h2><span>{filtered.length} 位员工</span></div>
          <label className="activity-search">
            <Search size={15} aria-hidden="true" />
            <input aria-label="搜索员工" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索员工或团队" />
          </label>
        </div>
        <div className="activity-table-wrap">
          <table aria-label="员工用量">
            <thead><tr><th>员工</th><th>团队</th><th>Token</th><th>活跃 Agent</th><th>完成轮次</th><th /></tr></thead>
            <tbody>{filtered.map(employee => (
              <tr key={employee.employeeId}>
                <td><strong>{employee.employeeName}</strong></td><td>{employee.team}</td>
                <td data-missing={employee.usage === undefined}>{formatTokenUsage(employee.usage)}</td>
                <td>{employee.activeAgents}</td><td>{employee.completedTurns}</td>
                <td><button className="activity-row-link" aria-label={`查看${employee.employeeName}的 Agent`} onClick={() => props.onNavigate({ view: 'activity-agent', collectorId: employee.collectorId, agentId: employee.representativeAgentId, range: props.range })}><ChevronRight size={16} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AgentDetail(props: { route: Extract<AppRoute, { view: 'activity-agent' }>; onNavigate(route: AppRoute): void }) {
  const detail = findAgentFixture(props.route.range, props.route.collectorId, props.route.agentId);
  if (detail === undefined) {
    return <main className="activity-page"><div className="activity-page__inner"><StaticDataNotice /><section className="activity-empty-state"><Bot size={24} aria-hidden="true" /><h1>未找到 Agent</h1><p>当前静态样例中没有匹配的 Agent 记录。</p><button className="activity-back-button" onClick={() => props.onNavigate({ view: 'activity', range: props.route.range })}><ArrowLeft size={16} />返回 Agent动态</button></section></div></main>;
  }
  return <main className="activity-page"><div className="activity-page__inner">
    <StaticDataNotice />
    <header className="activity-detail-header">
      <button className="activity-icon-button" aria-label="返回 Agent动态" onClick={() => props.onNavigate({ view: 'activity', range: props.route.range })}><ArrowLeft size={18} /></button>
      <div className="activity-agent-icon"><Bot size={20} aria-hidden="true" /></div>
      <div><div className="activity-title-row"><h1>{detail.name}</h1><span className="activity-status">{detail.status}</span><span className="activity-partial-label">部分数据</span></div><p>{detail.employeeName} · {detail.collectorId} · {detail.workspace}</p></div>
      <RangeControl range={props.route.range} onChange={range => props.onNavigate({ ...props.route, range })} />
    </header>
    <div className="activity-content">
      <MetricGrid metrics={[["总 Token", formatTokenUsage(detail.usage)], ['输入 Token', formatNumber(detail.usage.inputTokens)], ['输出 Token', formatNumber(detail.usage.outputTokens)], ['完成轮次', String(detail.completedTurns)]]} />
      <TokenBreakdown usage={detail.usage} />
      <div className="activity-detail-grid">
        <section className="activity-section"><div className="activity-section__header"><div><h2>会话与轮次</h2><span>{detail.sessionCount} 个会话 · {detail.completedTurns} 轮</span></div></div>
          <div className="activity-list"><article><div className="activity-list__meta"><strong>{detail.sessionTitle}</strong><span>最近更新</span></div><p><b>提示摘要</b> {detail.promptSummary}</p><p><b>回答摘要</b> {detail.assistantSummary}</p></article></div>
        </section>
        <div className="activity-detail-side">
          <section className="activity-section"><div className="activity-section__header"><div><h2>活动记录</h2><span>已脱敏</span></div></div><ToolActivity activity={detail.toolActivity} /></section>
          <section className="activity-section"><div className="activity-section__header"><div><h2>子 Agent</h2><span>{detail.subagents.length} 个</span></div></div><div className="activity-subagents">{detail.subagents.map(item => <p key={item.id}><Users size={15} aria-hidden="true" /><strong>{item.name}</strong><span>{item.status === 'completed' ? '已完成' : '运行中'} · {item.completedTurns} 轮</span></p>)}</div></section>
        </div>
      </div>
    </div>
  </div></main>;
}

function MetricGrid({ metrics }: { metrics: string[][] }) { return <div className={`activity-metrics activity-metrics--${metrics.length}`}>{metrics.map(([label, value]) => <div className="activity-metric" key={label}><span>{label}</span><strong data-testid={label === '总 Token' ? 'total-tokens' : undefined}>{value}</strong></div>)}</div>; }
function TrendPanel({ title, trend }: { title: string; trend: ActivitySnapshot['trend'] }) { const totals = trend.points.map(point => calculateTotal(point.usage)); const max = Math.max(...totals, 1); return <section className="activity-panel"><div className="activity-panel__heading"><h2>{title}</h2><span>{trend.granularity}</span></div><div className="activity-trend" aria-label={title} data-granularity={trend.granularity}>{trend.points.map((point, index) => <i key={point.label} role="img" aria-label={`${point.label} ${formatTokenUsage(point.usage)} Token`} title={`${point.label} · ${formatTokenUsage(point.usage)} Token`} style={{ height: `${Math.max(4, totals[index]! / max * 100)}%` }} />)}</div><div className="activity-chart-labels"><span>{trend.startLabel}</span><span>{trend.endLabel}</span></div></section>; }
function UsageDistribution({ title, items }: { title: string; items: ActivitySnapshot['organization']['skillDistribution'] }) { return <section className="activity-panel"><div className="activity-panel__heading"><h2>{title}</h2><span>{items.reduce((total, item) => total + item.invocationCount, 0)} 次调用</span></div><div className="activity-distribution activity-distribution--usage">{items.map((item, index) => <p key={item.id}><i data-tone={index} /><span>{item.label}</span><strong>{item.invocationCount} 次 · {new Intl.NumberFormat('zh-CN', { style: 'percent' }).format(item.share)}</strong></p>)}</div></section>; }
function TokenBreakdown({ usage }: { usage: TokenUsage }) { const fields = [['输入 Token', usage.inputTokens], ['缓存输入', usage.cachedInputTokens], ['输出 Token', usage.outputTokens], ['推理输出', usage.reasoningOutputTokens]] as const; return <section className="activity-panel"><div className="activity-panel__heading"><h2>Token 构成</h2><span>缓存/推理为子集</span></div><div className="activity-breakdown">{fields.map(([label, value]) => <div key={label}><span>{label}</span><strong>{new Intl.NumberFormat('zh-CN').format(value)}</strong></div>)}</div></section>; }
function ToolActivity({ activity }: { activity: ActivitySnapshot['agents'][number]['toolActivity'] }) { return <div className="activity-tool-row"><span className="activity-tool-icon">T</span><div><strong>{activity.name}</strong><div className="activity-tool-meta"><span>工具调用</span><span>{activity.status === 'success' ? '成功' : '失败'}</span><span>{new Date(activity.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>{activity.durationMs === undefined ? null : <span>{(activity.durationMs / 1_000).toFixed(1)} 秒</span>}</div></div></div>; }
function RangeControl({ range, onChange }: { range: ActivityRange; onChange(range: ActivityRange): void }) { return <SegmentedControl label="时间范围" options={rangeOptions} value={range} onChange={value => onChange(value as ActivityRange)} />; }
function SegmentedControl(props: { label: string; options: Array<{ value: string; label: string }>; value: string; onChange(value: string): void }) { return <div className="activity-segmented" role="group" aria-label={props.label}>{props.options.map(option => <button key={option.value} type="button" aria-pressed={props.value === option.value} onClick={() => props.onChange(option.value)}>{option.label}</button>)}</div>; }
function StaticDataNotice() { return <div className="activity-static-notice" role="note">静态示例数据，非实时遥测</div>; }
function formatNumber(value: number) { return new Intl.NumberFormat('zh-CN').format(value); }
function calculateTotal(usage: TokenUsage) { return usage.inputTokens + usage.outputTokens; }
