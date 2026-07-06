import { describe, expect, it } from 'vitest';
import { ApiClientError, type RuntimeClient } from '../runtime/client.js';
import { createConnectionService } from './connection-service.js';

describe('ConnectionService', () => {
  it('returns invalid_token for unauthorized Runtime responses', async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new ApiClientError({ status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
    } satisfies Pick<RuntimeClient, 'get'>;
    const service = createConnectionService(client);

    await expect(service.check()).resolves.toEqual({ status: 'invalid_token', message: 'Unauthorized' });
  });

  it('returns disconnected for network errors', async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new TypeError('fetch failed');
      }
    } satisfies Pick<RuntimeClient, 'get'>;
    const service = createConnectionService(client);

    await expect(service.check()).resolves.toEqual({ status: 'disconnected', message: 'fetch failed' });
  });
});
