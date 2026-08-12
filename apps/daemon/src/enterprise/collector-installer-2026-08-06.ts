import {
  spawn,
  type ChildProcess,
  type SpawnOptions
} from 'node:child_process';
import { resolve } from 'node:path';
import type {
  EnterpriseCollectorRegistration
} from './http-client-2026-07-30.js';

export type EnterpriseCollectorInstallErrorCode =
  | 'COLLECTOR_INSTALL_FAILED'
  | 'COLLECTOR_INSTALL_TIMEOUT'
  | 'COLLECTOR_PLATFORM_UNSUPPORTED';

export class EnterpriseCollectorInstallError extends Error {
  constructor(readonly code: EnterpriseCollectorInstallErrorCode) {
    super(`${code}: collector installation failed`);
    this.name = 'EnterpriseCollectorInstallError';
  }
}

export type EnterpriseCollectorInstaller = {
  install(registration: EnterpriseCollectorRegistration): Promise<void>;
  close(): Promise<void>;
};

export function createEnterpriseCollectorInstaller(input: {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  claweeAgentConfigPath?: string;
  spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => ChildProcess;
} = {}): EnterpriseCollectorInstaller {
  const platform = input.platform ?? process.platform;
  const timeoutMs = input.timeoutMs ?? 5 * 60_000;
  const spawnProcess = input.spawn ?? spawn;
  const claweeAgentConfigPath = input.claweeAgentConfigPath === undefined
    ? undefined
    : resolve(input.claweeAgentConfigPath);
  let active:
    | {
        child: ChildProcess;
        work: Promise<void>;
      }
    | undefined;

  async function install(
    registration: EnterpriseCollectorRegistration
  ): Promise<void> {
    if (active !== undefined) return active.work;

    const invocation = resolveInvocation(platform, registration);
    let child: ChildProcess;
    try {
      child = spawnProcess(invocation.command, invocation.args, {
        stdio: 'ignore',
        windowsHide: true,
        ...(claweeAgentConfigPath === undefined
          ? {}
          : {
              env: {
                ...process.env,
                CLAWEE_AGENT_CONFIG: claweeAgentConfigPath
              }
            })
      });
    } catch {
      throw new EnterpriseCollectorInstallError('COLLECTOR_INSTALL_FAILED');
    }

    const work = waitForChild(child, timeoutMs).finally(() => {
      if (active?.child === child) active = undefined;
    });
    active = { child, work };
    return work;
  }

  return {
    install,

    async close() {
      const current = active;
      if (current === undefined) return;
      current.child.kill();
      try {
        await current.work;
      } catch {
        // Closing the Daemon intentionally interrupts an active installer.
      }
    }
  };
}

function resolveInvocation(
  platform: NodeJS.Platform,
  registration: EnterpriseCollectorRegistration
): { command: string; args: string[] } {
  if (platform === 'darwin' || platform === 'linux') {
    return {
      command: '/bin/sh',
      args: ['-c', registration.installCommand]
    };
  }
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        registration.installPowershellCommand
      ]
    };
  }
  throw new EnterpriseCollectorInstallError(
    'COLLECTOR_PLATFORM_UNSUPPORTED'
  );
}

function waitForChild(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new EnterpriseCollectorInstallError('COLLECTOR_INSTALL_TIMEOUT')
      );
    }, timeoutMs);

    const finish = (error?: EnterpriseCollectorInstallError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error === undefined) resolve();
      else reject(error);
    };

    child.once('error', () => {
      finish(new EnterpriseCollectorInstallError('COLLECTOR_INSTALL_FAILED'));
    });
    child.once('close', code => {
      finish(
        code === 0
          ? undefined
          : new EnterpriseCollectorInstallError('COLLECTOR_INSTALL_FAILED')
      );
    });
  });
}
