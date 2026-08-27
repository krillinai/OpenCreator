import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const CODEX_RUNTIME_VERSION = '0.149.0';
export const CODEX_RUNTIME_COMMIT = '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0';

export function readCodexRuntimeManifest(path) {
  if (!existsSync(path)) throw new Error(`Codex Runtime manifest is missing: ${path}`);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  validateManifest(manifest);
  return manifest;
}

export function verifyCodexRuntime(root, platform, arch) {
  const manifestPath = join(root, 'manifest.json');
  const manifest = readCodexRuntimeManifest(manifestPath);
  if (manifest.platform !== platform || manifest.arch !== arch) {
    throw new Error(`Codex Runtime targets ${manifest.platform}/${manifest.arch}, not ${platform}/${arch}`);
  }

  const expected = new Set(['manifest.json']);
  for (const resource of manifest.resources) {
    const path = safePath(root, resource.path);
    assertRegularFile(path, `Codex Runtime resource is missing: ${resource.path}`);
    if (hashFile(path) !== resource.sha256) {
      throw new Error(`Codex Runtime resource hash mismatch: ${resource.path}`);
    }
    expected.add(normalizeRelative(resource.path));
  }

  const protocolRoot = safePath(root, manifest.appServerProtocol.relativePath);
  verifyProtocolTree(protocolRoot, manifest.appServerProtocol.schemaSha256);
  for (const path of listFiles(protocolRoot)) {
    expected.add(normalizeRelative(relative(root, path)));
  }

  const actual = new Set(listFiles(root).map(path => normalizeRelative(relative(root, path))));
  const extra = [...actual].find(path => !expected.has(path));
  const missing = [...expected].find(path => !actual.has(path));
  if (extra !== undefined || missing !== undefined) {
    throw new Error(`Codex Runtime file list differs from manifest: ${extra ?? missing}`);
  }

  const binary = safePath(root, manifest.binary.relativePath);
  if (hashFile(binary) !== manifest.binary.sha256) {
    throw new Error('Codex Runtime primary binary hash does not match the manifest');
  }
  return manifest;
}

function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1
    || manifest.runtime !== 'codex'
    || manifest.version !== CODEX_RUNTIME_VERSION
    || manifest.tag !== `rust-v${CODEX_RUNTIME_VERSION}`
    || manifest.commit !== CODEX_RUNTIME_COMMIT
    || typeof manifest.platform !== 'string'
    || typeof manifest.arch !== 'string'
    || typeof manifest.officialAsset !== 'string'
    || typeof manifest.sourcePackage !== 'string'
    || typeof manifest.sourceArchive?.url !== 'string'
    || !isSha512Integrity(manifest.sourceArchive?.integrity)
    || !isSafeRelativePath(manifest.sourceArchive?.vendorPath)
    || typeof manifest.builtAt !== 'string'
    || !Array.isArray(manifest.resources)
    || !isSha256(manifest.binary?.sha256)
    || typeof manifest.binary?.relativePath !== 'string'
    || !isSha256(manifest.appServerProtocol?.schemaSha256)
    || typeof manifest.appServerProtocol?.relativePath !== 'string'
  ) {
    throw new Error('Codex Runtime manifest is invalid');
  }
  if (!manifest.resources.some(resource => resource.path === manifest.binary.relativePath)) {
    throw new Error('Codex Runtime primary binary is not listed as a resource');
  }
  for (const resource of manifest.resources) {
    if (
      typeof resource?.path !== 'string'
      || !isSha256(resource.sha256)
      || !['executable', 'metadata', 'asset'].includes(resource.kind)
    ) {
      throw new Error('Codex Runtime contains an invalid resource record');
    }
  }
}

function verifyProtocolTree(root, expectedAggregate) {
  const manifestPath = join(root, 'protocol-manifest.json');
  assertRegularFile(manifestPath, `Codex app-server protocol manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest.sourceTag !== 'rust-v0.149.0'
    || manifest.sourceCommit !== CODEX_RUNTIME_COMMIT
    || manifest.aggregateSha256 !== expectedAggregate
    || manifest.files === null
    || typeof manifest.files !== 'object'
  ) {
    throw new Error('Codex app-server protocol manifest is incompatible');
  }
  const expected = new Set(['protocol-manifest.json', 'metadata.ts']);
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!isSha256(hash)) throw new Error(`Codex app-server protocol hash is invalid: ${name}`);
    const path = safePath(root, name);
    assertRegularFile(path, `Codex app-server protocol file is missing: ${name}`);
    if (hashFile(path) !== hash) throw new Error(`Codex app-server protocol hash mismatch: ${name}`);
    expected.add(normalizeRelative(name));
  }
  const actual = new Set(listFiles(root).map(path => normalizeRelative(relative(root, path))));
  const extra = [...actual].find(path => !expected.has(path));
  const missing = [...expected].find(path => !actual.has(path));
  if (extra !== undefined || missing !== undefined) {
    throw new Error(`Codex app-server protocol file list differs: ${extra ?? missing}`);
  }
}

function safePath(root, candidate) {
  const path = resolve(root, candidate);
  const relativePath = relative(resolve(root), path);
  if (relativePath.startsWith('..') || resolve(root, relativePath) !== path) {
    throw new Error(`Codex Runtime path escapes its root: ${candidate}`);
  }
  return path;
}

function assertRegularFile(path, message) {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
    throw new Error(message);
  }
}

function listFiles(root) {
  const result = [];
  visit(root);
  return result.sort();

  function visit(current) {
    if (!existsSync(current)) throw new Error(`Codex Runtime directory is missing: ${current}`);
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Codex Runtime contains a symbolic link: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(path);
    }
  }
}

function normalizeRelative(path) {
  return path.replaceAll('\\', '/');
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSha512Integrity(value) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) return false;
  try {
    return Buffer.from(value.slice('sha512-'.length), 'base64').length === 64;
  } catch {
    return false;
  }
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !value.split(/[\\/]/).includes('..');
}
