import { useMemo, useState } from 'react';
import { ArrowLeft, Bot, ChevronRight, Search, Users } from 'lucide-react';
import type { AppRoute } from '../../app/routes.js';
import {
  employees,
  formatTokenUsage,
  organizationUsage,
  type ActivityRange,
  type TokenUsage
} from './activity-model.js';
import './activity.css';

type ActivityRoute = Extract<AppRoute, { view: 'activity' | 'activity-agent' }>;
type PrototypeRole = 'admin' | 'employee';

const rangeOptions: Array<{ value: ActivityRange; label: string }> = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' }
];

const trend = [42, 58, 49, 72, 64, 88, 79];

export function ActivityPage(props: {
  route: ActivityRoute;
  onNavigate(route: AppRoute): void;
}) {
  const [role, setRole] = useState<PrototypeRole>('admin');
  if (props.route.view === 'activity-agent') {
    return <AgentDetail route={props.route} onNavigate={props.onNavigate} />;
  }
  return (
    <main className="activity-page">
      <div className="activity-page__inner">
        <header className="activity-header">
          <div>
            <div className="activity-title-row">
              <h1>Agent 活动</h1>
              <span className="activity-static-label">静态原型</span>
              <span className="activity-partial-label">部分数据</span>
            </div>
            <p>团队 Agent 用量与执行概览</p>
          </div>
          <div className="activity-header__controls">
            <SegmentedControl
              label="原型视图"
              options={[{ value: 'admin', label: '管理员视图' }, { value: 'employee', label: '员工视图' }]}
              value={role}
              onChange={value => setRole(value as PrototypeRole)}
            />
            <RangeControl range={props.route.range} onChange={range => props.onNavigate({ view: 'activity', range })} />
          </div>
        </header>
        <div className="activity-partial-banner" role="status">
          当前展示静态采样数据，陈默的 Token 用量尚未上报。
        </div>
        {role === 'admin' ? (
          <AdminView range={props.route.range} onNavigate={props.onNavigate} />
        ) : (
          <EmployeeView range={props.route.range} onNavigate={props.onNavigate} />
        )}
      </div>
    </main>
  );
}

