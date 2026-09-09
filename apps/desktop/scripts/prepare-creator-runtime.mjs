import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
const targetPlatform = normalizePlatform(
  process.env.OPENCREATOR_DESKTOP_TARGET_PLATFORM
    ?? process.env.OPENCREATOR_CREATOR_RUNTIME_PLATFORM
    ?? process.platform
);
const targetArch = process.env.OPENCREATOR_DESKTOP_TARGET_ARCH
  ?? process.env.OPENCREATOR_CREATOR_RUNTIME_ARCH
  ?? process.arch;
const outputRoot = resolve(process.env.OPENCREATOR_CREATOR_RUNTIME_OUTPUT ?? join(desktopDir, '.pack', 'creator-runtime', 'krillinai'));
const vendorRoot = resolve(
  process.env.OPENCREATOR_CREATOR_RUNTIME_VENDOR
    ?? join(rootDir, '.runtime', 'vendor', 'creator-runtime', `${targetPlatform}-${targetArch}`)
);
const krillinBuildRoot = resolve(
  process.env.OPENCREATOR_KRILLINAI_BUILD_OUTPUT
    ?? join(rootDir, '.runtime', 'build', 'krillinai', `${targetPlatform}-${targetArch}`)
);
const binDir = join(outputRoot, 'bin');
const executableSuffix = targetPlatform === 'win32' ? '.exe' : '';
const configuredYtDlpPath = process.env.OPENCREATOR_YT_DLP_PATH?.trim();
const runtimeMode = 'cli';
const subtitleFontSourceRoot = join(rootDir, 'assets', 'creator-subtitle-fonts');

ensureKrillinBuild();
ensureExternalDependencies();
const krillinBuild = readKrillinBuildManifest();
const vendorVersions = readVendorVersions();
const cliVersion = krillinBuild.componentVersion;
const sourceCommit = krillinBuild.sourceCommit;
const sourceSha256 = krillinBuild.sourceSha256;
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });
const subtitleFonts = prepareSubtitleFonts();

const primaryExecutablePath = join(binDir, `krillinai-cli${executableSuffix}`);
copyExecutable(
  resolve(krillinBuildRoot, krillinBuild.binaries['krillinai-cli'].path),
  primaryExecutablePath
);
verifyStandaloneKrillinCli(primaryExecutablePath);

const externalInputs = [
  ['ffmpeg', process.env.OPENCREATOR_FFMPEG_PATH, join(vendorRoot, `ffmpeg${executableSuffix}`)],
  ['ffprobe', process.env.OPENCREATOR_FFPROBE_PATH, join(vendorRoot, `ffprobe${executableSuffix}`)]
];
for (const [name, configured, vendored] of externalInputs) {
  const source = resolveExecutable(name, configured, vendored);
  const target = join(binDir, `${name}${executableSuffix}`);
  copyExecutable(source, target);
}
const ytDlpRuntime = prepareYtDlpRuntime(vendorVersions);
for (const path of [
  primaryExecutablePath,
  ...externalInputs.map(([name]) => join(binDir, `${name}${executableSuffix}`)),
  ...ytDlpRuntime.executablePaths
]) {
  clearMacOSFileMetadata(path);
}

const subtitleStylePath = join(outputRoot, 'subtitle-style.json');
writeFileSync(subtitleStylePath, `${JSON.stringify({ version: 1 }, null, 2)}\n`);
const buildRecord = {
  version: 1,
  runtimeMode,
  cliVersion,
  sourceCommit,
  sourceSha256,
  ytDlp: ytDlpRuntime.descriptor,
  subtitleFonts: {
    manifestSha256: subtitleFonts.manifestSha256,
    resourceCount: subtitleFonts.resourcePaths.length
  },
  integrationPatchSha256: hashFiles([
    join(rootDir, 'scripts', 'build-krillinai.mjs'),
    join(scriptDir, 'install-creator-runtime-dependencies.mjs'),
    join(scriptDir, 'prepare-creator-runtime.mjs'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'krillin', 'adapter.ts'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'krillin', 'cli-runner.ts'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'krillin', 'config-bridge.ts'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'krillin', 'dependency-loader.ts'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'krillin', 'dependency-preflight.ts'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'templates', 'video-translation.ts')
  ]),
  platform: targetPlatform,
  arch: targetArch
};
const buildRecordPath = join(outputRoot, 'build-record.json');
writeFileSync(buildRecordPath, `${JSON.stringify(buildRecord, null, 2)}\n`);

