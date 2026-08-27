import { describe, expect, it } from 'vitest';
import {
  buildDaemonArguments,
  buildDaemonEnvironment,
  type DaemonStartInput
} from '../src/main/daemon-manager.js';

const runId = '123e4567-e89b-42d3-a456-426614174000';

describe('Daemon enterprise environment', () => {
  it('removes inherited enterprise configuration from the child environment', () => {
    const environment = buildDaemonEnvironment(createInput({
      env: {
        PATH: '/usr/bin',
        OPENCREATOR_ENTERPRISE_ORIGIN: 'https://untrusted.example',
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID:
          '223e4567-e89b-42d3-a456-426614174000',
        OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED: 'untrusted'
      }
    }));

    expect(environment).toMatchObject({
      PATH: '/usr/bin'
    });
    expect(environment.OPENCREATOR_ENTERPRISE_ORIGIN).toBeUndefined();
    expect(environment.OPENCREATOR_ENTERPRISE_E2E_RUN_ID).toBeUndefined();
    expect(environment.OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED).toBeUndefined();
    expect(environment).toMatchObject({
      OPENCREATOR_CODEX_BIN: '/usr/bin/codex',
      CODEX_HOME: '/tmp/codex-home',
      OPENCREATOR_DATA_DIR: '/tmp/data',
      OPENCREATOR_DEFAULT_CWD: '/tmp',
      OPENCREATOR_DEFAULT_PROJECT_ROOT: '/tmp/project',
      OPENCREATOR_REQUIRE_CODEX_PROBE: '0',
      OPENCREATOR_CODEX_PROBE_VERIFIED: '1'
    });
  });

  it('passes the gateway config path and E2E identity as typed arguments', () => {
    expect(buildDaemonArguments(createInput({
      enterpriseE2ERunId: runId
    }))).toEqual([
      '--opencreator-enterprise-config=/tmp/enterprise-gateway.json',
      `--opencreator-enterprise-e2e-run-id=${runId}`,
      '--opencreator-enterprise-e2e-authorized=packaged-app'
    ]);
    expect(buildDaemonArguments(createInput())).toEqual([
      '--opencreator-enterprise-config=/tmp/enterprise-gateway.json'
    ]);
  });

  it('does not pass enterprise overrides during an ordinary launch', () => {
    const environment = buildDaemonEnvironment(createInput({
      env: {
        OPENCREATOR_ENTERPRISE_ORIGIN: 'http://127.0.0.1:1904',
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID: runId,
        OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED: 'packaged-app'
      }
    }));

    expect(environment.OPENCREATOR_ENTERPRISE_ORIGIN).toBeUndefined();
    expect(environment.OPENCREATOR_ENTERPRISE_E2E_RUN_ID).toBeUndefined();
    expect(environment.OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED).toBeUndefined();
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
    enterpriseConfigPath: '/tmp/enterprise-gateway.json',
    ...overrides
  };
}
