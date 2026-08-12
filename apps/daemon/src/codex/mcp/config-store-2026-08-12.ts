import { createHash, randomBytes } from 'node:crypto';
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

type TomlRecord = Record<string, unknown>;
type TomlDocument = ReturnType<typeof parse>;

export async function getCodexMcpConfigurationFingerprint(
  codexHome: string
): Promise<string> {
  const config = await readCodexConfig(join(codexHome, 'config.toml'));
  const configRecord = config as unknown as TomlRecord;
  const servers = isRecord(configRecord.mcp_servers)
    ? configRecord.mcp_servers
    : {};
  return createHash('sha256')
    .update(JSON.stringify(normalizeForHash(servers)))
    .digest('hex');
}

export async function setCodexMcpServerEnabled(input: {
  codexHome: string;
  name: string;
  enabled: boolean;
}): Promise<void> {
  const configPath = join(input.codexHome, 'config.toml');
  let mode = 0o600;
  try {
    mode = (await stat(configPath)).mode & 0o777;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const config = await readCodexConfig(configPath);
  const configRecord = config as unknown as TomlRecord;
  const servers = isRecord(configRecord.mcp_servers)
    ? configRecord.mcp_servers
    : undefined;
  const server = servers?.[input.name];
  if (!isRecord(server)) {
    throw new Error('MCP_SERVER_NOT_FOUND: MCP server not found');
  }
  server.enabled = input.enabled;

  await mkdir(input.codexHome, { recursive: true, mode: 0o700 });
  const temporaryPath =
    `${configPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporaryPath, stringify(config), { mode });
  await chmod(temporaryPath, mode);
  await rename(temporaryPath, configPath);
}

async function readCodexConfig(configPath: string): Promise<TomlDocument> {
  let source = '';
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  try {
    return source.trim().length === 0
      ? {} as TomlDocument
      : parse(source);
  } catch {
    throw new Error('MCP_SERVER_INVALID: Codex config.toml is invalid');
  }
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForHash);
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, normalizeForHash(value[key])])
  );
}

function isRecord(value: unknown): value is TomlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
