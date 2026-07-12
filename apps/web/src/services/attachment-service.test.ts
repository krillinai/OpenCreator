import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createAttachmentService } from './attachment-service.js';

describe('attachment service', () => {
  it('uploads binary content with encoded metadata and exposes read and delete operations', async () => {
    const postBinary = vi.fn(async () => ({
      attachment: {
        id: 'attachment-1',
        fileName: '设计 图.png',
        mime: 'image/png'
      },
      deduplicated: false
    }));
    const get = vi.fn(async () => ({ attachment: { id: 'attachment-1' } }));
    const rawGet = vi.fn(async () => new Response('image', {
      headers: { 'content-type': 'image/png' }
    }));
    const deleteRequest = vi.fn(async () => ({ deleted: true }));
    const client = {
      postBinary,
      get,
      rawGet,
      delete: deleteRequest
    } as unknown as RuntimeClient;
    const service = createAttachmentService(client);
    const file = new File(['image'], '设计 图.png', { type: 'image/png' });

    await service.upload({
      file,
      draftId: 'draft/1'
    });
    await service.getMetadata({
      id: 'attachment-1',
      draftId: 'draft/1'
    });
    await service.openContent({
      id: 'attachment-1',
      draftId: 'draft/1'
    });
    await service.delete({
      id: 'attachment-1',
      draftId: 'draft/1'
    });

    expect(postBinary).toHaveBeenCalledWith(
      '/attachments?fileName=%E8%AE%BE%E8%AE%A1+%E5%9B%BE.png&mime=image%2Fpng&draftId=draft%2F1',
      file
    );
    expect(get).toHaveBeenCalledWith('/attachments/attachment-1?draftId=draft%2F1');
    expect(rawGet).toHaveBeenCalledWith('/attachments/attachment-1/content?draftId=draft%2F1');
    expect(deleteRequest).toHaveBeenCalledWith('/attachments/attachment-1?draftId=draft%2F1');
  });
});
