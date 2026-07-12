import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import { MemorySuggestion } from './MemorySuggestion.js';

describe('MemorySuggestion', () => {
  it('dismisses a suggestion without saving it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(
      <MemorySuggestion
        content="以后都运行全量测试"
        projectKey="/workspace/project"
        threadKey="thread_1"
        onSave={onSave}
        onDismiss={onDismiss}
      />
    );

    await user.click(screen.getByRole('button', { name: '忽略记忆建议' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves an edited suggestion in the selected scope', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    const onDismiss = vi.fn();
    render(
      <MemorySuggestion
        content="以后都运行测试"
        projectKey="/workspace/project"
        threadKey="thread_1"
        onSave={onSave}
        onDismiss={onDismiss}
      />
    );

    await user.clear(screen.getByRole('textbox', { name: '记忆建议内容' }));
    await user.type(screen.getByRole('textbox', { name: '记忆建议内容' }), '默认运行全量测试');
    await user.selectOptions(screen.getByRole('combobox', { name: '记忆建议范围' }), 'project');
    await user.click(screen.getByRole('button', { name: '保存记忆建议' }));

    expect(onSave).toHaveBeenCalledWith({
      content: '默认运行全量测试',
      scope: 'project',
      scopeKey: '/workspace/project',
      source: 'agent_suggestion'
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('requires a second confirmation for sensitive suggestions', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn()
      .mockRejectedValueOnce(new ApiClientError({
        status: 409,
        code: 'MEMORY_SENSITIVE_CONFIRMATION_REQUIRED',
        message: 'requires confirmation'
      }))
      .mockResolvedValueOnce(undefined);
    render(
      <MemorySuggestion
        content="password=secret"
        projectKey="/workspace/project"
        threadKey="thread_1"
        onSave={onSave}
        onDismiss={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '保存记忆建议' }));
    expect(await screen.findByText(/可能包含敏感信息/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认保存敏感建议' }));

    expect(onSave).toHaveBeenLastCalledWith({
      content: 'password=secret',
      scope: 'thread',
      scopeKey: 'thread_1',
      source: 'agent_suggestion',
      acknowledgeSensitive: true
    });
  });
});
