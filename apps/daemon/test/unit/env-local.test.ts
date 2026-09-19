import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadVolcengineEnvironment, parseEnvFile } from '../../src/env-local.js';

describe('local environment files', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('parses KEY=VALUE lines and ignores comments', () => {
    expect(parseEnvFile([
      '# comment',
      'VOLCENGINE_APP_ID=123',
      'export VOLCENGINE_ACCESS_TOKEN="token-value"',
      "DATABASE_URL='secret-value'",
      'INVALID',
      ''
    ].join('\n'))).toEqual({
      VOLCENGINE_APP_ID: '123',
      VOLCENGINE_ACCESS_TOKEN: 'token-value',
      DATABASE_URL: 'secret-value'
    });
  });

  it('does not walk the working directory or copy unrelated secrets into process.env', () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-env-local-'));
    writeFileSync(join(root, '.env.local'), [
      'VOLCENGINE_APP_ID=file-app-id',
      'VOLCENGINE_ACCESS_TOKEN=file-token',
      'DATABASE_URL=should-not-load'
    ].join('\n'));

    const env: NodeJS.ProcessEnv = {
      VOLCENGINE_APP_ID: 'shell-app-id'
    };
    const loaded = loadVolcengineEnvironment({ env, homeDir: null });

    expect(loaded).toEqual({ VOLCENGINE_APP_ID: 'shell-app-id' });
    expect(env.VOLCENGINE_ACCESS_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('loads only VOLCENGINE_* keys from ~/.opencreator/.env.local', () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-home-env-'));
    const homeDir = join(root, 'home');
    mkdirSync(join(homeDir, '.opencreator'), { recursive: true });
    writeFileSync(join(homeDir, '.opencreator', '.env.local'), [
      'VOLCENGINE_APP_ID=home-app-id',
      'VOLCENGINE_ACCESS_TOKEN=home-token',
      'DATABASE_URL=should-not-load',
      'VOLCENGINE_SECRET_KEY=unused'
    ].join('\n'));

    const env: NodeJS.ProcessEnv = {};
    const loaded = loadVolcengineEnvironment({ env, homeDir });

    expect(loaded).toEqual({
      VOLCENGINE_APP_ID: 'home-app-id',
      VOLCENGINE_ACCESS_TOKEN: 'home-token'
    });
    expect(env).toEqual({});
  });

  it('loads an explicit OPENCREATOR_ENV_FILE when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-env-file-'));
    const file = join(root, 'secrets.env');
    writeFileSync(file, [
      'VOLCENGINE_ACCESS_TOKEN=from-explicit-file',
      'DATABASE_URL=should-not-load'
    ].join('\n'));
    const env: NodeJS.ProcessEnv = {
      OPENCREATOR_ENV_FILE: file
    };

    expect(loadVolcengineEnvironment({ env, homeDir: null })).toEqual({
      VOLCENGINE_ACCESS_TOKEN: 'from-explicit-file'
    });
    expect(env.VOLCENGINE_ACCESS_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('does not fall back to a file when a process env key is explicitly empty', () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-empty-env-'));
    const homeDir = join(root, 'home');
    mkdirSync(join(homeDir, '.opencreator'), { recursive: true });
    writeFileSync(join(homeDir, '.opencreator', '.env.local'), 'VOLCENGINE_APP_ID=home-app-id\n');
    const env: NodeJS.ProcessEnv = {
      VOLCENGINE_APP_ID: ''
    };

    expect(loadVolcengineEnvironment({ env, homeDir })).toEqual({});
  });
});
