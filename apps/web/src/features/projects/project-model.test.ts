import type { ThreadResponse } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import {
  findProjectById,
  groupThreadsByPurpose,
  parseLegacyLocalStorageProjects,
  sortProjectConversations
} from './project-model.js';

describe('project model', () => {
  it('finds Runtime projects by stable id', () => {
    const projects = [{
      id: 'project-one',
      name: 'One',
      cwd: '/workspace/one',
      sandbox: 'follow-global' as const,
      profile: 'default',
      model: null,
      reasoning: null
    }];

    expect(findProjectById(projects, 'project-one')?.name).toBe('One');
    expect(findProjectById(projects, undefined)).toBeUndefined();
    expect(findProjectById(projects, 'missing')).toBeUndefined();
  });

  it('parses legacy localStorage only as migration input', () => {
    expect(parseLegacyLocalStorageProjects([
      legacyProject('legacy-one', '/workspace/one'),
      legacyProject('local-home', '~'),
      { id: 'broken' }
    ])).toEqual([
      legacyProject('legacy-one', '/workspace/one'),
      legacyProject('local-home', '~')
    ]);
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
      conversationThreads: [conversation],
      scheduleDraftThreads: [draft],
      scheduleTaskThreads: [task]
    });
  });

  it('sorts pinned conversations first and each group by newest update', () => {
    const rows = [
      { id: 'normal', projectId: 'one', title: 'Normal', updatedLabel: '1天', updatedAt: '2026-08-06T10:00:00Z' },
      { id: 'pinned-old', projectId: 'one', title: 'Old', updatedLabel: '2天', updatedAt: '2026-08-04T10:00:00Z', pinnedAt: '2026-08-05T00:00:00Z' },
      { id: 'pinned-new', projectId: 'one', title: 'New', updatedLabel: '1天', updatedAt: '2026-08-05T10:00:00Z', pinnedAt: '2026-08-06T00:00:00Z' }
    ];

    expect(sortProjectConversations(rows).map(row => row.id))
      .toEqual(['pinned-new', 'pinned-old', 'normal']);
  });
});

function legacyProject(id: string, cwd: string) {
  return {
    id,
    name: id,
    cwd,
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null
  };
}

function createThread(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    id: 'thread-1',
    title: '会话',
    projectId: 'project-one',
    origin: 'opencreator_created',
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
