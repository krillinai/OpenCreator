import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runStage } from './script-utils.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
const targetDir = resolve(desktopDir, '.pack/daemon');
const creatorPresetBuildRoot = resolve(
  rootDir,
  '.runtime/generated/creator-presets'
);
const targetCreatorPresetRoot = resolve(
  targetDir,
  'runtime',
  'creator-presets'
);
const runtimeDependencyDir = resolve(
  desktopDir,
  'packaging',
  'daemon-runtime'
);
const runtimeDependencyManifest = resolve(runtimeDependencyDir, 'package.json');
const runtimeDependencyLockfile = resolve(runtimeDependencyDir, 'pnpm-lock.yaml');
const targetArch = process.env.OPENCREATOR_DESKTOP_TARGET_ARCH ?? process.arch;
const require = createRequire(import.meta.url);
const nodeGypRoot = dirname(require.resolve('node-gyp/package.json'));
const cacheDir = resolve(
  process.env.OPENCREATOR_DESKTOP_CACHE_DIR
    ?? resolve(desktopDir, '.cache')
);
const offline = process.env.OPENCREATOR_DESKTOP_OFFLINE === '1';
const nativeBuildEnv = { ...process.env };
delete nativeBuildEnv.npm_config_recursive;
mkdirSync(cacheDir, { recursive: true });
cleanBuildOutputs();

await runStage('校验冻结锁文件', 'pnpm', [
  'install',
  '--frozen-lockfile',
  '--offline',
  '--lockfile-only',
  '--ignore-scripts'
], {
  cwd: rootDir,
  timeoutMs: 60_000
});
await runStage('编译 Creator Preset', 'pnpm', ['templates:compile'], {
  cwd: rootDir,
  timeoutMs: 5 * 60_000
});
await runStage('构建 Protocol', 'pnpm', ['--filter', '@opencreator/protocol', 'build'], {
  cwd: rootDir,
  timeoutMs: 5 * 60_000
});
await runStage('构建 Config', 'pnpm', ['--filter', '@opencreator/config', 'build'], {
  cwd: rootDir,
  timeoutMs: 5 * 60_000
});
await runStage('构建 Daemon', 'pnpm', ['--filter', '@opencreator/daemon', 'build'], {
  cwd: rootDir,
  timeoutMs: 5 * 60_000
});
await runStage('构建 Web', 'pnpm', ['--filter', '@opencreator/web', 'build'], {
  cwd: rootDir,
  timeoutMs: 5 * 60_000
});
prepareRuntimeDependencyInstall();
await runStage('安装扁平化 Daemon 生产依赖', 'pnpm', [
  '--dir',
  targetDir,
  'install',
  '--ignore-workspace',
  '--frozen-lockfile',
  offline ? '--offline' : '--prefer-offline',
  '--prod',
  '--ignore-scripts',
  '--config.node-linker=hoisted'
], {
  cwd: rootDir,
  timeoutMs: 10 * 60_000
});
prepareDaemonRuntimeFiles();
prepareWorkspaceRuntimePackages();
const betterSqlite3Root = dirname(realpathSync(
  resolve(targetDir, 'node_modules/better-sqlite3/package.json')
));
await runStage('重建 Electron 原生 SQLite', process.execPath, [
  resolve(nodeGypRoot, 'bin/node-gyp.js'),
  'rebuild',
  '--release',
  `--target=${desktopPackageVersion('electron')}`,
  `--arch=${targetArch}`,
  '--dist-url=https://electronjs.org/headers',
  `--devdir=${resolve(cacheDir, 'node-gyp')}`
], {
  cwd: betterSqlite3Root,
  timeoutMs: 10 * 60_000,
  env: {
    ...nativeBuildEnv,
    npm_config_runtime: 'electron',
    npm_config_target: desktopPackageVersion('electron'),
    npm_config_arch: targetArch,
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_devdir: resolve(cacheDir, 'node-gyp'),
    npm_config_build_from_source: 'true',
    npm_config_offline: offline ? 'true' : 'false',
    npm_config_update_notifier: 'false'
  }
});
pruneBetterSqliteBuildArtifacts(betterSqlite3Root);
cpSync(
  resolve(rootDir, 'apps', 'daemon', 'runtime'),
  resolve(targetDir, 'runtime'),
  { recursive: true }
);
rmSync(targetCreatorPresetRoot, { recursive: true, force: true });
cpSync(creatorPresetBuildRoot, targetCreatorPresetRoot, { recursive: true });
pruneDependencyInstallMetadata();
pruneDevelopmentArtifacts(targetDir);

