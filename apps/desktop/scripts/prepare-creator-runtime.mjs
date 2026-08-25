import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
const sourceRoot = resolve(process.env.OPENCREATOR_KRILLINAI_SOURCE ?? join(rootDir, 'KrillinAI'));
const outputRoot = resolve(process.env.OPENCREATOR_CREATOR_RUNTIME_OUTPUT ?? join(desktopDir, '.pack', 'creator-runtime', 'krillinai'));
const binDir = join(outputRoot, 'bin');
const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const serviceVersion = '0.1.0';
const protocolVersion = 1;
const protocolSchemaSource = join(rootDir, 'packages', 'protocol', 'contracts', 'krillin-opencreator-v1.schema.json');

if (!existsSync(join(sourceRoot, 'go.mod'))) throw new Error(`KrillinAI source is unavailable: ${sourceRoot}`);
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });

const servicePath = join(binDir, `krillinai-opencreator-server${executableSuffix}`);
execFileSync('go', [
  'build',
  '-trimpath',
  '-ldflags', `-s -w -X main.serviceVersion=${serviceVersion}`,
  '-o', servicePath,
  './cmd/opencreator-server'
], {
  cwd: sourceRoot,
  env: { ...process.env, CGO_ENABLED: process.env.CGO_ENABLED ?? '0' },
  stdio: 'inherit'
});

const externalInputs = [
  ['ffmpeg', process.env.OPENCREATOR_FFMPEG_PATH],
  ['ffprobe', process.env.OPENCREATOR_FFPROBE_PATH],
  ['yt-dlp', process.env.OPENCREATOR_YT_DLP_PATH]
];
for (const [name, configured] of externalInputs) {
  const source = resolveExecutable(name, configured);
  const target = join(binDir, `${name}${executableSuffix}`);
  copyFileSync(source, target);
  if (process.platform !== 'win32') chmodSync(target, 0o755);
  if (name === 'yt-dlp') verifyStandaloneYtDlp(target);
}
if (process.platform !== 'win32') chmodSync(servicePath, 0o755);

const packagedLocalAsrResources = [
  ...prepareFasterWhisper(),
  ...prepareWhisperCpp()
];
if (packagedLocalAsrResources.length === 0) {
  throw new Error(
    'Package at least one local transcription runtime so cloud credentials remain optional'
  );
}

const subtitleStylePath = join(outputRoot, 'subtitle-style.json');
writeFileSync(subtitleStylePath, `${JSON.stringify({ version: 1 }, null, 2)}\n`);
const protocolSchemaPath = join(outputRoot, 'api', 'opencreator', 'v1', 'schema.json');
mkdirSync(dirname(protocolSchemaPath), { recursive: true });
copyFileSync(protocolSchemaSource, protocolSchemaPath);
const protocolSha256 = hashFile(protocolSchemaPath);
const buildRecord = {
  version: 1,
  serviceVersion,
  protocolVersion,
  protocolSha256,
  upstreamCommit: commandOutput('git', ['rev-parse', 'HEAD'], sourceRoot),
  integrationPatchSha256: hashIntegrationSources(sourceRoot),
  goVersion: commandOutput('go', ['version'], sourceRoot),
  platform: process.platform,
  arch: process.arch
};
const buildRecordPath = join(outputRoot, 'build-record.json');
writeFileSync(buildRecordPath, `${JSON.stringify(buildRecord, null, 2)}\n`);

const resourcePaths = [
  servicePath,
  ...externalInputs.map(([name]) => join(binDir, `${name}${executableSuffix}`)),
  subtitleStylePath,
  protocolSchemaPath,
  buildRecordPath
];
const manifest = {
  version: 1,
  serviceVersion,
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

function resolveExecutable(name, configured) {
  if (configured) {
    const value = resolve(configured);
    if (!existsSync(value)) throw new Error(`${name} input is missing: ${value}`);
    return value;
  }
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const located = commandOutput(locator, [name], rootDir).split(/\r?\n/).find(Boolean);
  if (!located || !existsSync(located)) {
    throw new Error(`Set OPENCREATOR_${name.replace('-', '_').toUpperCase()}_PATH to a pinned ${name} binary`);
  }
  return resolve(located);
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
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d{6}$/.test(version)) {
    throw new Error(
      `yt-dlp must be an official nightly build with version YYYY.MM.DD.HHMMSS: ${version}`
    );
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
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function hashIntegrationSources(root) {
  const digest = createHash('sha256');
  const trackedDiff = execFileSync('git', ['diff', '--binary', 'HEAD', '--'], {
    cwd: root,
    encoding: 'buffer'
  });
  updateDigestEntry(digest, 'tracked-diff', trackedDiff);

  const untrackedFiles = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }
  )
    .split('\0')
    .filter(Boolean)
    .map(path => path.replaceAll('\\', '/'))
    .sort();
  for (const path of untrackedFiles) {
    updateDigestEntry(digest, `untracked:${path}`, readFileSync(join(root, path)));
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
