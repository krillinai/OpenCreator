import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const remotionVersion = '4.0.473';
const requiredFonts = new Set([
  'fonts/NotoSans-Bold.woff2',
  'fonts/NotoSansSC-Bold.woff2',
  'fonts/OFL.txt'
]);
const requiredCharacters = new Set([
  'characters/default.png',
  'characters/tech-guy.png',
  'characters/long-hair.png',
  'characters/short-hair.png',
  'characters/hiphop.png',
  'characters/student.png',
  'characters/elder.png',
  'characters/manager.png',
  'characters/chef.png',
  'characters/fitness.png'
]);

export function verifyStickmanRuntime(rootPath, platform, arch) {
  const root = resolve(rootPath);
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Stickman Runtime manifest is missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest?.version !== 1
    || manifest.platform !== platform
    || manifest.arch !== arch
    || manifest.remotionVersion !== remotionVersion
    || typeof manifest.chromiumVersion !== 'string'
    || typeof manifest.bundlePath !== 'string'
    || typeof manifest.browserExecutable !== 'string'
    || !Array.isArray(manifest.resources)
  ) {
    throw new Error('Stickman Runtime manifest is invalid or targets another platform');
  }

  const expected = new Set(['manifest.json']);
  for (const resource of manifest.resources) {
    if (
      typeof resource?.path !== 'string'
      || !['bundle', 'browser', 'font', 'character'].includes(resource.kind)
      || !/^[a-f0-9]{64}$/i.test(resource.sha256 ?? '')
      || !Number.isSafeInteger(resource.bytes)
      || resource.bytes < 0
      || typeof resource.version !== 'string'
      || resource.version.length === 0
      || resource.platform !== platform
      || resource.arch !== arch
    ) {
      throw new Error('Stickman Runtime contains an invalid resource record');
    }
    const path = resolveInside(root, resource.path);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Stickman Runtime resource is missing: ${resource.path}`);
    }
    if (statSync(path).size !== resource.bytes) {
      throw new Error(`Stickman Runtime resource size mismatch: ${resource.path}`);
    }
    if (hashFile(path) !== resource.sha256.toLowerCase()) {
      throw new Error(`Stickman Runtime resource hash mismatch: ${resource.path}`);
    }
    if (expected.has(resource.path)) {
      throw new Error(`Stickman Runtime resource is duplicated: ${resource.path}`);
    }
    expected.add(resource.path);
  }

  const actual = new Set(listFiles(root));
  const difference = findFirstDifferentPath([...expected].sort(), [...actual].sort());
  if (difference !== undefined) {
    throw new Error(`Stickman Runtime file list differs from manifest: ${difference}`);
  }
  const bundleRoot = `${normalizeRelative(manifest.bundlePath).replace(/\/$/, '')}/`;
  if (!manifest.resources.some(resource => (
    resource.kind === 'bundle'
    && resource.path.startsWith(bundleRoot)
    && resource.path.endsWith('/index.html')
  ))) {
    throw new Error('Stickman Runtime bundle entry is missing');
  }
  const browserExecutable = normalizeRelative(manifest.browserExecutable);
  if (!manifest.resources.some(resource => (
    resource.kind === 'browser' && resource.path === browserExecutable
  ))) {
    throw new Error('Stickman Runtime browser executable is not bound to the manifest');
  }
  for (const path of requiredFonts) {
    if (!manifest.resources.some(resource => resource.kind === 'font' && resource.path === path)) {
      throw new Error(`Stickman Runtime font is missing: ${path}`);
    }
  }
  for (const path of requiredCharacters) {
    if (!manifest.resources.some(resource => resource.kind === 'character' && resource.path === path)) {
      throw new Error(`Stickman Runtime character is missing: ${path}`);
    }
  }
  return manifest;
}

export function hashDirectory(root) {
  const files = listFiles(root);
  const aggregate = createHash('sha256');
  for (const relativePath of files) {
    const contentHash = hashFile(join(root, relativePath));
    aggregate.update(relativePath).update('\0').update(contentHash).update('\0');
  }
  return { files, fileCount: files.length, hash: aggregate.digest('hex') };
}

export function findFirstDifferentPath(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return `${left[index] ?? '<missing>'} / ${right[index] ?? '<missing>'}`;
    }
  }
  return undefined;
}

export function hashFile(path) {
  const digest = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return digest.digest('hex');
}

function listFiles(root) {
  const result = [];
  visit(root);
  return result.sort();

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(normalizeRelative(relative(root, path)));
    }
  }
}

function resolveInside(root, child) {
  const target = resolve(root, child);
  const value = relative(root, target);
  if (value === '' || (!value.startsWith('..') && !isAbsolute(value))) return target;
  throw new Error(`Stickman Runtime resource escapes its root: ${child}`);
}

function normalizeRelative(path) {
  return path.replaceAll('\\', '/');
}
