import { describe, expect, it } from 'vitest';
import {
  createActivityChatAnswer,
  getActivityChatSuggestions
} from './activity-chat-model.js';

describe('activity static conversation model', () => {
  it('answers administrator questions from the selected organization snapshot', () => {
    const token = createActivityChatAnswer('admin', '7d', '组织 Token 用量是多少？');
    expect(token.text).toContain('2,328,800 Token');
    expect(token.evidence).toEqual(['近 7 天 · 组织 Token 汇总']);

    const ranking = createActivityChatAnswer('admin', '7d', '哪位员工的 Token 用量最高？');
    expect(ranking.text).toContain('林夏');
    expect(ranking.text).toContain('608,500 Token');
  });

  it('answers Skill and MCP questions from role-specific distributions', () => {
    const skill = createActivityChatAnswer('admin', '7d', 'Skill 使用最多的是哪个？');
    expect(skill.text).toContain('网页检索');
    expect(skill.text).toContain('18 次');
    expect(skill.text).toContain('38%');

    const mcp = createActivityChatAnswer('employee', '7d', '我的 MCP 调用情况如何？');
    expect(mcp.text).toContain('filesystem');
    expect(mcp.text).toContain('21 次');
    expect(mcp.evidence).toEqual(['近 7 天 · 我的 MCP 分布']);
  });

  it('does not disclose employee rankings in the employee view', () => {
    const answer = createActivityChatAnswer('employee', '7d', '哪位员工 Token 用量最高？');
    expect(answer.text).toContain('只展示你自己的活动数据');
    expect(answer.text).not.toContain('林夏');
    expect(answer.text).not.toContain('周宁');
    expect(answer.evidence).toEqual(['近 7 天 · 个人权限']);
  });

  it('offers different suggested questions for administrators and employees', () => {
    expect(getActivityChatSuggestions('admin')).toContain('哪位员工的 Token 用量最高？');
    expect(getActivityChatSuggestions('employee')).not.toContain('哪位员工的 Token 用量最高？');
    expect(getActivityChatSuggestions('employee')).toContain('我的 Token 用量是多少？');
  });
});
