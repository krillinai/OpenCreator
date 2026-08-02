export type ActivityRange = 'today' | '7d' | '30d';

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type EmployeeUsage = {
  employeeId: string;
  employeeName: string;
  team: string;
  collectorId: string;
  representativeAgentId: string;
  activeAgents: number;
  completedTurns: number;
  usage?: TokenUsage;
};

export type TrendSeries = {
  granularity: '小时' | '每日' | '周';
  startLabel: string;
  endLabel: string;
  values: number[];
};

export type RecentTurn = {
  agentName: string;
  task: string;
  model: string;
  tokens: number;
  time: string;
  collectorId: string;
  agentId: string;
};

export type AgentFixture = {
  collectorId: string;
  agentId: string;
  employeeName: string;
  name: string;
  status: string;
  workspace: string;
  usage: TokenUsage;
  completedTurns: number;
  sessionCount: number;
  sessionTitle: string;
  promptSummary: string;
  assistantSummary: string;
  toolName: string;
  subagentName: string;
};

export type ActivitySnapshot = {
  organization: {
    usage: TokenUsage;
    activeEmployees: number;
    activeAgents: number;
    completedTurns: number;
  };
  employees: EmployeeUsage[];
  trend: TrendSeries;
  employeeView: {
    usage: TokenUsage;
    activeAgents: number;
    completedTurns: number;
    modelDistribution: string[];
    agentDistribution: string[];
    recentTurns: RecentTurn[];
  };
  agents: AgentFixture[];
};

// totalTokens = inputTokens + outputTokens. Cached input is a subset of input
// and reasoning output is a subset of output, so neither is added again.
export function calculateTokenUsage(usage: TokenUsage | undefined): number | undefined {
  return usage === undefined ? undefined : usage.inputTokens + usage.outputTokens;
}

export function formatTokenUsage(usage: TokenUsage | undefined): string {
  const total = calculateTokenUsage(usage);
  return total === undefined ? '暂无用量数据' : new Intl.NumberFormat('zh-CN').format(total);
}

const employeeIdentities = [
  {
    employeeId: 'employee-linxia', employeeName: '林夏', team: '产品研究',
    collectorId: 'collector-shanghai', representativeAgentId: 'agent-research'
  },
  {
    employeeId: 'employee-zhouning', employeeName: '周宁', team: '客户成功',
    collectorId: 'collector-beijing', representativeAgentId: 'agent-customer'
  },
  {
    employeeId: 'employee-chenmo', employeeName: '陈默', team: '数据平台',
    collectorId: 'collector-hangzhou', representativeAgentId: 'agent-analysis'
  }
] as const;

function employee(index: number, activeAgents: number, completedTurns: number, usage?: TokenUsage): EmployeeUsage {
  return { ...employeeIdentities[index]!, activeAgents, completedTurns, ...(usage === undefined ? {} : { usage }) };
}

function agent(input: Omit<AgentFixture, 'status'>): AgentFixture {
  return { ...input, status: '运行中' };
}