const resourcePaths = [
  primaryExecutablePath,
  ...externalInputs.map(([name]) => join(binDir, `${name}${executableSuffix}`)),
  ...ytDlpRuntime.resourcePaths,
  ...subtitleFonts.resourcePaths,
  subtitleStylePath,
  buildRecordPath
];
const manifest = {
  version: 1,
  runtimeMode,
  cliVersion,
  sourceCommit,
  sourceSha256,
  integrationPatchSha256: buildRecord.integrationPatchSha256,
  platform: targetPlatform,
  arch: targetArch,
  ytDlp: ytDlpRuntime.descriptor,
  resources: resourcePaths.map(path => ({
    path: relative(outputRoot, path).replaceAll('\\', '/'),
    sha256: hashFile(path),
    kind: path.startsWith(binDir) || ytDlpRuntime.executablePaths.includes(path)
      ? 'executable'
      : 'asset'
  }))
};
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outputRoot, resources: manifest.resources.length }));

function prepareSubtitleFonts() {
  const sourceManifestPath = join(subtitleFontSourceRoot, 'manifest.json');
  if (!existsSync(sourceManifestPath)) {
    throw new Error(`Creator subtitle font manifest is missing: ${sourceManifestPath}`);
  }
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
  if (
    sourceManifest?.version !== 1
    || !Array.isArray(sourceManifest.fonts)
    || sourceManifest.fonts.length !== 9
    || !Array.isArray(sourceManifest.licenses)
    || sourceManifest.licenses.length < 1
  ) {
    throw new Error('Creator subtitle font manifest is invalid');
  }

  const runtimeFontsDir = join(outputRoot, 'fonts');
  const runtimeLicensesDir = join(outputRoot, 'licenses', 'fonts');
  mkdirSync(runtimeFontsDir, { recursive: true });
  mkdirSync(runtimeLicensesDir, { recursive: true });
  const resourcePaths = [];
  const runtimeFonts = [];
  const seenAliases = new Set();
  for (const entry of sourceManifest.fonts) {
    if (
      !['sans', 'serif', 'rounded'].includes(entry?.preset)
      || !['regular', 'medium', 'bold'].includes(entry?.weight)
      || ![400, 500, 700].includes(entry?.weightValue)
      || typeof entry?.family !== 'string'
      || typeof entry?.fullName !== 'string'
      || typeof entry?.desktopFile !== 'string'
      || !/\.(?:otf|ttf)$/i.test(entry.desktopFile)
      || !/^[a-f0-9]{64}$/i.test(entry?.desktopSha256 ?? '')
      || typeof entry?.webFile !== 'string'
      || !/\.woff2$/i.test(entry.webFile)
      || !/^[a-f0-9]{64}$/i.test(entry?.webSha256 ?? '')
      || typeof entry?.license !== 'string'
    ) {
      throw new Error('Creator subtitle font manifest contains an invalid font entry');
    }
    const desktopSource = resolveAssetPath(subtitleFontSourceRoot, entry.desktopFile);
    if (
      !existsSync(desktopSource)
      || hashFile(desktopSource) !== entry.desktopSha256.toLowerCase()
    ) {
      throw new Error(`Creator subtitle desktop font hash mismatch: ${entry.desktopFile}`);
    }
    const webSource = resolveAssetPath(subtitleFontSourceRoot, entry.webFile);
    if (
      !existsSync(webSource)
      || hashFile(webSource) !== entry.webSha256.toLowerCase()
    ) {
      throw new Error(`Creator subtitle Web font hash mismatch: ${entry.webFile}`);
    }
    assertSubtitleFontMetadata(desktopSource, entry);
    assertSubtitleFontMetadata(webSource, entry);
    if (seenAliases.has(entry.family)) {
      throw new Error(`Creator subtitle font alias is duplicated: ${entry.family}`);
    }
    seenAliases.add(entry.family);
    const targetName = entry.desktopFile.split('/').at(-1);
    const target = join(runtimeFontsDir, targetName);
    copyFileSync(desktopSource, target);
    resourcePaths.push(target);
    runtimeFonts.push({
      preset: entry.preset,
      weight: entry.weight,
      weightValue: entry.weightValue,
      family: entry.family,
      fullName: entry.fullName,
      file: `fonts/${targetName}`,
      sha256: entry.desktopSha256.toLowerCase(),
      license: `licenses/fonts/${entry.license.split('/').at(-1)}`
    });
  }

  const copiedLicenses = new Set();
  const runtimeLicenses = [];
  for (const entry of sourceManifest.licenses) {
    if (
      typeof entry?.file !== 'string'
      || !/^[a-f0-9]{64}$/i.test(entry?.sha256 ?? '')
    ) {
      throw new Error('Creator subtitle font manifest contains an invalid license entry');
    }
    const source = resolveAssetPath(subtitleFontSourceRoot, entry.file);
    if (!existsSync(source) || hashFile(source) !== entry.sha256.toLowerCase()) {
      throw new Error(`Creator subtitle font license hash mismatch: ${entry.file}`);
    }
    const target = join(runtimeLicensesDir, entry.file.split('/').at(-1));
    if (!copiedLicenses.has(target)) {
      copyFileSync(source, target);
      resourcePaths.push(target);
      copiedLicenses.add(target);
    }
    runtimeLicenses.push({
      file: `licenses/fonts/${entry.file.split('/').at(-1)}`,
      sha256: entry.sha256.toLowerCase()
    });
  }

  const runtimeManifestPath = join(runtimeFontsDir, 'manifest.json');
  writeFileSync(runtimeManifestPath, `${JSON.stringify({
    version: sourceManifest.version,
    sources: sourceManifest.sources,
    fonts: runtimeFonts,
    licenses: runtimeLicenses
  }, null, 2)}\n`);
  resourcePaths.push(runtimeManifestPath);
  return {
    manifestSha256: hashFile(sourceManifestPath),
    resourcePaths
  };
}

