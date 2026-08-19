import type { WorkspaceFileKind } from '@opencreator/protocol';
import {
  MAX_IMAGE_BYTES,
  MAX_JSON_FORMAT_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES
} from './types.js';

const codeExtensions = new Set([
  '.bash',
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.eslintrc',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.less',
  '.mjs',
  '.cjs',
  '.jsonc',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svg',
  '.zsh',
  '.vue',
  '.xml',
  '.yaml',
  '.yml'
]);

const textExtensions = new Set([
  '.cert',
  '.crt',
  '.csv',
  '.env.example',
  '.env.sample',
  '.gitignore',
  '.ini',
  '.log',
  '.markdown',
  '.mdx',
  '.npmrc',
  '.prettierrc',
  '.properties',
  '.jsonl',
  '.srt',
  '.toml',
  '.txt'
]);

const sensitiveExactNames = new Set([
  '.env',
  '.env.development',
  '.env.local',
  '.env.production',
  '.env.test',
  'credentials.json',
  'id_ed25519',
  'id_rsa'
]);

function extensionFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.env.example')) return '.env.example';
  if (lower.endsWith('.env.sample')) return '.env.sample';
  if (lower.endsWith('.env.production')) return '.env.production';
  if (lower.endsWith('.env.development')) return '.env.development';
  if (lower.endsWith('.env.test')) return '.env.test';
  if (lower.endsWith('.env.local')) return '.env.local';
  const lastDot = lower.lastIndexOf('.');
  return lastDot === -1 ? '' : lower.slice(lastDot);
}

function basenameFor(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

export function mimeFor(path: string): string {
  const extension = extensionFor(path);
  switch (extension) {
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.json':
    case '.jsonc':
      return 'application/json; charset=utf-8';
    case '.jsonl':
      return 'application/x-ndjson; charset=utf-8';
    case '.toml':
      return 'application/toml; charset=utf-8';
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.yaml':
    case '.yml':
      return 'application/yaml; charset=utf-8';
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      if (codeExtensions.has(extension) || textExtensions.has(extension)) {
        return 'text/plain; charset=utf-8';
      }
      return 'application/octet-stream';
  }
}

export function kindFor(path: string): WorkspaceFileKind {
  const extension = extensionFor(path);
  if (extension === '.md' || extension === '.markdown' || extension === '.mdx') return 'markdown';
  if (extension === '.json' || extension === '.jsonc' || extension === '.jsonl') return 'json';
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.svg') return 'code';
  if (codeExtensions.has(extension)) return 'code';
  if (extension === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'].includes(extension)) return 'image';
  if (textExtensions.has(extension)) return 'text';
  if (mimeFor(path).startsWith('text/')) return 'text';
  return extension ? 'binary' : 'unknown';
}

export function isSensitivePath(path: string): boolean {
  const lowerBase = basenameFor(path).toLowerCase();
  if (lowerBase === '.env.example' || lowerBase === '.env.sample') return false;
  if (sensitiveExactNames.has(lowerBase)) return true;
  if (
    lowerBase.endsWith('.pem') ||
    lowerBase.endsWith('.key') ||
    lowerBase.endsWith('.secret') ||
    lowerBase.endsWith('.p12') ||
    lowerBase.endsWith('.crt') ||
    lowerBase.endsWith('.cert')
  ) {
    return true;
  }
  if (/^service-account.*\.json$/i.test(lowerBase)) return true;
  return false;
}

export function isEditable(kind: WorkspaceFileKind, path: string, size: number): boolean {
  if (isSensitivePath(path)) return false;
  if (size > sizeLimitForEditable(kind)) return false;
  return kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'code' || kind === 'html';
}

export function isPreviewable(kind: WorkspaceFileKind, path: string, size: number): boolean {
  if (isSensitivePath(path)) return false;
  if (kind === 'image') return size <= MAX_IMAGE_BYTES;
  if (kind === 'pdf') return size <= MAX_PDF_BYTES;
  return isEditable(kind, path, size);
}

export function reasonForUnavailable(kind: WorkspaceFileKind, path: string, size: number): string | undefined {
  if (isSensitivePath(path)) return 'Sensitive files are not available.';
  const editableLimit = sizeLimitForEditable(kind);
  if (isTextualKind(kind) && size > editableLimit) return `File exceeds ${editableLimit} bytes limit.`;
  if (kind === 'image' && size > MAX_IMAGE_BYTES) return `Image exceeds ${MAX_IMAGE_BYTES} bytes limit.`;
  if (kind === 'pdf' && size > MAX_PDF_BYTES) return `PDF exceeds ${MAX_PDF_BYTES} bytes limit.`;
  if (!isEditable(kind, path, size) && !isPreviewable(kind, path, size)) return 'File type is not supported.';
  return undefined;
}

export function isTextualKind(kind: WorkspaceFileKind): boolean {
  return kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'code' || kind === 'html';
}

function sizeLimitForEditable(kind: WorkspaceFileKind): number {
  return kind === 'json' ? MAX_JSON_FORMAT_BYTES : MAX_TEXT_BYTES;
}
