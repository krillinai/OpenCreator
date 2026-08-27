import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AttachmentServiceError,
  createAttachmentService
} from '../../src/attachments/service.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zkAAAAAASUVORK5CYII=',
  'base64'
);

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('attachment service', () => {
  it('stores verified content under generated paths and deduplicates within a draft', async () => {
    const service = setup();

    const first = await service.upload({
      draftId: 'draft-1',
      fileName: '../../avatar.png',
      mime: 'image/png',
      content: PNG
    });
    const duplicate = await service.upload({
      draftId: 'draft-1',
      fileName: 'copy.png',
      mime: 'image/png',
      content: PNG
    });
    const anotherDraft = await service.upload({
      draftId: 'draft-2',
      fileName: 'avatar.png',
      mime: 'image/png',
      content: PNG
    });

    expect(first.deduplicated).toBe(false);
    expect(first.attachment).toMatchObject({
      fileName: 'avatar.png',
      mime: 'image/png',
      size: PNG.length,
      draftId: 'draft-1',
      status: 'draft'
    });
    expect(first.attachment.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.attachment.storageKey).toMatch(/^[a-zA-Z0-9_-]{2}\/[a-zA-Z0-9_-]+\.bin$/);
    const storedRelativePath = relative(
      resolve(tempDir, 'attachments'),
      resolve(tempDir, 'attachments', first.attachment.storageKey)
    );
    expect(storedRelativePath.startsWith('..') || isAbsolute(storedRelativePath)).toBe(false);
    expect(existsSync(resolve(tempDir, 'attachments', first.attachment.storageKey))).toBe(true);
    expect(duplicate).toEqual({
      attachment: first.attachment,
      deduplicated: true
    });
    expect(anotherDraft.attachment.id).not.toBe(first.attachment.id);

    const loaded = await service.read({
      id: first.attachment.id,
      draftId: 'draft-1'
    });
    expect(loaded.content).toEqual(PNG);
    await expect(
      service.read({ id: first.attachment.id, draftId: 'draft-2' })
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_ACCESS_DENIED',
      statusCode: 403
    });
  });

  it('rejects oversized, unsupported, mismatched, and ownerless uploads without files', async () => {
    const service = setup({ maxSizeBytes: PNG.length - 1 });

    await expect(
      service.upload({
        draftId: 'draft-1',
        fileName: 'avatar.png',
        mime: 'image/png',
        content: PNG
      })
    ).rejects.toMatchObject({ code: 'ATTACHMENT_TOO_LARGE', statusCode: 413 });
    await expect(
      service.upload({
        draftId: 'draft-1',
        fileName: 'payload.svg',
        mime: 'image/svg+xml',
        content: Buffer.from('<svg/>')
      })
    ).rejects.toMatchObject({ code: 'ATTACHMENT_TYPE_UNSUPPORTED', statusCode: 415 });
    await expect(
      service.upload({
        draftId: 'draft-1',
        fileName: 'fake.png',
        mime: 'image/png',
        content: Buffer.from('not a png')
      })
    ).rejects.toMatchObject({ code: 'ATTACHMENT_TYPE_MISMATCH', statusCode: 415 });
    await expect(
      service.upload({
        fileName: 'avatar.png',
        mime: 'image/png',
        content: PNG
      })
    ).rejects.toBeInstanceOf(AttachmentServiceError);
    expect(service.listStorageFiles()).toEqual([]);
  });

  it('refuses generated storage paths whose parent was replaced by a symlink', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-attachments-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const outsideDir = join(tempDir, 'outside');
    mkdirSync(outsideDir);
    const service = createAttachmentService({
      db,
      dataDir: tempDir,
      createId: () => 'aa-attachment'
    });
    symlinkSync(
      outsideDir,
      join(tempDir, 'attachments', 'aa'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(
      service.upload({
        draftId: 'draft-1',
        fileName: 'avatar.png',
        mime: 'image/png',
        content: PNG
      })
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_STORAGE_FAILED',
      statusCode: 500
    });
    expect(existsSync(join(outsideDir, 'aa-attachment.bin'))).toBe(false);
  });

  it('persists committed metadata, deletes content, and cleans expired draft attachments', async () => {
    let now = new Date('2026-07-01T00:00:00.000Z');
    const service = setup({ now: () => now });
    const committed = await service.upload({
      draftId: 'draft-committed',
      fileName: 'committed.png',
      mime: 'image/png',
      content: PNG
    });
    const expired = await service.upload({
      draftId: 'draft-expired',
      fileName: 'expired.png',
      mime: 'image/png',
      content: PNG
    });

    await service.commit({
      ids: [committed.attachment.id],
      draftId: 'draft-committed',
      threadId: 'thread-1',
      runId: 'run-1'
    });
    now = new Date('2026-07-09T00:00:00.000Z');
    const cleanup = await service.cleanupExpiredDrafts();

    expect(cleanup.deletedIds).toEqual([expired.attachment.id]);
    expect(await service.getMetadata({
      id: committed.attachment.id,
      threadId: 'thread-1'
    })).toMatchObject({
      id: committed.attachment.id,
      threadId: 'thread-1',
      runId: 'run-1',
      status: 'committed'
    });
    expect(service.listByRun('run-1')).toEqual([
      expect.objectContaining({ id: committed.attachment.id, runId: 'run-1' })
    ]);
    expect(service.resolveImagesForRun({
      ids: [committed.attachment.id],
      threadId: 'thread-1'
    })).toEqual([
      expect.objectContaining({
        attachment: expect.objectContaining({ id: committed.attachment.id }),
        path: realpathSync(resolve(tempDir, 'attachments', committed.attachment.storageKey))
      })
    ]);
    await expect(
      service.getMetadata({ id: expired.attachment.id, draftId: 'draft-expired' })
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND', statusCode: 404 });

    const persistedService = createAttachmentService({ db: db!, dataDir: tempDir });
    expect(await persistedService.getMetadata({
      id: committed.attachment.id,
      threadId: 'thread-1'
    })).toMatchObject({ status: 'committed' });

    await persistedService.delete({
      id: committed.attachment.id,
      threadId: 'thread-1'
    });
    await expect(
      persistedService.read({ id: committed.attachment.id, threadId: 'thread-1' })
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND', statusCode: 404 });
    expect(persistedService.listStorageFiles()).toEqual([]);
  });
});

function setup(overrides: {
  maxSizeBytes?: number;
  now?: () => Date;
} = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-attachments-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  return createAttachmentService({
    db,
    dataDir: tempDir,
    ...overrides
  });
}
