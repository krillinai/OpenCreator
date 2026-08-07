import { describe, expect, it } from 'vitest';
import {
  createProductionServerInput,
  prepareSchedulerStartup,
  resolveEnterpriseStartupArguments,
  resolveProductionServerEnvironment
} from '../../src/startup.js';

describe('daemon production startup', () => {
  it('enables scheduler autostart and built-in agent tools for the production server', () => {
    const input = createProductionServerInput({
      token: 'runtime-token'
    });

    expect(input).toMatchObject({
      token: 'runtime-token',
      schedulerAutostart: true,
      agentToolsEnabled: true,
      persistentAppServerEnabled: true
    });
  });

  it('repairs schedule bindings before classifying sessions', () => {
    const steps: string[] = [];

    const result = prepareSchedulerStartup({
      coordinator: {
        ensureBindings() {
          steps.push('repair');
          return { scanned: 2, repaired: 1, failed: 0, unchanged: 1 };
        }
      },
      classifySessions() {
        steps.push('classify');
      }
    });

    expect(steps).toEqual(['repair', 'classify']);
    expect(result).toEqual({ scanned: 2, repaired: 1, failed: 0, unchanged: 1 });
  });

  it('maps isolated runtime paths from non-empty environment variables', () => {
    expect(resolveProductionServerEnvironment({
      CLAWEE_DATA_DIR: ' /tmp/clawee-data ',
      CLAWEE_CODEX_BIN: ' /tmp/fake-codex ',
      CODEX_HOME: ' /tmp/clawee-codex-home ',
      CLAWEE_DEFAULT_CWD: ' /tmp/default-workspace ',
      CLAWEE_DEFAULT_PROJECT_ROOT: ' /tmp/Documents '
    })).toEqual({
      dataDir: '/tmp/clawee-data',
      codexBin: '/tmp/fake-codex',
      codexHome: '/tmp/clawee-codex-home',
      defaultCwd: '/tmp/default-workspace',
      defaultProjectRoot: '/tmp/Documents'
    });

    expect(resolveProductionServerEnvironment({
      CLAWEE_DATA_DIR: ' ',
      CLAWEE_CODEX_BIN: '',
      CODEX_HOME: '\t',
      CLAWEE_DEFAULT_CWD: '\n',
      CLAWEE_DEFAULT_PROJECT_ROOT: ' '
    })).toEqual({});
  });

  it('prefers standard CODEX_HOME and keeps the legacy variable as a fallback', () => {
    expect(resolveProductionServerEnvironment({
      CODEX_HOME: '/tmp/standard-codex-home',
      CLAWEE_CODEX_HOME: '/tmp/legacy-codex-home'
    })).toMatchObject({
      codexHome: '/tmp/standard-codex-home'
    });
    expect(resolveProductionServerEnvironment({
      CLAWEE_CODEX_HOME: '/tmp/legacy-codex-home'
    })).toMatchObject({
      codexHome: '/tmp/legacy-codex-home'
    });
  });

  it('reads the enterprise gateway and optional E2E identity from arguments', () => {
    const configArgument =
      '--clawee-enterprise-config=/tmp/enterprise-gateway.json';
    expect(resolveEnterpriseStartupArguments(
      ['node', 'main.js', configArgument],
      () => 'https://enterprise.example'
    )).toEqual({
      enterpriseConfigPath: '/tmp/enterprise-gateway.json',
      enterpriseOrigin: 'https://enterprise.example'
    });
    expect(resolveEnterpriseStartupArguments(
      [
        'node',
        'main.js',
        configArgument,
        '--clawee-enterprise-e2e-run-id=123e4567-e89b-42d3-a456-426614174000',
        '--clawee-enterprise-e2e-authorized=packaged-app'
      ],
      () => 'http://127.0.0.1:1904'
    )).toEqual({
      enterpriseConfigPath: '/tmp/enterprise-gateway.json',
      enterpriseOrigin: 'http://127.0.0.1:1904',
      enterpriseE2ERunId: '123e4567-e89b-42d3-a456-426614174000'
    });

    for (const argv of [
      ['node', 'main.js'],
      [
        'node',
        'main.js',
        configArgument,
        '--clawee-enterprise-e2e-run-id=123e4567-e89b-42d3-a456-426614174000'
      ],
      [
        'node',
        'main.js',
        configArgument,
        '--clawee-enterprise-e2e-run-id=not-a-uuid',
        '--clawee-enterprise-e2e-authorized=packaged-app'
      ]
    ]) {
      expect(() => resolveEnterpriseStartupArguments(
        argv,
        () => 'http://127.0.0.1:1904'
      )).toThrow();
    }
  });

  it('rejects enterprise configuration through environment variables', () => {
    for (const env of [
      { CLAWEE_ENTERPRISE_ORIGIN: 'https://enterprise.example' },
      {
        CLAWEE_ENTERPRISE_E2E_RUN_ID:
          '123e4567-e89b-42d3-a456-426614174000'
      },
      { CLAWEE_ENTERPRISE_KEYRING_SERVICE: 'arbitrary-service' }
    ]) {
      expect(() => resolveProductionServerEnvironment(env)).toThrow(
        'ENTERPRISE_ENV_CONFIG_FORBIDDEN'
      );
    }
  });
});
