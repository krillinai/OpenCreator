import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile
} from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from '@iarna/toml';

type TomlDocument = ReturnType<typeof parse>;
type TomlRecord = Record<string, unknown>;

export async function ensureCodexFileCredentialStore(
  codexHome: string
): Promise<void> {
  const configPath = join(codexHome, 'config.toml');
  let source = '';
  let mode = 0o600;
  try {
    const [contents, metadata] = await Promise.all([
      readFile(configPath, 'utf8'),
      stat(configPath)
    ]);
    source = contents;
    mode = metadata.mode & 0o777;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  let config: TomlDocument;
  try {
    config = source.trim().length === 0
      ? {} as TomlDocument
      : parse(source);
  } catch {
    throw new Error('CODEX_CONFIG_INVALID: Codex config.toml is invalid');
  }
  const configRecord = config as unknown as TomlRecord;
  if (configRecord.cli_auth_credentials_store === 'file') return;
  configRecord.cli_auth_credentials_store = 'file';

  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await enforceMode(codexHome, 0o700);
  const temporary =
    `${configPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, stringify(config), { mode });
  await enforceMode(temporary, mode);
  await rename(temporary, configPath);
  await enforceMode(configPath, mode);
}

export function isCodexCredentialStoreConfigurationDiagnostic(
  error: unknown
): boolean {
  if (error instanceof Error && error.message.startsWith('CODEX_CONFIG_INVALID:')) {
    return true;
  }
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === 'ENOTDIR' || error.code === 'EISDIR';
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
