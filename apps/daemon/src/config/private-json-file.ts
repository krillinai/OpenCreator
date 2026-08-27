import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export async function readPrivateJsonFile(path: string): Promise<unknown | undefined> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
  return JSON.parse(source) as unknown;
}

export async function writePrivateJsonFile(
  path: string,
  value: unknown
): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await enforceMode(parent, 0o700);

  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    await enforceMode(temporary, 0o600);
    await rename(temporary, path);
    await enforceMode(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function deletePrivateJsonFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export function createPrivateJsonDocumentEntry(path: string): {
  getPassword(): Promise<string | null>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<boolean>;
} {
  return {
    async getPassword() {
      const value = await readPrivateJsonFile(path);
      return value === undefined ? null : JSON.stringify(value);
    },
    async setPassword(value) {
      await writePrivateJsonFile(path, JSON.parse(value) as unknown);
    },
    async deletePassword() {
      await deletePrivateJsonFile(path);
      return true;
    }
  };
}

function enforceMode(path: string, mode: number): Promise<void> {
  return process.platform === 'win32'
    ? Promise.resolve()
    : chmod(path, mode);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}
