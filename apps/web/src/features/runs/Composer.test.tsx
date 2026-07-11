import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

const defaultProps = {
  projectName: 'content-design',
  permission: 'danger-full-access' as const,
  model: null,
  reasoning: null,
  onSubmit: vi.fn()
};

describe('Composer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows codex-style composer controls', () => {
    render(<Composer {...defaultProps} permission="workspace-write" />);

    expect(screen.getByRole('button', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 工作区读写' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.queryByText('跟随全局配置')).not.toBeInTheDocument();
    expect(screen.queryByText('本地模式')).not.toBeInTheDocument();
    expect(screen.queryByText('open-clawee')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('随心输入')).toBeInTheDocument();
  });

  it('opens menus and submits selected permission and model config', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} permission="workspace-write" onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: '选择访问权限 工作区读写' }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问/ }));

    await user.click(screen.getByRole('button', { name: '选择模型 默认模型' }));
    await user.click(screen.getByRole('menuitemradio', { name: /默认模型 超高/ }));

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '  hello  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('hello', {
      permission: 'danger-full-access',
      model: null,
      reasoning: 'xhigh'
    });
    expect(textbox).toHaveValue('');
  });

  it('opens the add context menu', async () => {
    const user = userEvent.setup();
    render(<Composer {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '添加上下文' }));

    expect(screen.getByRole('menu', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '添加文件' })).toBeInTheDocument();
  });

  it('is disabled when current thread has an active run', () => {
    render(<Composer {...defaultProps} disabled disabledReason="当前对话有任务运行中" />);

    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.getByPlaceholderText('当前对话有任务运行中')).toBeInTheDocument();
  });

  it('shows an interrupt control while a task is running', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(
      <Composer
        {...defaultProps}
        disabled
        running
        disabledReason="当前对话有任务运行中"
        onCancel={onCancel}
      />
    );

    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '停止任务' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <Composer
        {...defaultProps}
        disabled
        running
        canceling
        disabledReason="正在停止任务"
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole('button', { name: '正在停止任务' })).toBeDisabled();
  });

  it('keeps permission and model controls visible when disabled', () => {
    render(<Composer {...defaultProps} disabled />);

    expect(screen.getByRole('button', { name: '选择访问权限 完全访问' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();
  });

  it('submits the trimmed prompt and clears the textbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '  hello  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('hello', {
      permission: 'danger-full-access',
      model: null,
      reasoning: null
    });
    expect(textbox).toHaveValue('');
  });

  it('auto-sizes the textbox to its content and resets after submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get() {
        return textbox.value.includes('\n') ? 52 : 28;
      }
    });

    await user.type(textbox, 'first line');
    await waitFor(() => expect(textbox.style.height).toBe('28px'));

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textbox, 'second line');
    await waitFor(() => expect(textbox.style.height).toBe('52px'));

    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('first line\nsecond line', {
      permission: 'danger-full-access',
      model: null,
      reasoning: null
    });
    await waitFor(() => expect(textbox.style.height).toBe('28px'));
  });

  it('caps the textbox at three lines and scrolls to keep the latest input visible', async () => {
    render(<Composer {...defaultProps} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    let assignedScrollTop = 0;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get() {
        const lineCount = textbox.value.split('\n').length;
        if (lineCount >= 4) return 100;
        if (lineCount === 3) return 76;
        if (lineCount === 2) return 52;
        return 28;
      }
    });
    Object.defineProperty(textbox, 'scrollTop', {
      configurable: true,
      get() {
        return assignedScrollTop;
      },
      set(value: number) {
        assignedScrollTop = value;
      }
    });

    fireEvent.change(textbox, { target: { value: 'first\nsecond\nthird\nfourth' } });

    await waitFor(() => {
      expect(textbox.style.height).toBe('76px');
      expect(textbox.style.overflowY).toBe('auto');
      expect(textbox.scrollTop).toBe(100);
    });
  });

  it('submits with Enter and keeps Shift+Enter for new lines', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, 'hello');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('hello\n');

    await user.type(textbox, 'world');
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('hello\nworld', {
      permission: 'danger-full-access',
      model: null,
      reasoning: null
    });
    expect(textbox).toHaveValue('');
  });

  it('does not submit Enter during IME composition', () => {
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    fireEvent.change(textbox, { target: { value: '你好' } });
    fireEvent.keyDown(textbox, {
      key: 'Enter',
      code: 'Enter',
      isComposing: true
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('你好');
  });

  it('does not submit when disabled even if the form submit event fires', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    fireEvent.change(textbox, { target: { value: '  hello  ' } });
    rerender(<Composer {...defaultProps} disabled onSubmit={onSubmit} />);
    fireEvent.submit(textbox.closest('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit an empty trimmed prompt', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '   ');

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('applies an external draft once and focuses the textarea', async () => {
    const user = userEvent.setup();
    const onDraftApplied = vi.fn();
    const { rerender } = render(
      <Composer
        {...defaultProps}
        draftRequest={{ id: 1, text: '$frontend-slides ' }}
        onDraftApplied={onDraftApplied}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await waitFor(() => {
      expect(textbox).toHaveValue('$frontend-slides ');
      expect(textbox).toHaveFocus();
    });
    expect(onDraftApplied).toHaveBeenCalledWith(1);

    await user.type(textbox, '生成季度汇报');
    rerender(<Composer {...defaultProps} onDraftApplied={onDraftApplied} />);
    expect(textbox).toHaveValue('$frontend-slides 生成季度汇报');
  });

  it('applies an external draft after RAF focus and caret placement in StrictMode', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextRafId += 1;
      callbacks.set(nextRafId, callback);
      return nextRafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
    const calls: string[] = [];
    const onDraftApplied = vi.fn(() => calls.push('applied'));

    render(
      <StrictMode>
        <Composer
          {...defaultProps}
          draftRequest={{ id: 7, text: '$frontend-slides ' }}
          onDraftApplied={onDraftApplied}
        />
      </StrictMode>
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    const originalFocus = textbox.focus.bind(textbox);
    vi.spyOn(textbox, 'focus').mockImplementation(() => {
      calls.push('focus');
      originalFocus();
    });
    const originalSetSelectionRange = textbox.setSelectionRange.bind(textbox);
    vi.spyOn(textbox, 'setSelectionRange').mockImplementation((start, end, direction) => {
      calls.push(`selection:${start}:${end}`);
      originalSetSelectionRange(start, end, direction);
    });

    expect(textbox).toHaveValue('$frontend-slides ');
    expect(callbacks.size).toBe(1);
    expect(onDraftApplied).not.toHaveBeenCalled();

    const callback = Array.from(callbacks.values())[0]!;
    act(() => {
      callback(16);
    });

    expect(calls).toEqual(['focus', 'selection:17:17', 'applied']);
    expect(textbox).toHaveFocus();
    expect(textbox.selectionStart).toBe(17);
    expect(textbox.selectionEnd).toBe(17);
    expect(onDraftApplied).toHaveBeenCalledWith(7);
  });

  it('cancels a pending draft RAF on unmount without applying the draft', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextRafId += 1;
      callbacks.set(nextRafId, callback);
      return nextRafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
    const onDraftApplied = vi.fn();

    const { unmount } = render(
      <Composer
        {...defaultProps}
        draftRequest={{ id: 9, text: '$frontend-slides ' }}
        onDraftApplied={onDraftApplied}
      />
    );

    expect(callbacks.size).toBe(1);
    unmount();

    expect(callbacks.size).toBe(0);
    expect(onDraftApplied).not.toHaveBeenCalled();
  });

  it('typing slash opens skills, MCP, and goal commands and inserts the selected command', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理和方案发散',
            insertText: '$brainstorming '
          },
          {
            id: 'mcp:github',
            category: 'mcp',
            label: 'github',
            description: 'stdio · configured',
            insertText: '使用 MCP：github '
          },
          {
            id: 'goal:create',
            category: 'goal',
            label: '设置 Goal',
            description: '为这次任务声明目标',
            insertText: '目标：'
          }
        ]}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '/');

    expect(screen.getByRole('listbox', { name: '能力菜单' })).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByText('Goal')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /brainstorming/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /github/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /设置 Goal/ })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /brainstorming/ }));

    expect(textbox).toHaveValue('$brainstorming ');
    expect(screen.queryByRole('listbox', { name: '能力菜单' })).not.toBeInTheDocument();
  });

  it('filters slash commands and selects the active command with Enter', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理和方案发散',
            insertText: '$brainstorming '
          },
          {
            id: 'mcp:github',
            category: 'mcp',
            label: 'github',
            description: 'stdio · configured',
            insertText: '使用 MCP：github '
          }
        ]}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '/git');

    expect(screen.queryByRole('option', { name: /brainstorming/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /github/ })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');

    expect(textbox).toHaveValue('使用 MCP：github ');
  });
});
