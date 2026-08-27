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
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const releases = {
  'darwin-arm64': creatorRuntimeRelease({
    krillinAsset: 'KrillinAI-cli_2.1.0_macOS_arm64',
    krillinSha256: '3fdf9d573ffd6fc717f63a09d227b62da80919b5efe11e5504d3ad44f7090930',
    mediaTarget: 'darwin-arm64',
    ffmpegSha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
    ffprobeSha256: 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64',
    ytDlpAsset: 'yt-dlp_macos',
    ytDlpSha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'
  }),
  'darwin-x64': creatorRuntimeRelease({
    krillinAsset: 'KrillinAI-cli_2.1.0_macOS_amd64',
    krillinSha256: '99f232430d58dd2bf35504afda2f037cb571ef010082a16e65cf5ae3861cd356',
    mediaTarget: 'darwin-x64',
    ffmpegSha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
    ffprobeSha256: 'fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0',
    ytDlpAsset: 'yt-dlp_macos',
    ytDlpSha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'
  }),
  'linux-arm64': creatorRuntimeRelease({
    krillinAsset: 'KrillinAI-cli_2.1.0_Linux_arm64',
    krillinSha256: '3cbb5a71323a63d293031d91375c3d94f5ca31bf82f58b2fd27c0702058e9ed3',
    mediaTarget: 'linux-arm64',
    ffmpegSha256: '6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce',
    ffprobeSha256: 'd17ae9b4c297d48e2521ba14e417bb0537c6ff77c584cdbcd6bb0d8d0307a2e8',
    ytDlpAsset: 'yt-dlp_linux_aarch64',
    ytDlpSha256: 'b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc'
  }),
  'linux-x64': creatorRuntimeRelease({
    krillinAsset: 'KrillinAI-cli_2.1.0_Linux_x86_64',
    krillinSha256: '3f4e35af40d4ab4432e1bf9d40f8ab36c693631a90cd70946ee476034a571529',
    mediaTarget: 'linux-x64',
    ffmpegSha256: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99',
    ffprobeSha256: '4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d',
    ytDlpAsset: 'yt-dlp_linux',
    ytDlpSha256: '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a'
  }),
  'win32-x64': creatorRuntimeRelease({
    krillinAsset: 'KrillinAI-cli_2.1.0_Windows.exe',
    krillinSha256: '9050e37d41fa41097c07eb310003f3985422cb6c3ef8a117fd39fb45ac76805f',
    mediaTarget: 'win32-x64',
    ffmpegSha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
    ffprobeSha256: '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4',
    ytDlpAsset: 'yt-dlp.exe',
    ytDlpSha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
    executableSuffix: '.exe'
  })
};

const release = releases[target];
if (release === undefined) {
  throw new Error(
    `Automatic Creator Runtime dependency installation is not available for ${target}. `
    + 'Set OPENCREATOR_KRILLINAI_CLI_PATH, OPENCREATOR_FFMPEG_PATH, '
    + 'OPENCREATOR_FFPROBE_PATH, and OPENCREATOR_YT_DLP_PATH explicitly.'
  );
}

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
writeFileSync(join(outputRoot, 'versions.json'), `${JSON.stringify({
  version: 1,
  platform,
  arch,
  dependencies: installed
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outputRoot, dependencies: installed }));

function installAsset(name, asset, path) {
  if (existsSync(path) && statSync(path).isFile() && hashFile(path) === asset.sha256) {
    chmodExecutable(path);
    verifyExecutable(name, asset, path);
    console.log(`[creator-runtime] Reusing ${name} ${asset.version}`);
    return;
  }
  if (offline) {
    throw new Error(
      `${name} ${asset.version} is unavailable in the Creator Runtime offline cache: ${path}`
    );
  }

  const temporary = `${path}.${process.pid}.partial`;
  rmSync(temporary, { force: true });
  console.log(`[creator-runtime] Downloading ${name} ${asset.version}`);
  try {
    downloadAsset(name, asset, temporary);
    chmodExecutable(temporary);
    verifyExecutable(name, asset, temporary);
    rmSync(path, { recursive: true, force: true });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
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

function creatorRuntimeRelease(input) {
  const suffix = input.executableSuffix ?? '';
  return {
    krillinai: {
      version: '2.1.0',
      fileName: `krillinai-cli${suffix}`,
      url: `https://github.com/krillinai/KrillinAI/releases/download/v2.1.0/${input.krillinAsset}`,
      sha256: input.krillinSha256,
      verify: ['--help'],
      expected: /krillinai-cli <command>/
    },
    ffmpeg: {
      version: '6.0',
      fileName: `ffmpeg${suffix}`,
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-${input.mediaTarget}`,
      sha256: input.ffmpegSha256,
      verify: ['-version'],
      expected: /^ffmpeg version 6\.0/m
    },
    ffprobe: {
      version: '6.0',
      fileName: `ffprobe${suffix}`,
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-${input.mediaTarget}`,
      sha256: input.ffprobeSha256,
      verify: ['-version'],
      expected: /^ffprobe version 6\.0/m
    },
    ytDlp: {
      version: '2026.08.19',
      fileName: `yt-dlp${suffix}`,
      url: `https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/${input.ytDlpAsset}`,
      sha256: input.ytDlpSha256,
      verify: ['--version'],
      verifyTimeoutMs: 60_000,
      expected: /^2026\.08\.19$/m
    }
  };
}

function verifyExecutable(name, asset, path) {
  const verificationRoot = mkdtempSync(join(tmpdir(), 'opencreator-runtime-check-'));
  let output;
  try {
    output = execFileSync(path, asset.verify, {
      cwd: verificationRoot,
      env: minimalEnvironment(process.env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: asset.verifyTimeoutMs ?? 20_000,
      windowsHide: true
    });
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';
    throw new Error(`${name} failed its runtime check: ${stderr || String(error)}`);
  } finally {
    rmSync(verificationRoot, { recursive: true, force: true });
  }
  if (!asset.expected.test(output.trim())) {
    throw new Error(`${name} returned an unexpected version or help response`);
  }
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
