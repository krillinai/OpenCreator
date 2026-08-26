import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  cpSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
const outputRoot = resolve(process.env.OPENCREATOR_CREATOR_RUNTIME_OUTPUT ?? join(desktopDir, '.pack', 'creator-runtime', 'krillinai'));
const vendorRoot = resolve(
  process.env.OPENCREATOR_CREATOR_RUNTIME_VENDOR
    ?? join(rootDir, '.runtime', 'vendor', 'creator-runtime', `${process.platform}-${process.arch}`)
);
const binDir = join(outputRoot, 'bin');
const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const cliVersion = '2.1.0';
const protocolVersion = 1;
const protocolSchemaSource = join(rootDir, 'packages', 'protocol', 'contracts', 'krillin-opencreator-v1.schema.json');
const runtimeMode = 'cli';

ensureCliDependencies();
const vendorVersions = readVendorVersions();
const vendoredKrillin = process.env.OPENCREATOR_KRILLINAI_CLI_PATH
  ? undefined
  : vendorVersions?.dependencies?.krillinai;
const serviceVersion = vendoredKrillin?.version ?? cliVersion;
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });

const primaryExecutablePath = join(binDir, `krillinai-cli${executableSuffix}`);
copyExecutable(
  resolveExecutable(
    'krillinai-cli',
    process.env.OPENCREATOR_KRILLINAI_CLI_PATH,
    join(vendorRoot, `krillinai-cli${executableSuffix}`)
  ),
  primaryExecutablePath
);
verifyStandaloneKrillinCli(primaryExecutablePath);

const externalInputs = [
  ['ffmpeg', process.env.OPENCREATOR_FFMPEG_PATH, join(vendorRoot, `ffmpeg${executableSuffix}`)],
  ['ffprobe', process.env.OPENCREATOR_FFPROBE_PATH, join(vendorRoot, `ffprobe${executableSuffix}`)],
  ['yt-dlp', process.env.OPENCREATOR_YT_DLP_PATH, join(vendorRoot, `yt-dlp${executableSuffix}`)]
];
for (const [name, configured, vendored] of externalInputs) {
  const source = resolveExecutable(name, configured, vendored);
  const target = join(binDir, `${name}${executableSuffix}`);
  copyExecutable(source, target);
  if (name === 'yt-dlp') verifyStandaloneYtDlp(target);
}

const packagedLocalAsrResources = [
  ...prepareFasterWhisper(),
  ...prepareWhisperCpp(),
  ...prepareWhisperKit()
];
if (packagedLocalAsrResources.length === 0) {
  throw new Error('Package at least one local transcription runtime so cloud credentials remain optional');
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
  upstreamCommit: vendoredKrillin?.upstreamCommit ?? `v${cliVersion}`,
  integrationPatchSha256: hashFiles([
    join(scriptDir, 'install-creator-runtime-dependencies.mjs'),
    join(scriptDir, 'prepare-creator-runtime.mjs'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'krillin', 'adapter.ts'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'krillin', 'cli-runner.ts'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'krillin', 'config-bridge.ts'),
    join(rootDir, 'apps', 'daemon', 'src', 'creator', 'templates', 'video-translation.ts')
  ]),
  platform: process.platform,
  arch: process.arch
};
const buildRecordPath = join(outputRoot, 'build-record.json');
writeFileSync(buildRecordPath, `${JSON.stringify(buildRecord, null, 2)}\n`);

const resourcePaths = [
  primaryExecutablePath,
  ...externalInputs.map(([name]) => join(binDir, `${name}${executableSuffix}`)),
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
  platform: process.platform,
  arch: process.arch,
  upstreamCommit: buildRecord.upstreamCommit,
  resources: resourcePaths.map(path => ({
    path: relative(outputRoot, path).replaceAll('\\', '/'),
    sha256: hashFile(path),
    kind: path.startsWith(binDir) ? 'executable' : 'asset'
  })).concat(packagedLocalAsrResources)
};
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outputRoot, resources: manifest.resources.length }));