function AdminView(props: { range: ActivityRange; onNavigate(route: AppRoute): void }) {
  const [query, setQuery] = useState('');
  const filtered = employees.filter(employee => (
    `${employee.employeeName}${employee.team}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  return (
    <div className="activity-content">
      <MetricGrid metrics={[
        ['总 Token', formatTokenUsage(organizationUsage)], ['活跃员工', '12'],
        ['活跃 Agent', '31'], ['完成轮次', '684']
      ]} />
      <div className="activity-overview-grid">
        <TrendPanel title="Token 趋势" />
        <TokenBreakdown usage={organizationUsage} />
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

function EmployeeView(props: { range: ActivityRange; onNavigate(route: AppRoute): void }) {
  const mine = employees[0]!;
  return (
    <div className="activity-content">
      <MetricGrid metrics={[["我的 Token", formatTokenUsage(mine.usage)], ['活跃 Agent', '4'], ['完成轮次', '128']]} />
      <div className="activity-overview-grid activity-overview-grid--three">
        <TrendPanel title="我的 Token 趋势" />
        <Distribution title="模型分布" items={['gpt-5.3-codex 62%', 'gpt-5.2 24%', '其他 14%']} />
        <Distribution title="Agent 分布" items={['研究助理 48%', '代码审查 32%', '资料整理 20%']} />
      </div>
      <section className="activity-section">
        <div className="activity-section__header"><div><h2>最近轮次</h2><span>最近完成</span></div></div>
        <div className="activity-table-wrap"><table aria-label="最近轮次"><thead><tr><th>Agent</th><th>任务</th><th>模型</th><th>Token</th><th>时间</th><th /></tr></thead><tbody>
          <tr><td><strong>研究助理</strong></td><td>汇总竞品发布动态</td><td>gpt-5.3-codex</td><td>18,420</td><td>10:24</td><td><button className="activity-row-link" aria-label="查看研究助理详情" onClick={() => props.onNavigate({ view: 'activity-agent', collectorId: mine.collectorId, agentId: mine.representativeAgentId, range: props.range })}><ChevronRight size={16} /></button></td></tr>
          <tr><td><strong>代码审查</strong></td><td>检查工作区变更</td><td>gpt-5.3-codex</td><td>9,860</td><td>昨天</td><td><ChevronRight size={16} aria-hidden="true" /></td></tr>
        </tbody></table></div>
      </section>
    </div>
  );
}

function AgentDetail(props: { route: Extract<AppRoute, { view: 'activity-agent' }>; onNavigate(route: AppRoute): void }) {
  return <main className="activity-page"><div className="activity-page__inner">
    <header className="activity-detail-header">
      <button className="activity-icon-button" aria-label="返回 Agent 活动" onClick={() => props.onNavigate({ view: 'activity', range: props.route.range })}><ArrowLeft size={18} /></button>
      <div className="activity-agent-icon"><Bot size={20} /></div>
      <div><div className="activity-title-row"><h1>研究助理</h1><span className="activity-status">运行中</span><span className="activity-partial-label">部分数据</span></div><p>林夏 · collector-shanghai · ~/develop/market-research</p></div>
      <RangeControl range={props.route.range} onChange={range => props.onNavigate({ ...props.route, range })} />
    </header>
    <div className="activity-content">
      <MetricGrid metrics={[["总 Token", '184,620'], ['输入 Token', '142,300'], ['输出 Token', '42,320'], ['完成轮次', '36']]} />
      <TokenBreakdown usage={{ inputTokens: 142300, cachedInputTokens: 68700, outputTokens: 42320, reasoningOutputTokens: 19400 }} />
      <div className="activity-detail-grid">
        <section className="activity-section"><div className="activity-section__header"><div><h2>会话与轮次</h2><span>2 个会话 · 36 轮</span></div></div>
          <div className="activity-list"><article><div className="activity-list__meta"><strong>竞品周报研究</strong><span>今天 10:24</span></div><p><b>提示摘要</b> 对比本周主要竞品的产品更新与市场动作</p><p><b>回答摘要</b> 已整理 6 项发布动态，并标注对现有路线的影响</p></article><article><div className="activity-list__meta"><strong>用户访谈整理</strong><span>昨天 16:40</span></div><p><b>提示摘要</b> 提取访谈中的主要阻碍与需求信号</p><p><b>回答摘要</b> 已归纳 4 类主题和 12 条可执行结论</p></article></div>
        </section>
        <div className="activity-detail-side">
          <section className="activity-section"><div className="activity-section__header"><div><h2>活动记录</h2><span>已脱敏</span></div></div><ToolActivity name="WebSearch" type="工具调用" status="成功" time="10:22" duration="1.8 秒" icon="W" /><ToolActivity name="ReadFile" type="文件工具" status="成功" time="10:20" duration="0.3 秒" icon="F" /></section>
          <section className="activity-section"><div className="activity-section__header"><div><h2>子 Agent</h2><span>2 个</span></div></div><div className="activity-subagents"><p><Users size={15} /><strong>资料检索</strong><span>已完成 · 12 轮</span></p><p><Users size={15} /><strong>结论校验</strong><span>运行中 · 5 轮</span></p></div></section>
        </div>
      </div>
    </div>
  </div></main>;
}

function MetricGrid({ metrics }: { metrics: string[][] }) { return <div className="activity-metrics">{metrics.map(([label, value]) => <div className="activity-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>; }
function TrendPanel({ title }: { title: string }) { return <section className="activity-panel"><div className="activity-panel__heading"><h2>{title}</h2><span>每日</span></div><div className="activity-trend" aria-label={title}>{trend.map((value, index) => <i key={index} style={{ height: `${value}%` }} />)}</div><div className="activity-chart-labels"><span>周一</span><span>今天</span></div></section>; }
function Distribution({ title, items }: { title: string; items: string[] }) { return <section className="activity-panel"><div className="activity-panel__heading"><h2>{title}</h2></div><div className="activity-distribution">{items.map((item, index) => <p key={item}><i data-tone={index} /><span>{item}</span></p>)}</div></section>; }
function TokenBreakdown({ usage }: { usage: TokenUsage }) { const fields = [['输入 Token', usage.inputTokens], ['缓存输入', usage.cachedInputTokens], ['输出 Token', usage.outputTokens], ['推理输出', usage.reasoningOutputTokens]] as const; return <section className="activity-panel"><div className="activity-panel__heading"><h2>Token 构成</h2><span>缓存/推理为子集</span></div><div className="activity-breakdown">{fields.map(([label, value]) => <div key={label}><span>{label}</span><strong>{new Intl.NumberFormat('zh-CN').format(value)}</strong></div>)}</div></section>; }
function ToolActivity(props: { name: string; type: string; status: string; time: string; duration: string; icon: string }) { return <div className="activity-tool-row"><span className="activity-tool-icon">{props.icon}</span><div><strong>{props.name}</strong><div className="activity-tool-meta"><span>{props.type}</span><span>{props.status}</span><span>{props.time}</span><span>{props.duration}</span></div></div></div>; }
function RangeControl({ range, onChange }: { range: ActivityRange; onChange(range: ActivityRange): void }) { return <SegmentedControl label="时间范围" options={rangeOptions} value={range} onChange={value => onChange(value as ActivityRange)} />; }
function SegmentedControl(props: { label: string; options: Array<{ value: string; label: string }>; value: string; onChange(value: string): void }) { return <div className="activity-segmented" role="group" aria-label={props.label}>{props.options.map(option => <button key={option.value} type="button" aria-pressed={props.value === option.value} onClick={() => props.onChange(option.value)}>{option.label}</button>)}</div>; }
