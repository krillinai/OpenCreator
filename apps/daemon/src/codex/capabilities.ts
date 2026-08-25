import {
  spawnCodexProcess,
  spawnCodexProcessSync,
  terminateCodexProcess
} from './process.js';

export type ExecHelpCapabilities = {
  supportsJson: boolean;
  supportsProfiles: boolean;
  supportsCd: boolean;
  supportsSandbox: boolean;
  supportsImages: boolean;
  supportsSkipGitRepoCheck: boolean;
};

export type RuntimeCapabilityMatrix = {
  codexVersion: string;
  checkedAt: string;
  execJson: boolean;
  execStdinPrompt: boolean;
  execProfile: boolean;
  execCwd: boolean;
  execSandbox: boolean;
  execSkipGitRepoCheck: boolean;
  resumeJson: boolean;
  resumeByThreadId: boolean;
  resumeLast: boolean;
  resumeModelOverride: boolean;
  resumeConfigOverride: boolean;
  resumeCwdOverride: boolean;
  resumeProfileOverride: boolean;
  resumeSandboxOverride: boolean;
  execImages: boolean;
  resumeImages: boolean;
  resumeContextContinuityVerified: boolean;
  appServer?: boolean;
  appServerApprovals?: boolean;
  knowledgeToolIsolation?: boolean;
  knowledgeBuiltInTools?: {
    shell: boolean;
    fileRead: boolean;
    fileWrite: boolean;
    applyPatch: boolean;
    webSearch: boolean;
  };
  mcpList: boolean;
  mcpGet: boolean;
  mcpAdd: boolean;
  mcpRemove: boolean;
  mcpLogin: boolean;
  mcpLogout: boolean;
  mcpAddEnv: boolean;
  mcpAddUrl: boolean;
  mcpAddBearerTokenEnvVar: boolean;
  mcpAddOAuth: boolean;
  mcpRuntimeDiscoveryVerified: boolean;
  mcpRuntimeBehaviorVerified: boolean;
  skillsScan: boolean;
  skillsInstall: boolean;
  skillsDelete: boolean;
  skillsGlobalWrite: boolean;
  skillsRuntimeDiscoveryVerified: boolean;
  skillsRuntimeBehaviorVerified: boolean;
  warnings: string[];
};

