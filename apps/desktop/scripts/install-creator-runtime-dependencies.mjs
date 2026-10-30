import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { creatorRuntimeReleases, resolveYtDlpRelease } from './creator-runtime-releases.mjs';
import { verifyRuntimeExecutable } from './runtime-executable-check.mjs';
import { retryWindowsFileOperation } from './windows-file-retry.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '../../..');
const platform = process.env.OPENCREATOR_CREATOR_RUNTIME_PLATFORM ?? process.platform;
const arch = process.env.OPENCREATOR_CREATOR_RUNTIME_ARCH ?? process.arch;
const target = `${platform}-${arch}`;
const outputRoot = resolve(
  process.env.OPENCREATOR_CREATOR_RUNTIME_VENDOR
    ?? join(rootDir, '.runtime', 'vendor', 'creator-runtime', target)
);
const proxy = process.env.OPENCREATOR_DOWNLOAD_PROXY?.trim();
const offline = process.env.OPENCREATOR_DESKTOP_OFFLINE === '1';

const releases = creatorRuntimeReleases();

const release = releases[target];
if (release === undefined) {
  throw new Error(
    `Automatic Creator Runtime dependency installation is not available for ${target}. `
    + 'Set OPENCREATOR_FFMPEG_PATH, OPENCREATOR_FFPROBE_PATH, '
    + 'and OPENCREATOR_YT_DLP_PATH explicitly.'
  );
}

release.ytDlp = resolveYtDlpRelease({
  readText: readReleaseText,
  offline,
  cached: offline ? readCachedYtDlpRelease() : undefined
});
console.log(`[creator-runtime] ${offline ? 'Using offline cached' : 'Resolved latest nightly'} yt-dlp ${release.ytDlp.version}`);

