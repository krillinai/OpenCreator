import { spawn } from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve,
  win32 as win32Path
} from 'node:path';

const ENV_START = '__OPENCREATOR_ENV_START__';
const ENV_END = '__OPENCREATOR_ENV_END__';
const MAX_ENV_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_CANDIDATE_PROBE_TIMEOUT_MS = 5_000;

export type ResolvedCodexEnvironment = {
  codexBin: string;
  codexHome: string;
  defaultCwd: string;
  env: NodeJS.ProcessEnv;
  source:
    | 'saved'
    | 'process_path'
    | 'login_shell'
    | 'common_path'
    | 'application_bundle'
    | 'manual';
};

export type CodexResolutionDiagnostics = {
  platform: NodeJS.Platform;
  homeDir: string;
  shell?: string;
  processPathEntries: string[];
  loginShellPathEntries: string[];
  loginShellResolved: boolean;
  attemptedCandidates: Array<{
    path: string;
    source: ResolvedCodexEnvironment['source'];
  }>;
  selectedCodexBin?: string;
  selectedSource?: ResolvedCodexEnvironment['source'];
};

export type LoginShellEnvironmentTask = {
  result: Promise<NodeJS.ProcessEnv | undefined>;
  cancel(): Promise<void>;
};

export async function resolveCodexEnvironment(input: {
  successfulCodexBin?: string;
  savedCodexBin?: string;
  selectedCodexBin?: string;
  processEnv?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  shellTimeoutMs?: number;
  fastCandidateShellTimeoutMs?: number;
  loginShellTask?: LoginShellEnvironmentTask;
  loginShell?: string;
  onDiagnostics?(diagnostics: CodexResolutionDiagnostics): void;
  windowsWhereCandidates?: string[];
  windowsWhereTimeoutMs?: number;
  candidateProbeTimeoutMs?: number;
  applicationRoots?: string[];
} = {}): Promise<ResolvedCodexEnvironment | undefined> {
  const processEnv = { ...(input.processEnv ?? process.env) };
  const homeDir = input.homeDir ?? homedir();
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const applicationRoots = input.applicationRoots
    ?? configuredApplicationRoots(processEnv, homeDir, platform);
  const fastCandidates: Array<{
    path: string;
    source: ResolvedCodexEnvironment['source'];
  }> = [];
  pushCandidate(fastCandidates, input.selectedCodexBin, 'manual');
  pushCandidate(fastCandidates, processEnv.CODEX_BIN, 'manual');
  pushCandidate(fastCandidates, input.successfulCodexBin, 'saved');
  pushCandidate(fastCandidates, input.savedCodexBin, 'saved');
  for (const path of applicationBundleCodexCandidates(
    homeDir,
    platform,
    applicationRoots
  )) {
    fastCandidates.push({ path, source: 'application_bundle' });
  }
  pushPathCandidates(
    fastCandidates,
    processEnv.PATH,
    platform,
    processEnv.PATHEXT,
    'process_path'
  );
  for (const directory of commonExecutableDirectories(homeDir, platform, processEnv)) {
    for (const name of executableNames(platform, processEnv.PATHEXT)) {
      fastCandidates.push({ path: join(directory, name), source: 'common_path' });
    }
  }
  if (platform === 'win32') {
    const whereCandidates = input.windowsWhereCandidates
      ?? await readWindowsWhereCandidates({
        env: processEnv,
        timeoutMs: input.windowsWhereTimeoutMs ?? 2_000
      }).catch(() => []);
    for (const path of whereCandidates) {
      pushCandidate(fastCandidates, path, 'process_path');
    }
  }

  const fastExecutableCandidate = findExecutableCandidate(
    fastCandidates,
    homeDir,
    platform
  );
  const loginShell = platform === 'win32'
    ? undefined
    : resolveLoginShell(processEnv, platform, input.loginShell);
  const shellTask = platform === 'win32'
    ? undefined
    : input.loginShellTask ?? startLoginShellEnvironmentRead({
        env: processEnv,
        platform,
        shell: loginShell,
        timeoutMs: fastExecutableCandidate === undefined
          ? input.shellTimeoutMs ?? 5_000
          : input.fastCandidateShellTimeoutMs ?? 2_000
      });
  if (fastExecutableCandidate !== undefined) {
    const shellEnv = shellTask === undefined
      ? undefined
      : await waitForShellTask(
          shellTask,
          input.fastCandidateShellTimeoutMs ?? 2_000
        );
    const mergedEnv = { ...processEnv, ...shellEnv };
    const fastCandidate = await findRunnableCandidate(
      fastCandidates,
      mergedEnv,
      homeDir,
      platform,
      arch,
      input.candidateProbeTimeoutMs ?? DEFAULT_CANDIDATE_PROBE_TIMEOUT_MS
    );
    const shellCandidates: Array<{
      path: string;
      source: ResolvedCodexEnvironment['source'];
    }> = [];
    pushPathCandidates(
      shellCandidates,
      shellEnv?.PATH,
      platform,
      shellEnv?.PATHEXT ?? mergedEnv.PATHEXT,
      'login_shell'
    );
    if (fastCandidate === undefined) {
      const shellCandidate = await findRunnableCandidate(
        shellCandidates,
        mergedEnv,
        homeDir,
        platform,
        arch,
        input.candidateProbeTimeoutMs ?? DEFAULT_CANDIDATE_PROBE_TIMEOUT_MS
      );
      publishResolutionDiagnostics(input.onDiagnostics, {
        platform,
        homeDir,
        shell: loginShell,
        processEnv,
        shellEnv,
        candidates: [...fastCandidates, ...shellCandidates],
        selected: shellCandidate
      });
      return shellCandidate === undefined
        ? undefined
        : buildResolvedEnvironment(
            shellCandidate,
            mergedEnv,
            homeDir,
            platform,
            arch
          );
    }
    const shellCandidate = fastCandidate.source === 'common_path'
      ? await findRunnableCandidate(
          shellCandidates,
          mergedEnv,
          homeDir,
          platform,
          arch,
          input.candidateProbeTimeoutMs ?? DEFAULT_CANDIDATE_PROBE_TIMEOUT_MS
        )
      : undefined;
    const selectedCandidate = shellCandidate ?? fastCandidate;
    publishResolutionDiagnostics(input.onDiagnostics, {
      platform,
      homeDir,
      shell: loginShell,
      processEnv,
      shellEnv,
      candidates: [...fastCandidates, ...shellCandidates],
      selected: selectedCandidate
    });
    return buildResolvedEnvironment(
      selectedCandidate,
      mergedEnv,
      homeDir,
      platform,
      arch
    );
  }

  const shellEnv = shellTask === undefined
    ? undefined
    : await waitForShellTask(shellTask, input.shellTimeoutMs ?? 5_000);
  const mergedEnv = { ...processEnv, ...shellEnv };
  const candidates: Array<{
    path: string;
    source: ResolvedCodexEnvironment['source'];
  }> = [];
  pushPathCandidates(
    candidates,
    shellEnv?.PATH,
    platform,
    shellEnv?.PATHEXT ?? mergedEnv.PATHEXT,
    'login_shell'
  );
  for (const directory of commonExecutableDirectories(homeDir, platform, mergedEnv)) {
    for (const name of executableNames(platform, mergedEnv.PATHEXT)) {
      candidates.push({ path: join(directory, name), source: 'common_path' });
    }
  }

  const candidate = await findRunnableCandidate(
    candidates,
    mergedEnv,
    homeDir,
    platform,
    arch,
    input.candidateProbeTimeoutMs ?? DEFAULT_CANDIDATE_PROBE_TIMEOUT_MS
  );
  publishResolutionDiagnostics(input.onDiagnostics, {
    platform,
    homeDir,
    shell: loginShell,
    processEnv,
    shellEnv,
    candidates: [...fastCandidates, ...candidates],
    selected: candidate
  });
  return candidate === undefined
    ? undefined
    : buildResolvedEnvironment(candidate, mergedEnv, homeDir, platform, arch);
}

