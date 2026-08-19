import type {
  EnterpriseSharedFileDetailResponse,
  EnterpriseSharedFileDownloadResponse,
  EnterpriseSharedFileListResponse,
  EnterpriseSharedFileMutationResponse,
  EnterpriseSharedSpaceListResponse,
  RuntimeErrorCode
} from '@opencreator/protocol';
import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm
} from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import type { ProjectManager } from '../projects/types.js';
import { isIgnoredDir } from '../workspace-files/paths.js';
import type {
  EnterpriseHttpClient,
  EnterpriseRemoteSharedFile
} from './http-client-2026-07-30.js';
import { EnterpriseHttpError } from './http-client-2026-07-30.js';
import type { EnterpriseSessionManager } from './session-manager-2026-07-30.js';
import { EnterpriseSessionError } from './session-manager-2026-07-30.js';
import { ENTERPRISE_SHARED_FILE_MAX_BYTES } from './config-2026-07-30.js';

export type EnterpriseSharedDriveManager = {
  listSpaces(input?: {
    limit?: number;
    cursor?: string;
  }): Promise<EnterpriseSharedSpaceListResponse>;
  listFiles(input?: {
    spaceId?: string;
    query?: string;
    logicalPathPrefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<EnterpriseSharedFileListResponse>;
  getFileDetail(fileId: string): Promise<EnterpriseSharedFileDetailResponse>;
  uploadFile(input: {
    spaceId: string;
    logicalPath: string;
    expectedRevision?: number;
    contentType: string;
    expectedSizeBytes: number;
    content: AsyncIterable<Uint8Array>;
  }): Promise<EnterpriseSharedFileMutationResponse>;
  downloadToProject(input: {
    fileId: string;
    projectId: string;
    overwrite: boolean;
  }): Promise<EnterpriseSharedFileDownloadResponse>;
};

export class EnterpriseSharedDriveManagerError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    readonly statusCode: number,
    readonly details?: Record<string, unknown>
  ) {
    super(`${code}: enterprise shared drive operation failed`);
    this.name = 'EnterpriseSharedDriveManagerError';
  }
}

