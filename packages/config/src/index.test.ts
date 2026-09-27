import {
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readOpenCreatorConfig,
  resolveDesktopConfig,
  resolveOpenCreatorPaths,
  resolveStorageSettings,
  resolveUiSettings,
  updateOpenCreatorConfig,
  updateOpenCreatorStorageSettings,
  updateOpenCreatorUiSettings
} from './index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('OpenCreator config', () => {
  it('resolves the product-owned directory layout', () => {
    expect(resolveOpenCreatorPaths({ homeDir: '/Users/demo', env: {} })).toMatchObject({
      root: '/Users/demo/.opencreator',
      configFile: '/Users/demo/.opencreator/config.toml',
      dataDir: '/Users/demo/.opencreator/data',
      codexHome: '/Users/demo/.opencreator/runtime/codex',
      creatorCodexHome: '/Users/demo/.opencreator/runtime/creator-codex'
    });
  });

  it('isolates development state below the product directory', () => {
    expect(resolveOpenCreatorPaths({
      homeDir: '/Users/demo',
      env: {},
      runtimeChannel: 'development'
    })).toMatchObject({
      root: '/Users/demo/.opencreator/development',
      configFile: '/Users/demo/.opencreator/development/config.toml',
      dataDir: '/Users/demo/.opencreator/development/data',
      codexHome: '/Users/demo/.opencreator/development/runtime/codex'
    });
  });

  it('keeps an explicit product home authoritative in development', () => {
    expect(resolveOpenCreatorPaths({
      homeDir: '/Users/demo',
      env: { OPENCREATOR_HOME: '/tmp/opencreator-explicit' },
      runtimeChannel: 'development'
    }).root).toBe('/tmp/opencreator-explicit');
  });

  it('creates OpenCreator settings from an empty product directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencreator-config-'));
    tempDirs.push(root);
    const path = join(root, 'config.toml');

    expect(resolveUiSettings(readOpenCreatorConfig(path)).accentColor).toBe('red');

    updateOpenCreatorUiSettings(path, { colorMode: 'light', language: 'sv-SE' });

    expect(resolveUiSettings(readOpenCreatorConfig(path)).colorMode).toBe('light');
    expect(resolveUiSettings(readOpenCreatorConfig(path)).language).toBe('sv-SE');
  });

  it('persists anonymous telemetry preferences and the install identifier', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencreator-config-'));
    tempDirs.push(root);
    const path = join(root, 'config.toml');
    const telemetryInstallId = '123e4567-e89b-42d3-a456-426614174000';

    updateOpenCreatorConfig(path, document => ({
      ...document,
      desktop: {
        closeBehavior: 'hide',
        notificationsEnabled: true,
        telemetryEnabled: false,
        telemetryInstallId
      }
    }));

    const source = readFileSync(path, 'utf8');
    expect(source).toContain('telemetry_enabled = false');
    expect(source).toContain(`telemetry_install_id = "${telemetryInstallId}"`);
    expect(resolveDesktopConfig(readOpenCreatorConfig(path))).toMatchObject({
      telemetryEnabled: false,
      telemetryInstallId
    });
  });

  it('persists project and completed output locations', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencreator-config-'));
    tempDirs.push(root);
    const path = join(root, 'config.toml');
    const defaults = {
      defaultProjectRoot: join(root, 'OpenCreator'),
      outputRoot: join(root, 'OpenCreator', 'Exports')
    };

    expect(resolveStorageSettings(readOpenCreatorConfig(path), defaults)).toEqual(defaults);
    updateOpenCreatorStorageSettings(path, {
      defaultProjectRoot: join(root, 'Projects'),
      outputRoot: join(root, 'Outputs')
    });

    expect(resolveStorageSettings(readOpenCreatorConfig(path), defaults)).toEqual({
      defaultProjectRoot: join(root, 'Projects'),
      outputRoot: join(root, 'Outputs')
    });
    expect(readFileSync(path, 'utf8')).toContain('[storage]');
  });
});