assertExists(resolve(targetDir, 'dist/main.js'));
assertExists(resolve(targetDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'));
assertExists(resolve(targetDir, 'runtime/opencreator-runtime/SKILL.md'));
assertExists(resolve(targetDir, 'runtime/opencreator-runtime/manifest.json'));
assertExists(resolve(targetDir, 'runtime/creator-presets/catalog.json'));
assertExists(resolve(targetDir, 'runtime/creator-presets/manifest.json'));
assertWorkspaceRuntimePackage('protocol', 'Protocol');
assertWorkspaceRuntimePackage('config', 'Config');
assertWorkspaceRuntimePackage('skill-market', 'Skill Market');
assertMissing(
  resolve(targetDir, 'node_modules/@opencreator/protocol/dist/krillin-opencreator.js'),
  'Desktop Protocol runtime package still contains the removed Krillin sidecar contract'
);
assertPortableDependencyTree();
assertCleanDeployment();

function assertExists(path) {
  if (!existsSync(path)) {
    throw new Error(`Desktop Daemon deployment is missing required artifact: ${path}`);
  }
}

function assertMissing(path, message) {
  if (existsSync(path)) throw new Error(`${message}: ${path}`);
}

function cleanBuildOutputs() {
  for (const path of [
    resolve(rootDir, 'packages/protocol/dist'),
    resolve(rootDir, 'packages/config/dist'),
    resolve(rootDir, 'packages/skill-market/dist'),
    resolve(rootDir, 'apps/daemon/dist'),
    resolve(rootDir, 'apps/web/dist'),
    resolve(rootDir, '.runtime/generated/creator-presets')
  ]) {
    rmSync(path, { recursive: true, force: true });
  }
}

function prepareRuntimeDependencyInstall() {
  assertRuntimeDependencyManifest();
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(runtimeDependencyManifest, resolve(targetDir, 'package.json'));
  copyFileSync(runtimeDependencyLockfile, resolve(targetDir, 'pnpm-lock.yaml'));
}

function assertRuntimeDependencyManifest() {
  const runtimePackage = JSON.parse(readFileSync(runtimeDependencyManifest, 'utf8'));
  const daemonPackage = JSON.parse(readFileSync(
    resolve(rootDir, 'apps', 'daemon', 'package.json'),
    'utf8'
  ));
  const workspacePackages = new Set([
    '@opencreator/config',
    '@opencreator/protocol',
    '@opencreator/skill-market'
  ]);
  const expectedNames = Object.keys(daemonPackage.dependencies)
    .filter(name => !workspacePackages.has(name))
    .sort();
  const actualNames = Object.keys(runtimePackage.dependencies ?? {}).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      'Desktop Daemon runtime dependency manifest is out of sync with apps/daemon/package.json'
    );
  }
  for (const name of expectedNames) {
    const pinnedVersion = runtimePackage.dependencies[name];
    if (typeof pinnedVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(pinnedVersion)) {
      throw new Error(`Desktop Daemon runtime dependency is not pinned: ${name}`);
    }
    const installedVersion = JSON.parse(readFileSync(
      resolve(rootDir, 'apps', 'daemon', 'node_modules', name, 'package.json'),
      'utf8'
    )).version;
    if (installedVersion !== pinnedVersion) {
      throw new Error(
        `Desktop Daemon runtime dependency ${name} is pinned to ${pinnedVersion}, `
        + `but the workspace resolves ${installedVersion}`
      );
    }
  }
}

function prepareDaemonRuntimeFiles() {
  const daemonDir = resolve(rootDir, 'apps', 'daemon');
  cpSync(resolve(daemonDir, 'dist'), resolve(targetDir, 'dist'), {
    recursive: true
  });
  const daemonPackage = JSON.parse(readFileSync(
    resolve(daemonDir, 'package.json'),
    'utf8'
  ));
  writeFileSync(resolve(targetDir, 'package.json'), `${JSON.stringify({
    name: daemonPackage.name,
    version: daemonPackage.version,
    private: true,
    type: 'module',
    main: 'dist/main.js'
  }, null, 2)}\n`);
}

function prepareWorkspaceRuntimePackages() {
  for (const name of ['protocol', 'config', 'skill-market']) {
    copyWorkspaceRuntimePackage(name);
  }
}

