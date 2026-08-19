import type { ProjectResponse, ThreadResponse } from '@opencreator/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectManagementDialog } from './ProjectManagementDialog.js';

describe('ProjectManagementDialog', () => {
  it('manages archived and missing projects and assigns an unowned thread explicitly', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(async () => undefined);
    const onArchive = vi.fn(async () => undefined);
    const onRestore = vi.fn(async () => undefined);
    const onReplaceDirectory = vi.fn(async () => undefined);
    const onAssignThread = vi.fn(async () => undefined);

    render(
      <ProjectManagementDialog
        open
        projects={[
          project({
            id: 'project-active',
            name: 'Active',
            cwd: '/workspace/active',
            canonicalCwd: '/workspace/active'
          }),
          project({
            id: 'project-missing',
            name: 'Missing',
            cwd: '/workspace/missing',
            canonicalCwd: null,
            directoryState: 'missing'
          })
        ]}
        archivedProjects={[
          project({
            id: 'project-archived',
            name: 'Archived',
            status: 'archived'
          })
        ]}
        unassignedThreads={[thread()]}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onArchive={onArchive}
        onRestore={onRestore}
        onReplaceDirectory={onReplaceDirectory}
        onAssignThread={onAssignThread}
      />
    );

    expect(screen.getByText('目录不可用')).toBeInTheDocument();
    expect(screen.getByText('会话目录与目标项目不同，认领不会修改会话目录'))
      .toBeInTheDocument();
    expect(onAssignThread).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole('button', { name: '编辑' })[0]!);
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Renamed' } });
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(onUpdate).toHaveBeenCalledWith(
      'project-active',
      expect.objectContaining({ name: 'Renamed' })
    );

    await user.click(screen.getByRole('button', { name: '修复目录' }));
    expect(onReplaceDirectory).toHaveBeenCalledWith('project-missing');

    await user.click(screen.getByRole('button', { name: '恢复' }));
    expect(onRestore).toHaveBeenCalledWith('project-archived');

    await user.selectOptions(
      screen.getByLabelText('目标项目 Legacy conversation'),
      'project-missing'
    );
    await user.click(screen.getByRole('button', { name: '认领' }));
    expect(onAssignThread).toHaveBeenCalledWith('thread-unassigned', 'project-missing');
    expect(onArchive).not.toHaveBeenCalled();
  });

  it('explains the empty dependency and offers adding a project instead of an empty selector', async () => {
    const user = userEvent.setup();
    const onAddProject = vi.fn(async () => undefined);

    render(
      <ProjectManagementDialog
        open
        projects={[]}
        archivedProjects={[]}
        unassignedThreads={[thread()]}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => undefined)}
        onArchive={vi.fn(async () => undefined)}
        onRestore={vi.fn(async () => undefined)}
        onReplaceDirectory={vi.fn(async () => undefined)}
        onAssignThread={vi.fn(async () => undefined)}
        onAddProject={onAddProject}
      />
    );

    expect(screen.getByText('还没有项目。创建项目后即可开始对话或认领已有会话。'))
      .toBeInTheDocument();
    expect(screen.getByText('有 1 个待归属会话。添加项目后即可认领。'))
      .toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '认领' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: '创建项目' })[0]!);
    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it('keeps using an existing folder as a separate desktop action', async () => {
    const user = userEvent.setup();
    const onAddProjectDirectory = vi.fn(async () => undefined);

    render(
      <ProjectManagementDialog
        open
        projects={[]}
        archivedProjects={[]}
        unassignedThreads={[]}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => undefined)}
        onArchive={vi.fn(async () => undefined)}
        onRestore={vi.fn(async () => undefined)}
        onReplaceDirectory={vi.fn(async () => undefined)}
        onAssignThread={vi.fn(async () => undefined)}
        onAddProjectDirectory={onAddProjectDirectory}
      />
    );

    await user.click(screen.getByRole('button', { name: '使用现有文件夹' }));
    expect(onAddProjectDirectory).toHaveBeenCalledTimes(1);
  });

  it('hides directory replacement when the host does not provide that capability', () => {
    render(
      <ProjectManagementDialog
        open
        projects={[
          project(),
          project({
            id: 'project-missing',
            name: 'Missing',
            directoryState: 'missing'
          })
        ]}
        archivedProjects={[]}
        unassignedThreads={[]}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => undefined)}
        onArchive={vi.fn(async () => undefined)}
        onRestore={vi.fn(async () => undefined)}
        onAssignThread={vi.fn(async () => undefined)}
      />
    );

    expect(screen.queryByRole('button', { name: '更换目录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '修复目录' })).not.toBeInTheDocument();
  });

  it('confirms before removing a project from project management', async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn(async () => undefined);
    render(
      <ProjectManagementDialog
        open
        projects={[project({ name: '内容项目' })]}
        archivedProjects={[]}
        unassignedThreads={[]}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => undefined)}
        onArchive={onArchive}
        onRestore={vi.fn(async () => undefined)}
        onAssignThread={vi.fn(async () => undefined)}
      />
    );

    await user.click(screen.getByRole('button', { name: '移除' }));
    expect(screen.getByRole('alertdialog', { name: '移除项目' })).toBeInTheDocument();
    expect(screen.getByText('确认从 OpenCreator 中移除“内容项目”？项目目录和文件不会被删除。'))
      .toBeInTheDocument();
    expect(onArchive).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '移除项目' }));
    expect(onArchive).toHaveBeenCalledWith('project-active');
    expect(screen.queryByRole('alertdialog', { name: '移除项目' })).not.toBeInTheDocument();
  });
});

function project(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id: 'project-active',
    name: 'Active',
    cwd: '/workspace/active',
    canonicalCwd: '/workspace/active',
    directoryState: 'available',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'follow-global',
    status: 'active',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  };
}

function thread(): ThreadResponse {
  return {
    id: 'thread-unassigned',
    title: 'Legacy conversation',
    projectId: null,
    origin: 'opencreator_created',
    codexThreadId: 'codex-one',
    cwd: '/workspace/legacy',
    canonicalCwd: '/workspace/legacy',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    archivedAt: null
  };
}