export async function readLoginShellEnvironment(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
} = {}): Promise<NodeJS.ProcessEnv> {
  const task = startLoginShellEnvironmentRead(input);
  const result = await task.result;
  return result ?? {};
}

export function startLoginShellEnvironmentRead(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  shell?: string;
  timeoutMs?: number;
} = {}): LoginShellEnvironmentTask {
  const platform = input.platform ?? process.platform;
  if (platform === 'win32') {
    return {
      result: Promise.resolve({}),
      cancel: async () => undefined
    };
  }
  const env = input.env ?? process.env;
  const shell = resolveLoginShell(env, platform, input.shell);
  const command = [
    `/usr/bin/printf '${ENV_START}\\0'`,
    '/usr/bin/env -0',
    `/usr/bin/printf '${ENV_END}\\0'`
  ].join('; ');
  let cancelWork = async () => undefined;
  const result = new Promise<NodeJS.ProcessEnv | undefined>((resolvePromise, reject) => {
    const child = spawn(shell, loginShellArguments(shell, command), {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let pendingError: Error | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let finalTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      if (finalTimer !== undefined) clearTimeout(finalTimer);
      if (error !== undefined) {
        reject(error);
        return;
      }
      try {
        resolvePromise(parseEnvironmentOutput(Buffer.concat(chunks).toString('utf8')));
      } catch (parseError) {
        reject(parseError);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_ENV_OUTPUT_BYTES) {
        terminate(new Error('Login shell environment output exceeded 1 MiB'));
        return;
      }
      chunks.push(chunk);
    });
    child.once('error', error => finish(error));
    child.once('exit', code => {
      if (pendingError !== undefined) {
        finish(pendingError);
        return;
      }
      if (code !== 0) {
        finish(new Error(`Login shell exited with code ${String(code)}`));
        return;
      }
      finish();
    });
    const timeout = setTimeout(() => {
      terminate(new Error(
        `Login shell environment timed out after ${input.timeoutMs ?? 5_000}ms`
      ));
    }, input.timeoutMs ?? 5_000);
    timeout.unref();

    const terminate = (error: Error) => {
      if (settled || pendingError !== undefined) return;
      pendingError = error;
      killProcessTree(child.pid, 'SIGTERM');
      forceKillTimer = setTimeout(() => {
        killProcessTree(child.pid, 'SIGKILL');
        finalTimer = setTimeout(() => finish(error), 500);
        finalTimer.unref();
      }, 250);
      forceKillTimer.unref();
    };
    cancelWork = async () => {
      terminate(new Error('Login shell environment read was canceled'));
      await result.catch(() => undefined);
    };
  });
  return {
    result,
    cancel: () => cancelWork()
  };
}