export const activitySnapshots: Record<ActivityRange, ActivitySnapshot> = {
  today: {
    organization: { usage: { inputTokens: 142_800, cachedInputTokens: 61_200, outputTokens: 41_400, reasoningOutputTokens: 16_800 }, activeEmployees: 7, activeAgents: 14, completedTurns: 58 },
    employees: [
      employee(0, 3, 14, { inputTokens: 39_200, cachedInputTokens: 18_600, outputTokens: 11_800, reasoningOutputTokens: 4_100 }),
      employee(1, 2, 9, { inputTokens: 28_400, cachedInputTokens: 11_300, outputTokens: 8_600, reasoningOutputTokens: 3_200 }),
      employee(2, 1, 3)
    ],
    trend: { granularity: '小时', startLabel: '00:00', endLabel: '现在', values: [24, 31, 46, 62, 55, 79, 68, 86] },
    employeeView: {
      usage: { inputTokens: 39_200, cachedInputTokens: 18_600, outputTokens: 11_800, reasoningOutputTokens: 4_100 }, activeAgents: 3, completedTurns: 14,
      modelDistribution: ['gpt-5.3-codex 74%', 'gpt-5.2 18%', '其他 8%'], agentDistribution: ['研究助理 56%', '代码审查 29%', '资料整理 15%'],
      recentTurns: [{ agentName: '研究助理', task: '快速资料核验', model: 'gpt-5.3-codex', tokens: 6_240, time: '10:24', collectorId: 'collector-shanghai', agentId: 'agent-research' }]
    },
    agents: [
      agent({ collectorId: 'collector-shanghai', agentId: 'agent-research', employeeName: '林夏', name: '研究助理', workspace: '~/develop/market-research', usage: { inputTokens: 31_400, cachedInputTokens: 14_800, outputTokens: 9_200, reasoningOutputTokens: 3_700 }, completedTurns: 11, sessionCount: 1, sessionTitle: '快速资料核验', promptSummary: '核验今日竞品发布信息', assistantSummary: '已交叉验证 4 个信息来源', toolName: 'WebSearch', subagentName: '资料检索' }),
      agent({ collectorId: 'collector-beijing', agentId: 'agent-customer', employeeName: '周宁', name: '客户洞察', workspace: '~/develop/customer-success', usage: { inputTokens: 22_600, cachedInputTokens: 8_700, outputTokens: 7_100, reasoningOutputTokens: 2_600 }, completedTurns: 8, sessionCount: 1, sessionTitle: '今日客户反馈', promptSummary: '整理今日升级反馈', assistantSummary: '已归纳 3 项阻碍和跟进建议', toolName: 'ReadFile', subagentName: '反馈归类' }),
      agent({ collectorId: 'collector-hangzhou', agentId: 'agent-analysis', employeeName: '陈默', name: '数据分析', workspace: '~/develop/data-platform', usage: { inputTokens: 8_600, cachedInputTokens: 3_100, outputTokens: 2_400, reasoningOutputTokens: 900 }, completedTurns: 3, sessionCount: 1, sessionTitle: '指标口径核对', promptSummary: '检查今日指标口径差异', assistantSummary: '已定位 2 处口径差异', toolName: 'QueryData', subagentName: '口径核验' })
    ]
  },
  '7d': {
    organization: { usage: { inputTokens: 1_842_600, cachedInputTokens: 912_400, outputTokens: 486_200, reasoningOutputTokens: 184_900 }, activeEmployees: 12, activeAgents: 31, completedTurns: 684 },
    employees: [
      employee(0, 4, 128, { inputTokens: 482_000, cachedInputTokens: 251_000, outputTokens: 126_500, reasoningOutputTokens: 48_200 }),
      employee(1, 3, 94, { inputTokens: 391_400, cachedInputTokens: 180_200, outputTokens: 101_600, reasoningOutputTokens: 31_400 }), employee(2, 1, 18)
    ],
    trend: { granularity: '每日', startLabel: '周一', endLabel: '今天', values: [42, 58, 49, 72, 64, 88, 79] },
    employeeView: {
      usage: { inputTokens: 482_000, cachedInputTokens: 251_000, outputTokens: 126_500, reasoningOutputTokens: 48_200 }, activeAgents: 4, completedTurns: 128,
      modelDistribution: ['gpt-5.3-codex 62%', 'gpt-5.2 24%', '其他 14%'], agentDistribution: ['研究助理 48%', '代码审查 32%', '资料整理 20%'],
      recentTurns: [
        { agentName: '研究助理', task: '汇总竞品发布动态', model: 'gpt-5.3-codex', tokens: 18_420, time: '10:24', collectorId: 'collector-shanghai', agentId: 'agent-research' },
        { agentName: '代码审查', task: '检查工作区变更', model: 'gpt-5.3-codex', tokens: 9_860, time: '昨天', collectorId: 'collector-shanghai', agentId: 'agent-code-review' }
      ]
    },
    agents: [
      agent({ collectorId: 'collector-shanghai', agentId: 'agent-research', employeeName: '林夏', name: '研究助理', workspace: '~/develop/market-research', usage: { inputTokens: 142_300, cachedInputTokens: 68_700, outputTokens: 42_320, reasoningOutputTokens: 19_400 }, completedTurns: 36, sessionCount: 2, sessionTitle: '竞品周报研究', promptSummary: '对比本周主要竞品的产品更新与市场动作', assistantSummary: '已整理 6 项发布动态，并标注对现有路线的影响', toolName: 'WebSearch', subagentName: '资料检索' }),
      agent({ collectorId: 'collector-shanghai', agentId: 'agent-code-review', employeeName: '林夏', name: '代码审查', workspace: '~/develop/clawee-client', usage: { inputTokens: 7_480, cachedInputTokens: 3_120, outputTokens: 2_380, reasoningOutputTokens: 940 }, completedTurns: 4, sessionCount: 1, sessionTitle: '检查工作区变更', promptSummary: '检查当前工作区的前端变更', assistantSummary: '已标记 2 项可维护性建议', toolName: 'ReadFile', subagentName: '测试检查' }),
      agent({ collectorId: 'collector-beijing', agentId: 'agent-customer', employeeName: '周宁', name: '客户洞察', workspace: '~/develop/customer-success', usage: { inputTokens: 118_400, cachedInputTokens: 52_300, outputTokens: 31_600, reasoningOutputTokens: 10_800 }, completedTurns: 29, sessionCount: 3, sessionTitle: '续约风险归因', promptSummary: '分析本周高风险客户反馈', assistantSummary: '已识别 5 个风险信号及对应负责人', toolName: 'ReadFile', subagentName: '反馈归类' }),
      agent({ collectorId: 'collector-hangzhou', agentId: 'agent-analysis', employeeName: '陈默', name: '数据分析', workspace: '~/develop/data-platform', usage: { inputTokens: 48_200, cachedInputTokens: 19_600, outputTokens: 14_800, reasoningOutputTokens: 5_400 }, completedTurns: 18, sessionCount: 2, sessionTitle: '周度指标校验', promptSummary: '核对本周业务指标口径', assistantSummary: '已整理异常指标及修复建议', toolName: 'QueryData', subagentName: '口径核验' })
    ]
  },
  '30d': {
    organization: { usage: { inputTokens: 6_934_200, cachedInputTokens: 3_402_100, outputTokens: 1_808_400, reasoningOutputTokens: 672_300 }, activeEmployees: 18, activeAgents: 46, completedTurns: 2_741 },
    employees: [
      employee(0, 7, 492, { inputTokens: 1_786_000, cachedInputTokens: 891_000, outputTokens: 472_600, reasoningOutputTokens: 176_400 }),
      employee(1, 6, 407, { inputTokens: 1_421_000, cachedInputTokens: 680_000, outputTokens: 381_200, reasoningOutputTokens: 142_100 }), employee(2, 2, 61)
    ],
    trend: { granularity: '周', startLabel: '第 1 周', endLabel: '本周', values: [46, 59, 71, 84, 68] },
    employeeView: {
      usage: { inputTokens: 1_786_000, cachedInputTokens: 891_000, outputTokens: 472_600, reasoningOutputTokens: 176_400 }, activeAgents: 7, completedTurns: 492,
      modelDistribution: ['gpt-5.3-codex 58%', 'gpt-5.2 29%', '其他 13%'], agentDistribution: ['研究助理 44%', '代码审查 36%', '资料整理 20%'],
      recentTurns: [{ agentName: '研究助理', task: '月度市场脉络复盘', model: 'gpt-5.3-codex', tokens: 42_680, time: '7 月 31 日', collectorId: 'collector-shanghai', agentId: 'agent-research' }]
    },
    agents: [
      agent({ collectorId: 'collector-shanghai', agentId: 'agent-research', employeeName: '林夏', name: '研究助理', workspace: '~/develop/market-research', usage: { inputTokens: 548_600, cachedInputTokens: 274_100, outputTokens: 156_400, reasoningOutputTokens: 61_200 }, completedTurns: 148, sessionCount: 11, sessionTitle: '月度市场脉络复盘', promptSummary: '汇总本月竞品与市场变化', assistantSummary: '已形成月度变化脉络和 8 项建议', toolName: 'WebSearch', subagentName: '资料检索' }),
      agent({ collectorId: 'collector-beijing', agentId: 'agent-customer', employeeName: '周宁', name: '客户洞察', workspace: '~/develop/customer-success', usage: { inputTokens: 439_800, cachedInputTokens: 201_300, outputTokens: 127_200, reasoningOutputTokens: 45_800 }, completedTurns: 121, sessionCount: 9, sessionTitle: '月度客户健康复盘', promptSummary: '归纳本月客户健康变化', assistantSummary: '已输出分层风险清单与行动项', toolName: 'ReadFile', subagentName: '反馈归类' }),
      agent({ collectorId: 'collector-hangzhou', agentId: 'agent-analysis', employeeName: '陈默', name: '数据分析', workspace: '~/develop/data-platform', usage: { inputTokens: 176_400, cachedInputTokens: 72_100, outputTokens: 51_600, reasoningOutputTokens: 18_900 }, completedTurns: 61, sessionCount: 5, sessionTitle: '月度数据质量复盘', promptSummary: '复盘本月数据质量异常', assistantSummary: '已形成数据质量问题清单', toolName: 'QueryData', subagentName: '质量核验' })
    ]
  }
};

export function findAgentFixture(range: ActivityRange, collectorId: string, agentId: string): AgentFixture | undefined {
  return activitySnapshots[range].agents.find(agentItem => (
    agentItem.collectorId === collectorId && agentItem.agentId === agentId
  ));
}
