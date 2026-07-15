import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export type CodexSkillSourceInstallInput = {
  repository: string;
  skillPath: string;
  ref: string;
  skillId: string;
  workDir: string;
};

export type CodexSkillSourceInstaller = {
  install(input: CodexSkillSourceInstallInput): Promise<string>;
};

export type SkillInstallerProcessRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Promise<void>;

const execFileAsync = promisify(execFile);
const installerScriptRelativePath = join(
  'skills',
  '.system',
  'skill-installer',
  'scripts',
  'install-skill-from-github.py'
);

export function createCodexSkillSourceInstaller(input: {
  codexHome: string;
  scriptPath?: string;
  pythonBin?: string;
  sslCertFile?: string;
  runProcess?: SkillInstallerProcessRunner;
}): CodexSkillSourceInstaller {
  const scriptPath = resolve(
    input.scriptPath ?? join(input.codexHome, installerScriptRelativePath)
  );
  const pythonBin = input.pythonBin ?? 'python3';
  const runProcess = input.runProcess ?? runInstallerProcess;
  const sslCertFile =
    input.sslCertFile ??
    (input.runProcess === undefined ? resolvePythonSslCertFile(pythonBin) : process.env.SSL_CERT_FILE);

  return {
    async install(request) {
      if (!existsSync(scriptPath)) {
        throw new Error(
          `CODEX_SKILL_MARKET_INSTALL_FAILED: Codex Skill Installer script not found: ${scriptPath}`
        );
      }

      const workDir = resolve(request.workDir);
      mkdirSync(workDir, { recursive: true });
      try {
        await runProcess(
          pythonBin,
          [
            scriptPath,
            '--repo',
            request.repository,
            '--path',
            request.skillPath,
            '--ref',
            request.ref,
            '--name',
            request.skillId,
            '--dest',
            workDir,
            '--method',
            'download',
          ],
          {
            cwd: workDir,
            env: {
              ...process.env,
              CODEX_HOME: input.codexHome,
              ...(sslCertFile ? { SSL_CERT_FILE: sslCertFile } : {}),
            },
          }
        );
      } catch (error) {
        throw wrapSkillInstallerError(error);
      }

      const sourcePath = join(workDir, request.skillId);
      if (!existsSync(join(sourcePath, 'SKILL.md'))) {
        throw new Error(
          `CODEX_SKILL_MARKET_INSTALL_FAILED: Codex Skill Installer did not create ${sourcePath}`
        );
      }
      return sourcePath;
    },
  };
}

function resolvePythonSslCertFile(pythonBin: string): string | undefined {
  const configured = process.env.SSL_CERT_FILE?.trim();
  if (configured && existsSync(configured)) return configured;

  try {
    const resolved = execFileSync(
      pythonBin,
      ['-c', 'import certifi; print(certifi.where())'],
      { encoding: 'utf8', timeout: 5_000 }
    ).trim();
    return resolved.length > 0 && existsSync(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function runInstallerProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<void> {
  await execFileAsync(command, args, {
    ...options,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
}

function wrapSkillInstallerError(error: unknown): Error {
  if (
    error instanceof Error &&
    error.message.startsWith('CODEX_SKILL_MARKET_INSTALL_FAILED:')
  ) {
    return error;
  }

  const stderr = readErrorOutput(error, 'stderr')
    .replace(/^Error:\s*/i, '')
    .trim();
  const detail =
    stderr ||
    (error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : String(error));
  return new Error(`CODEX_SKILL_MARKET_INSTALL_FAILED: ${detail}`, {
    cause: error,
  });
}

function readErrorOutput(error: unknown, key: string): string {
  if (typeof error !== 'object' || error === null || !(key in error)) return '';
  const output = (error as Record<string, unknown>)[key];
  if (typeof output === 'string') return output;
  if (output instanceof Uint8Array) return Buffer.from(output).toString('utf8');
  return '';
}
