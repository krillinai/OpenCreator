import { expect, it, vi } from 'vitest';
import { RuntimeClient } from '../runtime/client.js';
import { createGatewayAccountService } from './gateway-account-service.js';

it('displays a signed-in account when official activation is blocked', async () => {
  const snapshot = { source: 'manual', authState: 'signed_in', activationState: 'blocked', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: null, models: [], activationError: { code: 'services_not_ready', message: 'Official service is not ready' } };
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json(snapshot)) });
  await expect(createGatewayAccountService(client).getState()).resolves.toEqual(snapshot);
});

it('reads the subscription summary through the shared Daemon', async () => {
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json({})) });
  const read = vi.spyOn(client, 'get');
  await createGatewayAccountService(client).getSummary();
  expect(read).toHaveBeenCalledWith('/gateway/billing/summary');
});

it('loads and shares photo bytes through the authenticated Runtime client', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
  const client = new RuntimeClient({ baseUrl: 'http://localhost', token: 'runtime-token', fetchImpl: fetcher });
  const service = createGatewayAccountService(client);
  const [first, second] = await Promise.all([service.getAvatar!('a', 'picture-1'), service.getAvatar!('a', 'picture-1')]);
  expect(first).toBe(second);
  expect(first.type).toBe('image/png');
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://localhost/gateway/avatar?accountId=a', expect.objectContaining({ headers: { Authorization: 'Bearer runtime-token' } }));
  await service.getAvatar!('b', 'picture-2');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
