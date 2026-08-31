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
const binDir = join(outputRoot, 'bin');
const executableSuffix = targetPlatform === 'win32' ? '.exe' : '';
const defaultCliVersion = '2.1.0';
const configuredKrillinCliPath = process.env.OPENCREATOR_KRILLINAI_CLI_PATH?.trim();
const configuredKrillinCliVersion = process.env.OPENCREATOR_KRILLINAI_CLI_VERSION?.trim();
const configuredKrillinUpstreamCommit = process.env.OPENCREATOR_KRILLINAI_UPSTREAM_COMMIT?.trim();
const configuredYtDlpPath = process.env.OPENCREATOR_YT_DLP_PATH?.trim();
const protocolVersion = 1;
const protocolSchemaSource = join(rootDir, 'packages', 'protocol', 'contracts', 'krillin-opencreator-v1.schema.json');
const runtimeMode = 'cli';

ensureCliDependencies();
const vendorVersions = readVendorVersions();
const vendoredKrillin = configuredKrillinCliPath
  ? undefined
  : vendorVersions?.dependencies?.krillinai;
if (configuredKrillinCliPath && (!configuredKrillinCliVersion || !configuredKrillinUpstreamCommit)) {
  throw new Error(
    'Set OPENCREATOR_KRILLINAI_CLI_VERSION and OPENCREATOR_KRILLINAI_UPSTREAM_COMMIT '
    + 'when OPENCREATOR_KRILLINAI_CLI_PATH is configured'
  );
}
const cliVersion = configuredKrillinCliVersion ?? vendoredKrillin?.version ?? defaultCliVersion;
const serviceVersion = cliVersion;
const upstreamCommit = configuredKrillinUpstreamCommit
  ?? vendoredKrillin?.upstreamCommit
  ?? `v${defaultCliVersion}`;
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });

const primaryExecutablePath = join(binDir, `krillinai-cli${executableSuffix}`);
copyExecutable(
  resolveExecutable(
    'krillinai-cli',
    configuredKrillinCliPath,
    join(vendorRoot, `krillinai-cli${executableSuffix}`)
  ),
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
const protocolSchemaPath = join(outputRoot, 'api', 'opencreator', 'v1', 'schema.json');
mkdirSync(dirname(protocolSchemaPath), { recursive: true });
copyFileSync(protocolSchemaSource, protocolSchemaPath);
const protocolSha256 = hashFile(protocolSchemaPath);
const buildRecord = {
  version: 1,
  runtimeMode,
  serviceVersion,
  cliVersion,
  protocolVersion,
  protocolSha256,
  ytDlp: ytDlpRuntime.descriptor,
  upstreamCommit,
  integrationPatchSha256: hashFiles([
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
  subtitleStylePath,
  protocolSchemaPath,
  buildRecordPath
];
const manifest = {
  version: 1,
  runtimeMode,
  serviceVersion,
  cliVersion,
  protocolVersion,
  protocolSha256,
  integrationPatchSha256: buildRecord.integrationPatchSha256,
  platform: targetPlatform,
  arch: targetArch,
  upstreamCommit: buildRecord.upstreamCommit,
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

function ensureCliDependencies() {
  const required = [
    [configuredKrillinCliPath, join(vendorRoot, `krillinai-cli${executableSuffix}`)],
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