function assertSubtitleFontMetadata(path, entry) {
  const font = fontkit.openSync(path);
  if (
    Array.isArray(font.fonts)
    || font.familyName !== entry.family
    || font.fullName !== entry.fullName
    || font['OS/2']?.usWeightClass !== entry.weightValue
  ) {
    throw new Error(`Creator subtitle font metadata mismatch: ${path}`);
  }
}

function resolveAssetPath(root, path) {
  const absoluteRoot = resolve(root);
  const result = resolve(absoluteRoot, path);
  if (
    result !== absoluteRoot
    && !result.startsWith(`${absoluteRoot}/`)
    && !result.startsWith(`${absoluteRoot}\\`)
  ) {
    throw new Error(`Creator subtitle font path escapes its root: ${path}`);
  }
  return result;
}

function ensureKrillinBuild() {
  execFileSync(process.execPath, [join(rootDir, 'scripts', 'build-krillinai.mjs')], {
    cwd: rootDir,
    env: {
      ...process.env,
      OPENCREATOR_DESKTOP_TARGET_PLATFORM: targetPlatform,
      OPENCREATOR_DESKTOP_TARGET_ARCH: targetArch,
      OPENCREATOR_KRILLINAI_BUILD_OUTPUT: krillinBuildRoot
    },
    stdio: 'inherit'
  });
}

