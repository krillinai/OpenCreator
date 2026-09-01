import { readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const forbiddenDirectoryNames = new Set([
  '.venv',
  'venv',
  'site-packages',
  '__pycache__',
  'auto-video'
]);

export function findPythonRuntimeMarker(roots, asarEntries = []) {
  for (const root of roots) {
    const marker = scanRoot(root);
    if (marker !== undefined) return marker;
  }
  for (const entry of asarEntries) {
    const marker = pythonRuntimePathMarker(entry.replaceAll('\\', '/'));
    if (marker !== undefined) return `app.asar:${marker}`;
  }
  return undefined;
}

export function verifyStickmanBuildBinding(buildManifest, runtime, runtimeManifest, manifestSha256) {
  if (
    buildManifest.stickmanRuntimeHash !== runtime.hash
    || buildManifest.stickmanRuntimeFileCount !== runtime.fileCount
    || buildManifest.stickmanRuntimeManifestSha256 !== manifestSha256
    || buildManifest.remotionVersion !== runtimeManifest.remotionVersion
    || buildManifest.chromiumVersion !== runtimeManifest.chromiumVersion
  ) {
    throw new Error('Desktop build manifest is not bound to the exact Stickman Runtime');
  }
}

function scanRoot(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const relativePath = relative(root, path).replaceAll('\\', '/');
      const marker = pythonRuntimePathMarker(relativePath);
      if (marker !== undefined) return `${root}:${marker}`;
      if (entry.isDirectory()) stack.push(path);
    }
  }
  return undefined;
}

function pythonRuntimePathMarker(path) {
  const normalized = path.toLowerCase().replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  const forbiddenDirectory = segments.find(segment => forbiddenDirectoryNames.has(segment));
  if (forbiddenDirectory !== undefined) return path;
  const name = basename(normalized);
  if (
    name === 'python'
    || name === 'python.exe'
    || /^python3(?:\.\d+)?(?:\.exe)?$/.test(name)
    || /^libpython.*\.(?:so|dylib|dll)$/.test(name)
    || name.endsWith('.pyc')
    || name.endsWith('.pyo')
    || name.endsWith('.pth')
  ) return path;
  return undefined;
}
