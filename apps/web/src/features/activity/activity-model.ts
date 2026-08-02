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

// totalTokens = inputTokens + outputTokens. Cached input is a subset of input
// and reasoning output is a subset of output, so neither is added again.
export function calculateTokenUsage(usage: TokenUsage | undefined): number | undefined {
  return usage === undefined ? undefined : usage.inputTokens + usage.outputTokens;
}

export function formatTokenUsage(usage: TokenUsage | undefined): string {
  const total = calculateTokenUsage(usage);
  return total === undefined ? '暂无用量数据' : new Intl.NumberFormat('zh-CN').format(total);
}

export const organizationUsage: TokenUsage = {
  inputTokens: 1_842_600,
  cachedInputTokens: 912_400,
  outputTokens: 486_200,
  reasoningOutputTokens: 184_900
};

export const employees: EmployeeUsage[] = [
  {
    employeeId: 'employee-linxia', employeeName: '林夏', team: '产品研究',
    collectorId: 'collector-shanghai', representativeAgentId: 'agent-research',
    activeAgents: 4, completedTurns: 128,
    usage: { inputTokens: 482_000, cachedInputTokens: 251_000, outputTokens: 126_500, reasoningOutputTokens: 48_200 }
  },
  {
    employeeId: 'employee-zhouning', employeeName: '周宁', team: '客户成功',
    collectorId: 'collector-beijing', representativeAgentId: 'agent-customer',
    activeAgents: 3, completedTurns: 94,
    usage: { inputTokens: 391_400, cachedInputTokens: 180_200, outputTokens: 101_600, reasoningOutputTokens: 31_400 }
  },
  {
    employeeId: 'employee-chenmo', employeeName: '陈默', team: '数据平台',
    collectorId: 'collector-hangzhou', representativeAgentId: 'agent-analysis',
    activeAgents: 1, completedTurns: 18
  }
];
