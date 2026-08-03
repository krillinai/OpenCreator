import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, FileText, Search } from 'lucide-react';
import { knowledgeCategories, knowledgeDocuments, queryKnowledgeDocuments, type KnowledgeDocument, type KnowledgeFilter } from './knowledge-model.js';
import './knowledge.css';

const categoryLabels = Object.fromEntries(knowledgeCategories.map(item => [item.id, item.label]));
const visibilityLabels = { all_employees: '全体员工', department: '部门可见', restricted: '指定成员' } as const;
const statusLabels = { synced: '已同步', stale: '待更新', processing: '同步中' } as const;

export function KnowledgePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<KnowledgeFilter>('all');
  const filtered = useMemo(() => queryKnowledgeDocuments(knowledgeDocuments, query, category), [query, category]);
  const [selectedId, setSelectedId] = useState(knowledgeDocuments[0]!.id);
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0];
  useEffect(() => { if (selected !== undefined && selected.id !== selectedId) setSelectedId(selected.id); }, [selected, selectedId]);
  const spaces = new Set(knowledgeDocuments.map(item => item.spaceId)).size;
  const sources = new Set(knowledgeDocuments.map(item => item.source.type)).size;
  const stale = knowledgeDocuments.filter(item => item.syncStatus !== 'synced').length;

  return <main className="knowledge-page"><div className="knowledge-page__inner">
    <header className="knowledge-header">
      <div><div className="knowledge-title-row"><h1>企业知识库</h1><span>静态示例</span></div><p>统一查看企业制度、产品资料、客户经验与研发文档</p></div>
      <label className="knowledge-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索企业知识库" placeholder="搜索标题、空间或标签" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </header>
    <div className="knowledge-notice" role="note">静态示例数据，未连接企业知识服务</div>
    <section className="knowledge-metrics" aria-label="知识库概览">
      {[['知识条目', knowledgeDocuments.length], ['知识空间', spaces], ['连接来源', sources], ['待更新', stale]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </section>
    <div className="knowledge-toolbar"><div className="knowledge-tabs" role="group" aria-label="知识分类">{knowledgeCategories.map(item => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div><span>{filtered.length} 条结果</span></div>
    {filtered.length === 0 ? <section className="knowledge-empty"><BookOpen size={24} aria-hidden="true" /><h2>没有匹配的知识条目</h2><p>尝试更换关键词或知识分类。</p></section> : <div className="knowledge-workbench">
      <section className="knowledge-list-panel"><div className="knowledge-panel-heading"><h2>知识文档</h2><span>按更新时间排序</span></div><ul className="knowledge-list" aria-label="知识文档">{filtered.map(item => <li key={item.id}><button type="button" data-selected={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><FileText size={17} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.spaceName} · {item.source.label} · {formatDate(item.updatedAt)}</small></span><em data-status={item.syncStatus}>{statusLabels[item.syncStatus]}</em><ChevronRight size={16} aria-hidden="true" /></button></li>)}</ul></section>
      {selected === undefined ? null : <KnowledgeDetail document={selected} />}
    </div>}
  </div></main>;
}

function KnowledgeDetail({ document }: { document: KnowledgeDocument }) {
  return <article className="knowledge-detail">
    <div className="knowledge-detail__heading"><div><span>{categoryLabels[document.category]}</span><h2>{document.title}</h2><p>{document.summary}</p></div><span data-status={document.syncStatus}>{statusLabels[document.syncStatus]}</span></div>
    <dl><div><dt>知识空间</dt><dd>{document.spaceName}</dd></div><div><dt>来源</dt><dd>{document.source.label}</dd></div><div><dt>所有者</dt><dd>{document.owner.name} · {document.owner.department}</dd></div><div><dt>可见范围</dt><dd>{visibilityLabels[document.visibility]}</dd></div><div><dt>更新时间</dt><dd>{formatDate(document.updatedAt)}</dd></div></dl>
    <section><h3>内容节选</h3><p>{document.excerpt}</p></section>
    <div className="knowledge-tags" aria-label="标签">{document.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
    <small>静态示例详情，不代表实时权限或同步状态</small>
  </article>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
