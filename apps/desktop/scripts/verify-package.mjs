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
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
const packageRoot = process.env.OPENCREATOR_DESKTOP_PACKAGE_ROOT
  ? resolve(process.env.OPENCREATOR_DESKTOP_PACKAGE_ROOT)
  : resolve(manifest.packageRoot);
const resourcesDir = platformResourcesDir(packageRoot);
const appAsar = join(resourcesDir, 'app.asar');
const daemonDir = join(resourcesDir, 'daemon');
const webDir = join(resourcesDir, 'web');
const daemonCreatorPresetDir = join(daemonDir, 'runtime', 'creator-presets');
const webCreatorPresetDir = join(webDir, 'creator-presets');
const webCreatorSubtitleFontDir = join(webDir, 'fonts', 'opencreator');
const creatorRuntimeDir = join(resourcesDir, 'creator-runtime', 'krillinai');
const codexRuntimeDir = join(resourcesDir, 'codex-runtime');
const sourceWebDir = resolve(desktopDir, '../web/dist');
const sourceCreatorAgentRuntimeDir = resolve(
  desktopDir,
  '../daemon/runtime/opencreator-runtime'
);
const sourceCreatorSubtitleFontManifestPath = resolve(
  desktopDir,
  '../../assets/creator-subtitle-fonts/manifest.json'
);
const executable = packagedExecutable(packageRoot);
const machOMagicValues = new Set([
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca'
]);

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
assertExists(join(daemonDir, 'runtime', 'opencreator-runtime', 'SKILL.md'));
assertExists(join(daemonDir, 'runtime', 'opencreator-runtime', 'manifest.json'));

assertAsarContents();
assertBrandingContents();
assertDaemonContents();
assertCreatorPresetContents();
assertWebContents();
assertCreatorRuntime();
assertCreatorSubtitleFontContents();
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
  for (const [name, label] of [
    ['protocol', 'Protocol'],
    ['config', 'Config']
  ]) {
    const packageDir = join(daemonDir, 'node_modules', '@opencreator', name);
    const packageJson = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8')
    );
    if (packageJson.exports?.['.']?.import !== './dist/index.js') {
      throw new Error(`Packaged Daemon ${label} does not export built JavaScript`);
    }
    assertExists(join(packageDir, 'dist', 'index.js'));
    if (existsSync(join(packageDir, 'src'))) {
      throw new Error(`Packaged Daemon ${label} contains TypeScript runtime sources`);
    }
  }
  assertPortableDaemonDependencies();

  const packagedCreatorAgentRuntime = hashDirectory(
    join(daemonDir, 'runtime', 'opencreator-runtime')
  );
  const sourceCreatorAgentRuntime = hashDirectory(sourceCreatorAgentRuntimeDir);
  const firstDifferentPath = findFirstDifferentPath(
    sourceCreatorAgentRuntime.files,
    packagedCreatorAgentRuntime.files
  );
  if (firstDifferentPath !== undefined) {
    throw new Error(
      `Packaged Creator Agent Runtime file list differs from source at: ${firstDifferentPath}`
    );
  }
  if (sourceCreatorAgentRuntime.hash !== packagedCreatorAgentRuntime.hash) {
    throw new Error(
      'Packaged Creator Agent Runtime contents differ from apps/daemon/runtime/opencreator-runtime'
    );
  }
  if (
    typeof manifest.packageRoot === 'string'
    && (
      manifest.creatorAgentRuntimeHash !== sourceCreatorAgentRuntime.hash
      || manifest.creatorAgentRuntimeFileCount !== sourceCreatorAgentRuntime.fileCount
    )
  ) {
    throw new Error(
      'Desktop build manifest Creator Agent Runtime hash does not match the source runtime'
    );
  }
}