export function createEnterpriseSharedDriveManager(input: {
  dataDir: string;
  sessionManager: EnterpriseSessionManager;
  httpClient: EnterpriseHttpClient;
  projectManager: ProjectManager;
  maxFileBytes?: number;
  now?: () => Date;
}): EnterpriseSharedDriveManager {
  const maxFileBytes =
    input.maxFileBytes ?? ENTERPRISE_SHARED_FILE_MAX_BYTES;
  const now = input.now ?? (() => new Date());
  const tempDir = join(input.dataDir, 'enterprise-shared-drive', '.tmp');

  async function requireToken(): Promise<string> {
    try {
      return await input.sessionManager.requireAccessToken();
    } catch (error) {
      if (error instanceof EnterpriseSessionError) {
        throw new EnterpriseSharedDriveManagerError(
          error.code,
          error.statusCode
        );
      }
      throw error;
    }
  }

  async function runRemote<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw await managerErrorFromUnknown(error);
    }
  }

  async function managerErrorFromUnknown(
    error: unknown
  ): Promise<EnterpriseSharedDriveManagerError> {
    if (!(error instanceof EnterpriseHttpError)) throw error;
    if (error.code === 'ENTERPRISE_UNAUTHORIZED') {
      await input.sessionManager.invalidateUnauthorized();
      return new EnterpriseSharedDriveManagerError(
        'ENTERPRISE_SESSION_EXPIRED',
        401
      );
    }
    return new EnterpriseSharedDriveManagerError(
      error.code,
      error.statusCode ?? defaultStatusCode(error.code),
      error.details
    );
  }

  async function listSpaces(request: {
    limit?: number;
    cursor?: string;
  } = {}): Promise<EnterpriseSharedSpaceListResponse> {
    validateLimit(request.limit);
    validateCursor(request.cursor);
    const accessToken = await requireToken();
    const response = await runRemote(
      () => input.httpClient.listSharedSpaces(accessToken, request)
    );
    return {
      spaces: response.spaces,
      meta: response.meta,
      refreshedAt: now().toISOString()
    };
  }

  async function listFiles(request: {
    spaceId?: string;
    query?: string;
    logicalPathPrefix?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<EnterpriseSharedFileListResponse> {
    const spaceId = validateOptionalIdentifier(request.spaceId);
    const query = validateSearchQuery(request.query);
    const logicalPathPrefix = validateLogicalPathPrefix(
      request.logicalPathPrefix
    );
    validateLimit(request.limit);
    validateCursor(request.cursor);
    const accessToken = await requireToken();
    const response = await runRemote(
      () => input.httpClient.listSharedFiles({
        accessToken,
        ...(spaceId === undefined ? {} : { spaceId }),
        ...(query === undefined ? {} : { query }),
        ...(logicalPathPrefix === undefined ? {} : { logicalPathPrefix }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.cursor === undefined ? {} : { cursor: request.cursor })
      })
    );
    return {
      files: response.files,
      meta: response.meta,
      refreshedAt: now().toISOString()
    };
  }

  async function getFileDetail(
    fileId: string
  ): Promise<EnterpriseSharedFileDetailResponse> {
    validateIdentifier(fileId);
    const accessToken = await requireToken();
    const file = await runRemote(
      () => input.httpClient.getSharedFileDetail(accessToken, fileId)
    );
    return { file };
  }

  async function uploadFile(request: {
    spaceId: string;
    logicalPath: string;
    expectedRevision?: number;
    contentType: string;
    expectedSizeBytes: number;
    content: AsyncIterable<Uint8Array>;
  }): Promise<EnterpriseSharedFileMutationResponse> {
    const spaceId = validateIdentifier(request.spaceId);
    const logicalPath = validateLogicalPath(request.logicalPath);
    const contentType = validateContentType(request.contentType);
    validateExpectedRevision(request.expectedRevision);
    validateExpectedSize(request.expectedSizeBytes, maxFileBytes);
    const accessToken = await requireToken();

    await mkdir(tempDir, { recursive: true, mode: 0o700 });
    const temporaryPath = join(tempDir, `${randomUUID()}.upload`);
    try {
      const staged = await stageFile({
        content: request.content,
        expectedSizeBytes: request.expectedSizeBytes,
        maxFileBytes,
        temporaryPath
      });
      try {
        return await input.httpClient.uploadSharedFileContent({
          accessToken,
          spaceId,
          logicalPath,
          ...(request.expectedRevision === undefined
            ? {}
            : { expectedRevision: request.expectedRevision }),
          filePath: temporaryPath,
          sizeBytes: staged.sizeBytes,
          sha256: staged.sha256,
          contentType
        });
      } catch (error) {
        if (
          request.expectedRevision === undefined
          && error instanceof EnterpriseHttpError
          && error.code === 'ENTERPRISE_SERVICE_UNAVAILABLE'
        ) {
          const reconciled = await reconcileUnknownCreate({
            accessToken,
            spaceId,
            logicalPath,
            sha256: staged.sha256
          });
          if (reconciled !== undefined) return reconciled;
        }
        throw await managerErrorFromUnknown(error);
      }
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async function reconcileUnknownCreate(request: {
    accessToken: string;
    spaceId: string;
    logicalPath: string;
    sha256: string;
  }): Promise<EnterpriseSharedFileMutationResponse | undefined> {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    try {
      while (true) {
        const response = await input.httpClient.listSharedFiles({
          accessToken: request.accessToken,
          spaceId: request.spaceId,
          logicalPathPrefix: request.logicalPath,
          limit: 100,
          ...(cursor === undefined ? {} : { cursor })
        });
        const exact = response.files.find(
          file => file.logicalPath === request.logicalPath
        );
        if (exact !== undefined) {
          if (exact.sha256 !== request.sha256) {
            throw new EnterpriseSharedDriveManagerError(
              'ENTERPRISE_SHARED_FILE_ALREADY_EXISTS',
              409
            );
          }
          return mutationFromRemoteFile(exact, true);
        }
        if (!response.meta.hasNext || response.meta.nextCursor.length === 0) {
          return undefined;
        }
        if (seenCursors.has(response.meta.nextCursor)) return undefined;
        seenCursors.add(response.meta.nextCursor);
        cursor = response.meta.nextCursor;
      }
    } catch (error) {
      if (error instanceof EnterpriseSharedDriveManagerError) throw error;
      return undefined;
    }
  }

  async function downloadToProject(request: {
    fileId: string;
    projectId: string;
    overwrite: boolean;
  }): Promise<EnterpriseSharedFileDownloadResponse> {
    validateIdentifier(request.fileId);
    validateIdentifier(request.projectId);
    const project = input.projectManager.getProject(request.projectId);
    if (project === undefined) {
      throw new EnterpriseSharedDriveManagerError('PROJECT_NOT_FOUND', 404);
    }
    if (project.status === 'archived') {
      throw new EnterpriseSharedDriveManagerError('PROJECT_ARCHIVED', 409);
    }
    if (
      project.directoryState !== 'available'
      || project.canonicalCwd === null
    ) {
      throw new EnterpriseSharedDriveManagerError(
        'PROJECT_DIRECTORY_UNAVAILABLE',
        409
      );
    }

    const accessToken = await requireToken();
    const file = await runRemote(
      () => input.httpClient.getSharedFileDetail(
        accessToken,
        request.fileId
      )
    );
    const relativePath = validateLocalRelativePath(file.logicalPath);
    let rootReal: string;
    let target: Awaited<ReturnType<typeof prepareLocalTarget>>;
    let previous: ExistingTarget | undefined;
    try {
      rootReal = await realpath(project.cwd);
      if (rootReal !== project.canonicalCwd) {
        throw new EnterpriseSharedDriveManagerError(
          'PROJECT_DIRECTORY_UNAVAILABLE',
          409
        );
      }
      target = await prepareLocalTarget(rootReal, relativePath);
      previous = await readExistingTarget(rootReal, target.path);
    } catch (error) {
      if (error instanceof EnterpriseSharedDriveManagerError) throw error;
      throw new EnterpriseSharedDriveManagerError(
        'ENTERPRISE_SHARED_FILE_LOCAL_WRITE_FAILED',
        500
      );
    }
    if (previous !== undefined && !request.overwrite) {
      throw new EnterpriseSharedDriveManagerError(
        'ENTERPRISE_SHARED_FILE_LOCAL_EXISTS',
        409,
        { relativePath }
      );
    }

    const temporaryPath = join(
      target.parentReal,
      `.${basename(target.path)}.opencreator-${randomUUID()}.download`
    );
    try {
      const downloaded = await runRemote(
        () => input.httpClient.downloadSharedFileContent({
          accessToken,
          fileId: request.fileId,
          destinationPath: temporaryPath
        })
      );
      await assertUnchangedTarget(rootReal, target.path, previous);
      await commitDownloadedFile({
        targetPath: target.path,
        temporaryPath,
        previousExists: previous !== undefined
      });
      return {
        fileId: request.fileId,
        projectId: request.projectId,
        relativePath,
        sizeBytes: downloaded.bytes,
        sha256: downloaded.sha256,
        revision: downloaded.revision,
        overwritten: previous !== undefined
      };
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof EnterpriseSharedDriveManagerError) throw error;
      throw new EnterpriseSharedDriveManagerError(
        'ENTERPRISE_SHARED_FILE_LOCAL_WRITE_FAILED',
        500
      );
    }
  }

  return {
    listSpaces,
    listFiles,
    getFileDetail,
    uploadFile,
    downloadToProject
  };
}

async function stageFile(input: {
  content: AsyncIterable<Uint8Array>;
  expectedSizeBytes: number;
  maxFileBytes: number;
  temporaryPath: string;
}): Promise<{ sizeBytes: number; sha256: string }> {
  const handle = await open(input.temporaryPath, 'wx', 0o600);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  try {
    for await (const chunk of input.content) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += value.byteLength;
      if (sizeBytes > input.maxFileBytes) {
        throw new EnterpriseSharedDriveManagerError(
          'ENTERPRISE_SHARED_FILE_TOO_LARGE',
          413
        );
      }
      hash.update(value);
      await writeAll(handle, value);
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (sizeBytes !== input.expectedSizeBytes) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_SHARED_FILE_LENGTH_MISMATCH',
      422
    );
  }
  return {
    sizeBytes,
    sha256: hash.digest('hex')
  };
}

function mutationFromRemoteFile(
  file: EnterpriseRemoteSharedFile,
  reconciled: boolean
): EnterpriseSharedFileMutationResponse {
  return {
    fileId: file.fileId,
    spaceId: file.spaceId,
    logicalPath: file.logicalPath,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    contentType: file.contentType,
    revision: file.revision,
    created: true,
    reconciled,
    updatedAt: file.updatedAt
  };
}

async function prepareLocalTarget(
  rootReal: string,
  relativePath: string
): Promise<{ path: string; parentReal: string }> {
  const segments = relativePath.split('/');
  let current = rootReal;
  for (const segment of segments.slice(0, -1)) {
    const next = join(current, segment);
    try {
      const stats = await lstat(next);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw localPathEscape();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      await mkdir(next, { mode: 0o700 });
    }
    const nextReal = await realpath(next);
    assertInsideRoot(rootReal, nextReal);
    current = nextReal;
  }
  return {
    path: join(current, segments.at(-1)!),
    parentReal: current
  };
}

type ExistingTarget = {
  realPath: string;
  dev: number;
  ino: number;
};

async function readExistingTarget(
  rootReal: string,
  targetPath: string
): Promise<ExistingTarget | undefined> {
  try {
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink() || !stats.isFile()) throw localPathEscape();
    const realPath = await realpath(targetPath);
    assertInsideRoot(rootReal, realPath);
    return { realPath, dev: stats.dev, ino: stats.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function assertUnchangedTarget(
  rootReal: string,
  targetPath: string,
  previous: ExistingTarget | undefined
): Promise<void> {
  const current = await readExistingTarget(rootReal, targetPath);
  if (previous === undefined) {
    if (current !== undefined) {
      throw new EnterpriseSharedDriveManagerError(
        'ENTERPRISE_SHARED_FILE_LOCAL_EXISTS',
        409
      );
    }
    return;
  }
  if (
    current === undefined
    || current.realPath !== previous.realPath
    || current.dev !== previous.dev
    || current.ino !== previous.ino
  ) {
    throw localPathEscape();
  }
}

async function commitDownloadedFile(input: {
  targetPath: string;
  temporaryPath: string;
  previousExists: boolean;
}): Promise<void> {
  if (!input.previousExists) {
    try {
      await link(input.temporaryPath, input.targetPath);
      await rm(input.temporaryPath, { force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
        throw new EnterpriseSharedDriveManagerError(
          'ENTERPRISE_SHARED_FILE_LOCAL_EXISTS',
          409
        );
      }
      throw error;
    }
  }

  const backupPath = `${input.targetPath}.opencreator-${randomUUID()}.backup`;
  let backupCreated = false;
  try {
    await rename(input.targetPath, backupPath);
    backupCreated = true;
    await rename(input.temporaryPath, input.targetPath);
    await rm(backupPath, { force: true });
  } catch (error) {
    if (backupCreated) {
      await rename(backupPath, input.targetPath).catch(() => undefined);
    }
    throw error;
  }
}

function validateIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
  return normalized;
}

function validateOptionalIdentifier(value: string | undefined): string | undefined {
  return value === undefined ? undefined : validateIdentifier(value);
}

function validateSearchQuery(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > 200) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
  return normalized.length === 0 ? undefined : normalized;
}

function validateLogicalPathPrefix(
  value: string | undefined
): string | undefined {
  if (value === undefined) return undefined;
  const trailingSlash = value.endsWith('/');
  const normalized = validateLogicalPath(
    trailingSlash ? value.slice(0, -1) : value
  );
  return trailingSlash ? `${normalized}/` : normalized;
}

function validateLogicalPath(value: string): string {
  if (
    value.length === 0
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > 512
  ) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || Buffer.byteLength(segment, 'utf8') > 255
    ) {
      throw new EnterpriseSharedDriveManagerError(
        'ENTERPRISE_INVALID_REQUEST',
        400
      );
    }
  }
  return value;
}

