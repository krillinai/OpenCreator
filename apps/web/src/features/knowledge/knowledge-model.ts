export type KnowledgeRole = 'employee' | 'admin';
export type KnowledgeAccessLevel = 'organization' | 'team' | 'restricted';

export type KnowledgeProfile = {
  id: KnowledgeRole;
  name: string;
  roleLabel: string;
  department: string;
  accessibleScopeIds: string[];
};

export type KnowledgeScope = {
  id: string;
  name: string;
  summary: string;
  accessLevel: KnowledgeAccessLevel;
  itemCount: number;
  suggestions: string[];
};

export type KnowledgeEvidence = {
  scopeId: string;
  label: string;
  count: number;
};

export type KnowledgeAnswer = {
  text: string;
  evidence: KnowledgeEvidence[];
};

export const knowledgeProfiles: KnowledgeProfile[] = [
  {
    id: 'employee',
    name: '小林',
    roleLabel: '员工',
    department: '客户成功',
    accessibleScopeIds: [
      'scope-company-policy',
      'scope-product',
      'scope-customer-success'
    ]
  },
  {
    id: 'admin',
    name: '企业管理员',
    roleLabel: '管理员',
    department: '企业管理',
    accessibleScopeIds: [
      'scope-company-policy',
      'scope-product',
      'scope-customer-success',
      'scope-engineering'
    ]
  }
];

export const knowledgeScopes: KnowledgeScope[] = [
  {
    id: 'scope-company-policy',
    name: '公司制度',
    summary: '差旅、报销与人事制度',
    accessLevel: 'organization',
    itemCount: 18,
    suggestions: ['出差住宿标准是多少？', '报销需要在多久内提交？']
  },
  {
    id: 'scope-product',
    name: '产品资料',
    summary: '产品能力、部署与安全边界',
    accessLevel: 'organization',
    itemCount: 12,
    suggestions: ['Clawee 企业版包含哪些能力？']
  },
  {
    id: 'scope-customer-success',
    name: '客户成功',
    summary: '客户上线、退款与服务流程',
    accessLevel: 'team',
    itemCount: 24,
    suggestions: ['客户退款需要谁审批？', '企业客户上线前要完成什么？']
  },
  {
    id: 'scope-engineering',
    name: '研发知识',
    summary: 'Runtime、Daemon 与发布门禁',
    accessLevel: 'restricted',
    itemCount: 31,
    suggestions: ['Runtime 和 Desktop 如何通信？']
  }
];

type KnowledgeAnswerRule = {
  scopeId: string;
  keywords: RegExp;
  text: string;
  evidenceCount: number;
};

const answerRules: KnowledgeAnswerRule[] = [
  {
    scopeId: 'scope-customer-success',
    keywords: /退款|退费|审批/u,
    text: '退款请求先由客户成功负责人完成事实核验。金额低于 5 万元时提交区域负责人审批；金额达到或超过 5 万元时，还需要财务负责人共同审批。',
    evidenceCount: 2
  },
  {
    scopeId: 'scope-customer-success',
    keywords: /上线|交付|验收/u,
    text: '企业客户上线前需要完成租户初始化、管理员确认、身份认证配置、知识授权和首批 Agent 验收，并记录每个环节的负责人和完成时间。',
    evidenceCount: 3
  },
  {
    scopeId: 'scope-company-policy',
    keywords: /差旅|出差|住宿|报销/u,
    text: '员工应在出差前完成差旅申请，住宿和交通标准按城市等级执行。报销材料需要在行程结束后 10 个工作日内提交。',
    evidenceCount: 2
  },
  {
    scopeId: 'scope-product',
    keywords: /Clawee|企业版|产品|部署|安全/u,
    text: 'Clawee 企业版提供组织级 Agent 管理、权限控制、企业知识问答和活动审计。通用界面由 Web 与 Desktop 共享，企业数据通过统一 Runtime 接口访问。',
    evidenceCount: 2
  },
  {
    scopeId: 'scope-engineering',
    keywords: /Runtime|Desktop|Daemon|Bridge|发布|构建/u,
    text: 'Web 与 Desktop 的通用业务都通过 Runtime API 调用 Daemon。Desktop Bridge 只承载窗口、系统目录和原生通知等操作系统能力，发布前需要校验内嵌 Web 资源哈希。',
    evidenceCount: 2
  }
];

export function getKnowledgeProfile(role: KnowledgeRole): KnowledgeProfile {
  return knowledgeProfiles.find(profile => profile.id === role)!;
}

export function getAccessibleKnowledgeScopes(role: KnowledgeRole): KnowledgeScope[] {
  const allowed = new Set(getKnowledgeProfile(role).accessibleScopeIds);
  return knowledgeScopes.filter(scope => allowed.has(scope.id));
}

export function getKnowledgeSuggestions(role: KnowledgeRole): string[] {
  return getAccessibleKnowledgeScopes(role)
    .flatMap(scope => scope.suggestions.slice(0, 1));
}

export function createKnowledgeAnswer(role: KnowledgeRole, question: string): KnowledgeAnswer {
  const accessibleScopes = getAccessibleKnowledgeScopes(role);
  const scopesById = new Map(accessibleScopes.map(scope => [scope.id, scope]));
  const rule = answerRules.find(candidate => (
    scopesById.has(candidate.scopeId) && candidate.keywords.test(question)
  ));

  if (rule === undefined) {
    return {
      text: '当前权限范围内暂时没有找到直接答案。你可以换一种问法，或询问右侧列出的知识范围。',
      evidence: []
    };
  }

  const scope = scopesById.get(rule.scopeId)!;
  return {
    text: rule.text,
    evidence: [{
      scopeId: scope.id,
      label: scope.name.endsWith('知识') ? `${scope.name}域` : `${scope.name}知识域`,
      count: rule.evidenceCount
    }]
  };
}
