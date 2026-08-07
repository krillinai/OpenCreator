import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  ENTERPRISE_AGENT_ID_PATTERN,
  readEnterpriseClientConfig,
  serializeEnterpriseClientConfig,
  type EnterpriseClientConfig
} from './client-config-2026-08-06.js';

const FILE_NAME = 'enterprise-agent.json';

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
  generateId?: () => string;
}): EnterpriseAgentIdentityStore {
  const path = resolve(input.configPath);
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
    const config = await readConfig(path);
    if (config.agentId !== undefined) return config.agentId;

    const agentId = (
      legacyPath === undefined ? undefined : await readLegacyIdentity(legacyPath)
    ) ?? generateId();
    if (!ENTERPRISE_AGENT_ID_PATTERN.test(agentId)) {
      throw new EnterpriseAgentIdentityStoreError('validate');
    }
    await writeAtomic(path, {
      ...config,
      agentId
    });
    return agentId;
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
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(serializeEnterpriseClientConfig(value), 'utf8');
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
