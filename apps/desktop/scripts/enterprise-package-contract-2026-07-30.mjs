import {
  existsSync,
  readdirSync,
  statSync
} from 'node:fs';
import { basename, join } from 'node:path';

export function resolveKeyringTarget(
  platform,
  arch,
  linuxLibc = detectLinuxLibc()
) {
  let target;
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) {
    target = `darwin-${arch}`;
  } else if (
    platform === 'win32'
    && ['arm64', 'ia32', 'x64'].includes(arch)
  ) {
    target = `win32-${arch}-msvc`;
  } else if (
    platform === 'linux'
    && ['arm64', 'x64'].includes(arch)
    && ['gnu', 'musl'].includes(linuxLibc)
  ) {
    target = `linux-${arch}-${linuxLibc}`;
  } else if (platform === 'linux' && arch === 'arm' && linuxLibc === 'gnu') {
    target = 'linux-arm-gnueabihf';
  } else if (
    platform === 'linux'
    && arch === 'riscv64'
    && linuxLibc === 'gnu'
  ) {
    target = 'linux-riscv64-gnu';
  } else if (platform === 'freebsd' && arch === 'x64') {
    target = 'freebsd-x64';
  } else {
    throw new Error(
      `Unsupported @napi-rs/keyring target: `
      + `${platform}/${arch}/${linuxLibc}`
    );
  }

  return {
    packageName: `@napi-rs/keyring-${target}`,
    nativeFile: `keyring.${target}.node`
  };
}

export function assertKeyringArtifacts(deploymentRoot, input) {
  const target = resolveKeyringTarget(
    input.platform,
    input.arch,
    input.linuxLibc
  );
  const loaderRoot = join(
    deploymentRoot,
    'node_modules',
    '@napi-rs',
    'keyring'
  );
  assertFile(join(loaderRoot, 'package.json'), 'Keyring loader package');
  assertFile(join(loaderRoot, 'index.js'), 'Keyring loader');

  const packageRoot = join(
    deploymentRoot,
    'node_modules',
    '@napi-rs',
    target.packageName.slice('@napi-rs/'.length)
  );
  assertFile(join(packageRoot, 'package.json'), 'Keyring platform package');
  const nativeFiles = [];
  walk(packageRoot, path => {
    if (
      statSync(path).isFile()
      && basename(path).startsWith('keyring.')
      && path.endsWith('.node')
    ) {
      nativeFiles.push(path);
    }
  });
  if (
    nativeFiles.length !== 1
    || basename(nativeFiles[0]) !== target.nativeFile
  ) {
    throw new Error(
      `Keyring platform package must contain exactly ${target.nativeFile}: `
      + JSON.stringify(nativeFiles)
    );
  }

  return {
    ...target,
    loaderRoot,
    packageRoot,
    nativePath: nativeFiles[0]
  };
}

export function assertEnterpriseReleaseTransport(input) {
  const url = parseOrigin(input.origin);
  const transportSecurity =
    url.protocol === 'https:' ? 'secure_https' : 'insecure_http';
  if (input.mode !== 'dir' && transportSecurity !== 'secure_https') {
    throw new Error(
      `ENTERPRISE_RELEASE_REQUIRES_HTTPS: ${url.origin}`
    );
  }
  return {
    origin: url.origin,
    transportSecurity
  };
}

export function detectLinuxLibc() {
  if (process.platform !== 'linux') return 'gnu';
  const report = process.report?.getReport?.();
  if (report?.header?.glibcVersionRuntime) return 'gnu';
  if (
    Array.isArray(report?.sharedObjects)
    && report.sharedObjects.some(path => (
      path.includes('libc.musl-') || path.includes('ld-musl-')
    ))
  ) {
    return 'musl';
  }
  return 'gnu';
}

function parseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ENTERPRISE_ORIGIN_INVALID');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0
    || url.password.length > 0
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new Error('ENTERPRISE_ORIGIN_INVALID');
  }
  return url;
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} is missing: ${path}`);
  }
}

function walk(root, visitor) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    visitor(path);
    if (entry.isDirectory()) walk(path, visitor);
  }
}
