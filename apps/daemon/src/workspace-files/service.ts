import { constants as fsConstants, type Stats } from 'node:fs';
import {
  accessSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from 'node:fs';
import { basename, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
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
} from '@opencreator/protocol';
import type { RuntimeThread } from '../threads/types.js';
import { WorkspaceFileError } from './errors.js';
import { isEditable, isPreviewable, isSensitivePath, isTextualKind, kindFor, mimeFor, reasonForUnavailable } from './mime.js';
import { assertInsideRoot, assertRegularFile, isIgnoredDir, resolveSafeExisting, resolveSafeParent, validateRelativePath } from './paths.js';
import { defaultRevealExecutor, type RevealExecutor } from './reveal.js';
import { buildDirectoryResponse } from './tree.js';
import { MAX_IMAGE_BYTES, MAX_JSON_FORMAT_BYTES, MAX_PDF_BYTES, MAX_TEXT_BYTES } from './types.js';

export type WorkspaceFileService = {
  listDirectory(request: WorkspaceDirectoryListRequest): Promise<WorkspaceDirectoryResponse>;
  getMeta(request: WorkspaceFileMetaRequest): Promise<WorkspaceFileMeta>;
  readContent(request: WorkspaceFileContentRequest): Promise<WorkspaceFileContentResponse>;
  saveContent(request: WorkspaceFileSaveRequest): Promise<WorkspaceFileSaveResponse>;
  readBlob(request: WorkspaceFileBlobRequest): Promise<{ meta: WorkspaceFileMeta; buffer: Buffer }>;
  reveal(request: WorkspaceFileRevealRequest): Promise<WorkspaceFileRevealResponse>;
};

type WorkspaceFileOps = {
  accessSync: typeof accessSync;
  closeSync: typeof closeSync;
  fsyncSync: typeof fsyncSync;
  lstatSync: typeof lstatSync;
  openSync: typeof openSync;
  realpathSync: typeof realpathSync;
  renameSync: typeof renameSync;
  unlinkSync: typeof unlinkSync;
  writeSync: typeof writeSync;
};

const defaultFileOps: WorkspaceFileOps = {
  accessSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync
};

export function createWorkspaceFileService(input: {
  getThread(threadId: string): RuntimeThread | undefined;
  revealExecutor?: RevealExecutor;
  fileOps?: Partial<WorkspaceFileOps>;
}): WorkspaceFileService {
  const revealExecutor = input.revealExecutor ?? defaultRevealExecutor;
  const fileOps: WorkspaceFileOps = { ...defaultFileOps, ...input.fileOps };

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
        absolutePath,
        rootReal,
        readonly: thread.sandbox === 'read-only' || thread.status === 'archived'
      });
    },

    async getMeta(request) {
      const resolved = resolveFileRequest(input.getThread, request.threadId, request.path);
      if (isSensitivePath(resolved.relativePath)) {
        throw new WorkspaceFileError('PERMISSION_DENIED', 'Sensitive files are not readable.');
      }
      return buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath);
    },

    async readContent(request) {
      const resolved = resolveFileRequest(input.getThread, request.threadId, request.path);
      if (isSensitivePath(resolved.relativePath)) {
        throw new WorkspaceFileError('PERMISSION_DENIED', 'Sensitive files are not readable.');
      }
      const meta = buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath);
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
        throw new WorkspaceFileError('THREAD_ARCHIVED', 'Archived threads cannot save files.');
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
      if (request.overwriteConflict !== true && currentMeta.versionToken !== request.baseVersionToken) {
        throw new WorkspaceFileError('FILE_CONFLICT', 'File version token does not match current content.');
      }

      safeOverwriteFile(resolved.rootReal, resolved.relativePath, resolved.absolutePath, request.content, fileOps);
      return {
        meta: buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath),
        saved: true
      };
    },

    async readBlob(request) {
      const resolved = resolveFileRequest(input.getThread, request.threadId, request.path);
      if (isSensitivePath(resolved.relativePath)) {
        throw new WorkspaceFileError('PERMISSION_DENIED', 'Sensitive files are not readable.');
      }
      const meta = buildMeta(resolved.thread, resolved.relativePath, resolved.absolutePath);
      if ((meta.kind !== 'image' && meta.kind !== 'pdf') || !meta.previewable) {
        throw new WorkspaceFileError('UNSUPPORTED_FILE_TYPE', 'Only previewable images and PDFs can be read as blobs.');
      }
      return {
        meta,
        buffer: readFileSync(resolved.absolutePath)
      };
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

function safeOverwriteFile(
  rootReal: string,
  relativePath: string,
  absolutePath: string,
  content: string,
  fileOps: WorkspaceFileOps
): void {
  const { candidatePath, parentReal } = resolveSafeParent(rootReal, relativePath);
  const stats = fileOps.lstatSync(candidatePath);
  if (stats.isSymbolicLink()) {
    throw new WorkspaceFileError('PATH_ESCAPE', 'Target symlink is not writable.');
  }
  if (!stats.isFile()) throw new WorkspaceFileError('PATH_ESCAPE', 'Target is not a regular file.');
  fileOps.accessSync(candidatePath, fsConstants.W_OK);
  const realBefore = fileOps.realpathSync(candidatePath);
  assertInsideRoot(rootReal, realBefore);
  assertInsideRoot(rootReal, parentReal);

  const tempPath = createTempPath(parentReal, basename(candidatePath));
  let tempHandle: number | undefined;
  try {
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL;
    tempHandle = fileOps.openSync(tempPath, flags, stats.mode & 0o777);
    const buffer = Buffer.from(content, 'utf8');
    let written = 0;
    while (written < buffer.byteLength) {
      written += fileOps.writeSync(tempHandle, buffer, written, buffer.byteLength - written);
    }
    fileOps.fsyncSync(tempHandle);
    fileOps.closeSync(tempHandle);
    tempHandle = undefined;

    assertSameWritableTarget(rootReal, absolutePath, realBefore, stats, fileOps);
    fileOps.renameSync(tempPath, absolutePath);
    fsyncParentDirectory(parentReal, fileOps);
  } catch (error) {
    if (error instanceof WorkspaceFileError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new WorkspaceFileError('FILE_NOT_FOUND', 'File not found.');
    }
    if ((error as NodeJS.ErrnoException)?.code === 'EACCES' || (error as NodeJS.ErrnoException)?.code === 'EPERM') {
      throw new WorkspaceFileError('PERMISSION_DENIED', 'File is not writable.');
    }
    throw error;
  } finally {
    if (tempHandle !== undefined) {
      try {
        fileOps.closeSync(tempHandle);
      } catch {
        // ignore cleanup failure
      }
    }
    try {
      fileOps.unlinkSync(tempPath);
    } catch {
      // ignore cleanup failure
    }
  }
}

function assertSameWritableTarget(
  rootReal: string,
  targetPath: string,
  realBefore: string,
  originalStats: Stats,
  fileOps: WorkspaceFileOps
): void {
  let verifyStats: Stats;
  try {
    verifyStats = fileOps.lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new WorkspaceFileError('FILE_NOT_FOUND', 'File not found.');
    }
    throw error;
  }
  if (!verifyStats.isFile()) throw new WorkspaceFileError('PATH_ESCAPE', 'Target is not a regular file.');
  if (verifyStats.isSymbolicLink()) throw new WorkspaceFileError('PATH_ESCAPE', 'Target symlink is not writable.');
  const realAfter = fileOps.realpathSync(targetPath);
  assertInsideRoot(rootReal, realAfter);
  if (realAfter !== realBefore || verifyStats.dev !== originalStats.dev || verifyStats.ino !== originalStats.ino) {
    throw new WorkspaceFileError('PATH_ESCAPE', 'Target changed during save.');
  }
}

function createTempPath(parentPath: string, fileName: string): string {
  return join(parentPath, `.${fileName}.opencreator-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
}

function fsyncParentDirectory(parentReal: string, fileOps: WorkspaceFileOps): void {
  let directoryHandle: number | undefined;
  try {
    directoryHandle = fileOps.openSync(parentReal, fsConstants.O_RDONLY);
    fileOps.fsyncSync(directoryHandle);
  } catch {
    // best effort only
  } finally {
    if (directoryHandle !== undefined) {
      try {
        fileOps.closeSync(directoryHandle);
      } catch {
        // ignore cleanup failure
      }
    }
  }
}
