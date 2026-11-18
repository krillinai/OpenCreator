import type { CodexProviderConfig, CodexRuntimeReadiness } from '@opencreator/protocol';
import { readJsonFromStorage } from '../../storage/browser-storage.js';

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

export function hasLegacyAgentSetupConfirmation(): boolean {
  return readJsonFromStorage<unknown>(confirmationKey) !== null;
}
