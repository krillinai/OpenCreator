import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStage } from './script-utils.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
const targetDir = resolve(desktopDir, '.pack/daemon');
const targetArch = process.env.CLAWEE_DESKTOP_TARGET_ARCH ?? process.arch;
const cacheDir = resolve(
  process.env.CLAWEE_DESKTOP_CACHE_DIR
    ?? resolve(desktopDir, '.cache')
);
const offline = process.env.CLAWEE_DESKTOP_OFFLINE === '1';
const deployOffline = process.env.CLAWEE_DESKTOP_OFFLINE !== '0';
const nativeBuildEnv = { ...process.env };
delete nativeBuildEnv.npm_config_recursive;
mkdirSync(cacheDir, { recursive: true });

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
await runStage('构建 Daemon', 'pnpm', ['--filter', '@clawee/daemon', 'build'], {
  cwd: rootDir,
  timeoutMs: 5 * 60_000
});
await runStage('构建 Web', 'pnpm', ['--filter', '@clawee/web', 'build'], {
  cwd: rootDir,
  timeoutMs: 5 * 60_000
});
rmSync(targetDir, { recursive: true, force: true });
await runStage('部署 Daemon 生产依赖', 'pnpm', [
  '--frozen-lockfile',
  ...(deployOffline ? ['--offline'] : []),
  '--config.node-linker=hoisted',
  '--config.ignore-scripts=true',
  '--filter',
  '@clawee/daemon',
  'deploy',
  '--prod',
  targetDir
], {
  cwd: rootDir,
  timeoutMs: 10 * 60_000
});
pruneDeploymentRoot();
await runStage('重建 Electron 原生 SQLite', 'npm', [
  'rebuild',
  'better-sqlite3',
  '--foreground-scripts'
], {
  cwd: targetDir,
  timeoutMs: 10 * 60_000,
  env: {
    ...nativeBuildEnv,
    npm_config_runtime: 'electron',
    npm_config_target: desktopPackageVersion('electron'),
    npm_config_arch: targetArch,
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_devdir: resolve(cacheDir, 'node-gyp'),
    npm_config_cache: resolve(cacheDir, 'npm'),
    npm_config_build_from_source: 'true',
    npm_config_offline: offline ? 'true' : 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false'
  }
});
pruneDevelopmentArtifacts(targetDir);

assertExists(resolve(targetDir, 'dist/main.js'));
assertExists(resolve(targetDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'));
assertCleanDeployment();

function assertExists(path) {
  if (!existsSync(path)) {
    throw new Error(`Desktop Daemon deployment is missing required artifact: ${path}`);
  }
}

function pruneDeploymentRoot() {
  const allowed = new Set(['dist', 'node_modules', 'package.json']);
  for (const entry of readdirSync(targetDir)) {
    if (allowed.has(entry)) continue;
    rmSync(resolve(targetDir, entry), { recursive: true, force: true });
  }
}

function pruneDevelopmentArtifacts(root) {
  const removableDirectories = new Set([
    '.bin',
    '.pnpm',
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
