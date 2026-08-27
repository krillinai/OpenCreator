import {
  mkdtempSync,
  rmSync,
  statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deletePrivateJsonFile,
  readPrivateJsonFile,
  writePrivateJsonFile
} from '../../src/config/private-json-file.js';

describe('private JSON configuration file', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('writes, reads, and deletes a user-private JSON document', async () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-private-config-'));
    const path = join(root, 'config', 'settings.json');
    const value = {
      apiKey: 'sk-local-file',
      model: 'gpt-custom'
    };

    await writePrivateJsonFile(path, value);
    await expect(readPrivateJsonFile(path)).resolves.toEqual(value);

    if (process.platform !== 'win32') {
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }

    await deletePrivateJsonFile(path);
    await expect(readPrivateJsonFile(path)).resolves.toBeUndefined();
  });
});
