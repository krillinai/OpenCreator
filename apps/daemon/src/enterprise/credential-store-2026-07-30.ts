import { AsyncEntry } from '@napi-rs/keyring';

const DEFAULT_SERVICE = 'com.clawee.enterprise';
const DEFAULT_ACCOUNT = 'clawee-agent';
const E2E_SERVICE = 'com.clawee.enterprise.e2e';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type EnterpriseCredential = {
  accessToken: string;
  expiresAt: string;
};

export type EnterpriseCredentialStore = {
  read(): Promise<EnterpriseCredential | undefined>;
  write(credential: EnterpriseCredential): Promise<void>;
  delete(): Promise<void>;
};

type EnterpriseCredentialEntry = {
  getPassword(): Promise<string | null | undefined>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<unknown>;
};

type EnterpriseCredentialIdentity = {
  service: string;
  account: string;
};

export class EnterpriseCredentialStoreError extends Error {
  readonly code = 'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE';

  constructor(stage: 'read' | 'write' | 'delete' | 'decode') {
    super(`ENTERPRISE_SECURE_STORAGE_UNAVAILABLE: enterprise credential ${stage} failed`);
    this.name = 'EnterpriseCredentialStoreError';
  }
}

export function resolveEnterpriseCredentialIdentity(
  e2eRunId?: string
): EnterpriseCredentialIdentity {
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

export function createEnterpriseCredentialStore(input: {
  entry: EnterpriseCredentialEntry;
}): EnterpriseCredentialStore {
  const { entry } = input;

  return {
    async read() {
      let value: string | null | undefined;
      try {
        value = await entry.getPassword();
      } catch {
        throw new EnterpriseCredentialStoreError('read');
      }

      if (value === null || value === undefined) return undefined;

      try {
        return parseCredential(value);
      } catch {
        try {
          await entry.deletePassword();
        } catch {
          // A malformed credential remains unusable even when cleanup also fails.
        }
        throw new EnterpriseCredentialStoreError('decode');
      }
    },

    async write(credential) {
      let serialized: string;
      try {
        serialized = JSON.stringify(validateCredential(credential));
      } catch {
        throw new EnterpriseCredentialStoreError('write');
      }

      try {
        await entry.setPassword(serialized);
      } catch {
        throw new EnterpriseCredentialStoreError('write');
      }
    },

    async delete() {
      try {
        await entry.deletePassword();
      } catch {
        throw new EnterpriseCredentialStoreError('delete');
      }
    }
  };
}

export function createSystemEnterpriseCredentialStore(input?: {
  e2eRunId?: string;
}): EnterpriseCredentialStore {
  const identity = resolveEnterpriseCredentialIdentity(input?.e2eRunId);
  return createEnterpriseCredentialStore({
    entry: new AsyncEntry(identity.service, identity.account)
  });
}

function parseCredential(value: string): EnterpriseCredential {
  const parsed: unknown = JSON.parse(value);
  return validateCredential(parsed);
}

function validateCredential(value: unknown): EnterpriseCredential {
  if (!isPlainObject(value)) throw new Error('invalid credential');

  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes('accessToken') ||
    !keys.includes('expiresAt') ||
    typeof value.accessToken !== 'string' ||
    value.accessToken.length === 0 ||
    typeof value.expiresAt !== 'string' ||
    !isRfc3339(value.expiresAt)
  ) {
    throw new Error('invalid credential');
  }

  return {
    accessToken: value.accessToken,
    expiresAt: value.expiresAt
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRfc3339(value: string): boolean {
  return RFC_3339_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}