mkdirSync(outputRoot, { recursive: true });
const installed = {};
for (const [name, asset] of Object.entries(release)) {
  const path = join(outputRoot, asset.fileName);
  installAsset(name, asset, path);
  installed[name] = {
    version: asset.version,
    path: asset.fileName,
    sha256: asset.sha256,
    source: asset.url
  };
}
verifyPortableYtDlpRuntime({
  pythonArchive: join(outputRoot, release.pythonRuntime.fileName),
  ytDlp: join(outputRoot, release.ytDlp.fileName),
  certificateBundle: join(outputRoot, release.certificateBundle.fileName),
  expectedVersion: release.ytDlp.version
});
writeFileSync(join(outputRoot, 'versions.json'), `${JSON.stringify({
  version: 1,
  platform,
  arch,
  dependencies: installed
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outputRoot, dependencies: installed }));

function readCachedYtDlpRelease() {
  const path = join(outputRoot, 'versions.json');
  if (!existsSync(path)) return undefined;
  const versions = JSON.parse(readFileSync(path, 'utf8'));
  return versions?.version === 1 && versions.platform === platform && versions.arch === arch
    ? versions.dependencies?.ytDlp
    : undefined;
}

function readReleaseText(url) {
  const args = [
    '--fail-with-body', '--silent', '--show-error', '--location',
    '--retry', '3', '--connect-timeout', '20', '--max-time', '60',
    '--header', 'Cache-Control: no-cache'
  ];
  let input;
  if (new URL(url).origin === 'https://api.github.com') {
    const token = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
    if (token) {
      if (/[\r\n]/.test(token)) throw new Error('Invalid GitHub API token');
      // Keep credentials out of process arguments and command failure messages.
      args.push('--config', '-');
      input = `header = ${JSON.stringify(`Authorization: Bearer ${token}`)}\n`;
    }
  }
  if (proxy) args.push('--proxy', proxy);
  args.push(url);
  return execFileSync('curl', args, {
    cwd: rootDir,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: 4 * 1024 * 1024
  });
}

function installAsset(name, asset, path) {
  if (existsSync(path) && statSync(path).isFile() && hashFile(path) === asset.sha256) {
    if (asset.executable) chmodExecutable(path);
    if (asset.verify) verifyExecutable(name, asset, path);
    console.log(`[creator-runtime] Reusing ${name} ${asset.version}`);
    return;
  }
  if (offline) {
    throw new Error(
      `${name} ${asset.version} is unavailable in the Creator Runtime offline cache: ${path}`
    );
  }

  const temporary = `${path}.${process.pid}.partial`;
  retryWindowsFileOperation(() => rmSync(temporary, { force: true }));
  console.log(`[creator-runtime] Downloading ${name} ${asset.version}`);
  let installationError;
  try {
    downloadAsset(name, asset, temporary);
    if (asset.executable) chmodExecutable(temporary);
    if (asset.verify) verifyExecutable(name, asset, temporary);
    retryWindowsFileOperation(() => rmSync(path, { recursive: true, force: true }));
    retryWindowsFileOperation(() => renameSync(temporary, path));
  } catch (error) {
    installationError = error;
    throw error;
  } finally {
    try {
      retryWindowsFileOperation(() => rmSync(temporary, { force: true }));
    } catch (error) {
      if (!installationError) throw error;
      console.warn(`[creator-runtime] Unable to remove temporary download ${temporary}: ${error.message}`);
    }
  }
}

function downloadAsset(name, asset, path) {
  const args = [
    '--fail',
    '--location',
    '--retry', '3',
    '--connect-timeout', '20',
    '--output', path
  ];
  if (proxy) args.push('--proxy', proxy);
  if (asset.ghcrScope) {
    const tokenArgs = [
      '--fail',
      '--silent',
      '--show-error'
    ];
    if (proxy) tokenArgs.push('--proxy', proxy);
    tokenArgs.push(
      `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(asset.ghcrScope)}`
    );
    const response = JSON.parse(execFileSync('curl', tokenArgs, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit']
    }));
    if (typeof response?.token !== 'string' || response.token.length === 0) {
      throw new Error(`Unable to obtain the ${name} release download token`);
    }
    args.push('--header', `Authorization: Bearer ${response.token}`);
  }
  args.push(asset.url);
  execFileSync('curl', args, { cwd: rootDir, stdio: 'inherit' });
  verifyAssetHash(name, asset, path);
  return path;
}

function verifyAssetHash(name, asset, path) {
  const actual = hashFile(path);
  if (actual !== asset.sha256) {
    throw new Error(`${name} SHA-256 mismatch: expected ${asset.sha256}, received ${actual}`);
  }
}

function verifyPortableYtDlpRuntime(input) {
  if (platform !== process.platform || arch !== process.arch) return;
  const verificationRoot = mkdtempSync(join(tmpdir(), 'opencreator-yt-dlp-runtime-'));
  try {
    extractPythonRuntime(input.pythonArchive, verificationRoot);
    const executable = portablePythonExecutable(
      join(verificationRoot, 'python'),
      platform
    );
    const output = execFileSync(
      executable,
      ['-I', '-B', input.ytDlp, '--version'],
      {
        cwd: verificationRoot,
        env: {
          ...minimalEnvironment(process.env),
          SSL_CERT_FILE: input.certificateBundle
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
        windowsHide: true
      }
    ).trim();
    if (output !== input.expectedVersion) {
      throw new Error(`yt-dlp returned an unexpected version: ${output}`);
    }
  } finally {
    rmSync(verificationRoot, { recursive: true, force: true });
  }
}

function extractPythonRuntime(archive, destination) {
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', [
    '-xzf',
    archive,
    '-C',
    destination
  ], {
    cwd: rootDir,
    stdio: 'ignore'
  });
}

function portablePythonExecutable(pythonRoot, targetPlatform) {
  return targetPlatform === 'win32'
    ? join(pythonRoot, 'python.exe')
    : join(pythonRoot, 'bin', 'python3.13');
}

function verifyExecutable(name, asset, path) {
  verifyRuntimeExecutable({
    name,
    path,
    args: asset.verify,
    expected: asset.expected,
    env: minimalEnvironment(process.env),
    timeoutMs: asset.verifyTimeoutMs
  });
}

function minimalEnvironment(env) {
  const names = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']
    : ['HOME', 'TMPDIR', 'LANG', 'LC_ALL'];
  return Object.fromEntries(names.flatMap(name => (
    env[name] === undefined ? [] : [[name, env[name]]]
  )));
}

function chmodExecutable(path) {
  if (process.platform !== 'win32') chmodSync(path, 0o755);
}

function hashFile(path) {
  const digest = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return digest.digest('hex');
}
