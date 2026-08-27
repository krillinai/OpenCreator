import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readCodexRuntimeManifest,
  verifyCodexRuntime
} from './codex-runtime-contract.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');

export function stageCodexRuntime(input = {}) {
  const platform = normalizePlatform(
    input.platform
      ?? process.env.OPENCREATOR_DESKTOP_TARGET_PLATFORM
      ?? process.platform
  );
  const arch = input.arch
    ?? process.env.OPENCREATOR_DESKTOP_TARGET_ARCH
    ?? process.arch;
  const manifestPath = resolve(
    input.manifestPath
      ?? process.env.OPENCREATOR_CODEX_MANIFEST
      ?? join(rootDir, 'resources', 'codex-runtime', `${platform}-${arch}`, 'manifest.json')
  );
  const protocolRoot = resolve(
    input.protocolRoot
      ?? join(rootDir, 'apps', 'daemon', 'src', 'codex', 'generated', 'v0_149_0')
  );
  const outputRoot = resolve(
    input.outputRoot
      ?? process.env.OPENCREATOR_CODEX_RUNTIME_OUTPUT
      ?? join(desktopDir, '.pack', 'codex-runtime')
  );
  const manifest = readCodexRuntimeManifest(manifestPath);
  if (manifest.platform !== platform || manifest.arch !== arch) {
    throw new Error(
      `Codex Runtime manifest targets ${manifest.platform}/${manifest.arch}, `
      + `not ${platform}/${arch}`
    );
  }

  const configuredSourceRoot = input.sourceRoot
    ?? process.env.OPENCREATOR_CODEX_RUNTIME_ROOT;
  const preparedSource = configuredSourceRoot === undefined
    ? prepareSourceArchive(manifest, input)
    : { sourceRoot: resolve(configuredSourceRoot), cleanupRoot: undefined };
  const sourceRoot = preparedSource.sourceRoot;
  const binaryOverride = input.binaryPath ?? process.env.OPENCREATOR_CODEX_BINARY;

  try {
    if (!existsSync(sourceRoot) && binaryOverride === undefined) {
      throw new Error(
        `Codex ${manifest.version} source is unavailable: ${sourceRoot}. `
        + 'Set OPENCREATOR_CODEX_RUNTIME_ROOT or OPENCREATOR_CODEX_BINARY.'
      );
    }
    if (!existsSync(protocolRoot)) {
      throw new Error(`Generated Codex app-server protocol is unavailable: ${protocolRoot}`);
    }

    rmSync(outputRoot, { recursive: true, force: true });
    mkdirSync(outputRoot, { recursive: true });
    for (const resource of manifest.resources) {
      const source = resource.path === manifest.binary.relativePath
        && binaryOverride !== undefined
        ? resolve(binaryOverride)
        : resolveRuntimePath(sourceRoot, resource.path);
      if (!existsSync(source)) throw new Error(`Codex Runtime input is missing: ${source}`);
      const target = resolveRuntimePath(outputRoot, resource.path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      if (resource.kind === 'executable' && manifest.platform !== 'win32') {
        chmodSync(target, 0o755);
      }
    }
    const protocolTarget = resolveRuntimePath(
      outputRoot,
      manifest.appServerProtocol.relativePath
    );
    cpSync(protocolRoot, protocolTarget, { recursive: true });
    copyFileSync(manifestPath, join(outputRoot, 'manifest.json'));
    verifyCodexRuntime(outputRoot, manifest.platform, manifest.arch);
    return { outputRoot, manifest };
  } finally {
    if (preparedSource.cleanupRoot !== undefined) {
      rmSync(preparedSource.cleanupRoot, { recursive: true, force: true });
    }
  }
}

function prepareSourceArchive(manifest, input) {
  const cacheRoot = resolve(
    input.cacheRoot
      ?? process.env.OPENCREATOR_CODEX_RUNTIME_CACHE
      ?? join(
        process.env.OPENCREATOR_DESKTOP_CACHE_DIR ?? join(desktopDir, '.cache'),
        'codex-runtime'
      )
  );
  mkdirSync(cacheRoot, { recursive: true });
  const archivePath = resolve(
    input.archivePath
      ?? process.env.OPENCREATOR_CODEX_ARCHIVE
      ?? join(
        cacheRoot,
        `codex-${manifest.version}-${manifest.platform}-${manifest.arch}.tgz`
      )
  );
  if (input.archivePath !== undefined || process.env.OPENCREATOR_CODEX_ARCHIVE) {
    assertArchiveIntegrity(archivePath, manifest.sourceArchive.integrity);
  } else {
    installArchive(
      manifest,
      archivePath,
      input.offline ?? process.env.OPENCREATOR_DESKTOP_OFFLINE === '1'
    );
  }

  const extractionRoot = mkdtempSync(join(tmpdir(), 'opencreator-codex-runtime-'));
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', extractionRoot], {
      cwd: rootDir,
      stdio: 'inherit',
      timeout: 5 * 60_000,
      windowsHide: true
    });
    const sourceRoot = resolveRuntimePath(
      extractionRoot,
      manifest.sourceArchive.vendorPath
    );
    if (!existsSync(sourceRoot)) {
      throw new Error(
        `Codex Runtime archive is missing ${manifest.sourceArchive.vendorPath}`
      );
    }
    return { sourceRoot, cleanupRoot: extractionRoot };
  } catch (error) {
    rmSync(extractionRoot, { recursive: true, force: true });
    throw error;
  }
}

