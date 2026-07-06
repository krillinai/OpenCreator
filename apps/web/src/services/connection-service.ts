import type { CodexStatusResponse } from '@clawee/protocol';
import { ApiClientError, type RuntimeClient } from '../runtime/client.js';

export type ConnectionState =
  | { status: 'disconnected'; message: string }
  | { status: 'connected'; codexStatus: CodexStatusResponse }
  | { status: 'invalid_token'; message: string };

type ClientLike = Pick<RuntimeClient, 'get'>;

export function createConnectionService(client: ClientLike) {
  return {
    async check(): Promise<ConnectionState> {
      try {
        await client.get('/healthz');
        const codexStatus = await client.get<CodexStatusResponse>('/codex/status');
        return { status: 'connected', codexStatus };
      } catch (error) {
        const message = errorMessage(error);
        if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
          return { status: 'invalid_token', message };
        }
        return { status: 'disconnected', message };
      }
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Runtime connection failed';
}
