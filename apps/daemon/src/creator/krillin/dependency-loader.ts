import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
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
import { pipeline } from 'node:stream/promises';
import type {
  CreatorJson,
  CreatorServicesCapabilitiesResponse,
  CreatorServicesConfig
} from '@opencreator/protocol';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { createKrillinCreatorServicesCapabilities } from './capabilities.js';
import { openPromise, type ZipFile } from 'yauzl';

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

const whisperCppRelease = {
  executable: {
    version: '1.9.2',
    archiveUrl: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip',
    archiveSha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
    archiveRoot: 'Release',
    binarySha256: '95e3c0b0e778ad9499eb0125f97c1dcf437dd9eb4ea77050b043574f93c2631d',
    files: [
      ['whisper-cli.exe', 479_232],
      ['whisper.dll', 1_368_064],
      ['ggml.dll', 67_584],
      ['ggml-base.dll', 666_624],
      ['ggml-cpu-alderlake.dll', 809_984],
      ['ggml-cpu-cannonlake.dll', 853_504],
      ['ggml-cpu-cascadelake.dll', 850_944],
      ['ggml-cpu-haswell.dll', 811_008],
      ['ggml-cpu-icelake.dll', 850_944],
      ['ggml-cpu-sandybridge.dll', 803_328],
      ['ggml-cpu-skylakex.dll', 852_992],
      ['ggml-cpu-sse42.dll', 790_016],
      ['ggml-cpu-x64.dll', 794_112]
    ] as ReadonlyArray<readonly [string, number]>
  },
  models: {
    tiny: {
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin',
      sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
      size: 77_691_713,
      environment: 'OPENCREATOR_WHISPERCPP_TINY_MODEL'
    },
    medium: {
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium.bin',
      sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',
      size: 1_533_763_059,
      environment: 'OPENCREATOR_WHISPERCPP_MEDIUM_MODEL'
    },
    'large-v2': {
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v2.bin',
      sha256: '9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487',
      size: 3_094_623_691,
      environment: 'OPENCREATOR_WHISPERCPP_LARGE_V2_MODEL'
    }
  }
} as const;

type WhisperCppModel = keyof typeof whisperCppRelease.models;

type WhisperKitInstaller = {
  isInstalled(root: string): Promise<boolean>;
  install(input: {
    root: string;
    proxy: string;
    signal: AbortSignal;
    onPhase(phase: 'cli' | 'model'): void;
  }): Promise<void>;
};

type WhisperCppInstaller = {
  isInstalled(root: string, model: WhisperCppModel): Promise<boolean>;
  install(input: {
    root: string;
    proxy: string;
    model: WhisperCppModel;
    signal: AbortSignal;
    onPhase(phase: 'cli' | 'model'): void;
  }): Promise<void>;
};

