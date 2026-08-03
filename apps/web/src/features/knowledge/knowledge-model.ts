export type KnowledgeCategory = 'policy' | 'product' | 'customer' | 'engineering';
export type KnowledgeFilter = 'all' | KnowledgeCategory;
export type KnowledgeVisibility = 'all_employees' | 'department' | 'restricted';
export type KnowledgeSyncStatus = 'synced' | 'stale' | 'processing';

export type KnowledgeDocument = {
  id: string;
  title: string;
  summary: string;
  excerpt: string;
  category: KnowledgeCategory;
  spaceId: string;
  spaceName: string;
  source: { type: 'notion' | 'feishu' | 'confluence' | 'manual'; label: string };
  owner: { id: string; name: string; department: string };
  visibility: KnowledgeVisibility;
  updatedAt: string;
  syncStatus: KnowledgeSyncStatus;
  tags: string[];
};

export const knowledgeCategories: Array<{ id: KnowledgeFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'policy', label: '制度规范' },
  { id: 'product', label: '产品资料' },
  { id: 'customer', label: '客户案例' },
  { id: 'engineering', label: '技术文档' }
];

export const knowledgeDocuments: KnowledgeDocument[] = [
  { id: 'knowledge-travel-policy', title: '员工差旅与报销制度', summary: '差旅申请、费用标准与报销流程的统一说明。', excerpt: '员工出差前应完成差旅申请。住宿、交通和餐饮费用按城市等级执行对应标准，报销材料需在行程结束后十个工作日内提交。', category: 'policy', spaceId: 'space-company-policy', spaceName: '公司制度', source: { type: 'feishu', label: '飞书文档' }, owner: { id: 'employee-liwen', name: '李雯', department: '人力行政' }, visibility: 'all_employees', updatedAt: '2026-07-28T09:30:00+08:00', syncStatus: 'synced', tags: ['差旅', '报销', '财务'] },
  { id: 'knowledge-product-overview', title: 'Clawee 企业版产品手册', summary: '企业版核心能力、部署方式和安全边界。', excerpt: 'Clawee 企业版提供组织级 Agent 管理、权限控制、知识接入与活动审计。通用界面由 Web 与 Desktop 共享，企业数据通过统一 Runtime 接口访问。', category: 'product', spaceId: 'space-product', spaceName: '产品中心', source: { type: 'notion', label: 'Notion' }, owner: { id: 'employee-linxia', name: '林夏', department: '产品研究' }, visibility: 'all_employees', updatedAt: '2026-08-01T16:40:00+08:00', syncStatus: 'synced', tags: ['企业版', '产品手册', '安全'] },
  { id: 'knowledge-refund-playbook', title: '客户退款处理规范', summary: '退款场景分级、审批责任人与客户沟通模板。', excerpt: '退款请求按合同争议、服务故障和客户经营变化三类处理。客户成功负责人需在一个工作日内完成事实核验，并根据金额进入对应审批流程。', category: 'customer', spaceId: 'space-customer-success', spaceName: '客户成功', source: { type: 'confluence', label: 'Confluence' }, owner: { id: 'employee-zhouning', name: '周宁', department: '客户成功' }, visibility: 'department', updatedAt: '2026-07-30T14:20:00+08:00', syncStatus: 'stale', tags: ['退款', '审批', '客户沟通'] },
  { id: 'knowledge-enterprise-onboarding', title: '企业客户上线检查清单', summary: '从合同生效到正式上线的跨团队交付清单。', excerpt: '上线流程包含租户初始化、管理员确认、身份认证配置、知识源授权和首批 Agent 验收。每个环节需记录负责人和完成时间。', category: 'customer', spaceId: 'space-customer-success', spaceName: '客户成功', source: { type: 'feishu', label: '飞书多维表格' }, owner: { id: 'employee-zhouning', name: '周宁', department: '客户成功' }, visibility: 'department', updatedAt: '2026-07-25T11:00:00+08:00', syncStatus: 'synced', tags: ['上线', '交付', '检查清单'] },
  { id: 'knowledge-runtime-architecture', title: 'Runtime 接口与数据流', summary: 'Web、Desktop、Daemon 之间的职责和调用路径。', excerpt: '通用产品能力通过 Runtime API 调用 Daemon。Desktop Bridge 仅承载窗口、系统目录选择和原生通知等系统能力，禁止复制通用业务逻辑。', category: 'engineering', spaceId: 'space-engineering', spaceName: '研发文档', source: { type: 'manual', label: '内部文档' }, owner: { id: 'employee-chenmo', name: '陈默', department: '数据平台' }, visibility: 'restricted', updatedAt: '2026-08-02T18:15:00+08:00', syncStatus: 'processing', tags: ['Runtime', 'Daemon', '架构'] },
  { id: 'knowledge-release-gate', title: 'Web 与 Desktop 发布门禁', summary: '共享构建产物、一致性测试与桌面包验收要求。', excerpt: 'Desktop 打包前必须重新构建当前工作区 Web，并核对内嵌资源哈希。相同内容视口下的通用页面、文案和交互结果必须一致。', category: 'engineering', spaceId: 'space-engineering', spaceName: '研发文档', source: { type: 'manual', label: '内部文档' }, owner: { id: 'employee-chenmo', name: '陈默', department: '数据平台' }, visibility: 'restricted', updatedAt: '2026-08-02T19:10:00+08:00', syncStatus: 'synced', tags: ['Desktop', '构建', 'E2E'] }
];

export function queryKnowledgeDocuments(documents: KnowledgeDocument[], query: string, category: KnowledgeFilter): KnowledgeDocument[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  return documents.filter(document => {
    if (category !== 'all' && document.category !== category) return false;
    if (normalized.length === 0) return true;
    return [document.title, document.summary, document.spaceName, document.owner.name, ...document.tags]
      .join(' ').toLocaleLowerCase('zh-CN').includes(normalized);
  });
}

