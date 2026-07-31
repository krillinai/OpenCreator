import { describe, expect, it } from 'vitest';
import {
  buildDaemonEnvironment,
  type DaemonStartInput
} from '../src/main/daemon-manager.js';

const runId = '123e4567-e89b-42d3-a456-426614174000';

describe('Daemon enterprise environment', () => {
  it('removes inherited enterprise identity and writes only typed values', () => {
    const environment = buildDaemonEnvironment(createInput({
      env: {
        PATH: '/usr/bin',
        CLAWEE_ENTERPRISE_ORIGIN: 'https://untrusted.example',
        CLAWEE_ENTERPRISE_E2E_RUN_ID:
          '223e4567-e89b-42d3-a456-426614174000',
        CLAWEE_ENTERPRISE_E2E_AUTHORIZED: 'untrusted',
        CLAWEE_ENTERPRISE_KEYRING_SERVICE: 'attacker-service',
        CLAWEE_ENTERPRISE_KEYRING_ACCOUNT: 'attacker-account',
        clawee_enterprise_keyring_account: 'lowercase-attacker-account'
      },
      enterpriseOrigin: 'http://127.0.0.1:1904',
      enterpriseE2ERunId: runId
    }));

    expect(environment).toMatchObject({
      PATH: '/usr/bin',
      CLAWEE_ENTERPRISE_ORIGIN: 'http://127.0.0.1:1904',
      CLAWEE_ENTERPRISE_E2E_RUN_ID: runId,
      CLAWEE_ENTERPRISE_E2E_AUTHORIZED: 'packaged-app'
    });
    expect(environment.CLAWEE_ENTERPRISE_KEYRING_SERVICE).toBeUndefined();
    expect(environment.CLAWEE_ENTERPRISE_KEYRING_ACCOUNT).toBeUndefined();
    expect(environment.clawee_enterprise_keyring_account).toBeUndefined();
  });

  it('does not pass enterprise overrides during an ordinary launch', () => {
    const environment = buildDaemonEnvironment(createInput({
      env: {
        CLAWEE_ENTERPRISE_ORIGIN: 'http://127.0.0.1:1904',
        CLAWEE_ENTERPRISE_E2E_RUN_ID: runId,
        CLAWEE_ENTERPRISE_E2E_AUTHORIZED: 'packaged-app',
        CLAWEE_ENTERPRISE_KEYRING_SERVICE: 'service',
        CLAWEE_ENTERPRISE_KEYRING_ACCOUNT: 'account'
      }
    }));

    expect(environment.CLAWEE_ENTERPRISE_ORIGIN).toBeUndefined();
    expect(environment.CLAWEE_ENTERPRISE_E2E_RUN_ID).toBeUndefined();
    expect(environment.CLAWEE_ENTERPRISE_E2E_AUTHORIZED).toBeUndefined();
    expect(environment.CLAWEE_ENTERPRISE_KEYRING_SERVICE).toBeUndefined();
    expect(environment.CLAWEE_ENTERPRISE_KEYRING_ACCOUNT).toBeUndefined();
  });
});

function createInput(
  overrides: Partial<DaemonStartInput> = {}
): DaemonStartInput {
  return {
    entryPath: '/daemon/main.js',
    cwd: '/tmp',
    env: {},
    codexBin: '/usr/bin/codex',
    codexHome: '/tmp/codex-home',
    dataDir: '/tmp/data',
    defaultCwd: '/tmp',
    defaultProjectRoot: '/tmp/project',
    requireProbe: false,
    probeVerified: true,
    ...overrides
  };
}
