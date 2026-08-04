import {
  activitySnapshots,
  calculateTokenUsage,
  formatTokenUsage,
  type ActivityRange,
  type UsageDistributionItem
} from './activity-model.js';

export type ActivityChatRole = 'admin' | 'employee';

export type ActivityChatAnswer = {
  text: string;
  evidence: string[];
};

const rangeLabels: Record<ActivityRange, string> = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天'
};

const suggestions: Record<ActivityChatRole, string[]> = {
  admin: [
    '哪位员工的 Token 用量最高？',
    'Skill 使用最多的是哪个？',
    'MCP 调用分布怎么样？',
    '当前有多少活跃 Agent？'
  ],
  employee: [
    '我的 Token 用量是多少？',
    '我最常用的 Skill 是什么？',
    '我的 MCP 调用情况如何？',
    '我有多少活跃 Agent？'
  ]
};

export function getActivityChatSuggestions(role: ActivityChatRole): string[] {
  return suggestions[role];
}

export function getActivityRangeLabel(range: ActivityRange): string {
  return rangeLabels[range];
}

export function createActivityChatAnswer(
  role: ActivityChatRole,
  range: ActivityRange,
  question: string
): ActivityChatAnswer {
  const snapshot = activitySnapshots[range];
  const rangeLabel = rangeLabels[range];

  if (/员工|同事|成员|排行|排名|最高/u.test(question)) {
    if (role === 'employee') {
      return {
        text: '员工视图只展示你自己的活动数据，不能查询其他员工的用量或排名。你可以继续询问自己的 Token、Skill、MCP 或 Agent 使用情况。',
        evidence: [`${rangeLabel} · 个人权限`]
      };
    }
    const ranked = snapshot.employees
      .filter(employee => employee.usage !== undefined)
      .sort((left, right) => (
        (calculateTokenUsage(right.usage) ?? 0) - (calculateTokenUsage(left.usage) ?? 0)
      ));
    const leader = ranked[0];
    if (leader === undefined) return fallback(rangeLabel);
    return {
      text: `${rangeLabel} Token 用量最高的是${leader.employeeName}，共 ${formatTokenUsage(leader.usage)} Token，期间有 ${leader.activeAgents} 个活跃 Agent，完成 ${leader.completedTurns} 轮。`,
      evidence: [`${rangeLabel} · 员工用量汇总`]
    };
  }

  if (/token|消耗|用量|输入|输出/iu.test(question)) {
    const usage = role === 'admin' ? snapshot.organization.usage : snapshot.employeeView.usage;
    const owner = role === 'admin' ? '组织' : '你';
    return {
      text: `${rangeLabel}${owner}共使用 ${formatTokenUsage(usage)} Token，其中输入 ${formatNumber(usage.inputTokens)}，输出 ${formatNumber(usage.outputTokens)}。缓存输入和推理输出分别为 ${formatNumber(usage.cachedInputTokens)} 与 ${formatNumber(usage.reasoningOutputTokens)}。`,
      evidence: [`${rangeLabel} · ${role === 'admin' ? '组织 Token 汇总' : '我的 Token'}`]
    };
  }

  if (/skill|技能/iu.test(question)) {
    const items = role === 'admin'
      ? snapshot.organization.skillDistribution
      : snapshot.employeeView.skillDistribution;
    return distributionAnswer(rangeLabel, role, 'Skill', items);
  }

  if (/mcp|工具|系统/iu.test(question)) {
    const items = role === 'admin'
      ? snapshot.organization.mcpDistribution
      : snapshot.employeeView.mcpDistribution;
    return distributionAnswer(rangeLabel, role, 'MCP', items);
  }

  if (/agent|轮次|执行|活跃/iu.test(question)) {
    const summary = role === 'admin' ? snapshot.organization : snapshot.employeeView;
    return {
      text: `${rangeLabel}${role === 'admin' ? '组织内' : '你'}有 ${summary.activeAgents} 个活跃 Agent，共完成 ${summary.completedTurns} 轮。`,
      evidence: [`${rangeLabel} · ${role === 'admin' ? '组织 Agent 汇总' : '我的 Agent'}`]
    };
  }

  return fallback(rangeLabel);
}

function distributionAnswer(
  rangeLabel: string,
  role: ActivityChatRole,
  kind: 'Skill' | 'MCP',
  items: UsageDistributionItem[]
): ActivityChatAnswer {
  const top = items[0];
  if (top === undefined) return fallback(rangeLabel);
  const total = items.reduce((sum, item) => sum + item.invocationCount, 0);
  return {
    text: `${rangeLabel}${role === 'admin' ? '组织' : '你'}共调用 ${kind} ${total} 次，使用最多的是“${top.label}”，调用 ${top.invocationCount} 次，占 ${formatPercent(top.share)}。`,
    evidence: [`${rangeLabel} · ${role === 'admin' ? '组织' : '我的'} ${kind} 分布`]
  };
}

function fallback(rangeLabel: string): ActivityChatAnswer {
  return {
    text: '当前静态数据暂时无法回答这个问题。你可以询问 Token 用量、活跃 Agent、完成轮次、Skill 或 MCP 使用情况。',
    evidence: [`${rangeLabel} · 静态采样数据`]
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'percent' }).format(value);
}
