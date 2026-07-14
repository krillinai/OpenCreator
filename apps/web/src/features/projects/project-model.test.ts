import { describe, expect, it } from 'vitest';
import type { ThreadResponse } from '@clawee/protocol';
import {
  createDefaultProjects,
  findProjectById,
  groupThreadsByPurpose,
  listRecentConversations
} from './project-model.js';

describe('project model', () => {
  it('creates default projects in the expected order with default runtime settings', () => {
    const projects = createDefaultProjects();

    expect(projects.map((project) => project.name)).toEqual([
      'Playground',
      'content-design',
      'bili',
      'default',
      'feigua',
      'cover'
    ]);

    for (const project of projects) {
      expect(project.profile).toBe('default');
      expect(project.model).toBeNull();
      expect(project.reasoning).toBeNull();
    }

    const contentDesign = projects[1];
    expect(contentDesign).toBeDefined();
    if (contentDesign === undefined) {
      throw new Error('content-design project should exist');
    }

    expect(contentDesign.cwd).toContain('content-design');
    expect(contentDesign.sandbox).toBe('danger-full-access');

    expect(projects.filter((project) => project.id !== contentDesign.id).map((project) => project.sandbox)).toEqual([
      'follow-global',
      'follow-global',
      'follow-global',
      'follow-global',
      'follow-global'
    ]);
  });

  it('finds a project by id', () => {
    const projects = createDefaultProjects();

    expect(findProjectById(projects, 'content-design')?.name).toBe('content-design');
    expect(findProjectById(projects, 'missing')).toBeUndefined();
  });

  it('lists recent conversations in recency order for content-design', () => {
    const conversations = listRecentConversations();

    expect(conversations.map((conversation) => conversation.title)).toEqual([
      '整理本周项目进展',
      '提炼会议待办事项',
      '评审项目设计',
      '检查内容产线进度',
      '汇总团队最新更新'
    ]);
    expect(conversations.map((conversation) => conversation.updatedLabel)).toEqual(['4天', '5天', '1周', '1周', '3周']);
    expect(conversations.every((conversation) => conversation.projectId === 'content-design')).toBe(true);
  });

  it('groups conversations, schedule drafts, and schedule tasks by thread purpose', () => {
    const conversation = createThread({ id: 'thread-conversation', purpose: 'conversation' });
    const draft = createThread({ id: 'thread-draft', purpose: 'schedule_draft' });
    const task = createThread({
      id: 'thread-task',
      purpose: 'schedule_task',
      scheduleId: 'schedule-1'
    });

    expect(groupThreadsByPurpose([conversation, draft, task])).toEqual({
      conversationThreads: [conversation, draft],
      scheduleTaskThreads: [task]
    });
  });
});

function createThread(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    id: 'thread-1',
    title: '会话',
    codexThreadId: null,
    cwd: '/workspace/project',
    canonicalCwd: '/workspace/project',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  };
}
