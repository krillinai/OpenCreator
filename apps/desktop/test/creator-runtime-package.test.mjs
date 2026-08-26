import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyCreatorRuntime } from '../scripts/creator-runtime-contract.mjs';

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('Creator Runtime package contract', () => {
  it('accepts only manifest-pinned executables and assets', () => {
    createFixture();
    expect(verifyCreatorRuntime(root, process.platform, process.arch).resources).toHaveLength(8);
  });

  it('rejects the legacy source-built OpenCreator service runtime', () => {
    createFixture({ legacyService: true, localAsr: true });
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(
      /manifest is invalid|precompiled KrillinAI CLI/i
    );
  });

  it('rejects the official KrillinAI CLI without a bundled local transcription model', () => {
    createFixture({ legacyService: false, localAsr: false });
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(
      /local transcription fallback is missing/i
    );
  });

  it('rejects a missing file, wrong hash, and extra file', () => {
    let files = createFixture();
    rmSync(files.ffmpeg);
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(/missing/i);

    files = createFixture();
    writeFileSync(files.ffmpeg, 'tampered');
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(/hash mismatch/i);

    files = createFixture();
    writeFileSync(join(root, 'download-on-start.js'), 'fetch("https://example.com")');
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(/file list differs/i);
  });
});

function createFixture(options = { legacyService: false, localAsr: true }) {
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'creator-runtime-contract-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const paths = {
    primary: join(
      bin,
      options.legacyService
        ? `krillinai-opencreator-server${suffix}`
        : `krillinai-cli${suffix}`
    ),
    ffmpeg: join(bin, `ffmpeg${suffix}`),
    ffprobe: join(bin, `ffprobe${suffix}`),
    ytDlp: join(bin, `yt-dlp${suffix}`),
    style: join(root, 'subtitle-style.json'),
    schema: join(root, 'api', 'opencreator', 'v1', 'schema.json'),
    ...(options.localAsr
      ? {
          localAsr: join(bin, `faster-whisper${suffix}`),
          localModel: join(root, 'models', 'fasterwhisper', 'faster-whisper-tiny', 'model.bin')
        }
      : {})
  };
  if (options.localAsr) {
    mkdirSync(join(root, 'models', 'fasterwhisper', 'faster-whisper-tiny'), { recursive: true });
  }
  mkdirSync(join(root, 'api', 'opencreator', 'v1'), { recursive: true });
  for (const [name, path] of Object.entries(paths)) writeFileSync(path, name);
  const resources = Object.entries(paths).map(([name, path]) => ({
    path: path.slice(root.length + 1).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(Buffer.from(name)).digest('hex'),
    kind: name === 'localModel' ? 'model' : path.startsWith(bin) ? 'executable' : 'asset',
    ...(['localAsr', 'localModel'].includes(name)
      ? { provider: 'fasterwhisper', model: 'tiny' }
      : {})
  }));
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify({
    version: 1,
    runtimeMode: options.legacyService ? 'service' : 'cli',
    serviceVersion: 'test',
    cliVersion: 'test',
    protocolVersion: 1,
    protocolSha256: resources.find(resource => resource.path === 'api/opencreator/v1/schema.json').sha256,
    integrationPatchSha256: 'b'.repeat(64),
    upstreamCommit: 'test-commit',
    platform: process.platform,
    arch: process.arch,
    resources
  }, null, 2)}\n`);
  return paths;
}
