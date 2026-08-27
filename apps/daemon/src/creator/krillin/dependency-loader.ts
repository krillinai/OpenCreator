import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CreatorJson, CreatorServicesConfig } from '@opencreator/protocol';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';

const whisperKitRelease = {
  executable: {
    version: '1.1.0',
    archiveUrl: 'https://ghcr.io/v2/homebrew/core/whisperkit-cli/blobs/sha256:54cf5a0ae768aafe4dcbe9dad276801b67cfd5549dcde6cdf2f9435106104168',
    archiveSha256: '54cf5a0ae768aafe4dcbe9dad276801b67cfd5549dcde6cdf2f9435106104168',
    binarySha256: 'c999d375a23d5c5c07f96a2fbee9627c60a0de77bc3ca6689ed88878c9743d58',
    archivePath: 'whisperkit-cli/1.1.0/bin/whisperkit-cli',
    ghcrScope: 'repository:homebrew/core/whisperkit-cli:pull'
  },
  model: {
    version: 'large-v2',
    archiveUrl: 'https://modelscope.cn/models/Maranello/KrillinAI_dependency_cn/resolve/master/whisperkit-large-v2.zip',
    archiveSha256: '033c24fc20a432886a26aa8bc90de42bd5948654f131cecb60d5668b20dbb1cb',
    archiveRoot: 'openai_whisper-large-v2'
  }
} as const;

type WhisperKitInstaller = {
  isInstalled(root: string): Promise<boolean>;
  install(input: {
    root: string;
    proxy: string;
    signal: AbortSignal;
    onPhase(phase: 'cli' | 'model'): void;
  }): Promise<void>;
};

export type KrillinDependencyLoader = {
  root: string;
  ensure(input: {
    config: CreatorServicesConfig;
    signal: AbortSignal;
    reportProgress(progress: Record<string, CreatorJson>): void;
  }): Promise<void>;
};

export function createKrillinDependencyLoader(input: {
  root: string;
  platform?: NodeJS.Platform;
  arch?: string;
  whisperKitInstaller?: WhisperKitInstaller;
}): KrillinDependencyLoader {
  const root = resolve(input.root);
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const installer = input.whisperKitInstaller ?? defaultWhisperKitInstaller;
  let whisperKitReady = false;
  let whisperKitPending: Promise<void> | undefined;

  return {
    root,
    async ensure({ config, signal, reportProgress }): Promise<void> {
      if (normalizedProvider(config) !== 'whisperkit') return;
      if (platform !== 'darwin' || arch !== 'arm64') {
        throw new CreatorExecutorError(
          'dependency_not_packaged',
          `WhisperKit is unavailable on ${platform}/${arch}`
        );
      }
      if (whisperKitReady || await installer.isInstalled(root)) {
        whisperKitReady = true;
        return;
      }
      if (signal.aborted) {
        throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
      }
      reportProgress({
        krillinMode: 'cli',
        providerStatus: 'preparing',
        dependency: 'whisperkit',
        dependencyPhase: 'download',
        percent: 2
      });
      whisperKitPending ??= installer.install({
        root,
        proxy: config.proxy.trim(),
        signal,
        onPhase(phase) {
          reportProgress({
            krillinMode: 'cli',
            providerStatus: 'preparing',
            dependency: 'whisperkit',
            dependencyPhase: phase,
            percent: phase === 'cli' ? 2 : 4
          });
        }
      }).then(async () => {
        if (!await installer.isInstalled(root)) {
          throw new Error('WhisperKit dependency verification failed after installation');
        }
        whisperKitReady = true;
      }).finally(() => {
        whisperKitPending = undefined;
      });
      try {
        await whisperKitPending;
      } catch (cause) {
        if (signal.aborted) {
          throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
        }
        throw new CreatorExecutorError(
          'creator_dependency_prepare_failed',
          `WhisperKit 依赖加载失败：${errorMessage(cause)}`
        );
      }
    }
  };
}

const defaultWhisperKitInstaller: WhisperKitInstaller = {
  isInstalled: isWhisperKitInstalled,
  install: installWhisperKit
};

