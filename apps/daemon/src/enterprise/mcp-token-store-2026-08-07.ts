import { AsyncEntry } from '@napi-rs/keyring';

const DEFAULT_SERVICE = 'com.clawee.enterprise.mcp';
const DEFAULT_ACCOUNT = 'clawee-agent-mcp';
const E2E_SERVICE = 'com.clawee.enterprise.mcp.e2e';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type EnterpriseMcpTokenCredential = {
  tokenId: string;
  agentId: string;
  token: string;
  tokenType: 'Bearer';
  fingerprint: string;
  expiresAt: string | null;
  scopes: string[];
  createdAt: string;
};

export type EnterpriseMcpTokenStore = {
  read(): Promise<EnterpriseMcpTokenCredential | undefined>;
  write(credential: EnterpriseMcpTokenCredential): Promise<void>;
  delete(): Promise<void>;
};

type EnterpriseMcpTokenEntry = {
  getPassword(): Promise<string | null | undefined>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<unknown>;
};

type EnterpriseMcpTokenIdentity = {
  service: string;
  account: string;
};

export class EnterpriseMcpTokenStoreError extends Error {
  readonly code = 'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE';

  constructor(stage: 'read' | 'write' | 'delete' | 'decode') {
    super(`ENTERPRISE_SECURE_STORAGE_UNAVAILABLE: enterprise MCP token ${stage} failed`);
    this.name = 'EnterpriseMcpTokenStoreError';
  }
}

export function resolveEnterpriseMcpTokenIdentity(
  e2eRunId?: string
): EnterpriseMcpTokenIdentity {
  if (e2eRunId === undefined) {
    return {
      service: DEFAULT_SERVICE,
      account: DEFAULT_ACCOUNT
    };
  }
  if (!UUID_PATTERN.test(e2eRunId)) {
    throw new Error('ENTERPRISE_E2E_CONFIG_FORBIDDEN');
  }
  return {
    service: E2E_SERVICE,
    account: `${DEFAULT_ACCOUNT}:${e2eRunId}`
  };
}

export function createEnterpriseMcpTokenStore(input: {
  entry: EnterpriseMcpTokenEntry;
}): EnterpriseMcpTokenStore {
  return {
    async read() {
      let value: string | null | undefined;
      try {
        value = await input.entry.getPassword();
      } catch {
        throw new EnterpriseMcpTokenStoreError('read');
      }
      if (value === null || value === undefined) return undefined;
      try {
        return validateCredential(JSON.parse(value) as unknown);
      } catch {
        try {
          await input.entry.deletePassword();
        } catch {
          // Invalid secure-storage content is unusable even when cleanup fails.
        }
        throw new EnterpriseMcpTokenStoreError('decode');
      }
    },
    async write(credential) {
      let value: string;
      try {
        value = JSON.stringify(validateCredential(credential));
      } catch {
        throw new EnterpriseMcpTokenStoreError('write');
      }
      try {
        await input.entry.setPassword(value);
      } catch {
        throw new EnterpriseMcpTokenStoreError('write');
      }
    },
    async delete() {
      try {
        await input.entry.deletePassword();
      } catch {
        throw new EnterpriseMcpTokenStoreError('delete');
      }
    }
  };
}

export function createSystemEnterpriseMcpTokenStore(input?: {
  e2eRunId?: string;
}): EnterpriseMcpTokenStore {
  const identity = resolveEnterpriseMcpTokenIdentity(input?.e2eRunId);
  return createEnterpriseMcpTokenStore({
    entry: new AsyncEntry(identity.service, identity.account)
  });
}

function validateCredential(value: unknown): EnterpriseMcpTokenCredential {
  if (!isPlainObject(value)) throw new Error('invalid MCP token credential');
  const keys = Object.keys(value);
  const expectedKeys = [
    'tokenId',
    'agentId',
    'token',
    'tokenType',
    'fingerprint',
    'expiresAt',
    'scopes',
    'createdAt'
  ];
  if (
    keys.length !== expectedKeys.length
    || expectedKeys.some(key => !keys.includes(key))
    || typeof value.tokenId !== 'string'
    || value.tokenId.length === 0
    || typeof value.agentId !== 'string'
    || value.agentId.length === 0
    || typeof value.token !== 'string'
    || value.token.length === 0
    || value.tokenType !== 'Bearer'
    || typeof value.fingerprint !== 'string'
    || value.fingerprint.length === 0
    || (
      value.expiresAt !== null
      && (
        typeof value.expiresAt !== 'string'
        || !isRfc3339(value.expiresAt)
      )
    )
    || !Array.isArray(value.scopes)
    || value.scopes.some(scope => typeof scope !== 'string' || scope.length === 0)
    || !value.scopes.includes('mcp:call')
    || typeof value.createdAt !== 'string'
    || !isRfc3339(value.createdAt)
  ) {
    throw new Error('invalid MCP token credential');
  }
  return {
    tokenId: value.tokenId,
    agentId: value.agentId,
    token: value.token,
    tokenType: value.tokenType,
    fingerprint: value.fingerprint,
    expiresAt: value.expiresAt,
    scopes: [...value.scopes],
    createdAt: value.createdAt
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRfc3339(value: string): boolean {
  return RFC_3339_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}
