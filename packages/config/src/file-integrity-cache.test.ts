import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyFileIntegrityWithCache } from './file-integrity-cache.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('文件完整性缓存', () => {
  it('首次强校验后使用元数据缓存', () => {
    const fixture = createFixture();

    expect(verify(fixture)).toEqual({ verified: true, cacheHit: false });
    expect(verify(fixture)).toEqual({ verified: true, cacheHit: true });
  });

  it('文件变化后重新计算哈希并拒绝篡改内容', () => {
    const fixture = createFixture();
    expect(verify(fixture).verified).toBe(true);

    writeFileSync(fixture.file, 'changed-content');

    expect(verify(fixture)).toEqual({
      verified: false,
      key: 'runtime.bin',
      reason: 'hash_mismatch'
    });
  });

  it('缓存损坏时退回完整校验并重建缓存', () => {
    const fixture = createFixture();
    expect(verify(fixture).verified).toBe(true);
    writeFileSync(fixture.cachePath, '{invalid');

    expect(verify(fixture)).toEqual({ verified: true, cacheHit: false });
    expect(() => JSON.parse(readFileSync(fixture.cachePath, 'utf8'))).not.toThrow();
  });
});

function createFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-integrity-cache-'));
  const file = join(tempDir, 'runtime.bin');
  const cachePath = join(tempDir, 'cache', 'integrity.json');
  writeFileSync(file, 'runtime-content');
  return {
    file,
    cachePath,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex')
  };
}

function verify(fixture: ReturnType<typeof createFixture>) {
  return verifyFileIntegrityWithCache({
    cachePath: fixture.cachePath,
    identity: tempDir,
    fingerprint: 'manifest-v1',
    files: [{
      key: 'runtime.bin',
      path: fixture.file,
      sha256: fixture.sha256
    }]
  });
}
