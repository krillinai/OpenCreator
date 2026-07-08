import { describe, expect, it } from 'vitest';
import { createDefaultProjects, findProjectById, listRecentConversations } from './project-model.js';

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
});
