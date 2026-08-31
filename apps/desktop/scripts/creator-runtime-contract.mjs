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
import { basename, join, relative, resolve } from 'node:path';

export function verifyCreatorRuntime(root, platform, arch) {
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`Creator Runtime manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest?.version !== 1
    || manifest.runtimeMode !== 'cli'
    || typeof manifest.serviceVersion !== 'string'
    || typeof manifest.cliVersion !== 'string'
    || manifest.protocolVersion !== 1
    || !/^[a-f0-9]{64}$/i.test(manifest.protocolSha256 ?? '')
    || !/^[a-f0-9]{64}$/i.test(manifest.integrationPatchSha256 ?? '')
    || typeof manifest.upstreamCommit !== 'string'
    || manifest.platform !== platform
    || manifest.arch !== arch
    || !Array.isArray(manifest.resources)
  ) {
    throw new Error('Packaged Creator Runtime manifest is invalid or targets another platform');
  }
  const expected = new Set(['manifest.json']);
  const resourcesByPath = new Map();
  for (const resource of manifest.resources) {
    if (
      typeof resource?.path !== 'string'
      || !/^[a-f0-9]{64}$/i.test(resource?.sha256 ?? '')
      || !['executable', 'model', 'asset'].includes(resource?.kind)
    ) {
      throw new Error('Packaged Creator Runtime contains an invalid resource record');
    }
    if (
      /(?:^|\/)__pycache__(?:\/|$)/i.test(resource.path)
      || /\.pyc$/i.test(resource.path)
    ) {
      throw new Error(
        `Creator Runtime must not package mutable Python bytecode caches: ${resource.path}`
      );
    }
    if (resourcesByPath.has(resource.path)) {
      throw new Error(`Creator Runtime resource is declared more than once: ${resource.path}`);
    }
    const path = resolve(root, resource.path);
    const relativePath = relative(root, path);
    if (relativePath.startsWith('..') || resolve(root, relativePath) !== path) {
      throw new Error(`Creator Runtime resource escapes its root: ${resource.path}`);
    }
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Creator Runtime resource is missing: ${resource.path}`);
    if (hashFile(path) !== resource.sha256.toLowerCase()) throw new Error(`Creator Runtime resource hash mismatch: ${resource.path}`);
    resourcesByPath.set(resource.path, resource);
    expected.add(relativePath.replaceAll('\\', '/'));
  }
  const actual = new Set(listFiles(root));
  const extra = [...actual].find(path => !expected.has(path));
  const missing = [...expected].find(path => !actual.has(path));
  if (extra || missing) throw new Error(`Creator Runtime file list differs from manifest: ${extra ?? missing}`);
  const suffix = platform === 'win32' ? '.exe' : '';
  const executableNames = new Set(manifest.resources
    .filter(resource => resource.kind === 'executable')
    .map(resource => basename(resource.path).toLowerCase()));
  if (!executableNames.has(`krillinai-cli${suffix}`)) {
    throw new Error('Creator Runtime requires the precompiled KrillinAI CLI');
  }
  for (const name of [`ffmpeg${suffix}`, `ffprobe${suffix}`]) {
    if (!executableNames.has(name)) throw new Error(`Creator Runtime executable is missing: ${name}`);
  }
  verifyYtDlpRuntime(manifest.ytDlp, resourcesByPath);
  const schema = manifest.resources.find(resource => resource.path === 'api/opencreator/v1/schema.json');
  if (schema === undefined || schema.sha256 !== manifest.protocolSha256.toLowerCase()) {
    throw new Error('Creator Runtime protocol schema hash does not match its manifest');
  }
  const localProviders = new Set(['fasterwhisper', 'whispercpp', 'whisperkit']);
  if (manifest.resources.some(resource => (
    resource.kind === 'model'
    || localProviders.has(resource.provider)
    || /(?:faster[-_]?whisper|whisper(?:kit|cpp)?)/i.test(resource.path)
  ))) {
    throw new Error('Creator Runtime must load local transcription dependencies on demand');
  }
  return manifest;
}

function verifyYtDlpRuntime(descriptor, resourcesByPath) {
  if (
    descriptor === null
    || typeof descriptor !== 'object'
    || typeof descriptor.version !== 'string'
    || descriptor.version.length === 0
  ) {
    throw new Error('Creator Runtime yt-dlp descriptor is missing or invalid');
  }
  if (descriptor.mode === 'standalone') {
    assertDescriptorKeys(descriptor, ['mode', 'version', 'executable']);
    assertRuntimeResource(
      resourcesByPath,
      descriptor.executable,
      'executable',
      'yt-dlp executable'
    );
    return;
  }
  if (descriptor.mode === 'python') {
    assertDescriptorKeys(descriptor, [
      'mode',
      'version',
      'pythonVersion',
      'executable',
      'script',
      'certificateBundle'
    ]);
    if (
      typeof descriptor.pythonVersion !== 'string'
      || descriptor.pythonVersion.length === 0
    ) {
      throw new Error('Creator Runtime portable Python version is missing');
    }
    const paths = [
      descriptor.executable,
      descriptor.script,
      descriptor.certificateBundle
    ];
    if (new Set(paths).size !== paths.length) {
      throw new Error('Creator Runtime yt-dlp resources must use distinct paths');
    }
    assertRuntimeResource(
      resourcesByPath,
      descriptor.executable,
      'executable',
      'portable Python executable'
    );
    assertRuntimeResource(
      resourcesByPath,
      descriptor.script,
      'asset',
      'yt-dlp script'
    );
    assertRuntimeResource(
      resourcesByPath,
      descriptor.certificateBundle,
      'asset',
      'CA certificate bundle'
    );
    return;
  }
  throw new Error(`Creator Runtime yt-dlp mode is unsupported: ${descriptor.mode}`);
}

function assertDescriptorKeys(descriptor, expectedKeys) {
  const actual = Object.keys(descriptor).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error('Creator Runtime yt-dlp descriptor contains invalid fields');
  }
}

function assertRuntimeResource(resourcesByPath, path, kind, label) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`Creator Runtime ${label} path is missing`);
  }
  const resource = resourcesByPath.get(path);
  if (resource?.kind !== kind) {
    throw new Error(`Creator Runtime ${label} is not a manifest-pinned ${kind}: ${path}`);
  }
}

function listFiles(root) {
  const result = [];
  visit(root);
  return result.sort();

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
}

function hashFile(path) {
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
