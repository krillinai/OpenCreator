import { expect, it, vi } from 'vitest';
import { accountSchema, createGatewayClient } from '../../src/gateway/client.js';

it('accepts only the explicit direct transport endpoint for official credentials', async () => {
  const value = { schemaVersion: 1, transport: 'openrouter-direct', account: { id: 'a', email: 'a@test', verified: true }, modelKey: 'private', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://openrouter.ai/api/v1', models: [], defaults: {} };
  const fetcher = vi.fn(async () => Response.json(value));
  const client = createGatewayClient('https://gateway.example', fetcher);
  expect((await client.bootstrap('device-access')).transport).toBe('openrouter-direct');
  value.baseUrl = 'https://other.test/v1';
  await expect(client.bootstrap('device-access')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
});

it('keeps optional profile pictures while accepting old accounts', () => {
  const account = { id: 'a', email: 'a@example.test', verified: true };
  expect(accountSchema.parse(account)).toEqual(account);
  const photo = { ...account, avatarUrl: 'https://lh3.googleusercontent.com/photo' };
  expect(accountSchema.parse(photo)).toEqual(photo);
});

it('retrieves bounded avatar bytes using the device session', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
  const client = createGatewayClient('https://gateway.example', fetcher);
  expect(await client.avatar('private-device-token', 'a')).toEqual({ data: Buffer.from([1, 2, 3]), contentType: 'image/png' });
  expect(fetcher).toHaveBeenCalledWith('https://gateway.example/api/v1/me/avatar?accountId=a', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer private-device-token' }) }));
});

it('rejects oversized and non-image avatar responses and preserves account errors', async () => {
  for (const response of [new Response('<html>unavailable</html>', { headers: { 'Content-Type': 'text/html' } }), new Response(new Uint8Array(1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } })]) {
    const client = createGatewayClient('https://gateway.example', vi.fn(async () => response));
    await expect(client.avatar('private-device-token', 'a')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
  }
  const client = createGatewayClient('https://gateway.example', vi.fn(async () => Response.json({ error: { code: 'auth_required' } }, { status: 401 })));
  await expect(client.avatar('private-device-token', 'a')).rejects.toMatchObject({ code: 'auth_required', status: 401 });
});
