import { describe, expect, it } from 'vitest';
import {
  createProductionServerInput,
  parseRuntimeChannel,
  prepareSchedulerStartup,
  resolveProductionRuntimePaths,
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
      OPENCREATOR_LOCAL_CODEX_HOME: ' /tmp/local-codex-home ',
      OPENCREATOR_DEFAULT_CWD: ' /tmp/default-workspace ',
      OPENCREATOR_DEFAULT_PROJECT_ROOT: ' /tmp/Documents ',
      OPENCREATOR_YT_DLP_PATH: ' /tmp/yt-dlp '
    })).toEqual({
      gatewayOrigin: 'https://www.open-creator.ai',
      dataDir: '/tmp/opencreator-data',
      codexBin: '/tmp/fake-codex',
      codexHome: '/tmp/opencreator-codex-home',
      localCodexHome: '/tmp/local-codex-home',
      defaultCwd: '/tmp/default-workspace',
      defaultProjectRoot: '/tmp/Documents',
      creatorYtDlpPath: '/tmp/yt-dlp'
    });

    expect(resolveProductionServerEnvironment({
      OPENCREATOR_DATA_DIR: ' ',
      OPENCREATOR_CODEX_BIN: '',
      CODEX_HOME: '\t',
      OPENCREATOR_LOCAL_CODEX_HOME: ' ',
      OPENCREATOR_DEFAULT_CWD: '\n',
      OPENCREATOR_DEFAULT_PROJECT_ROOT: ' ',
      OPENCREATOR_YT_DLP_PATH: ''
    })).toEqual({ gatewayOrigin: 'https://www.open-creator.ai' });
  });

  it('uses the production gateway by default and allows an explicit local gateway', () => {
    expect(resolveProductionServerEnvironment({
      OPENCREATOR_GATEWAY_ORIGIN: ' '
    }).gatewayOrigin).toBe('https://www.open-creator.ai');
    expect(resolveProductionServerEnvironment({
      OPENCREATOR_GATEWAY_ORIGIN: ' http://127.0.0.1:8787 '
    }).gatewayOrigin).toBe('http://127.0.0.1:8787');
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

  it('resolves the default OpenCreator layout without a Codex home segment', () => {
    expect(resolveProductionRuntimePaths({}, {
      homeDir: '/Users/demo'
    })).toEqual({
      appHome: '/Users/demo/.opencreator',
      dataDir: '/Users/demo/.opencreator/data',
      configFile: '/Users/demo/.opencreator/config.toml',
      credentialsFile: '/Users/demo/.opencreator/credentials.json',
      runtimeDir: '/Users/demo/.opencreator/runtime',
      creatorDir: '/Users/demo/.opencreator/creator',
      codexHome: '/Users/demo/.opencreator/runtime/codex'
    });
  });

  it('resolves an isolated development layout', () => {
    expect(resolveProductionRuntimePaths({}, {
      homeDir: '/Users/demo',
      runtimeChannel: 'development'
    })).toEqual({
      appHome: '/Users/demo/.opencreator/development',
      dataDir: '/Users/demo/.opencreator/development/data',
      configFile: '/Users/demo/.opencreator/development/config.toml',
      credentialsFile: '/Users/demo/.opencreator/development/credentials.json',
      runtimeDir: '/Users/demo/.opencreator/development/runtime',
      creatorDir: '/Users/demo/.opencreator/development/creator',
      codexHome: '/Users/demo/.opencreator/development/runtime/codex'
    });
  });

  it('validates the runtime channel', () => {
    expect(parseRuntimeChannel(undefined)).toBe('production');
    expect(parseRuntimeChannel(' production ')).toBe('production');
    expect(parseRuntimeChannel(' development ')).toBe('development');
    expect(() => parseRuntimeChannel('preview')).toThrow(
      /Unsupported OpenCreator Runtime channel/
    );
  });

  it('keeps isolated test configuration next to an explicit data directory', () => {
    expect(resolveProductionRuntimePaths({
      dataDir: '/tmp/opencreator-e2e/runtime'
    })).toMatchObject({
      appHome: '/tmp/opencreator-e2e',
      dataDir: '/tmp/opencreator-e2e/runtime',
      configFile: '/tmp/opencreator-e2e/config.toml',
      credentialsFile: '/tmp/opencreator-e2e/credentials.json',
      codexHome: '/tmp/opencreator-e2e/runtime/codex'
    });
  });
});
