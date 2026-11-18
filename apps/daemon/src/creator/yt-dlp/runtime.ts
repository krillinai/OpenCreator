import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KrillinRuntimeManifest } from '../krillin/manifest.js';
import { resolveInside } from '../krillin/manifest.js';

export type YtDlpRuntime = {
  version: string;
  executable: string;
  prefixArgs: string[];
  env: NodeJS.ProcessEnv;
  script?: string;
};

export function createYtDlpRuntimeScope(resolveCurrent: () => YtDlpRuntime | undefined) {
  const scope = new AsyncLocalStorage<{ runtime: YtDlpRuntime | undefined }>();
  return {
    getRuntime() {
      const current = scope.getStore();
      return current === undefined ? resolveCurrent() : current.runtime;
    },
    run<Result>(operation: () => Result): Result {
      return scope.getStore() === undefined ? scope.run({ runtime: resolveCurrent() }, operation) : operation();
    }
  };
}

export function resolveYtDlpRuntime(input: {
  resourceRoot: string;
  manifest: KrillinRuntimeManifest;
  overridePath?: string;
}): YtDlpRuntime | undefined {
  const pluginArgs = ['--plugin-dirs', fileURLToPath(new URL('../../../runtime/yt-dlp', import.meta.url))];
  const javascriptRuntime = input.manifest.ytDlp?.javascriptRuntime;
  const javascriptArgs = javascriptRuntime === undefined ? [] : [
    '--js-runtimes', `${javascriptRuntime.name}:${manifestResource(input, javascriptRuntime.executable, 'executable')}`
  ];
  if (input.overridePath !== undefined) {
    const executable = resolve(input.overridePath);
    if (!existsSync(executable)) {
      throw new Error(`Configured yt-dlp executable is missing: ${executable}`);
    }
    return {
      version: 'external',
      executable,
      prefixArgs: [...pluginArgs, ...javascriptArgs],
      env: {}
    };
  }

  const descriptor = input.manifest.ytDlp;
  if (descriptor?.mode === 'standalone') {
    return {
      version: descriptor.version,
      executable: manifestResource(input, descriptor.executable, 'executable'),
      prefixArgs: [...pluginArgs, ...javascriptArgs],
      env: {}
    };
  }
  if (descriptor?.mode === 'python') {
    const executable = manifestResource(input, descriptor.executable, 'executable');
    const script = manifestResource(input, descriptor.script, 'asset');
    const certificateBundle = manifestResource(
      input,
      descriptor.certificateBundle,
      'asset'
    );
    return {
      version: descriptor.version,
      executable,
      prefixArgs: ['-I', '-B', script, ...pluginArgs, ...javascriptArgs],
      env: {
        SSL_CERT_FILE: certificateBundle
      },
      script
    };
  }

  const legacy = input.manifest.resources.find(candidate => (
    candidate.kind === 'executable'
    && /(?:^|\/)yt-dlp(?:\.exe)?$/i.test(candidate.path)
  ));
  return legacy === undefined
    ? undefined
    : {
        version: 'legacy',
        executable: resolveInside(input.resourceRoot, legacy.path),
        prefixArgs: [...pluginArgs, ...javascriptArgs],
        env: {}
      };
}

function manifestResource(
  input: {
    resourceRoot: string;
    manifest: KrillinRuntimeManifest;
  },
  relativePath: string,
  kind: 'executable' | 'asset'
): string {
  const resource = input.manifest.resources.find(candidate => (
    candidate.path === relativePath && candidate.kind === kind
  ));
  if (resource === undefined) {
    throw new Error(`dependency_not_packaged: ${relativePath}`);
  }
  return resolveInside(input.resourceRoot, resource.path);
}
