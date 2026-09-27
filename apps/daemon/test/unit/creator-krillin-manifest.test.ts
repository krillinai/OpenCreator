import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readKrillinRuntimeManifest,
  verifyKrillinRuntimeManifest
} from '../../src/creator/krillin/manifest.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Krillin Runtime 清单校验', () => {
  it('缓存完整校验结果，并在资源变化时拒绝缓存', () => {
    const fixture = createFixture();
    const manifest = readKrillinRuntimeManifest(fixture.root);

    expect(verifyKrillinRuntimeManifest(fixture.root, manifest, {
      cachePath: fixture.cachePath
    })).toEqual({ cacheHit: false });
    expect(verifyKrillinRuntimeManifest(fixture.root, manifest, {
      cachePath: fixture.cachePath
    })).toEqual({ cacheHit: true });

    writeFileSync(fixture.executable, 'tampered-runtime');
    expect(() => verifyKrillinRuntimeManifest(fixture.root, manifest, {
      cachePath: fixture.cachePath
    })).toThrow('dependency_hash_mismatch: bin/krillinai-cli');
  });
});

function createFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-krillin-manifest-'));
  const root = join(tempDir, 'runtime');
  const executable = join(root, 'bin', 'krillinai-cli');
  const cachePath = join(tempDir, 'cache', 'krillinai.json');
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, 'packaged-runtime');
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    version: 1,
    platform: process.platform,
    arch: process.arch,
    resources: [{
      path: 'bin/krillinai-cli',
      kind: 'executable',
      sha256: createHash('sha256').update(readFileSync(executable)).digest('hex')
    }]
  }));
  return { root, executable, cachePath };
}