function copyWorkspaceRuntimePackage(name) {
  const sourceDir = resolve(rootDir, 'packages', name);
  const packageDir = resolve(targetDir, `node_modules/@opencreator/${name}`);
  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(packageDir, { recursive: true });
  cpSync(resolve(sourceDir, 'dist'), resolve(packageDir, 'dist'), {
    recursive: true
  });
  const packageJson = JSON.parse(readFileSync(
    resolve(sourceDir, 'package.json'),
    'utf8'
  ));
  delete packageJson.scripts;
  delete packageJson.devDependencies;
  delete packageJson.types;
  packageJson.exports = {
    '.': {
      import: './dist/index.js',
      default: './dist/index.js'
    }
  };
  writeFileSync(
    resolve(packageDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  );
}

function assertWorkspaceRuntimePackage(name, label) {
  const packageDir = resolve(targetDir, `node_modules/@opencreator/${name}`);
  const packageJson = JSON.parse(
    readFileSync(resolve(packageDir, 'package.json'), 'utf8')
  );
  if (packageJson.exports?.['.']?.import !== './dist/index.js') {
    throw new Error(`Desktop ${label} runtime package does not export built JavaScript`);
  }
  assertExists(resolve(packageDir, 'dist/index.js'));
  if (existsSync(resolve(packageDir, 'src'))) {
    throw new Error(`Desktop ${label} runtime package still contains TypeScript sources`);
  }
}

function pruneDevelopmentArtifacts(root) {
  const removableDirectories = new Set([
    '.bin',
    '__tests__',
    'example',
    'examples',
    'test',
    'tests'
  ]);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (removableDirectories.has(entry.name)) {
        rmSync(path, { recursive: true, force: true });
      } else {
        pruneDevelopmentArtifacts(path);
      }
      continue;
    }
    if (
      entry.name === '.modules.yaml'
      || entry.name.endsWith('.map')
      || entry.name.endsWith('.d.ts')
    ) {
      rmSync(path, { force: true });
    }
  }
}

function pruneBetterSqliteBuildArtifacts(root) {
  const binaryPath = resolve(root, 'build/Release/better_sqlite3.node');
  const binary = readFileSync(binaryPath);
  rmSync(resolve(root, 'build'), { recursive: true, force: true });
  mkdirSync(dirname(binaryPath), { recursive: true });
  writeFileSync(binaryPath, binary);
  for (const path of ['binding.gyp', 'deps', 'src']) {
    rmSync(resolve(root, path), { recursive: true, force: true });
  }
}

function pruneDependencyInstallMetadata() {
  rmSync(resolve(targetDir, 'pnpm-lock.yaml'), { force: true });
  rmSync(resolve(targetDir, 'node_modules/.pnpm'), {
    recursive: true,
    force: true
  });
}

function assertPortableDependencyTree() {
  const required = [
    'avvio',
    'debug',
    'fastify-plugin',
    'isexe',
    'luxon',
    'path-key',
    'which'
  ];
  for (const name of required) {
    assertExists(resolve(targetDir, 'node_modules', name, 'package.json'));
  }
  walkFiles(targetDir, path => {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Desktop Daemon deployment contains a symlink: ${path}`);
    }
  });
}

function assertCleanDeployment() {
  const forbidden = [
    '.runtime',
    'src',
    'test',
    'tests',
    'tsconfig.json',
    'vitest.config.ts'
  ];
  for (const entry of forbidden) {
    const path = resolve(targetDir, entry);
    if (existsSync(path)) {
      throw new Error(`Desktop Daemon deployment contains development artifact: ${path}`);
    }
  }
  const size = directorySize(targetDir);
  if (size > 250 * 1024 * 1024) {
    throw new Error(`Desktop Daemon deployment is unexpectedly large: ${size} bytes`);
  }
}

function walkFiles(root, visit) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    visit(path);
    if (entry.isDirectory()) walkFiles(path, visit);
  }
}

function directorySize(root) {
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) total += directorySize(path);
    else if (entry.isFile()) total += statSync(path).size;
  }
  return total;
}

function desktopPackageVersion(name) {
  const packageJson = JSON.parse(
    readFileSync(resolve(desktopDir, 'package.json'), 'utf8')
  );
  const value = packageJson.devDependencies?.[name] ?? packageJson.dependencies?.[name];
  if (typeof value !== 'string') throw new Error(`Missing Desktop dependency: ${name}`);
  return value.replace(/^[^\d]*/, '');
}