function validateLocalRelativePath(value: string): string {
  const normalized = validateLogicalPath(value);
  if (normalized.split('/').some(isIgnoredDir)) {
    throw new EnterpriseSharedDriveManagerError('PATH_IGNORED', 403);
  }
  return normalized;
}

function validateContentType(value: string): string {
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, 'utf8') > 255) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
  return normalized.length === 0 ? 'application/octet-stream' : normalized;
}

function validateExpectedRevision(value: number | undefined): void {
  if (
    value !== undefined
    && (!Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
}

function validateExpectedSize(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
  if (value > maximum) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_SHARED_FILE_TOO_LARGE',
      413
    );
  }
}

function validateLimit(value: number | undefined): void {
  if (
    value !== undefined
    && (!Number.isSafeInteger(value) || value < 1 || value > 100)
  ) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
}

function validateCursor(value: string | undefined): void {
  if (value !== undefined && (value.length === 0 || value.length > 2048)) {
    throw new EnterpriseSharedDriveManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
}

function defaultStatusCode(code: RuntimeErrorCode): number {
  switch (code) {
    case 'ENTERPRISE_INVALID_REQUEST':
      return 400;
    case 'ENTERPRISE_UNAUTHORIZED':
    case 'ENTERPRISE_SESSION_EXPIRED':
      return 401;
    case 'ENTERPRISE_AGENT_FORBIDDEN':
    case 'ENTERPRISE_FORBIDDEN':
    case 'ENTERPRISE_SHARED_FILE_WRITE_FORBIDDEN':
      return 403;
    case 'ENTERPRISE_SHARED_SPACE_NOT_FOUND':
    case 'ENTERPRISE_SHARED_FILE_NOT_FOUND':
      return 404;
    case 'ENTERPRISE_SHARED_FILE_ALREADY_EXISTS':
    case 'ENTERPRISE_SHARED_FILE_REVISION_CONFLICT':
    case 'ENTERPRISE_SHARED_FILE_LOCAL_EXISTS':
      return 409;
    case 'ENTERPRISE_SHARED_FILE_TOO_LARGE':
      return 413;
    case 'ENTERPRISE_SHARED_FILE_LENGTH_MISMATCH':
    case 'ENTERPRISE_SHARED_FILE_DIGEST_MISMATCH':
      return 422;
    case 'ENTERPRISE_SHARED_FILE_STORAGE_UNAVAILABLE':
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

function localPathEscape(): EnterpriseSharedDriveManagerError {
  return new EnterpriseSharedDriveManagerError('PATH_ESCAPE', 403);
}

function assertInsideRoot(rootReal: string, targetReal: string): void {
  const prefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  if (targetReal !== rootReal && !targetReal.startsWith(prefix)) {
    throw localPathEscape();
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  value: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const result = await handle.write(
      value,
      offset,
      value.byteLength - offset
    );
    offset += result.bytesWritten;
  }
}
