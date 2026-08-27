import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '@iarna/toml';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCodexFileCredentialStore } from '../../src/codex/credential-storage.js';

describe('Codex credential storage configuration', () => {
  let codexHome: string | undefined;

  afterEach(() => {
    if (codexHome !== undefined) {
      rmSync(codexHome, { recursive: true, force: true });
    }
    codexHome = undefined;
  });

  it('forces Codex credentials into auth.json', async () => {
    codexHome = mkdtempSync(join(tmpdir(), 'opencreator-codex-storage-'));
    const configPath = join(codexHome, 'config.toml');
    writeFileSync(
      configPath,
      'model = "gpt-custom"\ncli_auth_credentials_store = "auto"\n',
      { mode: 0o600 }
    );

    await ensureCodexFileCredentialStore(codexHome);

    expect(parse(readFileSync(configPath, 'utf8'))).toMatchObject({
      model: 'gpt-custom',
      cli_auth_credentials_store: 'file'
    });
    if (process.platform !== 'win32') {
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
    }
  });
});
