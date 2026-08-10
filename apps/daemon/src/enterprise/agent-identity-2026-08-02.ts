import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parse, stringify } from '@iarna/toml';
import {
  ENTERPRISE_AGENT_ID_PATTERN,
  readEnterpriseClientConfig,
  serializeEnterpriseClientConfig,
  type EnterpriseClientConfig
} from './client-config-2026-08-06.js';

const FILE_NAME = 'enterprise-agent.json';
const IDENTITY_LOCK_FILE_NAME = '.agent-id.lock';
const IDENTITY_LOCK_TIMEOUT_MS = 5_000;
const IDENTITY_LOCK_STALE_MS = 30_000;

export type EnterpriseAgentIdentityStore = {
  getOrCreate(): Promise<string>;
};

export class EnterpriseAgentIdentityStoreError extends Error {
  readonly code = 'ENTERPRISE_PROTOCOL_ERROR';

  constructor(readonly stage: 'read' | 'write' | 'validate') {
    super(`ENTERPRISE_PROTOCOL_ERROR: enterprise agent identity ${stage} failed`);
    this.name = 'EnterpriseAgentIdentityStoreError';
  }
}

export function createEnterpriseAgentIdentityStore(input: {
  configPath: string;
  legacyDataDir?: string;
  collectorConfigPath?: string;
  generateId?: () => string;
}): EnterpriseAgentIdentityStore {
  const path = resolve(input.configPath);
  const collectorConfigPath = resolve(
    input.collectorConfigPath
      ?? join(homedir(), '.clawee', 'collector', 'config.toml')
  );
  const legacyPath = input.legacyDataDir === undefined
    ? undefined
    : join(input.legacyDataDir, FILE_NAME);
  const generateId = input.generateId ?? (() => `clawee_${randomUUID()}`);
  let pending: Promise<string> | undefined;

  return {
    getOrCreate() {
      pending ??= loadOrCreate().catch(error => {
        pending = undefined;
        throw error;
      });
      return pending;
    }
  };

  async function loadOrCreate(): Promise<string> {
    const release = await acquireIdentityLock(
      join(dirname(path), IDENTITY_LOCK_FILE_NAME)
    );
    try {
      const config = await readConfig(path);
      const collector = await readCollectorIdentity(
        collectorConfigPath,
        config.gateway
      );
      const legacyAgentId = config.agentId === undefined && legacyPath !== undefined
        ? await readLegacyIdentity(legacyPath)
        : undefined;
      const agentId = config.agentId
        ?? legacyAgentId
        ?? collector?.agentId
        ?? generateId();
      if (!ENTERPRISE_AGENT_ID_PATTERN.test(agentId)) {
        throw new EnterpriseAgentIdentityStoreError('validate');
      }
      if (config.agentId !== agentId) {
        await writeAtomic(path, {
          ...config,
          agentId
        });
      }
      if (collector !== undefined && collector.agentId !== agentId) {
        await writeAtomicContents(
          collectorConfigPath,
          stringify({ ...collector.raw, agent_id: agentId })
        );
      }
      return agentId;
    } finally {
      await release();
    }
  }
}

type CollectorIdentity = {
  agentId?: string;
  raw: Record<string, unknown>;
};

async function readCollectorIdentity(
  path: string,
  gateway: string
): Promise<CollectorIdentity | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw new EnterpriseAgentIdentityStoreError('read');
  }
  try {
    const parsed = parse(raw) as unknown;
    if (!isPlainObject(parsed)) throw new Error('invalid collector config');
    const officeUrl = parsed.office_url;
    const agentId = parsed.agent_id;
    if (
      typeof officeUrl !== 'string'
      || new URL(officeUrl).origin !== new URL(gateway).origin
      || (
        agentId !== undefined
        && (
          typeof agentId !== 'string'
          || !ENTERPRISE_AGENT_ID_PATTERN.test(agentId)
        )
      )
    ) {
      throw new Error('invalid collector identity');
    }
    return {
      ...(typeof agentId === 'string' ? { agentId } : {}),
      raw: parsed
    };
  } catch {
    throw new EnterpriseAgentIdentityStoreError('validate');
  }
}

async function readConfig(path: string): Promise<EnterpriseClientConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new EnterpriseAgentIdentityStoreError('read');
  }
  try {
    return readEnterpriseClientConfig(path, () => raw);
  } catch {
    throw new EnterpriseAgentIdentityStoreError('validate');
  }
}

async function readLegacyIdentity(path: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw new EnterpriseAgentIdentityStoreError('read');
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isPlainObject(value)
      || Object.keys(value).length !== 2
      || value.version !== 1
      || typeof value.agentId !== 'string'
      || !ENTERPRISE_AGENT_ID_PATTERN.test(value.agentId)
    ) {
      throw new Error('invalid enterprise agent identity');
    }
    return value.agentId;
  } catch {
    throw new EnterpriseAgentIdentityStoreError('validate');
  }
}

async function writeAtomic(
  path: string,
  value: EnterpriseClientConfig & { agentId: string }
): Promise<void> {
  await writeAtomicContents(path, serializeEnterpriseClientConfig(value));
}

async function writeAtomicContents(
  path: string,
  contents: string
): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new EnterpriseAgentIdentityStoreError('write');
  }
}

async function acquireIdentityLock(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + IDENTITY_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      await handle.close();
      return async () => {
        await rm(path, { force: true });
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw new EnterpriseAgentIdentityStoreError('write');
      }
      try {
        const info = await stat(path);
        if (Date.now() - info.mtimeMs > IDENTITY_LOCK_STALE_MS) {
          await rm(path, { force: true });
          continue;
        }
      } catch (statError) {
        if (!isNodeError(statError) || statError.code !== 'ENOENT') {
          throw new EnterpriseAgentIdentityStoreError('write');
        }
      }
      if (Date.now() >= deadline) {
        throw new EnterpriseAgentIdentityStoreError('write');
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
