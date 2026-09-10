import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findPythonRuntimeMarker,
  verifyStickmanBuildBinding
} from '../scripts/package-content-contract.mjs';
import { verifyStickmanRuntime } from '../scripts/stickman-runtime-contract.mjs';

let roots = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

describe('Stickman Runtime package contract', () => {
  it('accepts an exact manifest-pinned runtime', () => {
    const root = fixture();
    expect(verifyStickmanRuntime(root, process.platform, process.arch)).toMatchObject({
      remotionVersion: '4.0.473',
      chromiumVersion: '149.0.7790.0'
    });
  });

  it.each([
    ['missing', root => unlinkSync(join(root, 'fonts', 'NotoSans-Bold.woff2'))],
    ['extra', root => write(join(root, 'extra.bin'), 'extra')],
    ['hash-mismatched', root => write(join(root, 'characters', 'default.png'), 'changed')],
    ['wrong-platform', root => updateManifest(root, manifest => { manifest.platform = 'wrong'; })]
  ])('rejects %s resources', (_label, mutate) => {
    const root = fixture();
    mutate(root);
    expect(() => verifyStickmanRuntime(root, process.platform, process.arch)).toThrow();
  });

  it('rejects packaged Python Runtime markers but allows inert Python source', () => {
    const root = mkdtempSync(join(tmpdir(), 'stickman-python-scan-'));
    roots.push(root);
    write(join(root, 'docs', 'example.py'), 'print("docs")');
    expect(findPythonRuntimeMarker([root])).toBeUndefined();
    write(join(root, 'runtime', '__pycache__', 'module.pyc'), 'compiled');
    expect(findPythonRuntimeMarker([root])).toContain('__pycache__');
    expect(findPythonRuntimeMarker([], ['/node_modules/.venv/python.exe'])).toContain('app.asar');
  });

  it('binds the Desktop build manifest to exact Stickman and Web-era runtime evidence', () => {
    const runtime = { hash: 'a'.repeat(64), fileCount: 12 };
    const runtimeManifest = { remotionVersion: '4.0.473', chromiumVersion: '149.0.7790.0' };
    const manifestHash = 'b'.repeat(64);
    const buildManifest = {
      stickmanRuntimeHash: runtime.hash,
      stickmanRuntimeFileCount: runtime.fileCount,
      stickmanRuntimeManifestSha256: manifestHash,
      remotionVersion: runtimeManifest.remotionVersion,
      chromiumVersion: runtimeManifest.chromiumVersion
    };
    expect(() => verifyStickmanBuildBinding(
      buildManifest,
      runtime,
      runtimeManifest,
      manifestHash
    )).not.toThrow();
    expect(() => verifyStickmanBuildBinding(
      { ...buildManifest, stickmanRuntimeHash: 'c'.repeat(64) },
      runtime,
      runtimeManifest,
      manifestHash
    )).toThrow(/exact Stickman Runtime/);
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'stickman-runtime-package-'));
  roots.push(root);
  const files = [
    'bundle/index.html',
    `browser/${process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'}`,
    'fonts/NotoSans-Bold.woff2',
    'fonts/NotoSansSC-Bold.woff2',
    'fonts/OFL.txt',
    'visual-assets/catalog.json',
    ...[
      'default.png', 'tech-guy.png', 'long-hair.png', 'short-hair.png', 'hiphop.png',
      'student.png', 'elder.png', 'manager.png', 'chef.png', 'fitness.png'
    ].map(name => `characters/${name}`)
  ];
  for (const path of files) write(join(root, path), `fixture:${path}`);
  const browserExecutable = files.find(path => path.startsWith('browser/'));
  const resources = files.map(path => ({
    path,
    kind: path.startsWith('bundle/')
      ? 'bundle'
      : path.startsWith('browser/')
        ? 'browser'
        : path.startsWith('fonts/')
          ? 'font'
          : path.startsWith('visual-assets/')
            ? 'visual-asset'
            : 'character',
    sha256: hash(readFileSync(join(root, path))),
    bytes: readFileSync(join(root, path)).length,
    version: path.startsWith('bundle/')
      ? '4.0.473'
      : path.startsWith('browser/')
        ? '149.0.7790.0'
        : 'fixture',
    platform: process.platform,
    arch: process.arch
  }));
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify({
    version: 1,
    platform: process.platform,
    arch: process.arch,
    remotionVersion: '4.0.473',
    chromiumVersion: '149.0.7790.0',
    bundlePath: 'bundle',
    browserExecutable,
    resources
  }, null, 2)}\n`);
  return root;
}

function updateManifest(root, update) {
  const path = join(root, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  update(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