export type KrillinDependencyLoader = {
  root: string;
  capabilities(): CreatorServicesCapabilitiesResponse;
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
  whisperCppInstaller?: WhisperCppInstaller;
}): KrillinDependencyLoader {
  const root = resolve(input.root);
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const whisperKitInstaller = input.whisperKitInstaller ?? defaultWhisperKitInstaller;
  const whisperCppInstaller = input.whisperCppInstaller ?? defaultWhisperCppInstaller;
  let whisperKitReady = false;
  let whisperKitPending: Promise<void> | undefined;
  const whisperCppReady = new Set<WhisperCppModel>();
  const whisperCppPending = new Map<WhisperCppModel, Promise<void>>();

  return {
    root,
    capabilities() {
      return createKrillinCreatorServicesCapabilities(platform, arch);
    },
    async ensure({ config, signal, reportProgress }): Promise<void> {
      const provider = normalizedProvider(config);
      if (provider === 'whispercpp') {
        if (platform !== 'win32' || arch !== 'x64') {
          throw new CreatorExecutorError(
            'dependency_not_packaged',
            `Whisper.cpp is unavailable on ${platform}/${arch}`
          );
        }
        const model = config.transcription.whisperCpp.model;
        if (whisperCppReady.has(model) || await whisperCppInstaller.isInstalled(root, model)) {
          whisperCppReady.add(model);
          return;
        }
        if (signal.aborted) {
          throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
        }
        reportProgress({
          krillinMode: 'cli',
          providerStatus: 'preparing',
          dependency: 'whispercpp',
          dependencyPhase: 'download',
          percent: 2
        });
        let pending = whisperCppPending.get(model);
        if (pending === undefined) {
          pending = whisperCppInstaller.install({
            root,
            proxy: config.proxy.trim(),
            model,
            signal,
            onPhase(phase) {
              reportProgress({
                krillinMode: 'cli',
                providerStatus: 'preparing',
                dependency: 'whispercpp',
                dependencyPhase: phase,
                percent: phase === 'cli' ? 2 : 4
              });
            }
          }).then(async () => {
            if (!await whisperCppInstaller.isInstalled(root, model)) {
              throw new Error('Whisper.cpp dependency verification failed after installation');
            }
            whisperCppReady.add(model);
          }).finally(() => {
            whisperCppPending.delete(model);
          });
          whisperCppPending.set(model, pending);
        }
        try {
          await pending;
        } catch (cause) {
          if (signal.aborted) {
            throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
          }
          throw new CreatorExecutorError(
            'creator_dependency_prepare_failed',
            `Whisper.cpp 依赖加载失败：${errorMessage(cause)}`
          );
        }
        return;
      }
      if (provider !== 'whisperkit') return;
      if (platform !== 'darwin' || arch !== 'arm64') {
        throw new CreatorExecutorError(
          'dependency_not_packaged',
          `WhisperKit is unavailable on ${platform}/${arch}`
        );
      }
      if (whisperKitReady || await whisperKitInstaller.isInstalled(root)) {
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
      whisperKitPending ??= whisperKitInstaller.install({
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
        if (!await whisperKitInstaller.isInstalled(root)) {
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

const defaultWhisperCppInstaller: WhisperCppInstaller = {
  isInstalled: isWhisperCppInstalled,
  install: installWhisperCpp
};

async function installWhisperCpp(input: {
  root: string;
  proxy: string;
  model: WhisperCppModel;
  signal: AbortSignal;
  onPhase(phase: 'cli' | 'model'): void;
}): Promise<void> {
  await mkdir(input.root, { recursive: true, mode: 0o700 });
  const staging = join(input.root, `.whispercpp-${randomUUID()}`);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    input.onPhase('cli');
    await installWhisperCppExecutable(input, staging);
    input.onPhase('model');
    await installWhisperCppModel(input, staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function installWhisperCppExecutable(
  input: { root: string; proxy: string; signal: AbortSignal },
  staging: string
): Promise<void> {
  const executableRoot = join(input.root, 'bin', 'whispercpp');
  if (await isWhisperCppExecutableInstalled(executableRoot)) return;
  const archive = await configuredOrDownloadedFile({
    configured: process.env.OPENCREATOR_WHISPERCPP_CLI_ARCHIVE,
    name: 'Whisper.cpp CLI',
    url: whisperCppRelease.executable.archiveUrl,
    sha256: whisperCppRelease.executable.archiveSha256,
    path: join(staging, 'whisper-bin-x64.zip'),
    proxy: input.proxy,
    signal: input.signal
  });
  const extracted = join(staging, 'cli');
  await extractWhisperCppExecutableArchive(archive, extracted, input.signal);
  await verifyWhisperCppExecutableFiles(extracted);
  const version = await runCommand(join(extracted, 'whisper-cli.exe'), ['--version'], {
    cwd: extracted,
    signal: input.signal,
    captureStdout: true
  });
  if (!`${version.stdout}\n${version.stderr}`.includes(whisperCppRelease.executable.version)) {
    throw new Error(`Unexpected Whisper.cpp CLI version: ${version.stdout || version.stderr}`);
  }
  await writeFile(join(extracted, '.opencreator-runtime.json'), `${JSON.stringify({
    version: 1,
    cliVersion: whisperCppRelease.executable.version,
    archiveSha256: whisperCppRelease.executable.archiveSha256
  }, null, 2)}\n`, { mode: 0o600 });
  await mkdir(dirname(executableRoot), { recursive: true });
  await rm(executableRoot, { recursive: true, force: true });
  await rename(extracted, executableRoot);
}

async function installWhisperCppModel(
  input: {
    root: string;
    proxy: string;
    model: WhisperCppModel;
    signal: AbortSignal;
  },
  staging: string
): Promise<void> {
  const modelRoot = join(input.root, 'models', 'whispercpp');
  if (await isWhisperCppModelInstalled(modelRoot, input.model)) return;
  const release = whisperCppRelease.models[input.model];
  const stagedModel = join(staging, `ggml-${input.model}.bin`);
  const downloaded = await configuredOrDownloadedFile({
    configured: process.env[release.environment],
    name: `Whisper.cpp ${input.model} model`,
    url: release.url,
    sha256: release.sha256,
    path: stagedModel,
    proxy: input.proxy,
    signal: input.signal
  });
  const source = downloaded === stagedModel
    ? stagedModel
    : join(staging, `ggml-${input.model}.verified.bin`);
  if (source !== downloaded) {
    await pipeline(
      createReadStream(downloaded),
      createWriteStream(source, { flags: 'wx', mode: 0o600 }),
      { signal: input.signal }
    );
  }
  await verifyWhisperCppModelFile(source, input.model);
  await mkdir(modelRoot, { recursive: true });
  const model = join(modelRoot, `ggml-${input.model}.bin`);
  const marker = join(modelRoot, `.opencreator-${input.model}.json`);
  await rm(model, { force: true });
  await rename(source, model);
  await writeFile(marker, `${JSON.stringify({
    version: 1,
    model: input.model,
    sha256: release.sha256,
    size: release.size
  }, null, 2)}\n`, { mode: 0o600 });
}

async function isWhisperCppInstalled(root: string, model: WhisperCppModel): Promise<boolean> {
  return await isWhisperCppExecutableInstalled(join(root, 'bin', 'whispercpp'))
    && await isWhisperCppModelInstalled(join(root, 'models', 'whispercpp'), model);
}

async function isWhisperCppExecutableInstalled(root: string): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(join(root, '.opencreator-runtime.json'), 'utf8')) as {
      archiveSha256?: unknown;
      cliVersion?: unknown;
    };
    if (
      record.archiveSha256 !== whisperCppRelease.executable.archiveSha256
      || record.cliVersion !== whisperCppRelease.executable.version
    ) return false;
    await verifyWhisperCppExecutableFiles(root);
    return true;
  } catch {
    return false;
  }
}

async function verifyWhisperCppExecutableFiles(root: string): Promise<void> {
  for (const [name, expectedSize] of whisperCppRelease.executable.files) {
    const path = join(root, name);
    const info = await stat(path);
    if (!info.isFile() || info.size !== expectedSize) {
      throw new Error(`Whisper.cpp CLI file is invalid: ${name}`);
    }
  }
  if (await hashFile(join(root, 'whisper-cli.exe')) !== whisperCppRelease.executable.binarySha256) {
    throw new Error('Whisper.cpp CLI executable hash mismatch');
  }
}

async function isWhisperCppModelInstalled(
  root: string,
  model: WhisperCppModel
): Promise<boolean> {
  try {
    const release = whisperCppRelease.models[model];
    const record = JSON.parse(await readFile(join(root, `.opencreator-${model}.json`), 'utf8')) as {
      model?: unknown;
      sha256?: unknown;
      size?: unknown;
    };
    if (
      record.model !== model
      || record.sha256 !== release.sha256
      || record.size !== release.size
    ) return false;
    const info = await stat(join(root, `ggml-${model}.bin`));
    return info.isFile() && info.size === release.size;
  } catch {
    return false;
  }
}

async function verifyWhisperCppModelFile(path: string, model: WhisperCppModel): Promise<void> {
  const release = whisperCppRelease.models[model];
  const info = await stat(path);
  if (!info.isFile() || info.size !== release.size) {
    throw new Error(`Whisper.cpp ${model} model size mismatch`);
  }
}

async function extractWhisperCppExecutableArchive(
  archive: string,
  destination: string,
  signal: AbortSignal
): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const expected = new Map(whisperCppRelease.executable.files.map(([name, size]) => [
    `${whisperCppRelease.executable.archiveRoot}/${name}`,
    { name, size }
  ]));
  const extracted = new Set<string>();
  let zip: ZipFile | undefined;
  try {
    zip = await openPromise(archive, {
      autoClose: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true
    });
    for await (const entry of zip.eachEntry()) {
      if (signal.aborted) throw new Error('dependency_download_canceled');
      const descriptor = expected.get(entry.fileName);
      if (descriptor === undefined) continue;
      if (extracted.has(descriptor.name) || entry.uncompressedSize !== descriptor.size) {
        throw new Error(`Whisper.cpp archive entry is invalid: ${entry.fileName}`);
      }
      const stream = await zip.openReadStreamPromise(entry);
      await pipeline(
        stream,
        createWriteStream(join(destination, descriptor.name), { flags: 'wx', mode: 0o600 })
      );
      extracted.add(descriptor.name);
    }
  } finally {
    if (zip?.isOpen) zip.close();
  }
  const missing = whisperCppRelease.executable.files.find(([name]) => !extracted.has(name));
  if (missing !== undefined) {
    throw new Error(`Whisper.cpp archive file is missing: ${missing[0]}`);
  }
}

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
  const archive = await configuredOrDownloadedFile({
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
  const archive = await configuredOrDownloadedFile({
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

async function configuredOrDownloadedFile(input: {
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
    await verifyHash(input.name, configured, input.sha256, input.signal);
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
  await verifyHash(input.name, input.path, input.sha256, input.signal);
  return input.path;
}

async function verifyHash(
  name: string,
  path: string,
  expected: string,
  signal?: AbortSignal
): Promise<void> {
  const actual = await hashFile(path, signal);
  if (actual !== expected) {
    throw new Error(`${name} SHA-256 mismatch`);
  }
}

async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    if (signal?.aborted === true) throw new Error('dependency_download_canceled');
    digest.update(chunk as Buffer);
  }
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
): Promise<{ stdout: string; stderr: string }> {
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
        resolvePromise({ stdout, stderr });
      }
    });
  });
}

function dependencyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform === 'win32') {
    const names = [
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'LOCALAPPDATA'
    ];
    const executablePath = env.Path ?? env.PATH ?? (
      env.SystemRoot === undefined ? '' : join(env.SystemRoot, 'System32')
    );
    return {
      ...Object.fromEntries(names.flatMap(name => env[name] === undefined ? [] : [[name, env[name]]])),
      PATH: executablePath,
      Path: executablePath
    };
  }
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
