import { constants as fsConstants } from 'node:fs';
import {
  accessSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  WorkspaceDirectoryListRequest,
  WorkspaceDirectoryResponse,
  WorkspaceFileBlobRequest,
  WorkspaceFileContentRequest,
  WorkspaceFileContentResponse,
  WorkspaceFileMeta,
  WorkspaceFileMetaRequest,
  WorkspaceFileRevealRequest,
  WorkspaceFileRevealResponse,
  WorkspaceFileSaveRequest,
  WorkspaceFileSaveResponse
} from '@clawee/protocol';
import type { RuntimeThread } from '../threads/types.js';
import { WorkspaceFileError } from './errors.js';
import { isEditable, isPreviewable, isSensitivePath, isTextualKind, kindFor, mimeFor, reasonForUnavailable } from './mime.js';
import { assertInsideRoot, assertRegularFile, isIgnoredDir, resolveSafeExisting, validateRelativePath } from './paths.js';
import { defaultRevealExecutor, type RevealExecutor } from './reveal.js';
import { buildDirectoryResponse } from './tree.js';
import { MAX_IMAGE_BYTES, MAX_JSON_FORMAT_BYTES, MAX_PDF_BYTES, MAX_TEXT_BYTES } from './types.js';

export type WorkspaceFileService = {
  listDirectory(request: WorkspaceDirectoryListRequest): Promise<WorkspaceDirectoryResponse>;
  getMeta(request: WorkspaceFileMetaRequest): Promise<WorkspaceFileMeta>;
  readContent(request: WorkspaceFileContentRequest): Promise<WorkspaceFileContentResponse>;
  saveContent(request: WorkspaceFileSaveRequest): Promise<WorkspaceFileSaveResponse>;
  readBlob(request: WorkspaceFileBlobRequest): Promise<Buffer>;
  reveal(request: WorkspaceFileRevealRequest): Promise<WorkspaceFileRevealResponse>;
};

export function createWorkspaceFileService(input: {
  getThread(threadId: string): RuntimeThread | undefined;
  revealExecutor?: RevealExecutor;
}): WorkspaceFileService {
  const revealExecutor = input.revealExecutor ?? defaultRevealExecutor;

  return {
    async listDirectory(request) {
      const { rootReal, thread } = getWorkspaceRoot(input.getThread, request.threadId);
      const relativePath = validateRelativePath(request.path, true);
      const absolutePath = resolveSafeExisting(rootReal, relativePath);
      const stats = lstatSync(absolutePath);
      if (!stats.isDirectory()) {
        throw new WorkspaceFileError('UNSUPPORTED_FILE_TYPE', 'Target path is not a directory.');
      }

      return buildDirectoryResponse({
        threadId: request.threadId,
        rootName: basename(thread.canonicalCwd) || thread.canonicalCwd,
        rootPathLabel: thread.canonicalCwd,
        path: relativePath,
        absolutePath
      });
    },

    async getMeta(request) {
      const resolved = resolveFileRequest(input.getThread, request.threadId, request.path);
      return buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath);
    },

    async readContent(request) {
      const resolved = resolveFileRequest(input.getThread, request.threadId, request.path);
      const meta = buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath);
      if (isSensitivePath(resolved.relativePath)) {
        throw new WorkspaceFileError('PERMISSION_DENIED', 'Sensitive files are not readable.');
      }
      if (!isTextualKind(meta.kind)) {
        throw new WorkspaceFileError('UNSUPPORTED_FILE_TYPE', 'Only text-like files can be read as content.');
      }
      assertWithinLimit(meta.kind, meta.size);

      return {
        meta,
        content: readFileSync(resolved.absolutePath, 'utf8'),
        encoding: 'utf8'
      };
    },

    async saveContent(request) {
      const resolved = resolveFileRequest(input.getThread, request.threadId, request.path);
      if (resolved.thread.status === 'archived') {
        throw new WorkspaceFileError('PERMISSION_DENIED', 'Archived threads cannot save files.');
      }
      if (resolved.thread.sandbox === 'read-only') {
        throw new WorkspaceFileError('PERMISSION_DENIED', 'Thread sandbox is read-only.');
      }
      if (isSensitivePath(resolved.relativePath)) {
        throw new WorkspaceFileError('PERMISSION_DENIED', 'Sensitive files cannot be modified.');
      }
      const currentMeta = buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath);
      if (!currentMeta.editable) {
        throw new WorkspaceFileError('FILE_NOT_EDITABLE', 'File is not editable.');
      }
      assertWithinLimit(currentMeta.kind, Buffer.byteLength(request.content, 'utf8'));
      if (currentMeta.versionToken !== request.baseVersionToken) {
        throw new WorkspaceFileError('FILE_CONFLICT', 'File version token does not match current content.');
      }

      safeOverwriteFile(resolved.rootReal, resolved.absolutePath, request.content);
      return {
        meta: buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath),
        saved: true
      };
    },

    async readBlob(request) {
      const resolved = resolveFileRequest(input.getThread, request.threadId, request.path);
      const meta = buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath);
      if ((meta.kind !== 'image' && meta.kind !== 'pdf') || !meta.previewable) {
        throw new WorkspaceFileError('UNSUPPORTED_FILE_TYPE', 'Only previewable images and PDFs can be read as blobs.');
      }
      return readFileSync(resolved.absolutePath);
    },

    async reveal(request) {
      const { rootReal } = getWorkspaceRoot(input.getThread, request.threadId);
      const relativePath = validateRelativePath(request.path ?? '', request.mode === 'directory');
      const absolutePath = request.mode === 'directory' && relativePath.length === 0
        ? rootReal
        : resolveSafeExisting(rootReal, relativePath);

      if (request.mode === 'file') assertRegularFile(absolutePath);
      if (request.mode === 'directory' && isIgnoredDir(basename(absolutePath))) {
        throw new WorkspaceFileError('PATH_IGNORED', 'Ignored paths are not available.');
      }

      await revealExecutor({ absolutePath, mode: request.mode });
      return { ok: true };
    }
  };
}

