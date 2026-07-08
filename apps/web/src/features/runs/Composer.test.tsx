import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

const defaultProps = {
  projectName: 'content-design',
  permission: 'danger-full-access' as const,
  model: null,
  reasoning: null,
  onSubmit: vi.fn()
};

describe('Composer', () => {
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
});
