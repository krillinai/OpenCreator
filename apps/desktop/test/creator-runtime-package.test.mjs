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
  it('accepts a manifest-pinned portable Python yt-dlp runtime', () => {
    createFixture();
    expect(verifyCreatorRuntime(root, process.platform, process.arch)).toMatchObject({
      ytDlp: {
        mode: 'python',
        version: '2026.08.29.232711',
        pythonVersion: '3.13.15'
      }
    });
  });

  it('accepts an explicitly configured standalone yt-dlp runtime', () => {
    createFixture({ ytDlpMode: 'standalone' });
    expect(verifyCreatorRuntime(root, process.platform, process.arch)).toMatchObject({
      ytDlp: {
        mode: 'standalone',
        version: '2026.08.29.232711'
      }
    });
  });

  it('rejects the legacy source-built OpenCreator service runtime', () => {
    createFixture({ legacyService: true });
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(
      /manifest is invalid|precompiled KrillinAI CLI/i
    );
  });

  it('rejects bundled local transcription dependencies', () => {
    createFixture({ localAsr: true });
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(
      /load local transcription dependencies on demand/i
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

  it('rejects yt-dlp descriptors that reference missing or incorrectly typed resources', () => {
    createFixture({
      mutateManifest(manifest) {
        manifest.ytDlp.script = 'yt-dlp-runtime/missing';
      }
    });
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(
      /yt-dlp script is not a manifest-pinned asset/i
    );

    createFixture({
      mutateManifest(manifest) {
        const certificate = manifest.resources.find(
          resource => resource.path === manifest.ytDlp.certificateBundle
        );
        certificate.kind = 'executable';
      }
    });
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(
      /CA certificate bundle is not a manifest-pinned asset/i
    );
  });

  it('rejects mutable Python bytecode caches', () => {
    createFixture({
      mutateManifest(manifest) {
        const bytecodePath = join(
          root,
          'yt-dlp-runtime',
          'python',
          'lib',
          'python3.13',
          '__pycache__',
          'site.cpython-313.pyc'
        );
        mkdirSync(join(bytecodePath, '..'), { recursive: true });
        writeFileSync(bytecodePath, 'bytecode');
        manifest.resources.push({
          path: bytecodePath.slice(root.length + 1).replaceAll('\\', '/'),
          sha256: createHash('sha256').update(Buffer.from('bytecode')).digest('hex'),
          kind: 'asset'
        });
      }
    });
    expect(() => verifyCreatorRuntime(root, process.platform, process.arch)).toThrow(
      /must not package mutable Python bytecode caches/i
    );
  });
});

function createFixture(options = {}) {
  const legacyService = options.legacyService ?? false;
  const localAsr = options.localAsr ?? false;
  const ytDlpMode = options.ytDlpMode ?? 'python';
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'creator-runtime-contract-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const paths = {
    primary: join(
      bin,
      legacyService
        ? `krillinai-opencreator-server${suffix}`
        : `krillinai-cli${suffix}`
    ),
    ffmpeg: join(bin, `ffmpeg${suffix}`),
    ffprobe: join(bin, `ffprobe${suffix}`),
    ...(ytDlpMode === 'standalone'
      ? {
          ytDlp: join(bin, `yt-dlp${suffix}`)
        }
      : {
          python: process.platform === 'win32'
            ? join(root, 'yt-dlp-runtime', 'python', 'python.exe')
            : join(root, 'yt-dlp-runtime', 'python', 'bin', 'python3.13'),
          ytDlp: join(root, 'yt-dlp-runtime', 'yt-dlp'),
          certificateBundle: join(root, 'yt-dlp-runtime', 'cacert.pem')
        }),
    style: join(root, 'subtitle-style.json'),
    schema: join(root, 'api', 'opencreator', 'v1', 'schema.json'),
    ...(localAsr
      ? {
          localAsr: join(bin, `faster-whisper${suffix}`),
          localModel: join(root, 'models', 'fasterwhisper', 'faster-whisper-tiny', 'model.bin')
        }
      : {})
  };
  if (localAsr) {
    mkdirSync(join(root, 'models', 'fasterwhisper', 'faster-whisper-tiny'), { recursive: true });
  }
  mkdirSync(join(root, 'api', 'opencreator', 'v1'), { recursive: true });
  for (const [name, path] of Object.entries(paths)) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, name);
  }
  const resources = Object.entries(paths).map(([name, path]) => ({
    path: path.slice(root.length + 1).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(Buffer.from(name)).digest('hex'),
    kind: name === 'localModel'
      ? 'model'
      : path.startsWith(bin) || name === 'python'
        ? 'executable'
        : 'asset',
    ...(['localAsr', 'localModel'].includes(name)
      ? { provider: 'fasterwhisper', model: 'tiny' }
      : {})
  }));
  const ytDlp = ytDlpMode === 'standalone'
    ? {
        mode: 'standalone',
        version: '2026.08.29.232711',
        executable: resources.find(resource => resource.path.includes('yt-dlp')).path
      }
    : {
        mode: 'python',
        version: '2026.08.29.232711',
        pythonVersion: '3.13.15',
        executable: resources.find(resource => resource.path.includes('python3.13') || resource.path.endsWith('python.exe')).path,
        script: resources.find(resource => resource.path.endsWith('/yt-dlp')).path,
        certificateBundle: resources.find(resource => resource.path.endsWith('/cacert.pem')).path
      };
  const manifest = {
    version: 1,
    runtimeMode: legacyService ? 'service' : 'cli',
    serviceVersion: 'test',
    cliVersion: 'test',
    protocolVersion: 1,
    protocolSha256: resources.find(resource => resource.path === 'api/opencreator/v1/schema.json').sha256,
    integrationPatchSha256: 'b'.repeat(64),
    upstreamCommit: 'test-commit',
    platform: process.platform,
    arch: process.arch,
    ytDlp,
    resources
  };
  options.mutateManifest?.(manifest);
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return paths;
}
