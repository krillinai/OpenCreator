import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const FILE_NAME = 'enterprise-agent.json';
const AGENT_ID_PATTERN =
  /^clawee_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  dataDir: string;
  generateId?: () => string;
}): EnterpriseAgentIdentityStore {
  const path = join(input.dataDir, FILE_NAME);
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
    const existing = await readExisting(path);
    if (existing !== undefined) return existing;

    const agentId = generateId();
    if (!AGENT_ID_PATTERN.test(agentId)) {
      throw new EnterpriseAgentIdentityStoreError('validate');
    }
    await writeAtomic(path, {
      version: 1,
      agentId
    });
    return agentId;
  }
}

async function readExisting(path: string): Promise<string | undefined> {
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
      || !AGENT_ID_PATTERN.test(value.agentId)
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
  value: { version: 1; agentId: string }
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
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
