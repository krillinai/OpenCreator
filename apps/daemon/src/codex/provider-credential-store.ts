import { AsyncEntry } from '@napi-rs/keyring';

const SERVICE = 'com.opencreator.codex-provider';
const ACCOUNT = 'default';

type CredentialEntry = {
  getPassword(): Promise<string | null | undefined>;
  setPassword(value: string): Promise<void>;
};

export type CodexProviderCredentialStore = {
  readApiKey(): Promise<string | undefined>;
  writeApiKey(apiKey: string): Promise<void>;
};

export type CodexProviderIdentity = {
  baseUrl: string;
  model: string;
};

export function createCodexProviderCredentialStore(
  entry: CredentialEntry
): CodexProviderCredentialStore {
  return {
    async readApiKey() {
      const apiKey = (await entry.getPassword())?.trim();
      return apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
    },
    async writeApiKey(apiKey) {
      await entry.setPassword(apiKey);
    }
  };
}

export function createSystemCodexProviderCredentialStore(): CodexProviderCredentialStore {
  return createCodexProviderCredentialStore(new AsyncEntry(SERVICE, ACCOUNT));
}

export async function readCodexProviderApiKey(input: {
  store: CodexProviderCredentialStore;
  provider: CodexProviderIdentity;
  readLegacy(): Promise<{
    baseUrl: string;
    model: string;
    apiKey: string;
  }>;
}): Promise<string | undefined> {
  let apiKey: string | undefined;
  try {
    apiKey = await input.store.readApiKey();
  } catch {
    apiKey = undefined;
  }
  if (apiKey !== undefined) return apiKey;

  const legacy = await input.readLegacy();
  const legacyApiKey = (
    legacy.baseUrl === input.provider.baseUrl
    && legacy.model === input.provider.model
    && legacy.apiKey.trim().length > 0
  )
    ? legacy.apiKey
    : undefined;
  if (legacyApiKey !== undefined) {
    try {
      await input.store.writeApiKey(legacyApiKey);
    } catch {
      // Keep using the legacy value until secure migration succeeds.
    }
  }
  return legacyApiKey;
}
