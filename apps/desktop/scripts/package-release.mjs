import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readEnterpriseGatewayPackageConfig,
  serializeEnterpriseGatewayPackageConfig
} from './enterprise-package-contract-2026-07-30.mjs';
import { runStage } from './script-utils.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
const releaseDir = resolve(desktopDir, 'release');
const enterpriseGatewayConfigFilename = 'config.toml';
const enterpriseGatewayConfigSource = resolve(
  rootDir,
  'config',
  enterpriseGatewayConfigFilename
);
const enterpriseGatewayConfigStage = resolve(
  desktopDir,
  '.pack',
  'deployment',
  enterpriseGatewayConfigFilename
);
const manifestPath = resolve(
  process.env.OPENCREATOR_DESKTOP_BUILD_MANIFEST
    ?? join(releaseDir, 'opencreator-desktop-build-manifest.json')
);
const mode = parseMode(process.argv.slice(2));
const platform = normalizePlatform(
  process.env.OPENCREATOR_DESKTOP_TARGET_PLATFORM ?? process.platform
);
const arch = process.env.OPENCREATOR_DESKTOP_TARGET_ARCH ?? process.arch;
const hasConfiguredCacheDir = hasValue(process.env.OPENCREATOR_DESKTOP_CACHE_DIR);
const cacheDir = resolve(
  process.env.OPENCREATOR_DESKTOP_CACHE_DIR
    ?? resolve(desktopDir, '.cache')
);
const env = {
  ...process.env,
  OPENCREATOR_DESKTOP_TARGET_PLATFORM: platform,
  OPENCREATOR_DESKTOP_TARGET_ARCH: arch,
  OPENCREATOR_DESKTOP_CACHE_DIR: cacheDir,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE
    ?? (hasConfiguredCacheDir
      ? resolve(cacheDir, 'electron')
      : defaultElectronCache()),
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE
    ?? (hasConfiguredCacheDir
      ? resolve(cacheDir, 'electron-builder')
      : defaultElectronBuilderCache())
};

mkdirSync(releaseDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });
rmSync(manifestPath, { force: true });
const enterpriseRelease = readEnterpriseGatewayPackageConfig(
  enterpriseGatewayConfigSource,
  mode
);
rmSync(dirname(enterpriseGatewayConfigStage), {
  force: true,
  recursive: true
});
mkdirSync(dirname(enterpriseGatewayConfigStage), { recursive: true });
writeFileSync(
  enterpriseGatewayConfigStage,
  serializeEnterpriseGatewayPackageConfig(enterpriseRelease.gateway)
);
console.log(
  `[desktop-package] 企业网关：`
  + `${enterpriseRelease.transportSecurity} ${enterpriseRelease.gateway}`
);

await runStage('构建 Desktop', 'pnpm', ['--filter', '@opencreator/desktop', 'build'], {
  cwd: rootDir,
  env,
  timeoutMs: 5 * 60_000
});
await runStage('准备打包 Daemon 与 Web', process.execPath, [
  resolve(scriptDir, 'prepare-daemon.mjs')
], {
  cwd: rootDir,
  env,
  timeoutMs: 25 * 60_000
});
const candidates = packageRootCandidates(platform, arch);
for (const path of candidates) rmSync(path, { recursive: true, force: true });

const { args, builderEnv } = electronBuilderArguments(mode, platform, arch, env);
await runStage(
  mode === 'dir' ? '生成可运行目录' : '生成桌面安装包',
  'electron-builder',
  args,
  {
    cwd: desktopDir,
    env: builderEnv,
    timeoutMs: mode === 'dir' ? 20 * 60_000 : 50 * 60_000
  }
);

