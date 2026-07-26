import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentTray } from './AttachmentTray.js';

describe('AttachmentTray', () => {
  it('shows preview, progress, errors, and attachment actions', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onRetry = vi.fn();
    render(
      <AttachmentTray
        items={[
          {
            localId: 'ready',
            fileName: 'ready.png',
            mime: 'image/png',
            previewUrl: 'blob:ready',
            status: 'ready'
          },
          {
            localId: 'uploading',
            fileName: 'uploading.png',
            mime: 'image/png',
            previewUrl: 'blob:uploading',
            status: 'uploading'
          },
          {
            localId: 'failed',
            fileName: 'failed.png',
            mime: 'image/png',
            previewUrl: 'blob:failed',
            status: 'error',
            error: '网络错误'
          }
        ]}
        onRemove={onRemove}
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('img', { name: 'ready.png' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '正在上传 uploading.png' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('网络错误');
    await user.click(screen.getByRole('button', { name: '移除附件 ready.png' }));
    await user.click(screen.getByRole('button', { name: '重试上传 failed.png' }));
    expect(onRemove).toHaveBeenCalledWith('ready');
    expect(onRetry).toHaveBeenCalledWith('failed');
  });

  it('opens a large image preview and restores focus when it closes', async () => {
    const user = userEvent.setup();
    render(
      <AttachmentTray
        items={[{
          localId: 'ready',
          fileName: 'ready.png',
          mime: 'image/png',
          previewUrl: 'blob:ready',
          status: 'ready'
        }]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: '预览附件 ready.png' });
    await user.click(trigger);

    const preview = screen.getByRole('dialog', { name: '预览附件 ready.png' });
    expect(within(preview).getByRole('img', { name: 'ready.png' })).toHaveAttribute(
      'src',
      'blob:ready'
    );
    expect(screen.getByRole('button', { name: '关闭图片预览' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '预览附件 ready.png' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
