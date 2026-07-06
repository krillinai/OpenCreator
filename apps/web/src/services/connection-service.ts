import type { CodexStatusResponse } from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export type ConnectionState =
  | { status: 'disconnected'; message: string }
  | { status: 'connected'; codexStatus: CodexStatusResponse }
  | { status: 'invalid_token'; message: string };

export function createConnectionService(client: RuntimeClient) {
  return {
    async check(): Promise<ConnectionState> {
      await client.get('/healthz');
      const codexStatus = await client.get<CodexStatusResponse>('/codex/status');
      return { status: 'connected', codexStatus };
    }
  };
}