export function parseEnvironmentOutput(output: string): NodeJS.ProcessEnv {
  const parts = output.split('\0');
  const start = parts.indexOf(ENV_START);
  const end = parts.indexOf(ENV_END, start + 1);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Login shell environment markers were not found');
  }
  const env: NodeJS.ProcessEnv = {};
  for (const entry of parts.slice(start + 1, end)) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = entry.slice(separator + 1);
  }
  return env;
}

export function validateManualCodexPath(
  path: string,
  input: { homeDir?: string; platform?: NodeJS.Platform } = {}
): string | undefined {
  const platform = input.platform ?? process.platform;
  const normalized = normalizeCandidate(path, input.homeDir ?? homedir());
  for (const candidate of manualCodexCandidates(normalized, platform)) {
    if (isExecutable(candidate, platform)) return candidate;
  }
  return undefined;
}

export async function readWindowsWhereCandidates(input: {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
} = {}): Promise<string[]> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn('where.exe', ['codex'], {
      env: input.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolvePromise(parseWindowsWhereOutput(Buffer.concat(chunks).toString('utf8')));
    };
    child.stdout.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_ENV_OUTPUT_BYTES) {
        child.kill();
        finish(new Error('where.exe output exceeded 1 MiB'));
        return;
      }
      chunks.push(chunk);
    });
    child.once('error', error => finish(error));
    child.once('exit', code => {
      if (code !== 0) {
        finish(new Error(`where.exe exited with code ${String(code)}`));
        return;
      }
      finish();
    });
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error(`where.exe timed out after ${input.timeoutMs ?? 2_000}ms`));
    }, input.timeoutMs ?? 2_000);
    timeout.unref();
  });
}

