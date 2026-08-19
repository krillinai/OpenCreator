import { describe, expect, it } from 'vitest';
import {
  createConversationTitle,
  extractPublicConversationInput
} from '../../src/threads/conversation-title.js';

describe('createConversationTitle', () => {
  it('keeps an already concise title unchanged', () => {
    expect(createConversationTitle('启动服务')).toBe('启动服务');
  });

  it('extracts the actual request from a schedule assistant prompt', () => {
    expect(createConversationTitle([
      '你是 OpenCreator 的计划任务配置助手。',
      '不要调用工具，不要修改文件，只根据用户描述生成一个计划任务草稿。',
      '用户所在时区：Asia/Shanghai',
      '只输出一个 JSON 对象，不要输出 Markdown 或解释。',
      '用户描述：每个工作日上午九点总结当前项目最近的进展和需要跟进的事项',
    ].join('\n'))).toBe('工作日总结项目进展');
  });

  it('uses a concise compatibility title for truncated legacy assistant prompts', () => {
    expect(createConversationTitle(
      '你是 OpenCreator 的计划任务配置助手。 不要调用工具，不要修改文件，只根据用户描述生成一个计划任务草稿。 用户所在时区：Asia/Shanghai 只输出一…'
    )).toBe('创建计划任务');
  });

  it('removes attachment metadata and uses the user request', () => {
    expect(createConversationTitle(`
# Files mentioned by the user:

## screenshot.png: /tmp/screenshot.png

## My request for Codex:
为什么 ChatGPT App 看不到 GPT-5.6，但 Codex CLI 可以使用
    `)).toBe('ChatGPT App 看不到 GPT-5.6');
  });

  it('removes a leading skill invocation and conversational filler', () => {
    expect(createConversationTitle(
      '[$brainstorming](/Users/test/.codex/skills/brainstorming/SKILL.md) 请帮我重新详细梳理下 AI 任务创建的逻辑，现有功能还有哪些问题'
    )).toBe('梳理 AI 任务创建逻辑');
  });

  it('uses a short fallback for attachment-only and blank requests', () => {
    expect(createConversationTitle('# Files mentioned by the user:\n\n## image.png: /tmp/image.png'))
      .toBe('查看附件');
    expect(createConversationTitle('   ')).toBe('新对话');
  });

  it('limits long titles by visual width', () => {
    expect(createConversationTitle(
      '分析 admin-api 里面的 AI 任务功能为什么显示顾问列表加载失败以及如何修复'
    )).toBe('分析 admin-api 的 AI 任务功能');
    expect(createConversationTitle(
      'Use the r4_smoke_skill_1783880138172 skill and reply with the marker'
    )).toBe('Use the r4_smoke_skill_17838…');
  });

  it('extracts only the public request from OpenCreator-managed context wrappers', () => {
    expect(extractPublicConversationInput([
      '[OpenCreator 用户显式管理的上下文]',
      '- 会话摘要：内部摘要',
      '[上下文结束]',
      '',
      '用户当前请求：',
      '修复重复请求'
    ].join('\n'))).toBe('修复重复请求');

    expect(extractPublicConversationInput([
      '[OpenCreator 执行上下文恢复摘要]',
      '- 已完成：内部恢复信息',
      '',
      '本次公开任务输入：',
      '继续运行测试'
    ].join('\n'))).toBe('继续运行测试');
  });

  it('hides malformed or empty OpenCreator context wrappers instead of exposing internal text', () => {
    expect(extractPublicConversationInput(
      '[OpenCreator 用户显式管理的上下文]\n- 会话摘要：内部摘要'
    )).toBeUndefined();
    expect(extractPublicConversationInput([
      '[OpenCreator 执行上下文恢复摘要]',
      '本次公开任务输入：',
      '   '
    ].join('\n'))).toBeUndefined();
  });
});