async function installWhisperKit(input: {
  root: string;
  proxy: string;
  signal: AbortSignal;
  onPhase(phase: 'cli' | 'model'): void;
}): Promise<void> {
  await mkdir(input.root, { recursive: true, mode: 0o700 });
  await chmod(input.root, 0o700);
  const staging = join(input.root, `.whisperkit-${randomUUID()}`);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    input.onPhase('cli');
    await installWhisperKitExecutable(input, staging);
    input.onPhase('model');
    await installWhisperKitModel(input, staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function installWhisperKitExecutable(
  input: { root: string; proxy: string; signal: AbortSignal },
  staging: string
): Promise<void> {
  const executable = join(input.root, 'bin', 'whisperkit-cli');
  if (await isWhisperKitExecutableInstalled(executable)) return;
  await mkdir(join(input.root, 'bin'), { recursive: true });
  const archive = await configuredOrDownloadedArchive({
    configured: process.env.OPENCREATOR_WHISPERKIT_CLI_ARCHIVE,
    name: 'WhisperKit CLI',
    url: whisperKitRelease.executable.archiveUrl,
    sha256: whisperKitRelease.executable.archiveSha256,
    path: join(staging, 'whisperkit-cli.tar.gz'),
    proxy: input.proxy,
    ghcrScope: whisperKitRelease.executable.ghcrScope,
    signal: input.signal
  });
  const extracted = join(staging, 'cli');
  await mkdir(extracted, { recursive: true });
  await runCommand('tar', ['-xzf', archive, '-C', extracted], {
    cwd: staging,
    signal: input.signal
  });
  const source = join(extracted, whisperKitRelease.executable.archivePath);
  if (await hashFile(source) !== whisperKitRelease.executable.binarySha256) {
    throw new Error('WhisperKit CLI executable hash mismatch');
  }
  const temporary = `${executable}.${process.pid}.partial`;
  await rm(temporary, { force: true });
  try {
    await copyFile(source, temporary);
    await chmod(temporary, 0o755);
    const version = (await runCommand(temporary, ['--version'], {
      cwd: staging,
      signal: input.signal,
      captureStdout: true
    })).stdout.trim();
    if (version !== `v${whisperKitRelease.executable.version}`) {
      throw new Error(`Unexpected WhisperKit CLI version: ${version}`);
    }
    await rm(executable, { force: true });
    await rename(temporary, executable);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function installWhisperKitModel(
  input: { root: string; proxy: string; signal: AbortSignal },
  staging: string
): Promise<void> {
  const modelRoot = join(input.root, 'models', 'whisperkit');
  const model = join(modelRoot, 'openai_whisper-large-v2');
  const marker = join(modelRoot, '.opencreator-large-v2.json');
  if (await isWhisperKitModelInstalled(model, marker)) return;
  await mkdir(modelRoot, { recursive: true });
  const archive = await configuredOrDownloadedArchive({
    configured: process.env.OPENCREATOR_WHISPERKIT_MODEL_ARCHIVE,
    name: 'WhisperKit large-v2 model',
    url: whisperKitRelease.model.archiveUrl,
    sha256: whisperKitRelease.model.archiveSha256,
    path: join(staging, 'whisperkit-model.zip'),
    proxy: input.proxy,
    signal: input.signal
  });
  const extracted = join(staging, 'model');
  await mkdir(extracted, { recursive: true });
  await runCommand('ditto', ['-x', '-k', archive, extracted], {
    cwd: staging,
    signal: input.signal
  });
  const source = join(extracted, whisperKitRelease.model.archiveRoot);
  await verifyWhisperKitModel(source);
  await rm(join(source, '.DS_Store'), { force: true });
  await rm(join(source, 'AudioEncoder.mlmodelc', '.DS_Store'), { force: true });
  await rm(model, { recursive: true, force: true });
  await rename(source, model);
  await verifyWhisperKitModel(model);
  await writeFile(marker, `${JSON.stringify({
    version: 1,
    modelVersion: whisperKitRelease.model.version,
    archiveSha256: whisperKitRelease.model.archiveSha256
  }, null, 2)}\n`, { mode: 0o600 });
}

async function isWhisperKitInstalled(root: string): Promise<boolean> {
  const executable = join(root, 'bin', 'whisperkit-cli');
  const modelRoot = join(root, 'models', 'whisperkit');
  return await isWhisperKitExecutableInstalled(executable)
    && await isWhisperKitModelInstalled(
      join(modelRoot, 'openai_whisper-large-v2'),
      join(modelRoot, '.opencreator-large-v2.json')
    );
}

async function isWhisperKitExecutableInstalled(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
      && await hashFile(path) === whisperKitRelease.executable.binarySha256;
  } catch {
    return false;
  }
}

async function isWhisperKitModelInstalled(path: string, marker: string): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(marker, 'utf8')) as {
      archiveSha256?: unknown;
      modelVersion?: unknown;
    };
    if (
      record.archiveSha256 !== whisperKitRelease.model.archiveSha256
      || record.modelVersion !== whisperKitRelease.model.version
    ) return false;
    await verifyWhisperKitModel(path);
    return true;
  } catch {
    return false;
  }
}