export function parseWindowsWhereOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(value => value.length > 0 && win32Path.isAbsolute(value));
}

function resolveCodexHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configured = env.CODEX_HOME?.trim();
  if (configured === undefined || configured.length === 0) return join(homeDir, '.codex');
  return normalizeCandidate(configured, homeDir);
}

function pushCandidate(
  candidates: Array<{ path: string; source: ResolvedCodexEnvironment['source'] }>,
  path: string | undefined,
  source: ResolvedCodexEnvironment['source']
): void {
  if (path !== undefined && path.trim().length > 0) candidates.push({ path, source });
}

function pushPathCandidates(
  candidates: Array<{ path: string; source: ResolvedCodexEnvironment['source'] }>,
  pathValue: string | undefined,
  platform: NodeJS.Platform,
  pathExt: string | undefined,
  source: ResolvedCodexEnvironment['source']
): void {
  if (pathValue === undefined) return;
  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  for (const directory of pathValue.split(pathDelimiter).filter(Boolean)) {
    for (const name of executableNames(platform, pathExt)) {
      candidates.push({ path: join(directory, name), source });
    }
  }
}

function executableNames(platform: NodeJS.Platform, pathExt?: string): string[] {
  if (platform !== 'win32') return ['codex'];
  const extensions = (pathExt ?? '.EXE;.CMD;.BAT')
    .split(';')
    .filter(Boolean)
    .map(extension => extension.startsWith('.') ? extension : `.${extension}`);
  return ['codex', ...extensions.map(extension => `codex${extension.toLowerCase()}`)];
}