function readKrillinBuildManifest() {
  const path = join(krillinBuildRoot, 'manifest.json');
  if (!existsSync(path)) {
    throw new Error(`KrillinAI build manifest is missing: ${path}`);
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const cli = manifest?.binaries?.['krillinai-cli'];
  const server = manifest?.binaries?.['krillinai-server'];
  if (
    manifest?.version !== 1
    || manifest.component !== 'opencreator-krillinai'
    || typeof manifest.componentVersion !== 'string'
    || typeof manifest.sourceCommit !== 'string'
    || !/^[a-f0-9]{64}$/i.test(manifest.sourceSha256 ?? '')
    || !/^[a-f0-9]{64}$/i.test(manifest.buildRecipeSha256 ?? '')
    || manifest.platform !== targetPlatform
    || manifest.arch !== targetArch
    || manifest.buildVcs !== false
    || typeof cli?.path !== 'string'
    || typeof server?.path !== 'string'
  ) {
    throw new Error('KrillinAI build manifest is invalid or targets another platform');
  }
  return manifest;
}

function ensureExternalDependencies() {
  const required = [
    [process.env.OPENCREATOR_FFMPEG_PATH, join(vendorRoot, `ffmpeg${executableSuffix}`)],
    [process.env.OPENCREATOR_FFPROBE_PATH, join(vendorRoot, `ffprobe${executableSuffix}`)],
    [configuredYtDlpPath, join(vendorRoot, 'yt-dlp')],
    [configuredYtDlpPath, join(vendorRoot, 'python-runtime.tar.gz')],
    [configuredYtDlpPath, join(vendorRoot, 'cacert.pem')]
  ];
  if (required.every(([configured, vendored]) => configured || existsSync(vendored))) return;
  execFileSync(process.execPath, [join(scriptDir, 'install-creator-runtime-dependencies.mjs')], {
    cwd: rootDir,
    env: {
      ...process.env,
      OPENCREATOR_CREATOR_RUNTIME_PLATFORM: targetPlatform,
      OPENCREATOR_CREATOR_RUNTIME_ARCH: targetArch,
      OPENCREATOR_CREATOR_RUNTIME_VENDOR: vendorRoot
    },
    stdio: 'inherit'
  });
}

function readVendorVersions() {
  const path = join(vendorRoot, 'versions.json');
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value?.version === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveExecutable(name, configured, vendored) {
  if (configured) {
    const value = resolve(configured);
    if (!existsSync(value)) throw new Error(`${name} input is missing: ${value}`);
    return value;
  }
  if (vendored && existsSync(vendored)) return resolve(vendored);
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const located = commandOutput(locator, [name], rootDir).split(/\r?\n/).find(Boolean);
  if (!located || !existsSync(located)) {
    throw new Error(`Set OPENCREATOR_${name.replace('-', '_').toUpperCase()}_PATH to a pinned ${name} binary`);
  }
  return resolve(located);
}

function copyExecutable(source, target) {
  copyFileSync(source, target);
  clearMacOSFileMetadata(target);
  if (process.platform !== 'win32') chmodSync(target, 0o755);
}

function prepareYtDlpRuntime(vendorVersions) {
  if (configuredYtDlpPath) {
    const target = join(binDir, `yt-dlp${executableSuffix}`);
    copyExecutable(
      resolveExecutable('yt-dlp', configuredYtDlpPath),
      target
    );
    const version = verifyStandaloneYtDlp(target);
    return {
      descriptor: {
        mode: 'standalone',
        version,
        executable: relative(outputRoot, target).replaceAll('\\', '/')
      },
      resourcePaths: [target],
      executablePaths: [target]
    };
  }

  const runtimeRoot = join(outputRoot, 'yt-dlp-runtime');
  mkdirSync(runtimeRoot, { recursive: true });
  extractPythonRuntime(
    join(vendorRoot, 'python-runtime.tar.gz'),
    runtimeRoot
  );
  removePythonBytecodeCaches(join(runtimeRoot, 'python'));
  const script = join(runtimeRoot, 'yt-dlp');
  const certificateBundle = join(runtimeRoot, 'cacert.pem');
  copyFileSync(join(vendorRoot, 'yt-dlp'), script);
  copyFileSync(join(vendorRoot, 'cacert.pem'), certificateBundle);
  const executable = portablePythonExecutable(
    join(runtimeRoot, 'python'),
    targetPlatform
  );
  if (!existsSync(executable)) {
    throw new Error(`Portable Python executable is missing: ${executable}`);
  }
  clearMacOSFileMetadata(runtimeRoot, true);
  const ytDlpVersion = vendorVersions?.dependencies?.ytDlp?.version;
  const pythonVersion = vendorVersions?.dependencies?.pythonRuntime?.version;
  if (!ytDlpVersion || !pythonVersion) {
    throw new Error('Portable yt-dlp dependency versions are missing');
  }
  verifyPortableYtDlp({
    executable,
    script,
    certificateBundle,
    expectedVersion: ytDlpVersion
  });
  return {
    descriptor: {
      mode: 'python',
      version: ytDlpVersion,
      pythonVersion,
      executable: relative(outputRoot, executable).replaceAll('\\', '/'),
      script: relative(outputRoot, script).replaceAll('\\', '/'),
      certificateBundle: relative(outputRoot, certificateBundle).replaceAll('\\', '/')
    },
    resourcePaths: listFiles(runtimeRoot),
    executablePaths: [executable]
  };
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

function portablePythonExecutable(pythonRoot, platform) {
  return platform === 'win32'
    ? join(pythonRoot, 'python.exe')
    : join(pythonRoot, 'bin', 'python3.13');
}

function listFiles(root) {
  const files = [];
  visit(root);
  return files.sort();

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
}

function removePythonBytecodeCaches(root) {
  visit(root);

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory() && entry.name === '__pycache__') {
        rmSync(path, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith('.pyc')) {
        rmSync(path, { force: true });
      }
    }
  }
}

function clearMacOSFileMetadata(path, recursive = false) {
  if (process.platform !== 'darwin') return;
  execFileSync('xattr', [recursive ? '-cr' : '-c', path], {
    cwd: rootDir,
    stdio: 'ignore'
  });
}

function verifyStandaloneKrillinCli(path) {
  const verificationRoot = mkdtempSync(join(tmpdir(), 'opencreator-krillin-cli-'));
  let help;
  try {
    help = execFileSync(path, ['--help'], {
      cwd: verificationRoot,
      env: minimalRuntimeEnvironment(process.env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      windowsHide: true
    });
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}\n${String(error.stderr ?? '')}`.trim().slice(-2_000)
      : String(error);
    throw new Error(`KrillinAI CLI must run in the packaged minimal environment: ${detail}`);
  } finally {
    rmSync(verificationRoot, { recursive: true, force: true });
  }
  if (!/krillinai-cli <command>/i.test(help)) {
    throw new Error('KrillinAI CLI emitted an unexpected help response');
  }
}

function verifyStandaloneYtDlp(path) {
  let version;
  try {
    version = execFileSync(path, ['--version'], {
      cwd: outputRoot,
      env: minimalRuntimeEnvironment(process.env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      windowsHide: true
    }).trim();
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}\n${String(error.stderr ?? '')}`.trim().slice(-2_000)
      : String(error);
    throw new Error(
      `yt-dlp must be a standalone binary that runs in the packaged minimal environment: ${detail}`
    );
  }
  if (!/^\d{4}\.\d{2}\.\d{2}(?:\.\d{6})?$/.test(version)) {
    throw new Error(
      `yt-dlp must be an official stable or nightly build: ${version}`
    );
  }
  return version;
}

function verifyPortableYtDlp(input) {
  if (targetPlatform !== process.platform || targetArch !== process.arch) return;
  let version;
  try {
    version = execFileSync(
      input.executable,
      ['-I', '-B', input.script, '--version'],
      {
        cwd: outputRoot,
        env: {
          ...minimalRuntimeEnvironment(process.env),
          SSL_CERT_FILE: input.certificateBundle
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
        windowsHide: true
      }
    ).trim();
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}\n${String(error.stderr ?? '')}`.trim().slice(-2_000)
      : String(error);
    throw new Error(
      `Portable yt-dlp runtime failed its packaged environment check: ${detail}`
    );
  }
  if (version !== input.expectedVersion) {
    throw new Error(
      `Portable yt-dlp returned ${version}; expected ${input.expectedVersion}`
    );
  }
}

function minimalRuntimeEnvironment(env) {
  const names = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']
    : ['HOME', 'TMPDIR', 'LANG', 'LC_ALL'];
  return Object.fromEntries(names.flatMap(name => (
    env[name] === undefined ? [] : [[name, env[name]]]
  )));
}

function commandOutput(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
}

function normalizePlatform(value) {
  if (value === 'mac') return 'darwin';
  if (value === 'win') return 'win32';
  if (['darwin', 'win32', 'linux'].includes(value)) return value;
  throw new Error(`Unsupported Creator Runtime platform: ${value}`);
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

function hashFiles(paths) {
  const digest = createHash('sha256');
  for (const path of [...paths].sort()) {
    if (!existsSync(path)) throw new Error(`Creator Runtime integration source is missing: ${path}`);
    updateDigestEntry(digest, relative(rootDir, path).replaceAll('\\', '/'), readFileSync(path));
  }
  return digest.digest('hex');
}

function updateDigestEntry(digest, label, content) {
  const header = Buffer.from(`${JSON.stringify(label)}\n${content.length}\n`, 'utf8');
  digest.update(header);
  digest.update(content);
  digest.update('\n');
}
