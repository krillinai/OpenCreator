import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

describe('Composer', () => {
  it('is disabled when current thread has an active run', () => {
    render(<Composer disabled onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  it('submits the trimmed prompt and clears the textbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '  hello  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('hello');
    expect(textbox).toHaveValue('');
  });

  it('does not submit when disabled even if the form submit event fires', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Composer onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    fireEvent.change(textbox, { target: { value: '  hello  ' } });
    rerender(<Composer disabled onSubmit={onSubmit} />);
    fireEvent.submit(textbox.closest('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