function commonExecutableDirectories(
  homeDir: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string[] {
  const npmPrefix = resolveUserConfiguredRoot(
    env.NPM_CONFIG_PREFIX ?? env.npm_config_prefix,
    homeDir
  );
  const pnpmHome = resolveUserConfiguredRoot(env.PNPM_HOME, homeDir);
  const vpHome = resolveUserConfiguredRoot(env.VP_HOME, homeDir);
  const voltaHome = resolveUserConfiguredRoot(env.VOLTA_HOME, homeDir);
  const asdfDataDir = resolveUserConfiguredRoot(env.ASDF_DATA_DIR, homeDir);
  const bunInstall = resolveUserConfiguredRoot(env.BUN_INSTALL, homeDir);
  const miseDataDir = resolveUserConfiguredRoot(env.MISE_DATA_DIR, homeDir)
    ?? join(homeDir, '.local', 'share', 'mise');
  if (platform === 'win32') {
    const fnmRoot = resolveUserConfiguredRoot(env.FNM_DIR, homeDir);
    const defaultFnmRoot = join(
      env.LOCALAPPDATA
        ?? env.APPDATA
        ?? join(homeDir, 'AppData', 'Roaming'),
      'fnm'
    );
    return unique([
      npmPrefix ?? '',
      npmPrefix === undefined ? '' : join(npmPrefix, 'bin'),
      pnpmHome ?? '',
      vpHome === undefined ? '' : join(vpHome, 'bin'),
      voltaHome === undefined ? '' : join(voltaHome, 'bin'),
      env.APPDATA === undefined ? '' : join(env.APPDATA, 'npm'),
      env.LOCALAPPDATA === undefined ? '' : join(env.LOCALAPPDATA, 'Programs'),
      join(homeDir, 'AppData', 'Roaming', 'npm'),
      join(homeDir, 'scoop', 'shims'),
      join(homeDir, '.local', 'bin'),
      ...versionedExecutableDirectories(
        join(fnmRoot ?? defaultFnmRoot, 'node-versions'),
        ['installation']
      )
    ].filter(value => value.length > 0));
  }
  const explicitToolchainDirs = [
    env.NVM_BIN,
    env.FNM_MULTISHELL_PATH,
    npmPrefix === undefined ? undefined : join(npmPrefix, 'bin'),
    pnpmHome,
    vpHome === undefined ? undefined : join(vpHome, 'bin'),
    voltaHome === undefined ? undefined : join(voltaHome, 'bin'),
    asdfDataDir === undefined ? undefined : join(asdfDataDir, 'shims'),
    bunInstall === undefined ? undefined : join(bunInstall, 'bin')
  ].flatMap(value => {
    const resolved = resolveUserConfiguredRoot(value, homeDir);
    return resolved === undefined ? [] : [resolved];
  });
  return unique([
    ...explicitToolchainDirs,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homeDir, '.local', 'bin'),
    join(homeDir, '.vite-plus', 'bin'),
    join(homeDir, '.local', 'node-current', 'bin'),
    join(homeDir, '.npm-global', 'bin'),
    join(homeDir, '.npm-packages', 'bin'),
    join(homeDir, '.volta', 'bin'),
    join(homeDir, '.asdf', 'shims'),
    join(miseDataDir, 'shims'),
    join(homeDir, '.mise', 'shims'),
    join(homeDir, '.local', 'share', 'pnpm'),
    join(homeDir, '.bun', 'bin'),
    join(homeDir, '.nodenv', 'shims'),
    join(homeDir, '.n', 'bin'),
    ...(platform === 'darwin' ? [join(homeDir, 'Library', 'pnpm')] : []),
    ...versionedExecutableDirectories(
      join(miseDataDir, 'installs', 'npm-openai-codex'),
      ['bin']
    ),
    ...versionedExecutableDirectories(
      join(homeDir, '.nvm', 'versions', 'node'),
      ['bin']
    ),
    ...versionedExecutableDirectories(
      join(homeDir, '.fnm', 'node-versions'),
      ['installation', 'bin']
    ),
    ...versionedExecutableDirectories(
      join(homeDir, '.local', 'share', 'fnm', 'node-versions'),
      ['installation', 'bin']
    ),
    ...versionedExecutableDirectories(
      join(homeDir, 'Library', 'Application Support', 'fnm', 'node-versions'),
      ['installation', 'bin']
    ),
    ...versionedExecutableDirectories(
      join(homeDir, '.asdf', 'installs', 'nodejs'),
      ['bin']
    ),
    ...versionedExecutableDirectories(
      join(miseDataDir, 'installs', 'node'),
      ['bin']
    ),
    ...versionedExecutableDirectories(
      join(homeDir, '.nodenv', 'versions'),
      ['bin']
    )
  ]);
}

function applicationBundleCodexCandidates(
  homeDir: string,
  platform: NodeJS.Platform,
  configuredRoots?: string[]
): string[] {
  if (platform !== 'darwin') return [];
  const applicationRoots = configuredRoots ?? [
    join(homeDir, 'Applications'),
    '/Applications'
  ];
  return unique(applicationRoots.flatMap(root => {
    const knownCandidates = [
      join(root, 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
      join(root, 'Codex.app', 'Contents', 'Resources', 'codex')
    ];
    try {
      const discoveredCandidates = readdirSync(root, { withFileTypes: true })
        .filter(entry => (
          (entry.isDirectory() || entry.isSymbolicLink())
          && entry.name.toLowerCase().endsWith('.app')
        ))
        .map(entry => join(root, entry.name, 'Contents', 'Resources', 'codex'))
        .filter(candidate => existsSync(candidate));
      return [...knownCandidates, ...discoveredCandidates];
    } catch {
      return knownCandidates;
    }
  }));
}

function configuredApplicationRoots(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform
): string[] | undefined {
  const configured = env.OPENCREATOR_CODEX_APPLICATION_ROOTS;
  if (configured === undefined) return undefined;
  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  return unique(configured
    .split(pathDelimiter)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => normalizeCandidate(value, homeDir)));
}

