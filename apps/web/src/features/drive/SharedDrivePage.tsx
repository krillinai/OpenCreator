import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, Folder, Image, Search, Users } from 'lucide-react';
import './shared-drive.css';

const spaces = [
  { id: 'all', name: '全部文件', access: 'both' },
  { id: 'brand', name: '品牌与市场', access: 'team' },
  { id: 'sales', name: '销售管理', access: 'team' },
  { id: 'channel', name: '渠道运营', access: 'team' },
  { id: 'public', name: '公共资料', access: 'enterprise' },
  { id: 'policy', name: '企业制度', access: 'enterprise' }
] as const;

const files = [
  { id: '1', access: 'team', space: 'brand', name: '2026 夏季品牌活动方案.pptx', owner: '林晓雨', updated: '8月3日 10:24', size: '18.6 MB', type: 'slides' },
  { id: '2', access: 'team', space: 'brand', name: 'KrillinAI 品牌视觉规范 2026.pdf', owner: '品牌中心', updated: '8月2日 16:08', size: '24.2 MB', type: 'document' },
  { id: '3', access: 'team', space: 'sales', name: '重点客户跟进清单.xlsx', owner: '小林', updated: '8月2日 09:40', size: '1.8 MB', type: 'sheet' },
  { id: '4', access: 'team', space: 'channel', name: 'Q3 渠道投放与 ROI 复盘.xlsx', owner: '数字营销组', updated: '8月1日 18:32', size: '3.4 MB', type: 'sheet' },
  { id: '5', access: 'enterprise', space: 'public', name: '新员工快速入门手册.pdf', owner: '人力资源部', updated: '7月30日 14:15', size: '6.7 MB', type: 'document' },
  { id: '6', access: 'enterprise', space: 'public', name: '企业常用素材', owner: '品牌中心', updated: '7月29日 11:06', size: '32 项', type: 'folder' },
  { id: '7', access: 'team', space: 'brand', name: '产品主视觉图库', owner: '创意设计组', updated: '7月28日 17:42', size: '86 项', type: 'image' },
  { id: '8', access: 'enterprise', space: 'policy', name: '企业信息安全管理制度.pdf', owner: '信息安全部', updated: '7月26日 09:18', size: '4.1 MB', type: 'document' }
] as const;

export function SharedDrivePage() {
  const [access, setAccess] = useState<'team' | 'enterprise'>('team');
  const [space, setSpace] = useState('all');
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return files.filter(file => file.access === access && (space === 'all' || file.space === space) && (normalized.length === 0 || file.name.toLocaleLowerCase().includes(normalized) || file.owner.toLocaleLowerCase().includes(normalized)));
  }, [access, query, space]);
  const visibleSpaces = spaces.filter(item => item.id === 'all' || item.access === access);

  return <main className="shared-drive-page"><div className="shared-drive-page__inner">
    <header className="shared-drive-header"><div><h1>共享网盘</h1><p>查看团队共享空间与企业公共文件</p></div><label><Search size={16} aria-hidden="true" /><input aria-label="搜索共享网盘" onChange={event => setQuery(event.target.value)} placeholder="搜索文件或所有者" type="search" value={query} /></label></header>
    <section className="shared-drive-summary" aria-label="网盘概览"><div><Folder size={18} /><strong>4</strong><span>共享空间</span></div><div><FileText size={18} /><strong>128</strong><span>文件</span></div><div><Users size={18} /><strong>36</strong><span>协作成员</span></div></section>
    <div className="shared-drive-navigation"><div className="shared-drive-access" role="tablist" aria-label="网盘权限"><button aria-selected={access === 'team'} onClick={() => { setAccess('team'); setSpace('all'); }} role="tab" type="button">团队网盘</button><button aria-selected={access === 'enterprise'} onClick={() => { setAccess('enterprise'); setSpace('all'); }} role="tab" type="button">企业网盘</button></div><div className="shared-drive-tabs" role="group" aria-label="共享空间">{visibleSpaces.map(item => <button aria-pressed={space === item.id} key={item.id} onClick={() => setSpace(item.id)} type="button">{item.name}</button>)}</div></div>
    <section className="shared-drive-files" aria-label="共享文件"><div className="shared-drive-files__head"><span>名称</span><span>可见范围</span><span>所有者</span><span>更新时间</span><span>大小</span></div>{filtered.map(file => { const Icon = file.type === 'sheet' ? FileSpreadsheet : file.type === 'folder' ? Folder : file.type === 'image' ? Image : FileText; return <button className="shared-drive-file" key={file.id} type="button"><span><Icon size={18} aria-hidden="true" /><strong>{file.name}</strong></span><span className="shared-drive-visibility" data-access={file.access}>{file.access === 'team' ? '团队成员' : '全体员工'}</span><span>{file.owner}</span><span>{file.updated}</span><span>{file.size}</span></button>; })}{filtered.length === 0 ? <p className="shared-drive-empty">没有找到匹配的文件</p> : null}</section>
  </div></main>;
}