function assertPortableDaemonDependencies() {
  const isolatedRoot = mkdtempSync(join(tmpdir(), 'opencreator-daemon-package-'));
  const isolatedDaemon = join(isolatedRoot, 'daemon');
  try {
    cpSync(daemonDir, isolatedDaemon, { recursive: true });
    const env = { ...process.env };
    delete env.NODE_PATH;
    const probe = spawnSync(process.execPath, [
      '-e',
      `
        const { createRequire } = require('node:module');
        const { pathToFileURL } = require('node:url');
        const { join } = require('node:path');
        const root = process.argv[1];
        const runtimeRequire = createRequire(join(root, 'package.json'));
        for (const name of [
          'cross-spawn',
          'fastify',
          '@fastify/cors',
          'https-proxy-agent',
          'cron-parser'
        ]) {
          runtimeRequire(name);
        }
        Promise.all([
          '@modelcontextprotocol/sdk/server/mcp.js',
          '@modelcontextprotocol/sdk/server/stdio.js',
          '@modelcontextprotocol/sdk/server/streamableHttp.js',
          '@opencreator/config',
          '@opencreator/protocol',
          '@opencreator/skill-market',
          'image-size',
          'nanoid',
          'yaml',
          'zod'
        ].map(async name => {
          const path = runtimeRequire.resolve(name);
          await import(pathToFileURL(path).href);
        })).catch(error => {
          console.error(error);
          process.exitCode = 1;
        });
      `,
      isolatedDaemon
    ], {
      cwd: isolatedRoot,
      env,
      encoding: 'utf8',
      timeout: 30_000
    });
    if (probe.status !== 0) {
      throw new Error(
        'Packaged Daemon dependencies are not self-contained: '
        + `exit=${String(probe.status)} stdout=${probe.stdout.trim()} `
        + `stderr=${probe.stderr.trim()}`
      );
    }
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
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

function assertCreatorPresetContents() {
  const manifestPath = join(daemonCreatorPresetDir, 'manifest.json');
  const catalogPath = join(daemonCreatorPresetDir, 'catalog.json');
  assertExists(manifestPath);
  assertExists(catalogPath);
  const presetManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    presetManifest?.schemaVersion !== 1
    || !isSha256(presetManifest.catalogHash)
    || !isSha256(presetManifest.assetSetHash)
    || !Array.isArray(presetManifest.files)
  ) {
    throw new Error(`Creator preset manifest is invalid: ${manifestPath}`);
  }

  const expectedDaemonFiles = new Set(['manifest.json']);
  for (const file of presetManifest.files) {
    if (
      typeof file?.path !== 'string'
      || !isSha256(file?.sha256)
      || !Number.isSafeInteger(file?.size)
      || file.size < 0
      || expectedDaemonFiles.has(file.path)
    ) {
      throw new Error(`Creator preset manifest contains an invalid resource: ${manifestPath}`);
    }
    expectedDaemonFiles.add(file.path);
    const absolute = join(daemonCreatorPresetDir, ...file.path.split('/'));
    assertExists(absolute);
    const contents = readFileSync(absolute);
    if (contents.byteLength !== file.size || hashBuffer(contents) !== file.sha256) {
      throw new Error(`Creator preset packaged resource hash mismatch: ${absolute}`);
    }
  }

  const daemonFiles = listRelativeFiles(daemonCreatorPresetDir);
  const staleDaemonFile = daemonFiles.find(file => !expectedDaemonFiles.has(file));
  if (staleDaemonFile !== undefined) {
    throw new Error(
      `Creator preset Daemon resources contain a stale file: ${staleDaemonFile}`
    );
  }
  const missingDaemonFile = [...expectedDaemonFiles]
    .find(file => !daemonFiles.includes(file));
  if (missingDaemonFile !== undefined) {
    throw new Error(`Creator preset Daemon resource is missing: ${missingDaemonFile}`);
  }

  const catalogHash = hashFile(catalogPath);
  if (catalogHash !== presetManifest.catalogHash) {
    throw new Error(
      `Creator preset catalog hash mismatch: ${catalogHash} !== ${presetManifest.catalogHash}`
    );
  }
  const assetEntries = presetManifest.files
    .filter(file => file.path.startsWith('assets/'))
    .sort((left, right) => left.path.localeCompare(right.path));
  const assetSetHash = hashBuffer(Buffer.from(canonicalJson(assetEntries)));
  if (assetSetHash !== presetManifest.assetSetHash) {
    throw new Error(
      `Creator preset asset set hash mismatch: ${assetSetHash} !== ${presetManifest.assetSetHash}`
    );
  }

  const expectedWebFiles = assetEntries.map(file => basename(file.path)).sort();
  assertExists(webCreatorPresetDir);
  for (const file of assetEntries) {
    const name = basename(file.path);
    const webAsset = join(webCreatorPresetDir, name);
    if (!existsSync(webAsset)) {
      throw new Error(`Creator preset Web asset is missing: ${webAsset}`);
    }
    const contents = readFileSync(webAsset);
    if (contents.byteLength !== file.size || hashBuffer(contents) !== file.sha256) {
      throw new Error(`Creator preset Web asset hash mismatch: ${webAsset}`);
    }
  }
  const actualWebFiles = listRelativeFiles(webCreatorPresetDir);
  const staleWebFile = actualWebFiles.find(file => !expectedWebFiles.includes(file));
  if (staleWebFile !== undefined) {
    throw new Error(
      `Creator preset Web assets contain a stale file: ${staleWebFile}`
    );
  }

  if (
    typeof manifest.packageRoot === 'string'
    && (
      manifest.creatorPresetCatalogHash !== presetManifest.catalogHash
      || manifest.creatorPresetAssetSetHash !== presetManifest.assetSetHash
      || manifest.creatorPresetResourceCount !== presetManifest.files.length
    )
  ) {
    throw new Error('Packaged Creator presets do not match the Desktop build manifest');
  }
}

function assertCreatorSubtitleFontContents() {
  const creatorRuntimeManifest = JSON.parse(readFileSync(
    join(creatorRuntimeDir, 'manifest.json'),
    'utf8'
  ));
  const fontResources = creatorRuntimeManifest.resources.filter(resource => (
    resource.path.startsWith('fonts/')
    || resource.path.startsWith('licenses/fonts/')
  ));
  const sourceFontManifest = JSON.parse(readFileSync(
    sourceCreatorSubtitleFontManifestPath,
    'utf8'
  ));
  if (
    sourceFontManifest?.version !== 1
    || !Array.isArray(sourceFontManifest.fonts)
    || sourceFontManifest.fonts.length === 0
  ) {
    throw new Error('Creator subtitle source font manifest is invalid');
  }
  const webFontResources = sourceFontManifest.fonts.map(font => {
    if (
      typeof font?.webFile !== 'string'
      || !font.webFile.endsWith('.woff2')
      || !isSha256(font?.webSha256)
    ) {
      throw new Error('Creator subtitle source Web font entry is invalid');
    }
    const source = resolve(
      dirname(sourceCreatorSubtitleFontManifestPath),
      font.webFile
    );
    if (!existsSync(source) || hashFile(source) !== font.webSha256.toLowerCase()) {
      throw new Error(`Creator subtitle source Web font hash mismatch: ${source}`);
    }
    return {
      path: `fonts/opencreator/${basename(font.webFile)}`,
      sha256: font.webSha256.toLowerCase()
    };
  });
  const expectedWebFiles = webFontResources
    .map(resource => basename(resource.path))
    .sort();
  assertExists(webCreatorSubtitleFontDir);
  for (const resource of webFontResources) {
    const webFont = join(webCreatorSubtitleFontDir, basename(resource.path));
    assertExists(webFont);
    if (hashFile(webFont) !== resource.sha256) {
      throw new Error(`Creator subtitle Web font hash mismatch: ${webFont}`);
    }
  }
  const actualWebFiles = listRelativeFiles(webCreatorSubtitleFontDir);
  const staleWebFont = actualWebFiles.find(file => !expectedWebFiles.includes(file));
  if (staleWebFont !== undefined) {
    throw new Error(`Creator subtitle Web fonts contain a stale file: ${staleWebFont}`);
  }
  if (
    typeof manifest.packageRoot === 'string'
    && (
      manifest.creatorSubtitleFontSetHash !== hashResourceDescriptors(fontResources)
      || manifest.creatorSubtitleFontResourceCount !== fontResources.length
      || manifest.creatorSubtitleWebFontSetHash !== hashResourceDescriptors(webFontResources)
      || manifest.creatorSubtitleWebFontResourceCount !== webFontResources.length
    )
  ) {
    throw new Error(
      'Packaged Creator subtitle fonts do not match the Desktop build manifest'
    );
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
    manifest.krillinCliVersion !== runtime.cliVersion
    || manifest.krillinSourceCommit !== runtime.sourceCommit
    || manifest.krillinSourceSha256 !== runtime.sourceSha256
    || manifest.krillinIntegrationPatchSha256 !== runtime.integrationPatchSha256
    || manifest.ytDlpRuntimeMode !== runtime.ytDlp?.mode
    || manifest.ytDlpVersion !== runtime.ytDlp?.version
    || manifest.ytDlpPythonVersion !== runtime.ytDlp?.pythonVersion
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

function hashFile(path) {
  return hashBuffer(readFileSync(path));
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

function listRelativeFiles(root) {
  const files = [];
  walk(root, path => {
    if (statSync(path).isFile()) {
      files.push(relative(root, path).replaceAll('\\', '/'));
    }
  });
  return files.sort();
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  );
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
    [FuseV1Options.EnableCookieEncryption, FUSE_DISABLED, 'CookieEncryption'],
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
  if (process.env.OPENCREATOR_REQUIRE_DEVELOPER_ID === '1') {
    verifyDeveloperIdSignature();
    verifyEmbeddedCreatorRuntimeSignatures();
  }
  if (process.env.OPENCREATOR_REQUIRE_NOTARIZED_MAC_APP === '1') {
    if (process.env.OPENCREATOR_REQUIRE_DEVELOPER_ID !== '1') {
      throw new Error(
        'A notarized macOS package must also require Developer ID verification'
      );
    }
    runMacVerification(
      'macOS notarization ticket',
      'xcrun',
      ['stapler', 'validate', packageRoot]
    );
    runMacVerification(
      'macOS Gatekeeper assessment',
      'spctl',
      ['--assess', '--type', 'execute', '--verbose=4', packageRoot]
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

function verifyDeveloperIdSignature() {
  const details = spawnSync('codesign', [
    '--display',
    '--verbose=4',
    packageRoot
  ], {
    encoding: 'utf8',
    timeout: 30_000
  });
  if (details.status !== 0) {
    throw new Error(
      `Unable to inspect packaged macOS signature: `
      + `${details.stderr || details.stdout}`
    );
  }
  const output = `${details.stdout}\n${details.stderr}`;
  const expectedTeamId = process.env.OPENCREATOR_APPLE_TEAM_ID?.trim();
  if (
    !output.includes('Authority=Developer ID Application:')
    || !output.includes('Timestamp=')
    || (
      expectedTeamId
      && !output.includes(`TeamIdentifier=${expectedTeamId}`)
    )
  ) {
    throw new Error(
      'Packaged macOS app is not signed with the expected Developer ID '
      + `identity for Team ${expectedTeamId ?? '<unspecified>'}`
    );
  }
}

function verifyEmbeddedCreatorRuntimeSignatures() {
  const embeddedBinaries = [];
  walk(creatorRuntimeDir, path => {
    if (isMachOBinary(path)) embeddedBinaries.push(path);
  });
  if (embeddedBinaries.length === 0) {
    throw new Error('Creator Runtime does not contain any macOS binaries');
  }
  const expectedTeamId = process.env.OPENCREATOR_APPLE_TEAM_ID?.trim();
  for (const path of embeddedBinaries) {
    const details = spawnSync('codesign', [
      '--display',
      '--verbose=4',
      path
    ], {
      encoding: 'utf8',
      timeout: 30_000
    });
    const output = `${details.stdout}\n${details.stderr}`;
    if (
      details.status !== 0
      || !output.includes('Authority=Developer ID Application:')
      || !output.includes('Timestamp=')
      || !output.includes('(runtime)')
      || (
        expectedTeamId
        && !output.includes(`TeamIdentifier=${expectedTeamId}`)
      )
    ) {
      throw new Error(
        'Embedded Creator Runtime binary is not signed for distribution: '
        + `${relative(packageRoot, path)}`
      );
    }
  }
}

function isMachOBinary(path) {
  if (!statSync(path).isFile()) return false;
  const descriptor = openSync(path, 'r');
  const header = Buffer.allocUnsafe(4);
  try {
    if (readSync(descriptor, header, 0, header.length, 0) < header.length) {
      return false;
    }
    return machOMagicValues.has(header.toString('hex'));
  } finally {
    closeSync(descriptor);
  }
}

function runMacVerification(label, command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 2 * 60_000
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed: ${result.stderr || result.stdout}`
    );
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