function manualCodexCandidates(
  selectedPath: string,
  platform: NodeJS.Platform
): string[] {
  if (platform !== 'darwin' || !isDirectory(selectedPath)) {
    return [selectedPath];
  }
  return unique([
    selectedPath,
    join(selectedPath, 'Contents', 'Resources', 'codex'),
    join(selectedPath, 'Resources', 'codex'),
    join(selectedPath, 'codex')
  ]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeCandidate(path: string, homeDir: string): string {
  const trimmed = path.trim();
  const expanded = trimmed === '~'
    ? homeDir
    : trimmed.startsWith('~/')
      ? join(homeDir, trimmed.slice(2))
      : trimmed;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(expanded);
}

function isExecutable(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return false;
    if (platform === 'win32') return true;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function findExecutableCandidate(
  candidates: Array<{
    path: string;
    source: ResolvedCodexEnvironment['source'];
  }>,
  homeDir: string,
  platform: NodeJS.Platform
): { path: string; source: ResolvedCodexEnvironment['source'] } | undefined {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate.path, homeDir);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (isExecutable(normalized, platform)) {
      return { path: normalized, source: candidate.source };
    }
  }
  return undefined;
}

async function findRunnableCandidate(
  candidates: Array<{
    path: string;
    source: ResolvedCodexEnvironment['source'];
  }>,
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  timeoutMs: number
): Promise<{ path: string; source: ResolvedCodexEnvironment['source'] } | undefined> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate.path, homeDir);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (!isExecutable(normalized, platform)) continue;
    if (platform === 'win32') {
      return { path: normalized, source: candidate.source };
    }
    const resolved = buildResolvedEnvironment(
      { path: normalized, source: candidate.source },
      env,
      homeDir,
      platform,
      arch
    );
    if (await canRunCodexVersion(resolved, timeoutMs)) {
      return { path: normalized, source: candidate.source };
    }
  }
  return undefined;
}

async function canRunCodexVersion(
  environment: ResolvedCodexEnvironment,
  timeoutMs: number
): Promise<boolean> {
  return await new Promise(resolvePromise => {
    let settled = false;
    const child = spawn(environment.codexBin, ['--version'], {
      cwd: environment.defaultCwd,
      env: environment.env,
      stdio: 'ignore',
      detached: true
    });
    const finish = (runnable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(runnable);
    };
    child.once('error', () => finish(false));
    child.once('exit', code => finish(code === 0));
    const timeout = setTimeout(() => {
      killProcessTree(child.pid, 'SIGTERM');
      finish(false);
    }, timeoutMs);
    timeout.unref();
  });
}

function buildResolvedEnvironment(
  candidate: { path: string; source: ResolvedCodexEnvironment['source'] },
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): ResolvedCodexEnvironment {
  const launch = resolveCodexLaunch(candidate.path, platform, arch);
  const resolvedEnv = withExecutableDirectories(
    env,
    [
      ...executableSearchDirectories(candidate.path),
      ...launch.pathEntries
    ],
    platform
  );
  return {
    codexBin: launch.path,
    codexHome: resolveCodexHome(resolvedEnv, homeDir),
    defaultCwd: homeDir,
    env: resolvedEnv,
    source: candidate.source
  };
}

function loginShellArguments(shell: string, command: string): string[] {
  const name = basename(shell).toLowerCase();
  if (name === 'fish') {
    return ['--interactive', '--login', '--command', command];
  }
  if (name === 'csh' || name === 'tcsh') {
    return ['-l', '-c', command];
  }
  return ['-i', '-l', '-c', command];
}