async function verifyWhisperKitModel(root: string): Promise<void> {
  const required: Array<[string, number | undefined]> = [
    ['config.json', undefined],
    ['AudioEncoder.mlmodelc/weights/weight.bin', 1_273_605_760],
    ['MelSpectrogram.mlmodelc/weights/weight.bin', 354_080],
    ['TextDecoder.mlmodelc/weights/weight.bin', 1_813_199_154]
  ];
  for (const [relativePath, expectedSize] of required) {
    const info = await stat(join(root, relativePath));
    if (!info.isFile()) throw new Error(`WhisperKit model file is missing: ${relativePath}`);
    if (expectedSize !== undefined && info.size !== expectedSize) {
      throw new Error(`WhisperKit model file size is invalid: ${relativePath}`);
    }
  }
}

async function configuredOrDownloadedArchive(input: {
  configured: string | undefined;
  name: string;
  url: string;
  sha256: string;
  path: string;
  proxy: string;
  ghcrScope?: string;
  signal: AbortSignal;
}): Promise<string> {
  if (input.configured !== undefined && input.configured.trim() !== '') {
    const configured = resolve(input.configured);
    if (!(await stat(configured)).isFile()) {
      throw new Error(`${input.name} archive is unavailable`);
    }
    await verifyHash(input.name, configured, input.sha256);
    return configured;
  }
  const args = [
    '--fail',
    '--location',
    '--retry', '3',
    '--connect-timeout', '20',
    '--output', input.path
  ];
  if (input.proxy) args.push('--proxy', input.proxy);
  if (input.ghcrScope !== undefined) {
    const tokenArgs = ['--fail', '--silent', '--show-error'];
    if (input.proxy) tokenArgs.push('--proxy', input.proxy);
    tokenArgs.push(
      `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(input.ghcrScope)}`
    );
    const tokenResponse = await runCommand('curl', tokenArgs, {
      cwd: dirname(input.path),
      signal: input.signal,
      captureStdout: true
    });
    const token = (JSON.parse(tokenResponse.stdout) as { token?: unknown }).token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error(`Unable to obtain ${input.name} download token`);
    }
    args.push('--header', `Authorization: Bearer ${token}`);
  }
  args.push(input.url);
  await runCommand('curl', args, {
    cwd: dirname(input.path),
    signal: input.signal
  });
  await verifyHash(input.name, input.path, input.sha256);
  return input.path;
}

async function verifyHash(name: string, path: string, expected: string): Promise<void> {
  const actual = await hashFile(path);
  if (actual !== expected) {
    throw new Error(`${name} SHA-256 mismatch`);
  }
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => digest.update(chunk));
    stream.once('end', resolvePromise);
    stream.once('error', reject);
  });
  return digest.digest('hex');
}

function runCommand(
  command: string,
  args: string[],
  input: {
    cwd: string;
    signal: AbortSignal;
    captureStdout?: boolean;
  }
): Promise<{ stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCreatorProcess(command, args, {
      cwd: input.cwd,
      env: dependencyEnvironment(process.env),
      stdio: ['ignore', 'pipe', 'pipe']
    }, input.signal);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      if (input.captureStdout) stdout = boundedAppend(stdout, String(chunk));
    });
    child.stderr?.on('data', chunk => {
      stderr = boundedAppend(stderr, String(chunk));
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (input.signal.aborted) {
        reject(new Error('dependency_download_canceled'));
      } else if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`));
      } else {
        resolvePromise({ stdout });
      }
    });
  });
}

function dependencyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = ['HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];
  return {
    ...Object.fromEntries(names.flatMap(name => env[name] === undefined ? [] : [[name, env[name]]])),
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin'
  };
}

function normalizedProvider(config: CreatorServicesConfig): string {
  if (config.transcription.provider === 'faster-whisper') return 'fasterwhisper';
  if (config.transcription.provider === 'whisper.cpp') return 'whispercpp';
  return config.transcription.provider;
}

function boundedAppend(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length <= 8_000 ? combined : combined.slice(-8_000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
