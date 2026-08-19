import type { ConversationSummary, MemoryEntry } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import {
  MemorySettingsView,
  type MemorySettingsService
} from './MemorySettingsView.js';

describe('MemorySettingsView', () => {
  it('creates, searches, edits, disables, deletes, and disables all memories', async () => {
    const user = userEvent.setup();
    const service = createService();

    render(
      <MemorySettingsView
        connected
        service={service}
        projects={[{ key: '/workspace/project', label: 'content-design' }]}
        threads={[{ key: 'thread_1', label: '项目会话' }]}
      />
    );

    expect(await screen.findByText('提交前运行全部测试')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: '搜索记忆' }), '测试');
    await waitFor(() => expect(service.listMemories).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: '测试' })
    ));

    await user.click(screen.getByRole('button', { name: '新建记忆' }));
    await user.clear(screen.getByRole('textbox', { name: '记忆内容' }));
    await user.type(screen.getByRole('textbox', { name: '记忆内容' }), '项目使用 pnpm');
    await user.selectOptions(screen.getByRole('combobox', { name: '记忆范围' }), 'project');
    await user.selectOptions(screen.getByRole('combobox', { name: '范围目标' }), '/workspace/project');
    await user.click(screen.getByRole('button', { name: '保存记忆' }));
    await waitFor(() => expect(service.createMemory).toHaveBeenCalledWith({
      content: '项目使用 pnpm',
      scope: 'project',
      scopeKey: '/workspace/project',
      source: 'user'
    }));

    await user.click(screen.getByRole('button', { name: '编辑记忆' }));
    await user.clear(screen.getByRole('textbox', { name: '记忆内容' }));
    await user.type(screen.getByRole('textbox', { name: '记忆内容' }), '提交前运行全量测试');
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(service.updateMemory).toHaveBeenCalledWith(
      'mem_1',
      { content: '提交前运行全量测试' }
    ));

    await user.click(screen.getByRole('button', { name: '停用记忆' }));
    await waitFor(() => expect(service.updateMemory).toHaveBeenCalledWith('mem_1', { enabled: false }));

    await user.click(screen.getByRole('button', { name: '删除记忆' }));
    await waitFor(() => expect(service.deleteMemory).toHaveBeenCalledWith('mem_1'));

    await user.click(screen.getByRole('button', { name: '全部停用' }));
    await user.click(screen.getByRole('button', { name: '确认全部停用' }));
    await waitFor(() => expect(service.disableAll).toHaveBeenCalledTimes(1));
  });

  it('requires explicit confirmation before saving sensitive content', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.createMemory)
      .mockRejectedValueOnce(new ApiClientError({
        status: 409,
        code: 'MEMORY_SENSITIVE_CONFIRMATION_REQUIRED',
        message: 'requires confirmation'
      }))
      .mockResolvedValueOnce({ memory: createMemory({ content: 'password=secret' }) });

    render(<MemorySettingsView connected service={service} projects={[]} threads={[]} />);
    await screen.findByText('提交前运行全部测试');
    await user.click(screen.getByRole('button', { name: '新建记忆' }));
    await user.type(screen.getByRole('textbox', { name: '记忆内容' }), 'password=secret');
    await user.click(screen.getByRole('button', { name: '保存记忆' }));

    expect(await screen.findByText(/可能包含敏感信息/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认保存敏感记忆' }));
    await waitFor(() => expect(service.createMemory).toHaveBeenLastCalledWith({
      content: 'password=secret',
      scope: 'global',
      source: 'user',
      acknowledgeSensitive: true
    }));
  });

  it('shows versioned summaries and deletes one explicitly', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <MemorySettingsView
        connected
        service={service}
        projects={[]}
        threads={[{ key: 'thread_1', label: '项目会话' }]}
      />
    );

    expect(await screen.findByText('版本 2')).toBeInTheDocument();
    expect(screen.getByText('用户：继续开发')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除摘要' }));
    await waitFor(() => expect(service.deleteSummary).toHaveBeenCalledWith('summary_1'));
  });
});

function createService(): MemorySettingsService & Record<string, ReturnType<typeof vi.fn>> {
  return {
    listMemories: vi.fn(async () => ({ memories: [createMemory()] })),
    createMemory: vi.fn(async input => ({ memory: createMemory({ content: input.content }) })),
    updateMemory: vi.fn(async (_id, input) => ({ memory: createMemory({
      content: input.content ?? '提交前运行全部测试',
      enabled: input.enabled ?? true
    }) })),
    deleteMemory: vi.fn(async () => ({ deleted: true as const })),
    disableAll: vi.fn(async () => ({ disabledCount: 1 })),
    listSummaries: vi.fn(async () => ({ summaries: [createSummary()] })),
    deleteSummary: vi.fn(async () => ({ deleted: true as const }))
  };
}

function createMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'mem_1',
    content: '提交前运行全部测试',
    scope: 'global',
    source: 'user',
    enabled: true,
    sensitive: false,
    userConfirmedAt: '2026-07-12T00:00:00.000Z',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides
  };
}

function createSummary(): ConversationSummary {
  return {
    id: 'summary_1',
    threadId: 'thread_1',
    content: '用户：继续开发',
    coveredFromCursor: 'item_1',
    coveredToCursor: 'item_4',
    itemCount: 4,
    version: 2,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  };
}
