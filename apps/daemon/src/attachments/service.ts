import type {
  AttachmentAccessRequest,
  AttachmentResponse,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  RuntimeErrorCode
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync
} from 'node:fs';
import {
  rename,
  rm,
  writeFile,
  readFile
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { nanoid } from 'nanoid';

export const ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ALLOWED_MIME_TYPES = new Set([
  'application/json',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/markdown',
  'text/plain'
]);

type AttachmentRow = {
  id: string;
  file_name: string;
  mime: string;
  size: number;
  sha256: string;
  storage_path: string;
  draft_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  status: 'draft' | 'committed';
  created_at: string;
  updated_at: string;
};

export type AttachmentService = ReturnType<typeof createAttachmentService>;

export type CreateAttachmentServiceInput = {
  db: Database.Database;
  dataDir: string;
  maxSizeBytes?: number;
  draftTtlMs?: number;
  now?: () => Date;
  createId?: () => string;
};

export class AttachmentServiceError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly statusCode: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AttachmentServiceError';
  }
}

export function createAttachmentService(input: CreateAttachmentServiceInput) {
  const rootDir = resolve(input.dataDir, 'attachments');
  const tempDir = join(rootDir, '.tmp');
  const trashDir = join(rootDir, '.trash');
  const maxSizeBytes = input.maxSizeBytes ?? ATTACHMENT_MAX_SIZE_BYTES;
  const draftTtlMs = input.draftTtlMs ?? ATTACHMENT_DRAFT_TTL_MS;
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? (() => nanoid());
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  assertNotSymlinkDirectory(rootDir);
  const canonicalRootDir = realpathSync(rootDir);
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  mkdirSync(trashDir, { recursive: true, mode: 0o700 });
  assertSafeDirectory(canonicalRootDir, tempDir);
  assertSafeDirectory(canonicalRootDir, trashDir);

  const selectById = input.db.prepare('SELECT * FROM attachments WHERE id = ?');
  const selectDraftDuplicate = input.db.prepare(`
    SELECT * FROM attachments
    WHERE draft_id = ? AND sha256 = ? AND status = 'draft'
  `);
  const insertAttachment = input.db.prepare(`
    INSERT INTO attachments (
      id, file_name, mime, size, sha256, storage_path,
      draft_id, thread_id, run_id, status, created_at, updated_at
    ) VALUES (
      @id, @file_name, @mime, @size, @sha256, @storage_path,
      @draft_id, @thread_id, @run_id, @status, @created_at, @updated_at
    )
  `);
  const deleteAttachment = input.db.prepare('DELETE FROM attachments WHERE id = ?');
  const selectExpiredDrafts = input.db.prepare(`
    SELECT * FROM attachments
    WHERE status = 'draft' AND created_at < ?
    ORDER BY created_at ASC, id ASC
  `);
  const selectByRun = input.db.prepare(`
    SELECT * FROM attachments
    WHERE run_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  const updateCommitted = input.db.prepare(`
    UPDATE attachments
    SET draft_id = NULL,
        thread_id = ?,
        run_id = ?,
        status = 'committed',
        updated_at = ?
    WHERE id = ? AND draft_id = ? AND status = 'draft'
  `);

  async function upload(
    request: AttachmentUploadRequest & { content: Buffer }
  ): Promise<AttachmentUploadResponse> {
    const owner = validateOwner(request);
    const fileName = sanitizeFileName(request.fileName);
    const mime = normalizeMime(request.mime);
    validateContent(request.content, mime, maxSizeBytes);
    const sha256 = createHash('sha256').update(request.content).digest('hex');

    if (owner.draftId !== undefined) {
      const duplicate = selectDraftDuplicate.get(owner.draftId, sha256) as AttachmentRow | undefined;
      if (duplicate !== undefined) {
        return { attachment: mapAttachment(duplicate), deduplicated: true };
      }
    }

    const id = createId();
    const storagePath = `${id.slice(0, 2)}/${id}.bin`;
    const finalPath = resolveStoragePath(rootDir, storagePath);
    const temporaryPath = join(tempDir, `${id}.upload`);
    const storageDir = dirname(finalPath);
    mkdirSync(storageDir, { recursive: true, mode: 0o700 });
    assertSafeDirectory(canonicalRootDir, storageDir);
    assertSafeDirectory(canonicalRootDir, tempDir);

    try {
      await writeFile(temporaryPath, request.content, { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, finalPath);
      const timestamp = now().toISOString();
      const status = owner.draftId === undefined ? 'committed' : 'draft';
      insertAttachment.run({
        id,
        file_name: fileName,
        mime,
        size: request.content.length,
        sha256,
        storage_path: storagePath,
        draft_id: owner.draftId ?? null,
        thread_id: owner.threadId ?? null,
        run_id: null,
        status,
        created_at: timestamp,
        updated_at: timestamp
      });
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      await rm(finalPath, { force: true }).catch(() => undefined);
      if (owner.draftId !== undefined) {
        const duplicate = selectDraftDuplicate.get(owner.draftId, sha256) as AttachmentRow | undefined;
        if (duplicate !== undefined) {
          return { attachment: mapAttachment(duplicate), deduplicated: true };
        }
      }
      throw new AttachmentServiceError(
        'ATTACHMENT_STORAGE_FAILED',
        'Attachment could not be stored',
        500,
        { cause: formatError(error) }
      );
    }

    return {
      attachment: mapAttachment(selectRequiredRow(id)),
      deduplicated: false
    };
  }

  async function getMetadata(request: AttachmentAccessRequest): Promise<AttachmentResponse> {
    return mapAttachment(authorize(request));
  }

  async function read(
    request: AttachmentAccessRequest
  ): Promise<{ attachment: AttachmentResponse; content: Buffer }> {
    const row = authorize(request);
    try {
      return {
        attachment: mapAttachment(row),
        content: await readFile(resolveExistingStorageFile(
          rootDir,
          canonicalRootDir,
          row.storage_path
        ))
      };
    } catch (error) {
      throw new AttachmentServiceError(
        'ATTACHMENT_STORAGE_FAILED',
        'Attachment content is unavailable',
        500,
        { cause: formatError(error) }
      );
    }
  }

  async function deleteStored(request: AttachmentAccessRequest): Promise<void> {
    const row = authorize(request);
    let finalPath: string;
    try {
      finalPath = resolveExistingStorageFile(rootDir, canonicalRootDir, row.storage_path);
    } catch (error) {
      if (error instanceof AttachmentServiceError) throw error;
      if (!isNotFoundError(error)) throw error;
      finalPath = resolveStoragePath(rootDir, row.storage_path);
    }
    assertSafeDirectory(canonicalRootDir, trashDir);
    const trashPath = join(trashDir, `${row.id}.bin`);
    let moved = false;
    try {
      await rename(finalPath, trashPath);
      moved = true;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw new AttachmentServiceError(
          'ATTACHMENT_STORAGE_FAILED',
          'Attachment could not be deleted',
          500,
          { cause: formatError(error) }
        );
      }
    }

    try {
      deleteAttachment.run(row.id);
    } catch (error) {
      if (moved) await rename(trashPath, finalPath).catch(() => undefined);
      throw new AttachmentServiceError(
        'ATTACHMENT_STORAGE_FAILED',
        'Attachment metadata could not be deleted',
        500,
        { cause: formatError(error) }
      );
    }
    if (moved) await rm(trashPath, { force: true });
  }

  async function commit(request: {
    ids: string[];
    draftId: string;
    threadId: string;
    runId: string;
  }): Promise<AttachmentResponse[]> {
    validateNonEmpty(request.draftId, 'draftId');
    validateNonEmpty(request.threadId, 'threadId');
    validateNonEmpty(request.runId, 'runId');
    const timestamp = now().toISOString();
    const transaction = input.db.transaction(() => {
      for (const id of request.ids) {
        validateNonEmpty(id, 'attachment id');
        const result = updateCommitted.run(
          request.threadId,
          request.runId,
          timestamp,
          id,
          request.draftId
        );
        if (result.changes !== 1) {
          const row = selectById.get(id) as AttachmentRow | undefined;
          if (row === undefined) throw notFound(id);
          throw accessDenied(id);
        }
      }
    });
    transaction();
    return request.ids.map(id => mapAttachment(selectRequiredRow(id)));
  }

  function resolveImagesForRun(request: {
    ids: string[];
    draftId?: string;
    threadId?: string;
  }): Array<{ attachment: AttachmentResponse; path: string }> {
    const seen = new Set<string>();
    return request.ids.map(id => {
      if (seen.has(id)) {
        throw new AttachmentServiceError(
          'VALIDATION_FAILED',
          `Duplicate attachment id: ${id}`,
          400,
          { id }
        );
      }
      seen.add(id);
      const row = authorize({
        id,
        ...(request.draftId === undefined ? {} : { draftId: request.draftId }),
        ...(request.threadId === undefined ? {} : { threadId: request.threadId })
      });
      if (!row.mime.startsWith('image/')) {
        throw new AttachmentServiceError(
          'ATTACHMENT_TYPE_UNSUPPORTED',
          `Attachment is not a supported image: ${row.file_name}`,
          415,
          { id, mime: row.mime }
        );
      }
      return {
        attachment: mapAttachment(row),
        path: resolveExistingStorageFile(rootDir, canonicalRootDir, row.storage_path)
      };
    });
  }

  function listByRun(runId: string): AttachmentResponse[] {
    validateNonEmpty(runId, 'runId');
    return (selectByRun.all(runId) as AttachmentRow[]).map(mapAttachment);
  }

  async function cleanupExpiredDrafts(): Promise<{ deletedIds: string[] }> {
    const cutoff = new Date(now().getTime() - draftTtlMs).toISOString();
    const rows = selectExpiredDrafts.all(cutoff) as AttachmentRow[];
    const deletedIds: string[] = [];
    for (const row of rows) {
      await deleteStored({ id: row.id, draftId: row.draft_id ?? undefined });
      deletedIds.push(row.id);
    }
    return { deletedIds };
  }

  function authorize(request: AttachmentAccessRequest): AttachmentRow {
    if (request.draftId === undefined && request.threadId === undefined) {
      throw new AttachmentServiceError(
        'VALIDATION_FAILED',
        'draftId or threadId is required',
        400
      );
    }
    const row = selectById.get(request.id) as AttachmentRow | undefined;
    if (row === undefined) throw notFound(request.id);
    if (
      (request.draftId !== undefined && row.draft_id !== request.draftId)
      || (request.threadId !== undefined && row.thread_id !== request.threadId)
    ) {
      throw accessDenied(request.id);
    }
    return row;
  }

  function selectRequiredRow(id: string): AttachmentRow {
    const row = selectById.get(id) as AttachmentRow | undefined;
    if (row === undefined) throw notFound(id);
    return row;
  }

  return {
    upload,
    getMetadata,
    read,
    delete: deleteStored,
    commit,
    resolveImagesForRun,
    listByRun,
    cleanupExpiredDrafts,
    listStorageFiles: () => listStoredFiles(rootDir)
  };
}

function validateOwner(request: AttachmentUploadRequest): {
  draftId?: string;
  threadId?: string;
} {
  if (request.draftId === undefined && request.threadId === undefined) {
    throw new AttachmentServiceError(
      'VALIDATION_FAILED',
      'draftId or threadId is required',
      400
    );
  }
  if (request.draftId !== undefined) validateNonEmpty(request.draftId, 'draftId');
  if (request.threadId !== undefined) validateNonEmpty(request.threadId, 'threadId');
  return {
    ...(request.draftId === undefined ? {} : { draftId: request.draftId }),
    ...(request.threadId === undefined ? {} : { threadId: request.threadId })
  };
}

function sanitizeFileName(value: string): string {
  validateNonEmpty(value, 'fileName');
  const sanitized = basename(value.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (sanitized.length === 0) {
    throw new AttachmentServiceError('VALIDATION_FAILED', 'fileName is invalid', 400);
  }
  return sanitized.slice(0, 255);
}

function normalizeMime(value: string): string {
  const mime = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    throw new AttachmentServiceError(
      'ATTACHMENT_TYPE_UNSUPPORTED',
      `Attachment type is not supported: ${mime || 'unknown'}`,
      415,
      { mime }
    );
  }
  return mime;
}

function validateContent(content: Buffer, declaredMime: string, maxSizeBytes: number): void {
  if (content.length === 0) {
    throw new AttachmentServiceError('VALIDATION_FAILED', 'Attachment must not be empty', 400);
  }
  if (content.length > maxSizeBytes) {
    throw new AttachmentServiceError(
      'ATTACHMENT_TOO_LARGE',
      `Attachment exceeds the ${maxSizeBytes} byte limit`,
      413,
      { maxSizeBytes, size: content.length }
    );
  }
  const detectedMime = detectMime(content, declaredMime);
  if (detectedMime !== declaredMime) {
    throw new AttachmentServiceError(
      'ATTACHMENT_TYPE_MISMATCH',
      `Attachment content does not match declared type ${declaredMime}`,
      415,
      { declaredMime, detectedMime }
    );
  }
}

function detectMime(content: Buffer, declaredMime: string): string {
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg';
  const header = content.subarray(0, 6).toString('ascii');
  if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  if (
    content.subarray(0, 4).toString('ascii') === 'RIFF'
    && content.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (declaredMime === 'application/json' || declaredMime.startsWith('text/')) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
      if (text.includes('\u0000')) return 'application/octet-stream';
      if (declaredMime === 'application/json') JSON.parse(text);
      return declaredMime;
    } catch {
      return 'application/octet-stream';
    }
  }
  return 'application/octet-stream';
}

function resolveStoragePath(rootDir: string, storagePath: string): string {
  const target = resolve(rootDir, storagePath);
  const rel = relative(rootDir, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw new AttachmentServiceError(
      'ATTACHMENT_STORAGE_FAILED',
      'Attachment storage path is invalid',
      500
    );
  }
  return target;
}

function resolveExistingStorageFile(
  rootDir: string,
  canonicalRootDir: string,
  storagePath: string
): string {
  const target = resolveStoragePath(rootDir, storagePath);
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw invalidStoragePath();
  const canonicalTarget = realpathSync(target);
  assertWithinRoot(canonicalRootDir, canonicalTarget);
  return canonicalTarget;
}

function assertNotSymlinkDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw invalidStoragePath();
}

function assertSafeDirectory(canonicalRootDir: string, path: string): void {
  assertNotSymlinkDirectory(path);
  assertWithinRoot(canonicalRootDir, realpathSync(path));
}

function assertWithinRoot(canonicalRootDir: string, target: string): void {
  const rel = relative(canonicalRootDir, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw invalidStoragePath();
  }
}

function invalidStoragePath(): AttachmentServiceError {
  return new AttachmentServiceError(
    'ATTACHMENT_STORAGE_FAILED',
    'Attachment storage path is invalid',
    500
  );
}

function mapAttachment(row: AttachmentRow): AttachmentResponse {
  return {
    id: row.id,
    fileName: row.file_name,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    storageKey: row.storage_path,
    ...(row.draft_id === null ? {} : { draftId: row.draft_id }),
    ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listStoredFiles(rootDir: string): string[] {
  const result: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else result.push(relative(rootDir, path));
    }
  }
  walk(rootDir);
  return result.sort();
}

function validateNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new AttachmentServiceError(
      'VALIDATION_FAILED',
      `${field} must be a non-empty string`,
      400
    );
  }
}

function notFound(id: string): AttachmentServiceError {
  return new AttachmentServiceError(
    'ATTACHMENT_NOT_FOUND',
    `Attachment not found: ${id}`,
    404,
    { id }
  );
}

function accessDenied(id: string): AttachmentServiceError {
  return new AttachmentServiceError(
    'ATTACHMENT_ACCESS_DENIED',
    `Attachment access denied: ${id}`,
    403,
    { id }
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
