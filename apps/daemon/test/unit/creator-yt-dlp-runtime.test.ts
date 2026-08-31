import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KrillinRuntimeManifest } from '../../src/creator/krillin/manifest.js';
import { resolveYtDlpRuntime } from '../../src/creator/yt-dlp/runtime.js';

let root = '';

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('yt-dlp runtime resolver', () => {
  it('resolves the portable Python executable, zipapp, and CA bundle', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-runtime-'));
    const executable = runtimePath('yt-dlp-runtime/python/bin/python3.13');
    const script = runtimePath('yt-dlp-runtime/yt-dlp');
    const certificateBundle = runtimePath('yt-dlp-runtime/cacert.pem');
    await Promise.all([
      writeResource(executable),
      writeResource(script),
      writeResource(certificateBundle)
    ]);

    expect(resolveYtDlpRuntime({
      resourceRoot: root,
      manifest: manifest({
        mode: 'python',
        version: '2026.08.29.232711',
        pythonVersion: '3.13.15',
        executable: 'yt-dlp-runtime/python/bin/python3.13',
        script: 'yt-dlp-runtime/yt-dlp',
        certificateBundle: 'yt-dlp-runtime/cacert.pem'
      }, [
        resource('yt-dlp-runtime/python/bin/python3.13', 'executable'),
        resource('yt-dlp-runtime/yt-dlp', 'asset'),
        resource('yt-dlp-runtime/cacert.pem', 'asset')
      ])
    })).toEqual({
      version: '2026.08.29.232711',
      executable,
      prefixArgs: ['-I', '-B', script],
      env: {
        SSL_CERT_FILE: certificateBundle
      },
      script
    });
  });

  it('resolves standalone and legacy packaged executables', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-runtime-'));
    const executable = runtimePath('bin/yt-dlp');
    await writeResource(executable);
    const packagedResource = resource('bin/yt-dlp', 'executable');

    expect(resolveYtDlpRuntime({
      resourceRoot: root,
      manifest: manifest({
        mode: 'standalone',
        version: '2026.08.29.232711',
        executable: packagedResource.path
      }, [packagedResource])
    })).toEqual({
      version: '2026.08.29.232711',
      executable,
      prefixArgs: [],
      env: {}
    });

    expect(resolveYtDlpRuntime({
      resourceRoot: root,
      manifest: manifest(undefined, [packagedResource])
    })).toEqual({
      version: 'legacy',
      executable,
      prefixArgs: [],
      env: {}
    });
  });

  it('rejects descriptors that do not point to manifest-pinned resource kinds', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-runtime-'));

    expect(() => resolveYtDlpRuntime({
      resourceRoot: root,
      manifest: manifest({
        mode: 'python',
        version: '2026.08.29.232711',
        pythonVersion: '3.13.15',
        executable: 'yt-dlp-runtime/python/bin/python3.13',
        script: 'yt-dlp-runtime/yt-dlp',
        certificateBundle: 'yt-dlp-runtime/cacert.pem'
      }, [
        resource('yt-dlp-runtime/python/bin/python3.13', 'asset'),
        resource('yt-dlp-runtime/yt-dlp', 'asset'),
        resource('yt-dlp-runtime/cacert.pem', 'asset')
      ])
    })).toThrow(/dependency_not_packaged.*python3\.13/i);
  });

  it('uses an explicit executable override without depending on the manifest', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-runtime-'));
    const overridePath = runtimePath('external/yt-dlp');
    await writeResource(overridePath);

    expect(resolveYtDlpRuntime({
      resourceRoot: root,
      manifest: manifest(undefined, []),
      overridePath
    })).toEqual({
      version: 'external',
      executable: resolve(overridePath),
      prefixArgs: [],
      env: {}
    });
  });
});

function runtimePath(relativePath: string): string {
  return join(root, ...relativePath.split('/'));
}

async function writeResource(path: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, 'fixture');
}

function resource(
  path: string,
  kind: 'executable' | 'asset'
): KrillinRuntimeManifest['resources'][number] {
  return {
    path,
    kind,
    sha256: 'a'.repeat(64)
  };
}

function manifest(
  ytDlp: KrillinRuntimeManifest['ytDlp'],
  resources: KrillinRuntimeManifest['resources']
): KrillinRuntimeManifest {
  return {
    version: 1,
    platform: process.platform,
    arch: process.arch,
    ...(ytDlp === undefined ? {} : { ytDlp }),
    resources
  };
}
