import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import type { RuntimeErrorCode } from '@opencreator/protocol';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;
const VALID_SOURCES = new Set(['self', 'licensed', 'cc', 'rework', 'unknown']);
const PUBLISH_TARGETS = new Set(['manual', 'bilibili', 'youtube', 'tiktok']);

export type ChannelCommandResult = {
  command: readonly string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type ChannelHealth = {
  repoPath: string | null;
  repoConfigured: boolean;
  repoAvailable: boolean;
  pyprojectPresent: boolean;
  uvAvailable: boolean;
  uvVersion: string | null;
};

export type ChannelIngestRequest = {
  url?: string;
  inbox?: boolean;
  source?: 'self' | 'licensed' | 'cc' | 'rework' | 'unknown';
};

export type ChannelProcessRequest = {
  jobId?: string;
};

export type ChannelPublishRequest = {
  jobId: string;
  targets: Array<'manual' | 'bilibili' | 'youtube' | 'tiktok'>;
  force?: boolean;
};

export type ChannelSpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export type ChannelPipelineService = ReturnType<typeof createChannelPipelineService>;

export class ChannelPipelineError extends Error {
  constructor(
    readonly code: Extract<RuntimeErrorCode,
      | 'VALIDATION_FAILED'
      | 'CHANNEL_REPO_NOT_CONFIGURED'
      | 'CHANNEL_REPO_UNAVAILABLE'
      | 'CHANNEL_COMMAND_FAILED'
      | 'CHANNEL_TIMEOUT'>,
    message: string,
    readonly statusCode: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ChannelPipelineError';
  }
}

export function createChannelPipelineService(input: {
  repoPath?: string;
  timeoutMs?: number;
  spawnImpl?: ChannelSpawnFunction;
}) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnImpl = input.spawnImpl ?? (crossSpawn as ChannelSpawnFunction);

  function repoPath(): string | null {
    const configured = input.repoPath
      ?? process.env.OPENCREATOR_CHANNEL_REPO
      ?? process.env.CHANNEL_REPO;
    return configured === undefined || configured.trim().length === 0
      ? null
      : resolve(configured);
  }

  function assertRepo(): string {
    const path = repoPath();
    if (path === null) {
      throw new ChannelPipelineError(
        'CHANNEL_REPO_NOT_CONFIGURED',
        'Set OPENCREATOR_CHANNEL_REPO or CHANNEL_REPO to the Channel checkout root',
        409
      );
    }
    if (!existsSync(path) || !existsSync(join(path, 'pyproject.toml'))) {
      throw new ChannelPipelineError(
        'CHANNEL_REPO_UNAVAILABLE',
        'Channel repo path does not contain pyproject.toml',
        500,
        { repoPath: path }
      );
    }
    return path;
  }

  function pipelineArgs(args: readonly string[]): string[] {
    return ['run', '--no-sync', 'pipeline', ...args];
  }

  function run(cwd: string, args: readonly string[]): Promise<ChannelCommandResult> {
    return new Promise((resolvePromise, reject) => {
      const command = ['uv', ...args];
      const child = spawnImpl(command[0]!, command.slice(1), {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8'
        }
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', chunk => {
        stdout += chunk;
        stdout = stdout.slice(-MAX_OUTPUT_BYTES);
      });
      child.stderr?.on('data', chunk => {
        stderr += chunk;
        stderr = stderr.slice(-MAX_OUTPUT_BYTES);
      });
      child.once('error', error => {
        finish(() => reject(new ChannelPipelineError(
          'CHANNEL_COMMAND_FAILED',
          error instanceof Error ? error.message : 'Failed to start the Channel CLI',
          502,
          { command, cwd }
        )));
      });
      child.once('close', (exitCode, signal) => {
        finish(() => {
          if (timedOut) {
            reject(new ChannelPipelineError(
              'CHANNEL_TIMEOUT',
              'The Channel CLI command timed out',
              504,
              { command, cwd, timeoutMs }
            ));
            return;
          }
          resolvePromise({
            command,
            cwd,
            exitCode,
            signal,
            stdout,
            stderr,
            timedOut
          });
        });
      });
    });
  }

  return {
    repoPath,
    async health(): Promise<ChannelHealth> {
      const path = repoPath();
      const repoAvailable = path !== null && existsSync(path);
      const pyprojectPresent = path !== null && existsSync(join(path, 'pyproject.toml'));
      let uvAvailable = false;
      let uvVersion: string | null = null;
      await new Promise<void>(resolvePromise => {
        const child = spawnImpl('uv', ['--version'], {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', chunk => {
          output += chunk;
        });
        child.once('error', () => resolvePromise());
        child.once('close', code => {
          uvAvailable = code === 0;
          uvVersion = output.trim().length > 0 ? output.trim() : null;
          resolvePromise();
        });
      });
      return {
        repoPath: path,
        repoConfigured: path !== null,
        repoAvailable,
        pyprojectPresent,
        uvAvailable,
        uvVersion
      };
    },
    async status(): Promise<ChannelCommandResult> {
      const cwd = assertRepo();
      return run(cwd, pipelineArgs(['status']));
    },
    async ingest(request: ChannelIngestRequest): Promise<ChannelCommandResult> {
      const cwd = assertRepo();
      const source = request.source ?? 'unknown';
      if (!VALID_SOURCES.has(source)) {
        throw new ChannelPipelineError(
          'VALIDATION_FAILED',
          'source must be self, licensed, cc, rework, or unknown',
          400
        );
      }
      const args = ['ingest'];
      if (request.inbox === true) {
        if (request.url !== undefined && request.url.trim().length > 0) {
          throw new ChannelPipelineError(
            'VALIDATION_FAILED',
            'url and inbox are mutually exclusive',
            400
          );
        }
        args.push('--inbox');
      } else {
        const url = request.url?.trim();
        if (url === undefined || url.length === 0) {
          throw new ChannelPipelineError(
            'VALIDATION_FAILED',
            'url is required when inbox is not true',
            400
          );
        }
        args.push('--url', url);
      }
      args.push('--source', source);
      return run(cwd, pipelineArgs(args));
    },
    async process(request: ChannelProcessRequest): Promise<ChannelCommandResult> {
      const cwd = assertRepo();
      const args = ['process'];
      if (request.jobId !== undefined) {
        validateJobId(request.jobId);
        args.push(request.jobId);
      }
      return run(cwd, pipelineArgs(args));
    },
    async publish(request: ChannelPublishRequest): Promise<ChannelCommandResult> {
      const cwd = assertRepo();
      validateJobId(request.jobId);
      if (!Array.isArray(request.targets) || request.targets.length === 0) {
        throw new ChannelPipelineError(
          'VALIDATION_FAILED',
          'targets must contain at least one platform',
          400
        );
      }
      const invalidTargets = request.targets.filter(target => !PUBLISH_TARGETS.has(target));
      if (invalidTargets.length > 0) {
        throw new ChannelPipelineError(
          'VALIDATION_FAILED',
          'targets contain an unsupported platform',
          400,
          { invalidTargets }
        );
      }
      const args = ['publish', request.jobId, '--to', request.targets.join(',')];
      if (request.force === true) args.push('--force');
      return run(cwd, pipelineArgs(args));
    }
  };
}

function validateJobId(jobId: string): void {
  if (!SAFE_JOB_ID.test(jobId)) {
    throw new ChannelPipelineError(
      'VALIDATION_FAILED',
      'jobId contains unsupported characters',
      400
    );
  }
}
