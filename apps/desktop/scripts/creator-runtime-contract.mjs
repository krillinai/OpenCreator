import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

export function verifyCreatorRuntime(root, platform, arch) {
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`Creator Runtime manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest?.version !== 1
    || typeof manifest.serviceVersion !== 'string'
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
  for (const resource of manifest.resources) {
    if (
      typeof resource?.path !== 'string'
      || !/^[a-f0-9]{64}$/i.test(resource?.sha256 ?? '')
      || !['executable', 'model', 'asset'].includes(resource?.kind)
    ) {
      throw new Error('Packaged Creator Runtime contains an invalid resource record');
    }
    const path = resolve(root, resource.path);
    const relativePath = relative(root, path);
    if (relativePath.startsWith('..') || resolve(root, relativePath) !== path) {
      throw new Error(`Creator Runtime resource escapes its root: ${resource.path}`);
    }
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Creator Runtime resource is missing: ${resource.path}`);
    if (hashFile(path) !== resource.sha256.toLowerCase()) throw new Error(`Creator Runtime resource hash mismatch: ${resource.path}`);
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
  for (const name of [`krillinai-opencreator-server${suffix}`, `ffmpeg${suffix}`, `ffprobe${suffix}`, `yt-dlp${suffix}`]) {
    if (!executableNames.has(name)) throw new Error(`Creator Runtime executable is missing: ${name}`);
  }
  const schema = manifest.resources.find(resource => resource.path === 'api/opencreator/v1/schema.json');
  if (schema === undefined || schema.sha256 !== manifest.protocolSha256.toLowerCase()) {
    throw new Error('Creator Runtime protocol schema hash does not match its manifest');
  }
  const localProviders = new Set(['fasterwhisper', 'whispercpp', 'whisperkit']);
  const hasLocalTranscriptionFallback = manifest.resources.some(executable => (
    executable.kind === 'executable'
    && localProviders.has(executable.provider)
    && typeof executable.model === 'string'
    && manifest.resources.some(model => (
      model.kind === 'model'
      && model.provider === executable.provider
      && model.model === executable.model
    ))
  ));
  if (!hasLocalTranscriptionFallback) {
    throw new Error('Creator Runtime local transcription fallback is missing');
  }
  return manifest;
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
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
