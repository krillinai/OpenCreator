import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLocalEnvironment, parseEnvFile } from '../../src/env-local.js';

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
      "VOLCENGINE_SECRET_KEY='secret-value'",
      'INVALID',
      ''
    ].join('\n'))).toEqual({
      VOLCENGINE_APP_ID: '123',
      VOLCENGINE_ACCESS_TOKEN: 'token-value',
      VOLCENGINE_SECRET_KEY: 'secret-value'
    });
  });

  it('loads .env.local from the working directory walk-up without overriding existing values', () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-env-local-'));
    const nested = join(root, 'apps', 'daemon');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, '.env.local'), [
      'VOLCENGINE_APP_ID=file-app-id',
      'VOLCENGINE_ACCESS_TOKEN=file-token'
    ].join('\n'));

    const env: NodeJS.ProcessEnv = {
      VOLCENGINE_APP_ID: 'shell-app-id'
    };
    const loaded = loadLocalEnvironment({ cwd: nested, env, homeDir: null });

    expect(loaded).toEqual([join(root, '.env.local')]);
    expect(env.VOLCENGINE_APP_ID).toBe('shell-app-id');
    expect(env.VOLCENGINE_ACCESS_TOKEN).toBe('file-token');
  });

  it('loads an explicit OPENCREATOR_ENV_FILE when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-env-file-'));
    const file = join(root, 'secrets.env');
    writeFileSync(file, 'VOLCENGINE_SECRET_KEY=from-explicit-file\n');
    const env: NodeJS.ProcessEnv = {
      OPENCREATOR_ENV_FILE: file
    };

    expect(loadLocalEnvironment({ cwd: root, env, homeDir: null })).toEqual([file]);
    expect(env.VOLCENGINE_SECRET_KEY).toBe('from-explicit-file');
  });
});
