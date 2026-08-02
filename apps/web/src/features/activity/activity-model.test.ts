import { describe, expect, it } from 'vitest';
import { activitySnapshots, calculateTokenUsage, findAgentFixture, formatTokenUsage } from './activity-model.js';

describe('activity token usage', () => {
  it('counts input and output only while treating cached and reasoning tokens as subsets', () => {
    expect(calculateTokenUsage({
      inputTokens: 1_000,
      cachedInputTokens: 700,
      outputTokens: 400,
      reasoningOutputTokens: 250
    })).toBe(1_400);
  });

  it('preserves missing usage instead of presenting it as zero', () => {
    expect(calculateTokenUsage(undefined)).toBeUndefined();
    expect(formatTokenUsage(undefined)).toBe('暂无用量数据');
  });

  it('keeps every range snapshot arithmetically valid and distinct', () => {
    const totals = Object.values(activitySnapshots).map(snapshot => {
      const usage = snapshot.organization.usage;
      expect(usage.cachedInputTokens).toBeLessThanOrEqual(usage.inputTokens);
      expect(usage.reasoningOutputTokens).toBeLessThanOrEqual(usage.outputTokens);
      expect(calculateTokenUsage(usage)).toBe(usage.inputTokens + usage.outputTokens);
      return calculateTokenUsage(usage);
    });

    expect(new Set(totals).size).toBe(3);
  });

  it('keeps nested token usage and route references valid in every range', () => {
    for (const [range, snapshot] of Object.entries(activitySnapshots)) {
      const usages = [snapshot.organization.usage, snapshot.employeeView.usage, ...snapshot.employees.flatMap(item => item.usage ? [item.usage] : []), ...snapshot.agents.map(item => item.usage), ...snapshot.employeeView.recentTurns.map(item => item.usage), ...snapshot.trend.points.map(item => item.usage)];
      for (const tokenUsage of usages) {
        expect(tokenUsage.cachedInputTokens).toBeLessThanOrEqual(tokenUsage.inputTokens);
        expect(tokenUsage.reasoningOutputTokens).toBeLessThanOrEqual(tokenUsage.outputTokens);
      }
      for (const employee of snapshot.employees) {
        expect(findAgentFixture(range as keyof typeof activitySnapshots, employee.collectorId, employee.representativeAgentId)?.employeeName).toBe(employee.employeeName);
      }
      for (const turn of snapshot.employeeView.recentTurns) {
        expect(findAgentFixture(range as keyof typeof activitySnapshots, turn.collectorId, turn.agentId)?.name).toBe(turn.agentName);
      }
    }
  });
});
