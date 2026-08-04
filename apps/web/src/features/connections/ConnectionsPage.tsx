import { useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  Check,
  Cloud,
  Database,
  Megaphone,
  Music2,
  Search,
  Send,
  ShieldCheck,
  TrendingUp
} from 'lucide-react';
import './connections.css';

type ConnectionStatus = 'available' | 'requestable';

type EnterpriseConnection = {
  id: string;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  scope: string;
  status: ConnectionStatus;
  icon: typeof Database;
  color: string;
};

const connections: EnterpriseConnection[] = [
  { id: 'feishu', name: '飞书', category: '协同办公', description: '读取文档、日历与组织通讯录', capabilities: ['文档检索', '日程查询'], scope: '当前用户可见范围', status: 'available', icon: Send, color: '#3370ff' },
  { id: 'xiaohongshu', name: '小红书', category: '内容平台', description: '查询账号、笔记与互动表现数据', capabilities: ['笔记检索', '互动分析'], scope: '已授权品牌账号', status: 'available', icon: BookOpen, color: '#ff2442' },
  { id: 'douyin', name: '抖音', category: '内容平台', description: '查询账号、视频与评论表现数据', capabilities: ['视频检索', '内容分析'], scope: '已授权企业账号', status: 'available', icon: Music2, color: '#19d7d2' },
  { id: 'ocean-engine', name: '巨量引擎', category: '广告投放', description: '查看广告计划、素材与转化数据', capabilities: ['投放分析', '转化归因'], scope: '需广告账户管理员审批', status: 'requestable', icon: Megaphone, color: '#2f88ff' },
  { id: 'qichacha', name: '企查查', category: '企业信息', description: '查询企业工商、股东与风险信息', capabilities: ['企业查询', '风险核验'], scope: '需企业数据权限', status: 'requestable', icon: Building2, color: '#1478ff' },
  { id: 'chanmama', name: '蝉妈妈', category: '电商分析', description: '查看达人、商品与直播电商榜单', capabilities: ['达人分析', '商品洞察'], scope: '需数据服务权限', status: 'requestable', icon: TrendingUp, color: '#ff6b35' }
];

export function ConnectionsPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | ConnectionStatus>('all');
  const [requested, setRequested] = useState<Set<string>>(() => new Set());
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return connections.filter(item => (
      (filter === 'all' || item.status === filter)
      && (normalized.length === 0 || [item.name, item.category, item.description, ...item.capabilities]
        .some(value => value.toLocaleLowerCase().includes(normalized)))
    ));
  }, [filter, query]);
  const availableCount = connections.filter(item => item.status === 'available').length;
  const requestableCount = connections.length - availableCount;

  return (
    <main className="connections-page">
      <div className="connections-page__inner">
        <header className="connections-header">
          <div><h1>系统连接</h1><p>查看已接入的业务平台与当前权限</p></div>
          <label className="connections-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索系统连接" onChange={event => setQuery(event.target.value)} placeholder="搜索系统或能力" type="search" value={query} /></label>
        </header>

        <section className="connections-summary" aria-label="连接概览">
          <div><Cloud size={18} aria-hidden="true" /><span><strong>{connections.length}</strong><small>已接入系统</small></span></div>
          <div><ShieldCheck size={18} aria-hidden="true" /><span><strong>{availableCount}</strong><small>已开通</small></span></div>
          <div><Database size={18} aria-hidden="true" /><span><strong>{requestableCount}</strong><small>可申请</small></span></div>
        </section>

        <div className="connections-toolbar" role="group" aria-label="权限状态">
          {([['all', '全部', connections.length], ['available', '已开通', availableCount], ['requestable', '可申请', requestableCount]] as const).map(([id, label, count]) => (
            <button aria-pressed={filter === id} key={id} onClick={() => setFilter(id)} type="button"><span>{label}</span><b>{count}</b></button>
          ))}
        </div>

        {filtered.length === 0 ? <div className="connections-empty">没有找到匹配的系统</div> : (
          <section className="connections-grid" aria-label="系统连接目录">
            {filtered.map(item => {
              const Icon = item.icon;
              const submitted = requested.has(item.id);
              return <article className="connection-card" key={item.id}>
                <div className="connection-card__head"><span className="connection-card__icon" style={{ '--connection-color': item.color } as React.CSSProperties}><Icon size={21} aria-hidden="true" /></span><div><h2>{item.name}</h2><span>{item.category}</span></div><em data-status={item.status}>{item.status === 'available' ? '已开通' : '可申请'}</em></div>
                <p>{item.description}</p>
                <div className="connection-card__capabilities">{item.capabilities.map(capability => <span key={capability}>{capability}</span>)}</div>
                <footer><small>{item.scope}</small>{item.status === 'available' ? <button className="is-ready" type="button"><Check size={14} aria-hidden="true" />可使用</button> : <button disabled={submitted} onClick={() => setRequested(current => new Set(current).add(item.id))} type="button">{submitted ? <><Check size={14} aria-hidden="true" />申请已提交</> : '申请权限'}</button>}</footer>
              </article>;
            })}
          </section>
        )}
      </div>
    </main>
  );
}