function resolveLoginShell(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  preferred?: string
): string {
  const configured = preferred?.trim() || env.SHELL?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  try {
    const accountShell = userInfo().shell?.trim();
    if (accountShell !== undefined && accountShell.length > 0) {
      return accountShell;
    }
  } catch {
    // Fall through to the platform default.
  }
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

function versionedExecutableDirectories(
  root: string,
  suffix: string[]
): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .sort((left, right) => compareVersionLikeNames(right.name, left.name))
      .map(entry => join(root, entry.name, ...suffix))
      .filter(path => existsSync(path));
  } catch {
    return [];
  }
}

function compareVersionLikeNames(left: string, right: string): number {
  const leftParts = parseVersionLikeName(left);
  const rightParts = parseVersionLikeName(right);
  if (leftParts !== undefined && rightParts !== undefined) {
    for (let index = 0; index < leftParts.length; index += 1) {
      const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
      if (delta !== 0) return delta;
    }
  }
  return left.localeCompare(right);
}

function parseVersionLikeName(value: string): [number, number, number] | undefined {
  const match = value.match(/^[^0-9]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (match === null) return undefined;
  return [
    Number(match[1] ?? 0),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0)
  ];
}

function resolveUserConfiguredRoot(
  value: string | undefined,
  homeDir: string
): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  if (normalized === '~') return homeDir;
  if (normalized.startsWith('~/') || normalized.startsWith('~\\')) {
    return join(homeDir, normalized.slice(2));
  }
  return isAbsolute(normalized) ? resolve(normalized) : undefined;
}

function resolveCodexLaunch(
  wrapperPath: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): { path: string; pathEntries: string[] } {
  const native = findCodexNativeBinary(wrapperPath, platform, arch);
  if (native === undefined) {
    return { path: wrapperPath, pathEntries: [] };
  }
  return {
    path: native.path,
    pathEntries: [dirname(native.path), ...native.pathEntries]
  };
}

function findCodexNativeBinary(
  wrapperPath: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): { path: string; pathEntries: string[] } | undefined {
  if (!looksLikeCodexNodeWrapper(wrapperPath)) return undefined;
  const packageSuffix = `${platform}-${arch}`;
  const targetTriple = codexNativeTargetTriple(platform, arch);
  for (const root of codexSearchRoots(wrapperPath)) {
    const scopedRoot = join(root, 'node_modules', '@openai');
    const packageDirs = [join(scopedRoot, `codex-${packageSuffix}`)];
    try {
      for (const entry of readdirSync(scopedRoot, { withFileTypes: true })) {
        if (
          (entry.isDirectory() || entry.isSymbolicLink())
          && entry.name.startsWith('codex-')
        ) {
          packageDirs.push(join(scopedRoot, entry.name));
        }
      }
    } catch {
      // Optional platform packages are not present under every ancestor.
    }
    for (const packageDir of unique(packageDirs)) {
      const vendorPath = join(packageDir, 'vendor', targetTriple, 'path');
      for (const candidate of codexNativeCandidates(packageDir, targetTriple)) {
        if (isExecutable(candidate, platform)) {
          return {
            path: candidate,
            pathEntries: existsSync(vendorPath) ? [vendorPath] : []
          };
        }
      }
    }
  }
  return undefined;
}

function codexSearchRoots(wrapperPath: string): string[] {
  const roots = new Set<string>();
  for (const seed of [wrapperPath, safeRealpath(wrapperPath)]) {
    if (seed === undefined) continue;
    let current = dirname(seed);
    while (true) {
      roots.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...roots];
}

function codexNativeCandidates(packageDir: string, targetTriple: string): string[] {
  return [
    join(packageDir, 'vendor', targetTriple, 'codex', 'codex'),
    join(packageDir, 'vendor', targetTriple, 'codex', 'codex.exe'),
    join(packageDir, 'codex'),
    join(packageDir, 'bin', 'codex'),
    join(packageDir, 'vendor', 'codex'),
    join(packageDir, 'codex.exe'),
    join(packageDir, 'bin', 'codex.exe')
  ];
}

function codexNativeTargetTriple(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): string {
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-musl';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-musl';
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  return `${platform}-${arch}`;
}

function looksLikeCodexNodeWrapper(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return /node|@openai\/codex|codex-/i.test(
      buffer.toString('utf8', 0, bytesRead)
    );
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The descriptor may already be closed after a failed read.
      }
    }
  }
}

