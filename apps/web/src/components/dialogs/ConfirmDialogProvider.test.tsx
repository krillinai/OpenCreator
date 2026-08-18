import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider, useConfirmDialog } from './ConfirmDialogProvider.js';

describe('ConfirmDialogProvider', () => {
  it('renders confirmations in the shared centered dialog and resolves confirm or cancel', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmDialogProvider>
        <ConfirmationHarness onResult={onResult} />
      </ConfirmDialogProvider>
    );

    await user.click(screen.getByRole('button', { name: '恢复配置' }));
    const dialog = screen.getByRole('alertdialog', { name: '恢复默认配置' });
    expect(dialog).toHaveTextContent('这会清除已保存的 Key');
    expect(dialog.parentElement).toHaveClass('confirm-dialog-backdrop');

    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '恢复配置' }));
    await user.click(screen.getByRole('button', { name: '恢复默认' }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
  });

  it('queues simultaneous confirmations instead of overlapping them', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialogProvider>
        <QueueHarness />
      </ConfirmDialogProvider>
    );

    await user.click(screen.getByRole('button', { name: '连续确认' }));
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('第一项');

    await user.click(screen.getByRole('button', { name: '继续' }));
    expect(await screen.findByRole('alertdialog', { name: '第二项' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

function ConfirmationHarness(props: { onResult(result: boolean): void }) {
  const confirm = useConfirmDialog();
  return (
    <button type="button" onClick={() => {
      void confirm({
        title: '恢复默认配置',
        description: '这会清除已保存的 Key。',
        confirmLabel: '恢复默认',
        destructive: true
      }).then(props.onResult);
    }}>
      恢复配置
    </button>
  );
}

function QueueHarness() {
  const confirm = useConfirmDialog();
  const [, setResults] = useState<boolean[]>([]);
  return (
    <button type="button" onClick={() => {
      void Promise.all([
        confirm({ title: '第一项', description: '确认第一项', confirmLabel: '继续' }),
        confirm({ title: '第二项', description: '确认第二项', confirmLabel: '继续' })
      ]).then(setResults);
    }}>
      连续确认
    </button>
  );
}
