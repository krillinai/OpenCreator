import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseCollectorInstaller,
  EnterpriseCollectorInstallError
} from '../../src/enterprise/collector-installer-2026-08-06.js';

const registration = {
  installCommand: "curl -fsSL 'http://enterprise/install.sh?code=secret' | sh",
  installPowershellCommand:
    "irm 'http://enterprise/install.ps1?code=secret' | iex"
};

describe('enterprise collector installer', () => {
  it('runs the Unix command once while an installation is active', async () => {
    const child = createChild();
    const spawn = vi.fn(() => child);
    const installer = createEnterpriseCollectorInstaller({
      platform: 'darwin',
      claweeAgentConfigPath: '.runtime/config.toml',
      spawn
    });

    const first = installer.install(registration);
    const second = installer.install(registration);

    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', registration.installCommand],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          CLAWEE_AGENT_CONFIG: resolve('.runtime/config.toml')
        }
      }
    );

    child.emit('close', 0, null);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('uses PowerShell on Windows without exposing command output', async () => {
    const child = createChild();
    const spawn = vi.fn(() => child);
    const installer = createEnterpriseCollectorInstaller({
      platform: 'win32',
      claweeAgentConfigPath: '.runtime/config.toml',
      spawn
    });

    const work = installer.install(registration);
    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        registration.installPowershellCommand
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          CLAWEE_AGENT_CONFIG: resolve('.runtime/config.toml')
        }
      }
    );

    child.emit('close', 0, null);
    await expect(work).resolves.toBeUndefined();
  });

  it('returns a sanitized failure code for non-zero exits', async () => {
    const child = createChild();
    const installer = createEnterpriseCollectorInstaller({
      platform: 'linux',
      spawn: () => child
    });

    const work = installer.install(registration);
    child.emit('close', 1, null);

    await expect(work).rejects.toEqual(
      new EnterpriseCollectorInstallError('COLLECTOR_INSTALL_FAILED')
    );
  });

  it('returns a sanitized failure code when the process cannot start', async () => {
    const installer = createEnterpriseCollectorInstaller({
      platform: 'linux',
      spawn: () => {
        throw new Error('secret command failed to start');
      }
    });

    await expect(installer.install(registration)).rejects.toEqual(
      new EnterpriseCollectorInstallError('COLLECTOR_INSTALL_FAILED')
    );
  });

  it('kills and rejects an installation that exceeds the timeout', async () => {
    vi.useFakeTimers();
    try {
      const child = createChild();
      const installer = createEnterpriseCollectorInstaller({
        platform: 'linux',
        timeoutMs: 100,
        spawn: () => child
      });

      const work = installer.install(registration);
      const rejection = expect(work).rejects.toEqual(
        new EnterpriseCollectorInstallError('COLLECTOR_INSTALL_TIMEOUT')
      );
      await vi.advanceTimersByTimeAsync(100);

      await rejection;
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects unsupported platforms before starting a process', async () => {
    const spawn = vi.fn(() => createChild());
    const installer = createEnterpriseCollectorInstaller({
      platform: 'freebsd',
      spawn
    });

    await expect(installer.install(registration)).rejects.toEqual(
      new EnterpriseCollectorInstallError('COLLECTOR_PLATFORM_UNSUPPORTED')
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('interrupts an active installation when the installer closes', async () => {
    const child = createChild();
    const installer = createEnterpriseCollectorInstaller({
      platform: 'linux',
      spawn: () => child
    });

    const work = installer.install(registration);
    const rejection = expect(work).rejects.toEqual(
      new EnterpriseCollectorInstallError('COLLECTOR_INSTALL_FAILED')
    );
    const closing = installer.close();
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit('close', null, 'SIGTERM');

    await rejection;
    await expect(closing).resolves.toBeUndefined();
  });
});

function createChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => true);
  return child;
}
