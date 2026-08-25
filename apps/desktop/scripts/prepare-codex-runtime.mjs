import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readCodexRuntimeManifest,
  verifyCodexRuntime
} from './codex-runtime-contract.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');

export function stageCodexRuntime(input = {}) {
  const manifestPath = resolve(input.manifestPath ?? process.env.OPENCREATOR_CODEX_MANIFEST ?? join(rootDir, 'resources', 'codex-runtime', 'manifest.json'));
  const protocolRoot = resolve(input.protocolRoot ?? join(rootDir, 'apps', 'daemon', 'src', 'codex', 'generated', 'v0_149_0'));
  const outputRoot = resolve(input.outputRoot ?? process.env.OPENCREATOR_CODEX_RUNTIME_OUTPUT ?? join(desktopDir, '.pack', 'codex-runtime'));
  const manifest = readCodexRuntimeManifest(manifestPath);
  const sourceRoot = resolve(input.sourceRoot ?? process.env.OPENCREATOR_CODEX_RUNTIME_ROOT ?? defaultSourceRoot(rootDir, manifest.platform, manifest.arch));
  const binaryOverride = input.binaryPath ?? process.env.OPENCREATOR_CODEX_BINARY;

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
    const source = resource.path === manifest.binary.relativePath && binaryOverride !== undefined
      ? resolve(binaryOverride)
      : resolve(sourceRoot, resource.path);
    if (!existsSync(source)) throw new Error(`Codex Runtime input is missing: ${source}`);
    const target = resolve(outputRoot, resource.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const protocolTarget = resolve(outputRoot, manifest.appServerProtocol.relativePath);
  cpSync(protocolRoot, protocolTarget, { recursive: true });
  copyFileSync(manifestPath, join(outputRoot, 'manifest.json'));
  verifyCodexRuntime(outputRoot, manifest.platform, manifest.arch);
  return { outputRoot, manifest };
}

function defaultSourceRoot(repositoryRoot, platform, arch) {
  const platformPackage = `${platform}-${arch}`;
  const triple = {
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-musl'
  }[platformPackage];
  if (triple === undefined) throw new Error(`Unsupported Codex Runtime platform: ${platformPackage}`);
  return join(
    repositoryRoot,
    '.tmp',
    'codex-runtime-npm',
    'node_modules',
    '@openai',
    `codex-${platformPackage}`,
    'vendor',
    triple
  );
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
      commit: result.manifest.commit
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