function getWorkspaceRoot(
  getThread: (threadId: string) => RuntimeThread | undefined,
  threadId: string
): { thread: RuntimeThread; rootReal: string } {
  const thread = getThread(threadId);
  if (thread === undefined) throw new WorkspaceFileError('THREAD_NOT_FOUND', 'Thread not found.');
  if (!thread.canonicalCwd || !existsSync(thread.canonicalCwd)) {
    throw new WorkspaceFileError('WORKSPACE_NOT_FOUND', 'Workspace root not found.');
  }
  return { thread, rootReal: realpathSync(thread.canonicalCwd) };
}

function resolveFileRequest(
  getThread: (threadId: string) => RuntimeThread | undefined,
  threadId: string,
  rawPath: string
): { thread: RuntimeThread; rootReal: string; relativePath: string; absolutePath: string } {
  const { thread, rootReal } = getWorkspaceRoot(getThread, threadId);
  const relativePath = validateRelativePath(rawPath, false);
  let absolutePath: string;
  try {
    absolutePath = resolveSafeExisting(rootReal, relativePath);
    assertRegularFile(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new WorkspaceFileError('FILE_NOT_FOUND', 'File not found.');
    }
    throw error;
  }
  return { thread, rootReal, relativePath, absolutePath };
}

function buildMeta(thread: RuntimeThread, relativePath: string, absolutePath: string): WorkspaceFileMeta {
  const stats = statSync(absolutePath);
  const kind = kindFor(relativePath);
  const reason = reasonForUnavailable(kind, relativePath, stats.size);

  return {
    path: relativePath,
    name: basename(relativePath),
    type: 'file',
    kind,
    mime: mimeFor(relativePath),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    versionToken: versionTokenFor(absolutePath, stats.mtimeMs, stats.size),
    previewable: isPreviewable(kind, relativePath, stats.size),
    editable: isEditable(kind, relativePath, stats.size),
    readonly: thread.sandbox === 'read-only' || thread.status === 'archived',
    ...(reason ? { reason } : {})
  };
}

function versionTokenFor(absolutePath: string, mtimeMs: number, size: number): string {
  const digest = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
  return `${Math.floor(mtimeMs)}:${size}:sha256:${digest}`;
}

function assertWithinLimit(kind: WorkspaceFileMeta['kind'], size: number): void {
  const limit = kind === 'json' ? MAX_JSON_FORMAT_BYTES : kind === 'image' ? MAX_IMAGE_BYTES : kind === 'pdf' ? MAX_PDF_BYTES : MAX_TEXT_BYTES;
  if (size > limit) {
    throw new WorkspaceFileError('FILE_TOO_LARGE', 'File exceeds supported size limit.', {
      details: { size, limit, kind }
    });
  }
}

function safeOverwriteFile(rootReal: string, absolutePath: string, content: string): void {
  const realBefore = realpathSync(absolutePath);
  assertInsideRoot(rootReal, realBefore);
  const stats = lstatSync(absolutePath);
  if (!stats.isFile()) throw new WorkspaceFileError('PATH_ESCAPE', 'Target is not a regular file.');
  accessSync(absolutePath, fsConstants.W_OK);

  const tempPath = `${absolutePath}.clawee-tmp-${process.pid}-${Date.now()}`;
  let handle: number | undefined;
  try {
    const flags = fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0);
    handle = openSync(tempPath, flags, 0o600);
    writeFileSync(handle, content, 'utf8');
    const realAfter = realpathSync(absolutePath);
    assertInsideRoot(rootReal, realAfter);
    renameSync(tempPath, absolutePath);
    const finalReal = realpathSync(absolutePath);
    assertInsideRoot(rootReal, finalReal);
  } catch (error) {
    rmSync(tempPath, { force: true });
    if (error instanceof WorkspaceFileError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new WorkspaceFileError('FILE_NOT_FOUND', 'File not found.');
    }
    if ((error as NodeJS.ErrnoException)?.code === 'EACCES' || (error as NodeJS.ErrnoException)?.code === 'EPERM') {
      throw new WorkspaceFileError('PERMISSION_DENIED', 'File is not writable.');
    }
    throw error;
  } finally {
    if (handle !== undefined) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }
}