function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function executableSearchDirectories(path: string): string[] {
  const directories = [dirname(path)];
  const seen = new Set<string>();
  let current = path;
  while (!seen.has(current)) {
    seen.add(current);
    try {
      if (!lstatSync(current).isSymbolicLink()) break;
      const target = readlinkSync(current);
      current = resolve(dirname(current), target);
      directories.push(dirname(current));
    } catch {
      break;
    }
  }
  return unique(directories);
}

function withExecutableDirectories(
  env: NodeJS.ProcessEnv,
  executableDirs: string[],
  platform: NodeJS.Platform
): NodeJS.ProcessEnv {
  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  const currentEntries = (env.PATH ?? '')
    .split(pathDelimiter)
    .filter(Boolean);
  const seen = new Set(currentEntries.map(entry => (
    platform === 'win32' ? entry.toLowerCase() : entry
  )));
  const missingExecutableDirs = executableDirs.filter(directory => {
    const normalized = platform === 'win32'
      ? directory.toLowerCase()
      : directory;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  return {
    ...env,
    PATH: [...missingExecutableDirs, ...currentEntries].join(pathDelimiter)
  };
}

function publishResolutionDiagnostics(
  listener: ((diagnostics: CodexResolutionDiagnostics) => void) | undefined,
  input: {
    platform: NodeJS.Platform;
    homeDir: string;
    shell?: string;
    processEnv: NodeJS.ProcessEnv;
    shellEnv?: NodeJS.ProcessEnv;
    candidates: Array<{
      path: string;
      source: ResolvedCodexEnvironment['source'];
    }>;
    selected?: {
      path: string;
      source: ResolvedCodexEnvironment['source'];
    };
  }
): void {
  if (listener === undefined) return;
  const pathDelimiter = input.platform === 'win32' ? ';' : delimiter;
  const seen = new Set<string>();
  const attemptedCandidates = input.candidates
    .map(candidate => ({
      path: normalizeCandidate(candidate.path, input.homeDir),
      source: candidate.source
    }))
    .filter(candidate => {
      if (seen.has(candidate.path)) return false;
      seen.add(candidate.path);
      return true;
    })
    .slice(0, 128);
  listener({
    platform: input.platform,
    homeDir: input.homeDir,
    ...(input.shell === undefined ? {} : { shell: input.shell }),
    processPathEntries: (input.processEnv.PATH ?? '')
      .split(pathDelimiter)
      .filter(Boolean),
    loginShellPathEntries: (input.shellEnv?.PATH ?? '')
      .split(pathDelimiter)
      .filter(Boolean),
    loginShellResolved: input.shellEnv !== undefined,
    attemptedCandidates,
    ...(input.selected === undefined
      ? {}
      : {
          selectedCodexBin: input.selected.path,
          selectedSource: input.selected.source
        })
  });
}

async function waitForShellTask(
  task: LoginShellEnvironmentTask,
  timeoutMs: number
): Promise<NodeJS.ProcessEnv | undefined> {
  const timeout = Symbol('timeout');
  const result = await Promise.race([
    task.result.catch(() => undefined),
    new Promise<typeof timeout>(resolvePromise => {
      const timer = setTimeout(() => resolvePromise(timeout), timeoutMs);
      timer.unref();
    })
  ]);
  if (result !== timeout) return result;
  await task.cancel();
  return undefined;
}

function killProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals
): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The login shell may already have exited.
    }
  }
}

export function executableDirectory(path: string): string {
  return dirname(path);
}
