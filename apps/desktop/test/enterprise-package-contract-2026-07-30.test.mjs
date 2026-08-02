import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertEnterpriseReleaseTransport,
  assertKeyringArtifacts,
  resolveKeyringTarget
} from '../scripts/enterprise-package-contract-2026-07-30.mjs';

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('Desktop enterprise package contract', () => {
  it('maps the current supported target to one native Keyring package', () => {
    expect(resolveKeyringTarget('darwin', 'arm64')).toEqual({
      packageName: '@napi-rs/keyring-darwin-arm64',
      nativeFile: 'keyring.darwin-arm64.node'
    });
    expect(resolveKeyringTarget('win32', 'x64')).toEqual({
      packageName: '@napi-rs/keyring-win32-x64-msvc',
      nativeFile: 'keyring.win32-x64-msvc.node'
    });
    expect(resolveKeyringTarget('linux', 'x64', 'gnu')).toEqual({
      packageName: '@napi-rs/keyring-linux-x64-gnu',
      nativeFile: 'keyring.linux-x64-gnu.node'
    });
  });

  it('requires the loader, target optional package and unique native file', () => {
    const root = deploymentFixture();
    const target = resolveKeyringTarget('darwin', 'arm64');
    const optionalRoot = join(
      root,
      'node_modules',
      '@napi-rs',
      'keyring-darwin-arm64'
    );
    mkdirSync(optionalRoot, { recursive: true });
    writeFileSync(join(optionalRoot, 'package.json'), '{}');
    writeFileSync(join(optionalRoot, target.nativeFile), 'native');

    expect(assertKeyringArtifacts(root, {
      platform: 'darwin',
      arch: 'arm64'
    })).toMatchObject(target);

    rmSync(join(optionalRoot, target.nativeFile));
    expect(() => assertKeyringArtifacts(root, {
      platform: 'darwin',
      arch: 'arm64'
    })).toThrow('Keyring');
  });

  it('resolves the target package from an isolated loader dependency layout', () => {
    const root = deploymentFixture();
    const target = resolveKeyringTarget('darwin', 'arm64');
    const optionalRoot = join(
      root,
      'node_modules',
      '@napi-rs',
      'keyring',
      'node_modules',
      '@napi-rs',
      'keyring-darwin-arm64'
    );
    mkdirSync(optionalRoot, { recursive: true });
    writeFileSync(join(optionalRoot, 'package.json'), '{}');
    writeFileSync(join(optionalRoot, target.nativeFile), 'native');

    expect(assertKeyringArtifacts(root, {
      platform: 'darwin',
      arch: 'arm64'
    })).toMatchObject({
      ...target,
      packageRoot: realpathSync(optionalRoot)
    });
  });

  it('allows HTTP only for unpacked dir builds', () => {
    expect(assertEnterpriseReleaseTransport({
      mode: 'dir',
      origin: 'http://127.0.0.1:1904'
    })).toEqual({
      origin: 'http://127.0.0.1:1904',
      transportSecurity: 'insecure_http'
    });
    expect(() => assertEnterpriseReleaseTransport({
      mode: 'dist',
      origin: 'http://127.0.0.1:1904'
    })).toThrow('ENTERPRISE_RELEASE_REQUIRES_HTTPS');
    expect(() => assertEnterpriseReleaseTransport({
      mode: 'release',
      origin: 'http://enterprise.example'
    })).toThrow('ENTERPRISE_RELEASE_REQUIRES_HTTPS');
    expect(assertEnterpriseReleaseTransport({
      mode: 'release',
      origin: 'https://enterprise.example/'
    })).toEqual({
      origin: 'https://enterprise.example',
      transportSecurity: 'secure_https'
    });
  });
});

function deploymentFixture() {
  const root = mkdtempSync(join(tmpdir(), 'clawee-keyring-contract-'));
  tempRoots.push(root);
  const loaderRoot = join(root, 'node_modules', '@napi-rs', 'keyring');
  mkdirSync(loaderRoot, { recursive: true });
  writeFileSync(join(loaderRoot, 'package.json'), '{}');
  writeFileSync(join(loaderRoot, 'index.js'), 'module.exports = {}');
  return root;
}
