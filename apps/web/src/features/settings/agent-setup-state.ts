import type { CodexProviderConfig, CodexRuntimeReadiness } from '@opencreator/protocol';
import { readJsonFromStorage, writeJsonToStorage } from '../../storage/browser-storage.js';

export type AgentSetupSnapshot = { readiness: CodexRuntimeReadiness; provider: CodexProviderConfig };
const confirmationKey = 'opencreator.agent-setup-confirmed.v1';

export function needsAgentSetup(readiness: CodexRuntimeReadiness): boolean {
  return readiness.account.accountStatus === 'signed_out'
    || readiness.account.accountStatus === 'expired'
    || readiness.account.status === 'not_authenticated';
}

export function availableAgentMode({ readiness, provider }: AgentSetupSnapshot): 'chatgpt' | 'api_key' | null {
  if (readiness.binary.status !== 'ready' || readiness.protocol.status !== 'ready'
    || readiness.models.status !== 'ready' || readiness.state === 'blocked') return null;
  if (provider.authentication === 'chatgpt' && provider.baseUrl.length === 0
    && !needsAgentSetup(readiness) && readiness.account.status === 'ready') return 'chatgpt';
  if (provider.authentication === 'api_key' && provider.apiKeyConfigured && provider.model.trim().length > 0
    && (readiness.account.status === 'ready' && readiness.account.accountStatus === 'signed_in'
      || readiness.account.status === 'not_authenticated' && readiness.account.accountStatus === 'signed_out'
        && provider.baseUrl.trim().length > 0)) return 'api_key';
  return null;
}

function confirmationValue(snapshot: AgentSetupSnapshot): string {
  const { provider } = snapshot;
  return JSON.stringify([
    availableAgentMode(snapshot), provider.authentication,
    provider.baseUrl, provider.model, provider.apiKeyConfigured
  ]);
}

export function isAgentSetupConfirmed(snapshot: AgentSetupSnapshot): boolean {
  if (availableAgentMode(snapshot) === null) return false;
  const stored = readJsonFromStorage<unknown>(confirmationKey);
  const current = confirmationValue(snapshot);
  if (stored === current) return true;
  if (typeof stored !== 'string') return false;
  try {
    const legacy = JSON.parse(stored) as unknown;
    // Older confirmations included codexHome, which changes between runtime profiles.
    return Array.isArray(legacy) && legacy.length === 6
      && typeof legacy[0] === 'string'
      && JSON.stringify(legacy.slice(1)) === current;
  } catch {
    return false;
  }
}

export function hasAgentSetupConfirmation(): boolean {
  return readJsonFromStorage<string>(confirmationKey) !== null;
}

export function confirmAgentSetup(snapshot: AgentSetupSnapshot): void {
  try {
    writeJsonToStorage(confirmationKey, confirmationValue(snapshot));
  } catch {}
}