function installArchive(manifest, archivePath, offline) {
  if (existsSync(archivePath)) {
    try {
      assertArchiveIntegrity(archivePath, manifest.sourceArchive.integrity);
      return;
    } catch (error) {
      if (offline) {
        throw new Error(
          `Codex Runtime cache is invalid in offline mode: ${archivePath}. `
          + `${error instanceof Error ? error.message : String(error)}`
        );
      }
      rmSync(archivePath, { force: true });
    }
  }
  if (offline) {
    throw new Error(
      `Codex Runtime cache is missing in offline mode: ${archivePath}`
    );
  }

  mkdirSync(dirname(archivePath), { recursive: true });
  const temporary = `${archivePath}.${process.pid}.partial`;
  rmSync(temporary, { force: true });
  const args = [
    '--fail',
    '--location',
    '--retry', '3',
    '--connect-timeout', '20',
    '--output', temporary
  ];
  const proxy = process.env.OPENCREATOR_DOWNLOAD_PROXY?.trim();
  if (proxy) args.push('--proxy', proxy);
  args.push(manifest.sourceArchive.url);
  try {
    console.log(
      `[codex-runtime] Downloading Codex ${manifest.version} `
      + `${manifest.platform}/${manifest.arch}`
    );
    execFileSync('curl', args, {
      cwd: rootDir,
      stdio: 'inherit',
      timeout: 10 * 60_000,
      windowsHide: true
    });
    assertArchiveIntegrity(temporary, manifest.sourceArchive.integrity);
    rmSync(archivePath, { force: true });
    renameSync(temporary, archivePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function assertArchiveIntegrity(path, integrity) {
  if (!existsSync(path)) throw new Error(`Codex Runtime archive is missing: ${path}`);
  const actual = `sha512-${hashFile(path, 'sha512', 'base64')}`;
  if (actual !== integrity) {
    throw new Error(
      `Codex Runtime archive integrity mismatch: expected ${integrity}, received ${actual}`
    );
  }
}

function resolveRuntimePath(root, candidate) {
  const path = resolve(root, candidate);
  const relativePath = relative(resolve(root), path);
  if (
    relativePath.startsWith('..')
    || relativePath === ''
    || resolve(root, relativePath) !== path
  ) {
    throw new Error(`Codex Runtime path escapes its root: ${candidate}`);
  }
  return path;
}

function normalizePlatform(value) {
  if (value === 'mac') return 'darwin';
  if (value === 'win') return 'win32';
  if (['darwin', 'win32', 'linux'].includes(value)) return value;
  throw new Error(`Unsupported Codex Runtime platform: ${value}`);
}

function hashFile(path, algorithm, encoding) {
  const digest = createHash(algorithm);
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
  return digest.digest(encoding);
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const result = stageCodexRuntime();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      outputRoot: result.outputRoot,
      version: result.manifest.version,
      commit: result.manifest.commit,
      platform: result.manifest.platform,
      arch: result.manifest.arch
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
