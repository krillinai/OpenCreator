import {
  extractFile,
  listPackage
} from '@electron/asar';
import electronFuses from '@electron/fuses';

const {
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire
} = electronFuses;
const FUSE_DISABLED = '0'.charCodeAt(0);
const FUSE_ENABLED = '1'.charCodeAt(0);
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertKeyringArtifacts,
  readEnterpriseGatewayPackageConfig
} from './enterprise-package-contract-2026-07-30.mjs';
import { verifyCreatorRuntime } from './creator-runtime-contract.mjs';
import { verifyCodexRuntime } from './codex-runtime-contract.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const manifestPath = resolve(
  process.env.OPENCREATOR_DESKTOP_BUILD_MANIFEST
    ?? join(desktopDir, 'release', 'opencreator-desktop-build-manifest.json')
);
const manifest = readBuildManifest(manifestPath);
const targetArch = process.env.OPENCREATOR_DESKTOP_TARGET_ARCH
  ?? manifest.arch
  ?? process.arch;
const targetPlatform = process.env.OPENCREATOR_DESKTOP_TARGET_PLATFORM
  ?? manifest.platform
  ?? process.platform;
const targetLibc = process.env.OPENCREATOR_DESKTOP_TARGET_LIBC;
const packageRoot = process.env.OPENCREATOR_DESKTOP_PACKAGE_ROOT
  ? resolve(process.env.OPENCREATOR_DESKTOP_PACKAGE_ROOT)
  : resolve(manifest.packageRoot);
const resourcesDir = platformResourcesDir(packageRoot);
const appAsar = join(resourcesDir, 'app.asar');
const daemonDir = join(resourcesDir, 'daemon');
const webDir = join(resourcesDir, 'web');
const creatorRuntimeDir = join(resourcesDir, 'creator-runtime', 'krillinai');
const codexRuntimeDir = join(resourcesDir, 'codex-runtime');
const enterpriseGatewayConfigFilename = 'config.toml';
const enterpriseGatewayConfigPath = join(
  resourcesDir,
  'deployment',
  enterpriseGatewayConfigFilename
);
const sourceWebDir = resolve(desktopDir, '../web/dist');
const executable = packagedExecutable(packageRoot);

assertExists(packageRoot);
assertExists(executable);
assertExists(appAsar);
assertExists(join(daemonDir, 'dist', 'main.js'));
assertExists(join(
  daemonDir,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
));
assertExists(join(webDir, 'index.html'));
assertExists(enterpriseGatewayConfigPath);
const keyring = assertKeyringArtifacts(daemonDir, {
  platform: targetPlatform,
  arch: targetArch,
  ...(targetLibc === undefined ? {} : { linuxLibc: targetLibc })
});

assertAsarContents();
assertBrandingContents();
assertDaemonContents();
assertEnterpriseGatewayConfig();
assertWebContents();
assertCreatorRuntime();
assertCodexRuntime();
assertNoLocalData();
assertSize('app.asar', appAsar, 80 * 1024 * 1024);
assertSize('Daemon resources', daemonDir, 250 * 1024 * 1024);
assertSize('Desktop package', packageRoot, 1536 * 1024 * 1024);
await assertFuseConfiguration();
verifyMacPackageMetadata();

console.log(JSON.stringify({
  ok: true,
  packageRoot,
  packageBytes: treeSize(packageRoot),
  daemonBytes: treeSize(daemonDir),
  keyringPackage: keyring.packageName,
  keyringNativeFile: keyring.nativeFile,
  fuses: 'verified',
  privacy: 'verified'
}));

