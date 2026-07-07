import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

const defaultProps = {
  projectName: 'content-design',
  branchName: 'main',
  permission: 'danger-full-access' as const,
  modelLabel: 'GPT-5',
  onSubmit: vi.fn()
};

describe('Composer', () => {
  it('shows the composer context and controls', () => {
    render(<Composer {...defaultProps} permission="workspace-write" />);

    expect(screen.getByText('content-design')).toBeInTheDocument();
    expect(screen.getByText('本地模式')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument();
    expect(screen.getByText('工作区读写')).not.toHaveProperty('tagName', 'BUTTON');
    expect(screen.getByText('GPT-5')).not.toHaveProperty('tagName', 'BUTTON');
    expect(screen.getByPlaceholderText('随心输入')).toBeInTheDocument();
  });

  it('maps permission labels', () => {
    const { rerender } = render(<Composer {...defaultProps} permission="danger-full-access" />);
    expect(screen.getByText('完全访问')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '完全访问' })).not.toBeInTheDocument();

    rerender(<Composer {...defaultProps} permission="follow-global" />);
    expect(screen.getByText('跟随全局配置')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '跟随全局配置' })).not.toBeInTheDocument();
  });

  it('is disabled when current thread has an active run', () => {
    render(<Composer {...defaultProps} disabled />);

    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.getByPlaceholderText('当前对话有任务运行中')).toBeInTheDocument();
  });

  it('keeps permission and model as status text when disabled', () => {
    render(<Composer {...defaultProps} disabled />);

    expect(screen.getByText('完全访问')).not.toHaveProperty('tagName', 'BUTTON');
    expect(screen.getByText('GPT-5')).not.toHaveProperty('tagName', 'BUTTON');
    expect(screen.queryByRole('button', { name: '完全访问' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'GPT-5' })).not.toBeInTheDocument();
  });

  it('submits the trimmed prompt and clears the textbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '  hello  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('hello');
    expect(textbox).toHaveValue('');
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
