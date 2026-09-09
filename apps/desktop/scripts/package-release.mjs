import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve
} from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  configureMacDirectorySigning,
  configureMacReleaseSigning
} from './mac-signing.mjs';
import { submitAndWaitForNotarization } from './apple-notarization.mjs';
import { prepareElectronBuilderCache } from './electron-builder-cache.mjs';
import { runStage } from './script-utils.mjs';
import { stageReleaseAssets } from './release-assets.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
const releaseDir = resolve(desktopDir, 'release');
const manifestPath = resolve(
  process.env.OPENCREATOR_DESKTOP_BUILD_MANIFEST
    ?? join(releaseDir, 'opencreator-desktop-build-manifest.json')
);
const packageArguments = process.argv.slice(2);
const mode = parseMode(packageArguments);
const signedDirectoryRequested = packageArguments.includes('--signed');
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
prepareElectronBuilderCache(env.ELECTRON_BUILDER_CACHE);
rmSync(manifestPath, { force: true });

await runStage('构建 KrillinAI CLI 与 Server', process.execPath, [
  resolve(rootDir, 'scripts', 'build-krillinai.mjs')
], {
  cwd: rootDir,
  env,
  timeoutMs: 10 * 60_000
});
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
await runStage('准备 Creator Runtime', process.execPath, [
  resolve(scriptDir, 'prepare-creator-runtime.mjs')
], {
  cwd: rootDir,
  env,
  timeoutMs: 25 * 60_000
});
await runStage('准备 Codex Runtime', process.execPath, [
  resolve(scriptDir, 'prepare-codex-runtime.mjs')
], {
  cwd: rootDir,
  env,
  timeoutMs: 10 * 60_000
});
const candidates = packageRootCandidates(platform, arch);
for (const path of candidates) rmSync(path, { recursive: true, force: true });

const {
  args,
  builderEnv,
  macSigning,
  notarizationArgs
} = electronBuilderArguments(mode, platform, arch, env, {
  signedDirectoryRequested,
  appleTeamId: process.env.OPENCREATOR_APPLE_TEAM_ID
    ?? process.env.APPLE_TEAM_ID
});
const packageStartedAt = Date.now();
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
const artifacts = findFreshArtifacts(packageStartedAt, mode, platform);
if (macSigning.mode === 'developer-id' && mode === 'release') {
  await finalizeMacReleaseArtifacts(
    artifacts.filter(path => path.endsWith('.dmg')),
    notarizationArgs
  );
}
const webBuild = hashDirectory(resolve(rootDir, 'apps/web/dist'));
const creatorAgentRuntime = hashDirectory(resolve(
  desktopDir,
  '.pack',
  'daemon',
  'runtime',
  'opencreator-runtime'
));
const codexRuntimeManifest = JSON.parse(readFileSync(
  resolve(desktopDir, '.pack', 'codex-runtime', 'manifest.json'),
  'utf8'
));
const creatorRuntimeManifest = JSON.parse(readFileSync(
  resolve(desktopDir, '.pack', 'creator-runtime', 'krillinai', 'manifest.json'),
  'utf8'
));
const creatorSubtitleFontSourceManifest = JSON.parse(readFileSync(
  resolve(rootDir, 'assets', 'creator-subtitle-fonts', 'manifest.json'),
  'utf8'
));
const creatorPresetManifest = JSON.parse(readFileSync(
  resolve(
    desktopDir,
    '.pack',
    'daemon',
    'runtime',
    'creator-presets',
    'manifest.json'
  ),
  'utf8'
));
const creatorSubtitleFontResources = creatorRuntimeManifest.resources
  .filter(resource => (
    resource.path.startsWith('fonts/')
    || resource.path.startsWith('licenses/fonts/')
  ));
const creatorSubtitleWebFontResources = creatorSubtitleFontSourceManifest.fonts
  .map(font => {
    if (
      typeof font?.webFile !== 'string'
      || typeof font?.webSha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(font.webSha256)
    ) {
      throw new Error('Creator subtitle Web font manifest is invalid');
    }
    const source = resolve(rootDir, 'assets', 'creator-subtitle-fonts', font.webFile);
    const built = resolve(rootDir, 'apps', 'web', 'dist', 'fonts', 'opencreator', basename(font.webFile));
    if (!existsSync(source) || hashFile(source) !== font.webSha256.toLowerCase()) {
      throw new Error(`Creator subtitle Web source font hash mismatch: ${font.webFile}`);
    }
    if (!existsSync(built) || hashFile(built) !== font.webSha256.toLowerCase()) {
      throw new Error(`Creator subtitle Web build font hash mismatch: ${built}`);
    }
    return {
      path: `fonts/opencreator/${basename(font.webFile)}`,
      sha256: font.webSha256.toLowerCase()
    };
  });