function readBuildManifest(path) {
  if (!existsSync(path)) {
    if (process.env.OPENCREATOR_DESKTOP_PACKAGE_ROOT) {
      return {};
    }
    throw new Error(
      `Desktop build manifest is missing: ${path}. `
      + 'Run the Desktop package command or set OPENCREATOR_DESKTOP_PACKAGE_ROOT.'
    );
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (
    parsed === null
    || typeof parsed !== 'object'
    || typeof parsed.packageRoot !== 'string'
  ) {
    throw new Error(`Desktop build manifest is invalid: ${path}`);
  }
  return parsed;
}

function platformResourcesDir(root) {
  return process.platform === 'darwin'
    ? join(root, 'Contents', 'Resources')
    : join(root, 'resources');
}

function packagedExecutable(root) {
  if (process.platform === 'darwin') {
    return join(root, 'Contents', 'MacOS', 'OpenCreator');
  }
  return join(root, process.platform === 'win32' ? 'OpenCreator.exe' : 'opencreator');
}

function assertAsarContents() {
  const entries = normalizedAsarEntries();
  const required = [
    '/dist/main/main.js',
    '/dist/preload/index.cjs',
    '/dist/bootstrap/index.html',
    '/dist/shared/ipc.js'
  ];
  for (const entry of required) {
    if (!entries.includes(entry)) {
      throw new Error(`app.asar is missing required entry: ${entry}`);
    }
  }
  const forbidden = entries.find(entry =>
    entry.startsWith('/dist/mac-')
    || entry.startsWith('/dist/win-')
    || entry === '/src'
    || entry.startsWith('/src/')
    || entry.endsWith('.map')
  );
  if (forbidden !== undefined) {
    throw new Error(`app.asar contains a development artifact: ${forbidden}`);
  }
}

function assertBrandingContents() {
  const desktopResourcesDir = join(resourcesDir, 'desktop-resources');
  const sourceResourcesDir = resolve(desktopDir, 'resources');
  const packagedIcon = join(desktopResourcesDir, 'icon.png');
  const packagedTray = join(desktopResourcesDir, 'tray.png');
  const sourceIcon = join(sourceResourcesDir, 'icon.png');
  const sourceTray = join(sourceResourcesDir, 'tray.png');

  assertSameFile('Desktop icon', packagedIcon, sourceIcon);
  assertSameFile('Desktop tray icon', packagedTray, sourceTray);

  const bootstrapHtml = extractFile(
    appAsar,
    join('dist', 'bootstrap', 'index.html')
  ).toString('utf8');
  if (!bootstrapHtml.includes('<title>OpenCreator</title>')) {
    throw new Error('Packaged Desktop bootstrap branding is missing OpenCreator');
  }

  if (process.platform === 'darwin') {
    assertExists(join(resourcesDir, 'icon.icns'));
  }
}

function assertDaemonContents() {
  const forbiddenTopLevelNames = new Set([
    '.runtime',
    '.pnpm',
    'src',
    'test',
    'tests',
    'tsconfig.json',
    'vitest.config.ts'
  ]);
  for (const name of forbiddenTopLevelNames) {
    const path = join(daemonDir, name);
    if (existsSync(path)) {
      throw new Error(`Daemon resources contain a development artifact: ${path}`);
    }
  }
  walk(daemonDir, path => {
    const name = basename(path);
    if (name.endsWith('.map') || name.endsWith('.d.ts')) {
      throw new Error(`Daemon resources contain a development artifact: ${path}`);
    }
  });
  const protocolDir = join(daemonDir, 'node_modules', '@opencreator', 'protocol');
  const protocolPackage = JSON.parse(
    readFileSync(join(protocolDir, 'package.json'), 'utf8')
  );
  if (protocolPackage.exports?.['.']?.import !== './dist/index.js') {
    throw new Error('Packaged Daemon Protocol does not export built JavaScript');
  }
  assertExists(join(protocolDir, 'dist', 'index.js'));
  if (existsSync(join(protocolDir, 'src'))) {
    throw new Error('Packaged Daemon Protocol contains TypeScript runtime sources');
  }
}

function assertEnterpriseGatewayConfig() {
  const config = readEnterpriseGatewayPackageConfig(
    enterpriseGatewayConfigPath,
    manifest.mode ?? 'dir'
  );
  if (typeof manifest.packageRoot !== 'string') return;
  const configHash = hashBuffer(readFileSync(enterpriseGatewayConfigPath));
  if (
    manifest.enterpriseOrigin !== config.gateway
    || manifest.enterpriseTransportSecurity !== config.transportSecurity
    || manifest.enterpriseGatewayConfigHash !== configHash
  ) {
    throw new Error(
      'Packaged enterprise gateway configuration does not match the build manifest'
    );
  }
}

function assertSameFile(label, left, right) {
  assertExists(left);
  assertExists(right);
  if (hashBuffer(readFileSync(left)) !== hashBuffer(readFileSync(right))) {
    throw new Error(`${label} differs between the package and source resources`);
  }
}

function hashBuffer(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function assertWebContents() {
  assertExists(sourceWebDir);
  const source = hashDirectory(sourceWebDir);
  const packaged = hashDirectory(webDir);
  const firstDifferentPath = findFirstDifferentPath(source.files, packaged.files);

  if (firstDifferentPath !== undefined) {
    throw new Error(
      `Packaged Web file list differs from apps/web/dist at: ${firstDifferentPath}`
    );
  }
  if (source.hash !== packaged.hash) {
    throw new Error(
      `Packaged Web contents differ from apps/web/dist: `
      + `${packaged.hash} !== ${source.hash}`
    );
  }
  if (typeof manifest.packageRoot === 'string') {
    if (
      manifest.webBuildHash !== source.hash
      || manifest.webFileCount !== source.fileCount
    ) {
      throw new Error(
        'Desktop build manifest Web hash does not match apps/web/dist'
      );
    }
  }
}

function normalizedAsarEntries() {
  return listPackage(appAsar).map(entry => {
    const normalized = entry.replaceAll('\\', '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  });
}

function assertCreatorRuntime() {
  const runtime = verifyCreatorRuntime(creatorRuntimeDir, targetPlatform, targetArch);
  if (typeof manifest.packageRoot !== 'string') return;
  if (
    manifest.krillinServiceVersion !== runtime.serviceVersion
    || manifest.krillinUpstreamCommit !== runtime.upstreamCommit
    || manifest.krillinIntegrationPatchSha256 !== runtime.integrationPatchSha256
    || manifest.krillinProtocolSha256 !== runtime.protocolSha256
  ) {
    throw new Error('Packaged Creator Runtime does not match the Desktop build manifest');
  }
}

function assertCodexRuntime() {
  const runtime = verifyCodexRuntime(codexRuntimeDir, targetPlatform, targetArch);
  if (typeof manifest.packageRoot !== 'string') return;
  if (
    manifest.codexRuntimeVersion !== runtime.version
    || manifest.codexRuntimeCommit !== runtime.commit
    || manifest.codexRuntimeBinarySha256 !== runtime.binary.sha256
    || manifest.codexAppServerProtocolSha256 !== runtime.appServerProtocol.schemaSha256
  ) {
    throw new Error('Packaged Codex Runtime does not match the Desktop build manifest');
  }
}

function hashDirectory(root) {
  const files = [];
  walk(root, path => {
    if (!statSync(path).isFile()) return;
    files.push(relative(root, path).replaceAll('\\', '/'));
  });
  files.sort();

  const aggregate = createHash('sha256');
  for (const relativePath of files) {
    const contents = readFileSync(join(root, relativePath));
    const contentHash = createHash('sha256').update(contents).digest('hex');
    aggregate.update(relativePath).update('\0').update(contentHash).update('\0');
  }
  return {
    files,
    fileCount: files.length,
    hash: aggregate.digest('hex')
  };
}

function findFirstDifferentPath(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return `${left[index] ?? '<missing>'} / ${right[index] ?? '<missing>'}`;
    }
  }
  return undefined;
}

function assertNoLocalData() {
  const forbiddenFragments = [
    homedir(),
    process.env.HOME,
    process.env.USERPROFILE,
    '~/develop/opencreator/',
    '~/develop/content-design',
    'content-design',
    'Playground'
  ].filter(value => typeof value === 'string' && value.length > 1);
  const scanPaths = [
    appAsar,
    ...textFiles(webDir),
    ...textFiles(join(daemonDir, 'dist'))
  ];

  for (const path of scanPaths) {
    const contents = readFileSync(path);
    for (const fragment of new Set(forbiddenFragments)) {
      if (contents.includes(Buffer.from(fragment))) {
        throw new Error(
          `Desktop package contains local build data in ${path}: ${fragment}`
        );
      }
    }
  }
}

function textFiles(root) {
  const paths = [];
  walk(root, path => {
    if (!statSync(path).isFile()) return;
    const name = basename(path).toLowerCase();
    if (
      name.endsWith('.js')
      || name.endsWith('.mjs')
      || name.endsWith('.cjs')
      || name.endsWith('.json')
      || name.endsWith('.html')
      || name.endsWith('.css')
    ) {
      paths.push(path);
    }
  });
  return paths;
}

async function assertFuseConfiguration() {
  const wire = await getCurrentFuseWire(executable);
  if (wire.version !== FuseVersion.V1) {
    throw new Error(`Unsupported Electron fuse wire version: ${wire.version}`);
  }
  const expected = [
    [FuseV1Options.RunAsNode, FUSE_DISABLED, 'RunAsNode'],
    [FuseV1Options.EnableCookieEncryption, FUSE_ENABLED, 'CookieEncryption'],
    [
      FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      FUSE_DISABLED,
      'NodeOptionsEnvironmentVariable'
    ],
    [
      FuseV1Options.EnableNodeCliInspectArguments,
      FUSE_DISABLED,
      'NodeCliInspectArguments'
    ],
    [
      FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
      FUSE_ENABLED,
      'EmbeddedAsarIntegrityValidation'
    ],
    [FuseV1Options.OnlyLoadAppFromAsar, FUSE_ENABLED, 'OnlyLoadAppFromAsar']
  ];
  for (const [index, expectedState, label] of expected) {
    if (wire[index] !== expectedState) {
      throw new Error(
        `Electron fuse ${label} has state ${wire[index]}, expected ${expectedState}`
      );
    }
  }
}

function verifyMacPackageMetadata() {
  if (process.platform !== 'darwin') return;
  const signature = spawnSync('codesign', [
    '--verify',
    '--deep',
    '--strict',
    packageRoot
  ], {
    encoding: 'utf8',
    timeout: 30_000
  });
  if (signature.status !== 0) {
    throw new Error(
      `Packaged macOS code signature is invalid: `
      + `${signature.stderr || signature.stdout}`
    );
  }
  const plist = spawnSync('plutil', [
    '-extract',
    'ElectronAsarIntegrity',
    'json',
    '-o',
    '-',
    join(packageRoot, 'Contents', 'Info.plist')
  ], {
    encoding: 'utf8',
    timeout: 30_000
  });
  if (plist.status !== 0) {
    throw new Error(
      `Packaged ASAR integrity metadata is missing: ${plist.stderr || plist.stdout}`
    );
  }
  const integrity = JSON.parse(plist.stdout);
  if (
    integrity?.['Resources/app.asar']?.algorithm !== 'SHA256'
    || typeof integrity?.['Resources/app.asar']?.hash !== 'string'
  ) {
    throw new Error('Packaged app.asar integrity metadata is invalid');
  }
}

function assertExists(path) {
  if (!existsSync(path)) throw new Error(`Desktop package is missing: ${path}`);
}

function assertSize(label, path, maxBytes) {
  const bytes = statSync(path).isDirectory() ? treeSize(path) : statSync(path).size;
  if (bytes > maxBytes) {
    throw new Error(`${label} is unexpectedly large: ${bytes} bytes`);
  }
}

function treeSize(root) {
  let total = 0;
  walk(root, path => {
    const stat = statSync(path);
    if (stat.isFile()) total += stat.size;
  });
  return total;
}

function walk(root, visitor) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink() && !existsSync(path)) {
      throw new Error(`Desktop package contains a broken symbolic link: ${path}`);
    }
    visitor(path);
    if (entry.isDirectory()) walk(path, visitor);
  }
}
