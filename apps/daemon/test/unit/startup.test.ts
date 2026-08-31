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
      OPENCREATOR_DATA_DIR: ' /tmp/opencreator-data ',
      OPENCREATOR_CODEX_BIN: ' /tmp/fake-codex ',
      CODEX_HOME: ' /tmp/opencreator-codex-home ',
      OPENCREATOR_DEFAULT_CWD: ' /tmp/default-workspace ',
      OPENCREATOR_DEFAULT_PROJECT_ROOT: ' /tmp/Documents ',
      OPENCREATOR_YT_DLP_PATH: ' /tmp/yt-dlp '
    })).toEqual({
      dataDir: '/tmp/opencreator-data',
      codexBin: '/tmp/fake-codex',
      codexHome: '/tmp/opencreator-codex-home',
      defaultCwd: '/tmp/default-workspace',
      defaultProjectRoot: '/tmp/Documents',
      creatorYtDlpPath: '/tmp/yt-dlp'
    });

    expect(resolveProductionServerEnvironment({
      OPENCREATOR_DATA_DIR: ' ',
      OPENCREATOR_CODEX_BIN: '',
      CODEX_HOME: '\t',
      OPENCREATOR_DEFAULT_CWD: '\n',
      OPENCREATOR_DEFAULT_PROJECT_ROOT: ' ',
      OPENCREATOR_YT_DLP_PATH: ''
    })).toEqual({});
  });

  it('prefers standard CODEX_HOME and keeps the legacy variable as a fallback', () => {
    expect(resolveProductionServerEnvironment({
      CODEX_HOME: '/tmp/standard-codex-home',
      OPENCREATOR_CODEX_HOME: '/tmp/legacy-codex-home'
    })).toMatchObject({
      codexHome: '/tmp/standard-codex-home'
    });
    expect(resolveProductionServerEnvironment({
      OPENCREATOR_CODEX_HOME: '/tmp/legacy-codex-home'
    })).toMatchObject({
      codexHome: '/tmp/legacy-codex-home'
    });
  });

  it('reads the enterprise gateway and optional E2E identity from arguments', () => {
    const configArgument =
      '--opencreator-enterprise-config=/tmp/enterprise-gateway.json';
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
        '--opencreator-enterprise-e2e-run-id=123e4567-e89b-42d3-a456-426614174000',
        '--opencreator-enterprise-e2e-authorized=packaged-app'
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
        '--opencreator-enterprise-e2e-run-id=123e4567-e89b-42d3-a456-426614174000'
      ],
      [
        'node',
        'main.js',
        configArgument,
        '--opencreator-enterprise-e2e-run-id=not-a-uuid',
        '--opencreator-enterprise-e2e-authorized=packaged-app'
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
      { OPENCREATOR_ENTERPRISE_ORIGIN: 'https://enterprise.example' },
      {
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID:
          '123e4567-e89b-42d3-a456-426614174000'
      }
    ]) {
      expect(() => resolveProductionServerEnvironment(env)).toThrow(
        'ENTERPRISE_ENV_CONFIG_FORBIDDEN'
      );
    }
  });
});