const manifest = {
  version: 1,
  commit: gitOutput(['rev-parse', 'HEAD']) || 'unknown',
  dirty: gitOutput(['status', '--porcelain', '--untracked-files=normal']).length > 0,
  generatedAt: new Date().toISOString(),
  platform,
  arch,
  mode,
  packageRoot,
  packageRootRelative: relative(rootDir, packageRoot),
  webBuildHash: webBuild.hash,
  webFileCount: webBuild.fileCount,
  creatorAgentRuntimeHash: creatorAgentRuntime.hash,
  creatorAgentRuntimeFileCount: creatorAgentRuntime.fileCount,
  creatorPresetCatalogHash: creatorPresetManifest.catalogHash,
  creatorPresetAssetSetHash: creatorPresetManifest.assetSetHash,
  creatorPresetResourceCount: creatorPresetManifest.files.length,
  creatorSubtitleFontSetHash: hashResourceDescriptors(
    creatorSubtitleFontResources
  ),
  creatorSubtitleFontResourceCount: creatorSubtitleFontResources.length,
  creatorSubtitleWebFontSetHash: hashResourceDescriptors(
    creatorSubtitleWebFontResources
  ),
  creatorSubtitleWebFontResourceCount: creatorSubtitleWebFontResources.length,
  codexRuntimeVersion: codexRuntimeManifest.version,
  codexRuntimeCommit: codexRuntimeManifest.commit,
  codexRuntimeBinarySha256: codexRuntimeManifest.binary.sha256,
  codexAppServerProtocolSha256: codexRuntimeManifest.appServerProtocol.schemaSha256,
  krillinCliVersion: creatorRuntimeManifest.cliVersion,
  krillinSourceCommit: creatorRuntimeManifest.sourceCommit,
  krillinSourceSha256: creatorRuntimeManifest.sourceSha256,
  krillinIntegrationPatchSha256: creatorRuntimeManifest.integrationPatchSha256,
  ytDlpRuntimeMode: creatorRuntimeManifest.ytDlp?.mode,
  ytDlpVersion: creatorRuntimeManifest.ytDlp?.version,
  ytDlpPythonVersion: creatorRuntimeManifest.ytDlp?.pythonVersion,
  macSigningMode: macSigning.mode,
  appleTeamId: macSigning.teamId ?? null,
  artifacts: artifacts.map(path => ({
    path,
    relativePath: relative(rootDir, path),
    bytes: statSync(path).size,
    sha256: hashFile(path)
  }))
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
    OPENCREATOR_DESKTOP_PACKAGE_ROOT: packageRoot,
    ...(macSigning.mode === 'developer-id'
      ? {
          OPENCREATOR_REQUIRE_DEVELOPER_ID: '1',
          OPENCREATOR_APPLE_TEAM_ID: macSigning.teamId,
          ...(mode === 'release'
            ? { OPENCREATOR_REQUIRE_NOTARIZED_MAC_APP: '1' }
            : {})
        }
      : {})
  },
  timeoutMs: 5 * 60_000
});

if (mode !== 'dir') {
  const packageJson = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'));
  const assetsDir = join(releaseDir, 'publish', `${platform}-${arch}`);
  const assets = stageReleaseAssets({ manifest, version: packageJson.version, assetsDir });
  console.log(`[desktop-package] 发布附件：${assetsDir} (${assets.length} files)`);
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `OPENCREATOR_DESKTOP_RELEASE_ASSETS=${assetsDir}\n`);
  }
}

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