const packageRoot = findFreshPackageRoot(candidates);
const webBuild = hashDirectory(resolve(rootDir, 'apps/web/dist'));
const manifest = {
  version: 1,
  commit: gitOutput(['rev-parse', 'HEAD']) || 'unknown',
  dirty: gitOutput(['status', '--porcelain', '--untracked-files=all']).length > 0,
  generatedAt: new Date().toISOString(),
  platform,
  arch,
  mode,
  enterpriseOrigin: enterpriseRelease.gateway,
  enterpriseTransportSecurity: enterpriseRelease.transportSecurity,
  enterpriseGatewayConfigHash: createHash('sha256')
    .update(readFileSync(enterpriseGatewayConfigStage))
    .digest('hex'),
  packageRoot,
  packageRootRelative: relative(rootDir, packageRoot),
  webBuildHash: webBuild.hash,
  webFileCount: webBuild.fileCount
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[desktop-package] 构建清单：${manifestPath}`);
console.log(`[desktop-package] 包根目录：${packageRoot}`);
if (process.env.GITHUB_ENV) {
  appendFileSync(
    process.env.GITHUB_ENV,
    `OPENCREATOR_DESKTOP_BUILD_MANIFEST=${manifestPath}\n`
    + `OPENCREATOR_DESKTOP_PACKAGE_ROOT=${packageRoot}\n`
  );
}

await runStage('验证桌面包', process.execPath, [
  resolve(scriptDir, 'verify-package.mjs')
], {
  cwd: rootDir,
  env: {
    ...builderEnv,
    OPENCREATOR_DESKTOP_BUILD_MANIFEST: manifestPath,
    OPENCREATOR_DESKTOP_PACKAGE_ROOT: packageRoot
  },
  timeoutMs: 5 * 60_000
});

function parseMode(args) {
  if (args.includes('--dir')) return 'dir';
  if (args.includes('--dist')) return 'dist';
  if (args.includes('--release') || args.length === 0) return 'release';
  throw new Error(`Unsupported Desktop package mode: ${args.join(' ')}`);
}

function normalizePlatform(value) {
  if (value === 'mac') return 'darwin';
  if (value === 'win') return 'win32';
  if (value === 'linux') return 'linux';
  if (['darwin', 'win32', 'linux'].includes(value)) return value;
  throw new Error(`Unsupported OpenCreator Desktop platform: ${value}`);
}

function electronBuilderArguments(packageMode, targetPlatform, targetArch, baseEnv) {
  const args = ['--publish', 'never'];
  const nextEnv = { ...baseEnv };
  if (packageMode === 'dir') {
    args.push('--dir', platformFlag(targetPlatform), `--${targetArch}`);
  } else if (targetPlatform === 'darwin') {
    args.push('--mac', 'dmg', 'zip', `--${targetArch}`);
    const signingConfigured = hasValue(nextEnv.CSC_LINK);
    const notarizationConfigured = [
      nextEnv.APPLE_ID,
      nextEnv.APPLE_APP_SPECIFIC_PASSWORD,
      nextEnv.APPLE_TEAM_ID
    ].every(hasValue);
    if (!signingConfigured) nextEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    if (!notarizationConfigured) args.push('--config.mac.notarize=false');
  } else if (targetPlatform === 'win32') {
    args.push('--win', 'nsis', `--${targetArch}`);
    if (hasValue(nextEnv.WIN_CSC_LINK)) {
      nextEnv.CSC_LINK = nextEnv.WIN_CSC_LINK;
      nextEnv.CSC_KEY_PASSWORD = nextEnv.WIN_CSC_KEY_PASSWORD;
    }
    if (!hasValue(nextEnv.CSC_LINK)) {
      nextEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    }
  } else if (packageMode === 'dist') {
    args.push('--linux', `--${targetArch}`);
  } else {
    throw new Error(`Release artifacts are unsupported on ${targetPlatform}`);
  }
  const installedElectronDist = resolve(
    desktopDir,
    'node_modules',
    'electron',
    'dist'
  );
  if (
    targetPlatform === process.platform
    && targetArch === process.arch
    && existsSync(installedElectronDist)
  ) {
    args.push(`--config.electronDist=${installedElectronDist}`);
  }
  return { args, builderEnv: nextEnv };
}

function platformFlag(targetPlatform) {
  if (targetPlatform === 'darwin') return '--mac';
  if (targetPlatform === 'win32') return '--win';
  return '--linux';
}

function packageRootCandidates(targetPlatform, targetArch) {
  if (targetPlatform === 'darwin') {
    return [
      join(releaseDir, `mac-${targetArch}`, 'OpenCreator.app'),
      join(releaseDir, 'mac', 'OpenCreator.app')
    ];
  }
  if (targetPlatform === 'win32') {
    return [join(releaseDir, 'win-unpacked')];
  }
  return [join(releaseDir, 'linux-unpacked')];
}

function findFreshPackageRoot(candidates) {
  const matches = candidates.filter(existsSync);
  if (matches.length !== 1) {
    throw new Error(
      `Desktop package root is ambiguous or missing: ${JSON.stringify(matches)}`
    );
  }
  return resolve(matches[0]);
}

function hashDirectory(root) {
  const files = listRelativeFiles(root).sort();
  const aggregate = createHash('sha256');
  for (const relativePath of files) {
    const contents = readFileSync(join(root, relativePath));
    const contentHash = createHash('sha256').update(contents).digest('hex');
    aggregate.update(relativePath).update('\0').update(contentHash).update('\0');
  }
  return {
    hash: aggregate.digest('hex'),
    fileCount: files.length
  };
}

function listRelativeFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(root, path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Web build contains unsupported entry: ${path}`);
    }
    files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files;
}

function gitOutput(args) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 10_000
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultElectronCache() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'electron');
  }
  if (process.platform === 'win32') {
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'electron',
      'Cache'
    );
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'electron');
}

function defaultElectronBuilderCache() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'electron-builder');
  }
  if (process.platform === 'win32') {
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'electron-builder',
      'Cache'
    );
  }
  return join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
    'electron-builder'
  );
}

if (!isAbsolute(manifestPath)) {
  throw new Error('Desktop build manifest path must be absolute');
}
