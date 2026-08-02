import { describe, expect, it } from 'vitest';
import { activitySnapshots, calculateTokenUsage, formatTokenUsage } from './activity-model.js';

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
});