function electronBuilderArguments(
  packageMode,
  targetPlatform,
  targetArch,
  baseEnv,
  options
) {
  const args = ['--publish', 'never'];
  let nextEnv = { ...baseEnv };
  let macSigning = {
    mode: targetPlatform === 'darwin' ? 'adhoc' : 'not-applicable',
    teamId: undefined,
    identity: undefined
  };
  let notarizationArgs = [];
  if (packageMode === 'dir') {
    args.push('--dir', platformFlag(targetPlatform), `--${targetArch}`);
    const configured = configureMacDirectorySigning({
      platform: targetPlatform,
      env: nextEnv,
      signed: options.signedDirectoryRequested,
      teamId: options.appleTeamId
    });
    args.push(...configured.args);
    nextEnv = configured.builderEnv;
    macSigning = {
      mode: configured.mode,
      teamId: configured.teamId,
      identity: configured.identity
    };
    if (configured.mode === 'developer-id') {
      nextEnv.OPENCREATOR_SIGN_CREATOR_RUNTIME = '1';
      nextEnv.OPENCREATOR_APPLE_TEAM_ID = configured.teamId;
    }
  } else if (targetPlatform === 'darwin') {
    args.push('--mac', 'dmg', 'zip', `--${targetArch}`);
    if (targetArch === 'x64') {
      args.push('--config.publish.channel=latest-x64');
    }
    if (packageMode === 'release') {
      const configured = configureMacReleaseSigning({
        platform: targetPlatform,
        env: nextEnv,
        teamId: options.appleTeamId
      });
      args.push(...configured.args);
      nextEnv = configured.builderEnv;
      nextEnv.OPENCREATOR_NOTARIZE_MAC_APP = '1';
      nextEnv.OPENCREATOR_SIGN_CREATOR_RUNTIME = '1';
      nextEnv.OPENCREATOR_APPLE_TEAM_ID = configured.teamId;
      macSigning = {
        mode: configured.mode,
        teamId: configured.teamId,
        identity: configured.identity
      };
      notarizationArgs = configured.notarizationArgs;
    } else {
      const signingConfigured = hasValue(nextEnv.CSC_LINK);
      const notarizationConfigured = [
        nextEnv.APPLE_ID,
        nextEnv.APPLE_APP_SPECIFIC_PASSWORD,
        nextEnv.APPLE_TEAM_ID
      ].every(hasValue);
      if (!signingConfigured) nextEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
      if (!notarizationConfigured) args.push('--config.mac.notarize=false');
    }
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
  return {
    args,
    builderEnv: nextEnv,
    macSigning,
    notarizationArgs
  };
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

function findFreshArtifacts(startedAt, packageMode, targetPlatform) {
  if (packageMode === 'dir') return [];
  const extensions = targetPlatform === 'darwin'
    ? ['.dmg', '.zip', '.blockmap']
    : ['.exe', '.blockmap'];
  const artifacts = readdirSync(releaseDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(releaseDir, entry.name))
    .filter(path => (
      extensions.some(extension => path.endsWith(extension))
      || (
        basename(path).startsWith('latest')
        && path.endsWith('.yml')
      )
    ))
    .filter(path => statSync(path).mtimeMs >= startedAt - 2_000)
    .sort();
  const installerExtension = targetPlatform === 'darwin' ? '.dmg' : '.exe';
  const installers = artifacts.filter(path => path.endsWith(installerExtension));
  if (installers.length !== 1) {
    throw new Error(
      `Expected exactly one fresh ${installerExtension} installer artifact, `
      + `found: ${JSON.stringify(installers)}`
    );
  }
  return artifacts;
}

async function finalizeMacReleaseArtifacts(artifacts, notarizationArgs) {
  if (artifacts.length !== 1 || notarizationArgs.length === 0) {
    throw new Error(
      'Formal macOS releases require one fresh DMG and notarization credentials'
    );
  }
  for (const artifact of artifacts) {
    await runStage(
      `验证 DMG 文件系统：${basename(artifact)}`,
      'hdiutil',
      ['verify', artifact],
      { cwd: releaseDir, timeoutMs: 5 * 60_000 }
    );
    await runStage(
      `验证 DMG 签名：${basename(artifact)}`,
      'codesign',
      ['--verify', '--verbose=4', artifact],
      { cwd: releaseDir, timeoutMs: 5 * 60_000 }
    );
    await submitAndWaitForNotarization(artifact, notarizationArgs);
    await runStage(
      `写入 DMG 公证票据：${basename(artifact)}`,
      'xcrun',
      ['stapler', 'staple', artifact],
      { cwd: releaseDir, timeoutMs: 5 * 60_000 }
    );
    await runStage(
      `验证 DMG 公证票据：${basename(artifact)}`,
      'xcrun',
      ['stapler', 'validate', artifact],
      { cwd: releaseDir, timeoutMs: 5 * 60_000 }
    );
    await runStage(
      `验证 DMG Gatekeeper：${basename(artifact)}`,
      'spctl',
      [
        '--assess',
        '--type',
        'open',
        '--context',
        'context:primary-signature',
        '--verbose=4',
        artifact
      ],
      { cwd: releaseDir, timeoutMs: 5 * 60_000 }
    );
  }
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

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function hashResourceDescriptors(resources) {
  const aggregate = createHash('sha256');
  for (const resource of [...resources].sort((left, right) => (
    left.path.localeCompare(right.path)
  ))) {
    aggregate
      .update(resource.path)
      .update('\0')
      .update(resource.sha256)
      .update('\0');
  }
  return aggregate.digest('hex');
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
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Git command failed (${args.join(' ')}): ${result.stderr.trim()}`
    );
  }
  return result.stdout.trim();
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
