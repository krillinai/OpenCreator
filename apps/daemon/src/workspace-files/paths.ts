import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { WorkspaceFileError } from './errors.js';

const ignoredNames = new Set([
  '.git',
  'node_modules',
  '.runtime',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.vite',
  '.DS_Store'
]);

export function validateRelativePath(raw: string | undefined, allowEmpty: boolean): string {
  const value = raw ?? '';
  if (value.length === 0) {
    if (allowEmpty) return '';
    throw new WorkspaceFileError('PATH_INVALID', 'Path is required.');
  }
  if (value.includes('\0')) throw new WorkspaceFileError('PATH_INVALID', 'Path contains null bytes.');
  if (/^[A-Za-z]:[\\/]/.test(value)) throw new WorkspaceFileError('PATH_INVALID', 'Absolute Windows paths are not allowed.');
  if (isAbsolute(value)) throw new WorkspaceFileError('PATH_INVALID', 'Absolute paths are not allowed.');

  const rawSegments = value.replace(/\\/g, '/').split('/');
  for (const segment of rawSegments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') throw new WorkspaceFileError('PATH_INVALID', 'Path traversal is not allowed.');
    if (isIgnoredDir(segment)) throw new WorkspaceFileError('PATH_IGNORED', 'Ignored paths are not available.');
  }

  const normalized = normalize(value).replace(/\\/g, '/');
  if (normalized === '.' && allowEmpty) return '';
  if (normalized === '.' || normalized.length === 0) throw new WorkspaceFileError('PATH_INVALID', 'Path is required.');

  const segments = normalized.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') throw new WorkspaceFileError('PATH_INVALID', 'Path traversal is not allowed.');
    if (isIgnoredDir(segment)) throw new WorkspaceFileError('PATH_IGNORED', 'Ignored paths are not available.');
  }

  return segments.filter((segment) => segment.length > 0 && segment !== '.').join('/');
}

export function resolveSafeExisting(root: string, relativePath: string): string {
  const target = relativePath ? join(root, relativePath) : root;
  const realTarget = realpathSync(target);
  assertInsideRoot(root, realTarget);
  return realTarget;
}

export function resolveSafeParent(root: string, relativePath: string): { candidatePath: string; parentReal: string } {
  const candidatePath = relativePath ? join(root, relativePath) : root;
  const parentPath = dirname(candidatePath);
  const parentReal = realpathSync(parentPath);
  assertInsideRoot(root, parentReal);
  return { candidatePath, parentReal };
}

export function assertInsideRoot(rootReal: string, targetReal: string): void {
  const rootPrefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  if (targetReal !== rootReal && !targetReal.startsWith(rootPrefix)) {
    throw new WorkspaceFileError('PATH_ESCAPE', 'Path escapes workspace root.');
  }
}

export function isIgnoredDir(name: string): boolean {
  return ignoredNames.has(name);
}

export function assertRegularFile(absolutePath: string): void {
  const stats = lstatSync(absolutePath);
  if (!stats.isFile()) throw new WorkspaceFileError('UNSUPPORTED_FILE_TYPE', 'Only regular files are supported.');
}
