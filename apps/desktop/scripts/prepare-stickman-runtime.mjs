import { createRequire } from 'node:module';
import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashFile,
  verifyStickmanRuntime
} from './stickman-runtime-contract.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
const targetPlatform = normalizePlatform(
  process.env.OPENCREATOR_DESKTOP_TARGET_PLATFORM ?? process.platform
);
const targetArch = process.env.OPENCREATOR_DESKTOP_TARGET_ARCH ?? process.arch;
if (targetPlatform !== process.platform || targetArch !== process.arch) {
  throw new Error('Stickman Runtime preparation must run on its target platform and architecture');
}
const outputRoot = resolve(
  process.env.OPENCREATOR_STICKMAN_RUNTIME_OUTPUT
    ?? join(desktopDir, '.pack', 'stickman-runtime')
);
const bundleRoot = join(outputRoot, 'bundle');
const browserRoot = join(outputRoot, 'browser');
const fontRoot = join(outputRoot, 'fonts');
const characterRoot = join(outputRoot, 'characters');
const remotionVersion = '4.0.473';
const chromiumVersion = '149.0.7790.0';
const requireFromDaemon = createRequire(join(rootDir, 'apps', 'daemon', 'package.json'));
const { bundle } = requireFromDaemon('@remotion/bundler');
const yauzl = requireFromDaemon('yauzl');

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
await bundle({
  entryPoint: join(rootDir, 'packages', 'stickman-remotion', 'src', 'index.ts'),
  outDir: bundleRoot,
  enableCaching: false,
  onProgress: () => undefined,
  webpackOverride: configuration => ({
    ...configuration,
    resolve: {
      ...configuration.resolve,
      extensionAlias: {
        ...configuration.resolve?.extensionAlias,
        '.js': ['.ts', '.tsx', '.js']
      }
    }
  })
});

const browserSource = await resolveBrowserSource();
const browserVersion = execFileSync(browserSource, ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30_000
}).trim();
if (!browserVersion.includes(chromiumVersion)) {
  throw new Error(`Unexpected Chromium version: ${browserVersion}`);
}
cpSync(dirname(browserSource), browserRoot, { recursive: true });
const packagedBrowserExecutable = join(browserRoot, basename(browserSource));

cpSync(
  join(rootDir, 'packages', 'stickman-remotion', 'assets', 'fonts'),
  fontRoot,
  { recursive: true }
);
cpSync(
  join(rootDir, 'apps', 'web', 'public', 'dashboard', 'characters'),
  characterRoot,
  { recursive: true }
);

const resources = [];
addDirectory(bundleRoot, 'bundle', remotionVersion);
addDirectory(browserRoot, 'browser', chromiumVersion);
addDirectory(fontRoot, 'font', '@fontsource/noto-sans@5.2.8');
addDirectory(characterRoot, 'character', 'opencreator-dashboard@1');
resources.sort((left, right) => left.path.localeCompare(right.path));
const manifest = {
  version: 1,
  platform: targetPlatform,
  arch: targetArch,
  remotionVersion,
  chromiumVersion,
  bundlePath: normalizeRelative(relative(outputRoot, bundleRoot)),
  browserExecutable: normalizeRelative(relative(outputRoot, packagedBrowserExecutable)),
  resources
};
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
verifyStickmanRuntime(outputRoot, targetPlatform, targetArch);
console.log(JSON.stringify({
  ok: true,
  outputRoot,
  resources: resources.length,
  browserVersion
}));

function addDirectory(root, kind, version) {
  visit(root);
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        resources.push({
          path: normalizeRelative(relative(outputRoot, path)),
          kind,
          sha256: hashFile(path),
          bytes: statSync(path).size,
          version,
          platform: targetPlatform,
          arch: targetArch
        });
      }
    }
  }
}

function normalizePlatform(value) {
  if (value === 'mac') return 'darwin';
  if (value === 'win') return 'win32';
  if (['darwin', 'win32', 'linux'].includes(value)) return value;
  throw new Error(`Unsupported Stickman Runtime platform: ${value}`);
}

function normalizeRelative(path) {
  return path.replaceAll('\\', '/');
}

async function resolveBrowserSource() {
  const configured = process.env.OPENCREATOR_STICKMAN_BROWSER_PATH?.trim();
  if (configured) {
    const path = resolve(configured);
    if (!existsSync(path)) throw new Error(`Configured Stickman browser is missing: ${path}`);
    return path;
  }
  const platformKey = browserPlatformKey(targetPlatform, targetArch);
  const executableName = targetPlatform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  const vendorRoot = resolve(
    process.env.OPENCREATOR_STICKMAN_RUNTIME_VENDOR
      ?? join(rootDir, '.runtime', 'vendor', 'stickman-runtime', `${targetPlatform}-${targetArch}`)
  );
  const extractedRoot = join(vendorRoot, `chrome-headless-shell-${platformKey}`);
  const executable = join(extractedRoot, executableName);
  if (existsSync(executable)) return executable;

  rmSync(vendorRoot, { recursive: true, force: true });
  mkdirSync(vendorRoot, { recursive: true });
  const archivePath = join(vendorRoot, `chrome-headless-shell-${platformKey}.zip`);
  const url = process.env.OPENCREATOR_STICKMAN_BROWSER_URL?.trim()
    || `https://cdn.npmmirror.com/binaries/chrome-for-testing/${chromiumVersion}/${platformKey}/chrome-headless-shell-${platformKey}.zip`;
  await downloadFile(url, archivePath);
  await extractZip(archivePath, vendorRoot);
  rmSync(archivePath, { force: true });
  if (!existsSync(executable)) {
    throw new Error(`Downloaded Stickman browser executable is missing: ${executable}`);
  }
  if (targetPlatform !== 'win32') chmodSync(executable, 0o755);
  return executable;
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10 * 60_000)
  });
  if (!response.ok || response.body === null) {
    throw new Error(`Stickman browser download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function extractZip(archivePath, destination) {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error('Stickman browser archive could not be opened'));
        return;
      }
      zipFile.once('error', reject);
      zipFile.once('end', resolvePromise);
      zipFile.on('entry', entry => {
        const entryName = entry.fileName.replaceAll('\\', '/');
        const target = resolve(destination, entryName);
        if (relative(destination, target).startsWith('..')) {
          zipFile.close();
          reject(new Error(`Stickman browser archive path escapes target: ${entryName}`));
          return;
        }
        if (entryName.endsWith('/')) {
          mkdirSync(target, { recursive: true });
          zipFile.readEntry();
          return;
        }
        mkdirSync(dirname(target), { recursive: true });
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipFile.close();
            reject(streamError ?? new Error(`Cannot extract ${entryName}`));
            return;
          }
          pipeline(stream, createWriteStream(target)).then(
            () => zipFile.readEntry(),
            error => {
              zipFile.close();
              reject(error);
            }
          );
        });
      });
      zipFile.readEntry();
    });
  });
}

function browserPlatformKey(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return 'win64';
  if (platform === 'linux' && arch === 'x64') return 'linux64';
  if (platform === 'darwin' && arch === 'x64') return 'mac-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
  throw new Error(`Unsupported Chromium target: ${platform}-${arch}`);
}
