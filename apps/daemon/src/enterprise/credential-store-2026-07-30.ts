import { createPrivateJsonDocumentEntry } from '../config/private-json-file.js';

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

export class EnterpriseCredentialStoreError extends Error {
  readonly code = 'ENTERPRISE_CONFIG_FILE_UNAVAILABLE';

  constructor(stage: 'read' | 'write' | 'delete' | 'decode') {
    super(`ENTERPRISE_CONFIG_FILE_UNAVAILABLE: enterprise credential ${stage} failed`);
    this.name = 'EnterpriseCredentialStoreError';
  }
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

export function createFileEnterpriseCredentialStore(input: {
  path: string;
}): EnterpriseCredentialStore {
  return createEnterpriseCredentialStore({
    entry: createPrivateJsonDocumentEntry(input.path)
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