export type CollectCodexCapabilityMatrixInput = {
  codexBin?: string;
  checkedAt?: string;
  resumeContextContinuityVerified?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export const STARTUP_CAPABILITY_TIMEOUT_MS = 500;

export type CodexVersionProbeResult = {
  ready: boolean;
  version: string;
  warning?: string;
};

export function isReusableCapabilityMatrix(
  matrix: RuntimeCapabilityMatrix
): boolean {
  return typeof matrix.knowledgeToolIsolation === 'boolean'
    && matrix.knowledgeBuiltInTools !== undefined
    && Object.values(matrix.knowledgeBuiltInTools).every(value => typeof value === 'boolean');
}

export async function probeCodexVersionAsync(input: {
  codexBin: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<CodexVersionProbeResult> {
  const result = await runCodexInfoAsync(
    input.codexBin,
    ['--version'],
    input.timeoutMs ?? 3_000,
    input.signal
  );
  const version = result.output.trim().split(/\r?\n/)[0] ?? '';
  const warning = result.warnings[0];
  return {
    ready: warning === undefined && version.length > 0,
    version,
    ...(warning === undefined ? {} : { warning })
  };
}

export function parseCodexExecHelp(help: string): ExecHelpCapabilities {
  return {
    supportsJson: help.includes('--json'),
    supportsProfiles: help.includes('--profile') || help.includes('-p,'),
    supportsCd: help.includes('--cd') || help.includes('-C,'),
    supportsSandbox: help.includes('--sandbox'),
    supportsImages: help.includes('--image'),
    supportsSkipGitRepoCheck: help.includes('--skip-git-repo-check')
  };
}

function hasMcpCommand(help: string, command: string): boolean {
  const commandPattern = new RegExp(`^\\s*${command}\\b`);
  let inCommandsSection = false;

  for (const line of help.split(/\r?\n/)) {
    if (/^\s*Commands:\s*$/.test(line)) {
      inCommandsSection = true;
      continue;
    }
    if (!inCommandsSection || line.trim() === '') continue;
    if (commandPattern.test(line)) return true;
    if (/^\S/.test(line)) break;
  }

  return false;
}

export function parseCodexCapabilityMatrix(input: {
  versionOutput: string;
  execHelp: string;
  resumeHelp: string;
  mcpHelp: string;
  mcpAddHelp: string;
  appServerHelp?: string;
  featuresOutput?: string;
  resumeContextContinuityVerified?: boolean;
  checkedAt?: string;
}): RuntimeCapabilityMatrix {
  const exec = parseCodexExecHelp(input.execHelp);
  const knowledgeBuiltInTools = knowledgeBuiltInToolCapabilities(
    input.execHelp,
    input.appServerHelp ?? '',
    input.featuresOutput ?? ''
  );

  return {
    codexVersion: normalizeCodexVersionOutput(input.versionOutput),
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    execJson: exec.supportsJson,
    execStdinPrompt: input.execHelp.includes('[PROMPT]') || input.execHelp.includes('PROMPT'),
    execProfile: exec.supportsProfiles,
    execCwd: exec.supportsCd,
    execSandbox: exec.supportsSandbox,
    execSkipGitRepoCheck: exec.supportsSkipGitRepoCheck,
    resumeJson: input.resumeHelp.includes('--json'),
    resumeByThreadId:
      input.resumeHelp.includes('[SESSION_ID]') || input.resumeHelp.includes('SESSION_ID'),
    resumeLast: input.resumeHelp.includes('--last'),
    resumeModelOverride: input.resumeHelp.includes('--model') || input.resumeHelp.includes('-m,'),
    resumeConfigOverride:
      input.resumeHelp.includes('--config') || input.resumeHelp.includes('-c,'),
    resumeCwdOverride: input.resumeHelp.includes('--cd') || input.resumeHelp.includes('-C,'),
    resumeProfileOverride:
      input.resumeHelp.includes('--profile') || input.resumeHelp.includes('-p,'),
    resumeSandboxOverride: input.resumeHelp.includes('--sandbox'),
    execImages: exec.supportsImages,
    resumeImages: input.resumeHelp.includes('--image') || input.resumeHelp.includes('-i,'),
    resumeContextContinuityVerified: input.resumeContextContinuityVerified ?? false,
    appServer: input.appServerHelp?.includes('Run the app server') ?? false,
    appServerApprovals:
      input.appServerHelp?.includes('generate-json-schema')
      && input.appServerHelp.includes('generate-ts'),
    knowledgeBuiltInTools,
    knowledgeToolIsolation: Object.values(knowledgeBuiltInTools).every(Boolean),
    mcpList: hasMcpCommand(input.mcpHelp, 'list'),
    mcpGet: hasMcpCommand(input.mcpHelp, 'get'),
    mcpAdd: hasMcpCommand(input.mcpHelp, 'add'),
    mcpRemove: hasMcpCommand(input.mcpHelp, 'remove'),
    mcpLogin: hasMcpCommand(input.mcpHelp, 'login'),
    mcpLogout: hasMcpCommand(input.mcpHelp, 'logout'),
    mcpAddEnv: input.mcpAddHelp.includes('--env'),
    mcpAddUrl: input.mcpAddHelp.includes('--url'),
    mcpAddBearerTokenEnvVar: input.mcpAddHelp.includes('--bearer-token-env-var'),
    mcpAddOAuth:
      input.mcpAddHelp.includes('--oauth-client-id') &&
      input.mcpAddHelp.includes('--oauth-resource'),
    mcpRuntimeDiscoveryVerified: false,
    mcpRuntimeBehaviorVerified: false,
    skillsScan: false,
    skillsInstall: false,
    skillsDelete: false,
    skillsGlobalWrite: false,
    skillsRuntimeDiscoveryVerified: false,
    skillsRuntimeBehaviorVerified: false,
    warnings: []
  };
}

export function normalizeCodexVersionOutput(output: string): string {
  const versionLine = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => /^codex-cli\s+\S+$/.test(line));
  return versionLine ?? output.trim();
}

export function collectCodexCapabilityMatrix(
  input: CollectCodexCapabilityMatrixInput = {}
): RuntimeCapabilityMatrix {
  const codexBin = input.codexBin ?? 'codex';
  const version = runCodexInfo(codexBin, ['--version'], input.timeoutMs);
  const execHelp = runCodexInfo(codexBin, ['exec', '--help'], input.timeoutMs);
  const resumeHelp = runCodexInfo(codexBin, ['exec', 'resume', '--help'], input.timeoutMs);
  const mcpHelp = runCodexInfo(codexBin, ['mcp', '--help'], input.timeoutMs);
  const mcpAddHelp = runCodexInfo(codexBin, ['mcp', 'add', '--help'], input.timeoutMs);
  const appServerHelp = runCodexInfo(codexBin, ['app-server', '--help'], input.timeoutMs);
  const features = runCodexInfo(codexBin, ['features', 'list'], input.timeoutMs);

  const matrix = parseCodexCapabilityMatrix({
    versionOutput: version.output.trim() || 'unknown',
    execHelp: execHelp.output,
    resumeHelp: resumeHelp.output,
    mcpHelp: mcpHelp.output,
    mcpAddHelp: mcpAddHelp.output,
    appServerHelp: appServerHelp.output,
    featuresOutput: features.output,
    resumeContextContinuityVerified: input.resumeContextContinuityVerified,
    checkedAt: input.checkedAt
  });

  matrix.warnings.push(
    ...version.warnings,
    ...execHelp.warnings,
    ...resumeHelp.warnings,
    ...mcpHelp.warnings,
    ...mcpAddHelp.warnings,
    ...appServerHelp.warnings,
    ...features.warnings
  );
  if (!isResumeExecutionSupported(matrix)) {
    matrix.warnings.push('Codex resume execution support was not verified from help output.');
  }

  return matrix;
}

export async function collectCodexCapabilityMatrixAsync(
  input: CollectCodexCapabilityMatrixInput = {}
): Promise<RuntimeCapabilityMatrix> {
  const codexBin = input.codexBin ?? 'codex';
  const [
    version,
    execHelp,
    resumeHelp,
    mcpHelp,
    mcpAddHelp,
    appServerHelp,
    features
  ] = await Promise.all([
    runCodexInfoAsync(codexBin, ['--version'], input.timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['exec', '--help'], input.timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['exec', 'resume', '--help'], input.timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['mcp', '--help'], input.timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['mcp', 'add', '--help'], input.timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['app-server', '--help'], input.timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['features', 'list'], input.timeoutMs, input.signal)
  ]);

  const matrix = parseCodexCapabilityMatrix({
    versionOutput: version.output.trim() || 'unknown',
    execHelp: execHelp.output,
    resumeHelp: resumeHelp.output,
    mcpHelp: mcpHelp.output,
    mcpAddHelp: mcpAddHelp.output,
    appServerHelp: appServerHelp.output,
    featuresOutput: features.output,
    resumeContextContinuityVerified: input.resumeContextContinuityVerified,
    checkedAt: input.checkedAt
  });
  matrix.warnings.push(
    ...version.warnings,
    ...execHelp.warnings,
    ...resumeHelp.warnings,
    ...mcpHelp.warnings,
    ...mcpAddHelp.warnings,
    ...appServerHelp.warnings,
    ...features.warnings
  );
  if (!isResumeExecutionSupported(matrix)) {
    matrix.warnings.push('Codex resume execution support was not verified from help output.');
  }
  return matrix;
}

export async function collectStartupCapabilityMatrixAsync(
  input: CollectCodexCapabilityMatrixInput = {}
): Promise<RuntimeCapabilityMatrix> {
  const codexBin = input.codexBin ?? 'codex';
  const timeoutMs = input.timeoutMs ?? STARTUP_CAPABILITY_TIMEOUT_MS;
  const [version, execHelp, resumeHelp, appServerHelp, features] = await Promise.all([
    runCodexInfoAsync(codexBin, ['--version'], timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['exec', '--help'], timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['exec', 'resume', '--help'], timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['app-server', '--help'], timeoutMs, input.signal),
    runCodexInfoAsync(codexBin, ['features', 'list'], timeoutMs, input.signal)
  ]);
  const matrix = parseCodexCapabilityMatrix({
    versionOutput: version.output.trim() || 'unknown',
    execHelp: execHelp.output,
    resumeHelp: resumeHelp.output,
    mcpHelp: '',
    mcpAddHelp: '',
    appServerHelp: appServerHelp.output,
    featuresOutput: features.output,
    checkedAt: input.checkedAt
  });
  matrix.warnings.push(
    ...version.warnings,
    ...execHelp.warnings,
    ...resumeHelp.warnings,
    ...appServerHelp.warnings,
    ...features.warnings
  );
  return matrix;
}

function knowledgeBuiltInToolCapabilities(
  execHelp: string,
  appServerHelp: string,
  featuresOutput: string
): NonNullable<RuntimeCapabilityMatrix['knowledgeBuiltInTools']> {
  const required = [
    'shell_tool',
    'unified_exec',
    'shell_snapshot',
    'browser_use',
    'computer_use',
    'in_app_browser',
    'image_generation',
    'multi_agent',
    'plugins',
    'apps'
  ];
  const isolationBase = execHelp.includes('--ignore-user-config')
    && appServerHelp.includes('--disable')
    && required.every(name => new RegExp(`^${name}\\s+`, 'm').test(featuresOutput));
  const shell = isolationBase
    && ['shell_tool', 'unified_exec', 'shell_snapshot'].every(name => (
      new RegExp(`^${name}\\s+`, 'm').test(featuresOutput)
    ));
  return {
    shell,
    fileRead: shell,
    fileWrite: shell,
    applyPatch: shell,
    webSearch: isolationBase
  };
}

export function isResumeExecutionSupported(matrix: RuntimeCapabilityMatrix): boolean {
  return matrix.resumeJson && matrix.resumeByThreadId;
}

export function withRuntimeSkillCapabilities(
  matrix: RuntimeCapabilityMatrix
): RuntimeCapabilityMatrix {
  Object.assign(matrix, {
    skillsScan: true,
    skillsInstall: true,
    skillsDelete: true,
    skillsGlobalWrite: true
  });
  return matrix;
}

export function applyCapabilityMatrix(
  target: RuntimeCapabilityMatrix,
  source: RuntimeCapabilityMatrix
): RuntimeCapabilityMatrix {
  Object.assign(target, source);
  return target;
}

export function createUnknownCapabilityMatrix(
  checkedAt = new Date().toISOString()
): RuntimeCapabilityMatrix {
  return {
    codexVersion: 'unknown',
    checkedAt,
    execJson: false,
    execStdinPrompt: false,
    execProfile: false,
    execCwd: false,
    execSandbox: false,
    execSkipGitRepoCheck: false,
    resumeJson: false,
    resumeByThreadId: false,
    resumeLast: false,
    resumeModelOverride: false,
    resumeConfigOverride: false,
    resumeCwdOverride: false,
    resumeProfileOverride: false,
    resumeSandboxOverride: false,
    execImages: false,
    resumeImages: false,
    resumeContextContinuityVerified: false,
    knowledgeToolIsolation: false,
    knowledgeBuiltInTools: {
      shell: false,
      fileRead: false,
      fileWrite: false,
      applyPatch: false,
      webSearch: false
    },
    mcpList: false,
    mcpGet: false,
    mcpAdd: false,
    mcpRemove: false,
    mcpLogin: false,
    mcpLogout: false,
    mcpAddEnv: false,
    mcpAddUrl: false,
    mcpAddBearerTokenEnvVar: false,
    mcpAddOAuth: false,
    mcpRuntimeDiscoveryVerified: false,
    mcpRuntimeBehaviorVerified: false,
    skillsScan: false,
    skillsInstall: false,
    skillsDelete: false,
    skillsGlobalWrite: false,
    skillsRuntimeDiscoveryVerified: false,
    skillsRuntimeBehaviorVerified: false,
    warnings: ['Codex runtime help has not been collected yet.']
  };
}

function runCodexInfo(
  codexBin: string,
  args: string[],
  timeoutMs = 5_000
): { output: string; warnings: string[] } {
  const result = spawnCodexProcessSync(codexBin, args, {
    encoding: 'utf8',
    timeout: timeoutMs
  });
  const command = [codexBin, ...args].join(' ');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const warnings: string[] = [];

  if (result.error != null) {
    warnings.push(`${command} failed: ${result.error.message}`);
  } else if (result.status !== 0) {
    warnings.push(`${command} exited with code ${result.status}`);
  }

  return { output, warnings };
}

function runCodexInfoAsync(
  codexBin: string,
  args: string[],
  timeoutMs = 5_000,
  signal?: AbortSignal
): Promise<{ output: string; warnings: string[] }> {
  return new Promise(resolve => {
    const command = [codexBin, ...args].join(' ');
    let output = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const child = spawnCodexProcess(codexBin, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const finish = (warnings: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ output, warnings });
    };
    const append = (chunk: Buffer | string) => {
      if (output.length >= 512 * 1024) return;
      output += chunk.toString().slice(0, 512 * 1024 - output.length);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', error => {
      finish([`${command} failed: ${error.message}`]);
    });
    child.once('exit', code => {
      if (aborted) {
        finish([`${command} canceled`]);
        return;
      }
      if (timedOut) {
        finish([`${command} timed out after ${timeoutMs}ms`]);
        return;
      }
      finish(code === 0 ? [] : [`${command} exited with code ${String(code)}`]);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminateCodexProcess(child, 'SIGTERM');
      const forceKill = setTimeout(() => {
        if (!settled) terminateCodexProcess(child, 'SIGKILL');
      }, 500);
      forceKill.unref();
    }, timeoutMs);
    timer.unref();
    const abort = () => {
      aborted = true;
      void terminateCodexProcess(child, 'SIGTERM');
    };
    if (signal?.aborted === true) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
