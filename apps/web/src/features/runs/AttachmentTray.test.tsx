import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('正在上传 uploading.png')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('网络错误');
    await user.click(screen.getByRole('button', { name: '移除附件 ready.png' }));
    await user.click(screen.getByRole('button', { name: '重试上传 failed.png' }));
    expect(onRemove).toHaveBeenCalledWith('ready');
    expect(onRetry).toHaveBeenCalledWith('failed');
  });
});