function ensureCliDependencies() {
  const required = [
    [process.env.OPENCREATOR_KRILLINAI_CLI_PATH, join(vendorRoot, `krillinai-cli${executableSuffix}`)],
    [process.env.OPENCREATOR_FFMPEG_PATH, join(vendorRoot, `ffmpeg${executableSuffix}`)],
    [process.env.OPENCREATOR_FFPROBE_PATH, join(vendorRoot, `ffprobe${executableSuffix}`)],
    [process.env.OPENCREATOR_YT_DLP_PATH, join(vendorRoot, `yt-dlp${executableSuffix}`)]
  ];
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    required.push(
      [process.env.OPENCREATOR_WHISPERKIT_PATH, join(vendorRoot, 'whisperkit-cli')],
      [
        process.env.OPENCREATOR_WHISPERKIT_MODEL_PATH,
        join(vendorRoot, 'models', 'whisperkit', 'openai_whisper-large-v2')
      ]
    );
  }
  if (required.every(([configured, vendored]) => configured || existsSync(vendored))) return;
  execFileSync(process.execPath, [join(scriptDir, 'install-creator-runtime-dependencies.mjs')], {
    cwd: rootDir,
    env: {
      ...process.env,
      OPENCREATOR_CREATOR_RUNTIME_PLATFORM: process.platform,
      OPENCREATOR_CREATOR_RUNTIME_ARCH: process.arch,
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
  if (process.platform !== 'win32') chmodSync(target, 0o755);
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

function prepareFasterWhisper() {
  const executableInput = process.env.OPENCREATOR_FASTER_WHISPER_PATH;
  const modelInput = process.env.OPENCREATOR_FASTER_WHISPER_MODEL_PATH;
  if (!executableInput && !modelInput) return [];
  if (!executableInput || !modelInput) {
    throw new Error('Set both OPENCREATOR_FASTER_WHISPER_PATH and OPENCREATOR_FASTER_WHISPER_MODEL_PATH');
  }
  const model = process.env.OPENCREATOR_FASTER_WHISPER_MODEL ?? 'medium';
  if (!['tiny', 'medium', 'large-v2'].includes(model)) {
    throw new Error(`Unsupported FasterWhisper model: ${model}`);
  }
  const executableSource = resolve(executableInput);
  const modelSource = resolve(modelInput);
  if (!existsSync(executableSource) || !statSync(executableSource).isFile()) {
    throw new Error(`FasterWhisper executable is unavailable: ${executableSource}`);
  }
  if (!existsSync(modelSource) || !statSync(modelSource).isDirectory()) {
    throw new Error(`FasterWhisper model directory is unavailable: ${modelSource}`);
  }
  const executable = join(binDir, `faster-whisper${executableSuffix}`);
  const modelDir = join(outputRoot, 'models', 'fasterwhisper', `faster-whisper-${model}`);
  copyFileSync(executableSource, executable);
  cpSync(modelSource, modelDir, { recursive: true });
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  return [
    packagedResource(executable, 'executable', 'fasterwhisper', model),
    ...listFiles(modelDir).map(path => packagedResource(path, 'model', 'fasterwhisper', model))
  ];
}

function prepareWhisperCpp() {
  const executableInput = process.env.OPENCREATOR_WHISPER_CPP_PATH;
  const modelInput = process.env.OPENCREATOR_WHISPER_CPP_MODEL_PATH;
  if (!executableInput && !modelInput) return [];
  if (!executableInput || !modelInput) {
    throw new Error('Set both OPENCREATOR_WHISPER_CPP_PATH and OPENCREATOR_WHISPER_CPP_MODEL_PATH');
  }
  if (process.platform !== 'win32') {
    throw new Error('The packaged whisper.cpp fallback currently supports Windows only');
  }
  const model = process.env.OPENCREATOR_WHISPER_CPP_MODEL ?? 'tiny';
  if (!['tiny', 'medium', 'large-v2'].includes(model)) {
    throw new Error(`Unsupported whisper.cpp model: ${model}`);
  }
  const executableSource = resolve(executableInput);
  const modelSource = resolve(modelInput);
  if (!existsSync(executableSource) || !statSync(executableSource).isFile()) {
    throw new Error(`whisper.cpp executable is unavailable: ${executableSource}`);
  }
  if (!existsSync(modelSource) || !statSync(modelSource).isFile()) {
    throw new Error(`whisper.cpp model is unavailable: ${modelSource}`);
  }

  const executable = join(binDir, `whispercpp${executableSuffix}`);
  copyFileSync(executableSource, executable);
  const dependencyPaths = readdirSync(dirname(executableSource), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.dll'))
    .map(entry => {
      const target = join(binDir, entry.name);
      copyFileSync(join(dirname(executableSource), entry.name), target);
      return target;
    });
  if (dependencyPaths.length === 0) {
    throw new Error(`whisper.cpp runtime DLLs are unavailable beside ${executableSource}`);
  }
  verifyStandaloneWhisperCpp(executable);

  const modelPath = join(outputRoot, 'models', 'whispercpp', `ggml-${model}.bin`);
  mkdirSync(dirname(modelPath), { recursive: true });
  copyFileSync(modelSource, modelPath);
  return [
    packagedResource(executable, 'executable', 'whispercpp', model),
    ...dependencyPaths.map(path => packagedResource(path, 'asset')),
    packagedResource(modelPath, 'model', 'whispercpp', model)
  ];
}

function prepareWhisperKit() {
  const defaultExecutable = process.platform === 'darwin' && process.arch === 'arm64'
    ? join(vendorRoot, 'whisperkit-cli')
    : undefined;
  const defaultModel = process.platform === 'darwin' && process.arch === 'arm64'
    ? join(vendorRoot, 'models', 'whisperkit', 'openai_whisper-large-v2')
    : undefined;
  const executableInput = process.env.OPENCREATOR_WHISPERKIT_PATH ?? defaultExecutable;
  const modelInput = process.env.OPENCREATOR_WHISPERKIT_MODEL_PATH ?? defaultModel;
  if (!executableInput && !modelInput) return [];
  if (!executableInput || !modelInput) {
    throw new Error('Set both OPENCREATOR_WHISPERKIT_PATH and OPENCREATOR_WHISPERKIT_MODEL_PATH');
  }
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('The packaged WhisperKit fallback requires macOS Apple Silicon');
  }

  const executableSource = resolve(executableInput);
  const modelSource = resolve(modelInput);
  if (!existsSync(executableSource) || !statSync(executableSource).isFile()) {
    throw new Error(`WhisperKit executable is unavailable: ${executableSource}`);
  }
  if (!existsSync(modelSource) || !statSync(modelSource).isDirectory()) {
    throw new Error(`WhisperKit model directory is unavailable: ${modelSource}`);
  }

  const executable = join(binDir, 'whisperkit-cli');
  copyExecutable(executableSource, executable);
  verifyStandaloneWhisperKit(executable);
  const model = 'large-v2';
  const modelDir = join(outputRoot, 'models', 'whisperkit', 'openai_whisper-large-v2');
  cpSync(modelSource, modelDir, {
    recursive: true,
    force: true,
    mode: constants.COPYFILE_FICLONE
  });
  return [
    packagedResource(executable, 'executable', 'whisperkit', model),
    ...listFiles(modelDir).map(path => packagedResource(path, 'model', 'whisperkit', model))
  ];
}

function verifyStandaloneYtDlp(path) {
  let version;
  try {
    version = execFileSync(path, ['--version'], {
      cwd: outputRoot,
      env: minimalRuntimeEnvironment(process.env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
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
}

function verifyStandaloneWhisperKit(path) {
  let version;
  try {
    version = execFileSync(path, ['--version'], {
      cwd: outputRoot,
      env: minimalRuntimeEnvironment(process.env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      windowsHide: true
    }).trim();
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}\n${String(error.stderr ?? '')}`.trim().slice(-2_000)
      : String(error);
    throw new Error(`WhisperKit must run in the packaged minimal environment: ${detail}`);
  }
  if (!/^v1\.1\.0$/i.test(version)) {
    throw new Error(`WhisperKit emitted an unexpected version: ${version}`);
  }
}

function verifyStandaloneWhisperCpp(path) {
  let version;
  try {
    version = execFileSync(path, ['--version'], {
      cwd: outputRoot,
      env: minimalRuntimeEnvironment(process.env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      windowsHide: true
    }).trim();
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}\n${String(error.stderr ?? '')}`.trim().slice(-2_000)
      : String(error);
    throw new Error(`whisper.cpp must run in the packaged minimal environment: ${detail}`);
  }
  if (!/^whisper\.cpp version:\s*\S+/i.test(version)) {
    throw new Error(`whisper.cpp emitted an unexpected version: ${version}`);
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

function listFiles(root) {
  const result = [];
  visit(root);
  return result.sort();

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(path);
    }
  }
}

function commandOutput(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
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

function packagedResource(path, kind, provider, model) {
  return {
    path: relative(outputRoot, path).replaceAll('\\', '/'),
    sha256: hashFile(path),
    kind,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model })
  };
}
