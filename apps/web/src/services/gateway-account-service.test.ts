import { expect, it, vi } from 'vitest';
import { RuntimeClient } from '../runtime/client.js';
import type { GatewayAccountState, GatewayModelCatalog } from '@opencreator/protocol';
import { createGatewayAccountService, type GatewayBillingSummary } from './gateway-account-service.js';

const signedIn: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: null, models: [], activationError: null };
const signedOut: GatewayAccountState = { ...signedIn, source: 'manual', authState: 'signed_out', account: null };
const summary: GatewayBillingSummary = { balance: { availableUnits: '123000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-15T00:00:00Z' }, subscription: null, billingAvailable: true };

it('reuses image and video catalogs for one hour across repeated workspace visits', async () => {
  const image: GatewayModelCatalog = { models: [{ id: 'image/a', name: 'Image A', vendor: 'Vendor', modality: 'image', capabilities: [] }] };
  const video: GatewayModelCatalog = { models: [{ id: 'video/a', name: 'Video A', vendor: 'Vendor', modality: 'video', capabilities: [] }] };
  const get = vi.fn(async (path: string) => path.includes('modality=video') ? video : image);
  const service = createGatewayAccountService({ get, post: vi.fn(), patch: vi.fn() } as never);
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    expect(service.getCachedImageCatalog()).toBeUndefined();
    await expect(service.getImageCatalog()).resolves.toBe(image);
    await expect(service.getVideoCatalog()).resolves.toBe(video);
    now.mockReturnValue(1_000 + 60 * 60_000 - 1);
    await expect(service.getImageCatalog()).resolves.toBe(image);
    await expect(service.getVideoCatalog()).resolves.toBe(video);
    expect(service.getCachedImageCatalog()).toBe(image);
    expect(service.getCachedVideoCatalog()).toBe(video);
    expect(get).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1_000 + 60 * 60_000);
    await service.getImageCatalog();
    expect(get).toHaveBeenCalledTimes(3);
  } finally { now.mockRestore(); }
});

it('reuses the public text catalog for one hour and refreshes it independently', async () => {
  const text: GatewayModelCatalog = { models: [{ id: 'vendor/text', name: 'Text One', vendor: 'Vendor', modality: 'text', capabilities: ['chat'] }] };
  const get = vi.fn(async () => text);
  const service = createGatewayAccountService({ get, post: vi.fn(), patch: vi.fn() } as never);
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    expect(service.getCachedTextCatalog()).toBeUndefined();
    await expect(service.getTextCatalog()).resolves.toBe(text);
    expect(get).toHaveBeenCalledWith('/gateway/models/catalog?modality=text');
    now.mockReturnValue(1_000 + 60 * 60_000 - 1);
    await expect(service.getTextCatalog()).resolves.toBe(text);
    expect(get).toHaveBeenCalledOnce();
    now.mockReturnValue(1_000 + 60 * 60_000);
    await service.getTextCatalog();
    expect(get).toHaveBeenCalledTimes(2);
  } finally { now.mockRestore(); }
});

it('shares in-flight catalog requests and lets retry bypass a fresh cache without discarding it on failure', async () => {
  const image: GatewayModelCatalog = { models: [{ id: 'image/a', modality: 'image', capabilities: [] }] };
  const updated: GatewayModelCatalog = { models: [{ id: 'image/b', modality: 'image', capabilities: [] }] };
  let finish!: (catalog: GatewayModelCatalog) => void;
  const get = vi.fn().mockImplementationOnce(() => new Promise<GatewayModelCatalog>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(updated).mockRejectedValueOnce(new Error('offline'));
  const service = createGatewayAccountService({ get, post: vi.fn(), patch: vi.fn() } as never);
  const first = service.getImageCatalog();
  const second = service.getImageCatalog();
  expect(get).toHaveBeenCalledOnce();
  finish(image);
  await expect(Promise.all([first, second])).resolves.toEqual([image, image]);
  await expect(service.getImageCatalog({ refresh: true })).resolves.toBe(updated);
  expect(service.getCachedImageCatalog()).toBe(updated);
  await expect(service.getImageCatalog({ refresh: true })).rejects.toThrow('offline');
  expect(service.getCachedImageCatalog()).toBe(updated);
  expect(get).toHaveBeenCalledTimes(3);
});

it('checks task models through the Daemon without changing global defaults', async () => {
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json({ costBearer: 'customer' })) });
  const post = vi.spyOn(client, 'post'); const patch = vi.spyOn(client, 'patch');
  await createGatewayAccountService(client).probeModel('video', 'vendor/video');
  expect(post).toHaveBeenCalledWith('/gateway/model/probe', { modality: 'video', model: 'vendor/video' });
  expect(patch).not.toHaveBeenCalled();
});

it('remembers a task model without changing the account model', async () => {
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json(signedIn)) });
  const patch = vi.spyOn(client, 'patch');
  await createGatewayAccountService(client).rememberTaskModel('image-generation', 'image', 'vendor/image-2');
  expect(patch).toHaveBeenCalledWith('/gateway/task-model', {
    templateId: 'image-generation', modality: 'image', model: 'vendor/image-2'
  });
  expect(patch).not.toHaveBeenCalledWith('/gateway/model', expect.anything());
});

it('checks browser authorization through the shared Daemon and adds the host return destination', async () => {
  const grant = { attemptId: 'attempt-1', authorizationUrl: 'https://gateway.example/device?grant=attempt-1', expiresAt: '2026-10-10T12:00:00Z' };
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json(grant)) });
  const post = vi.spyOn(client, 'post');
  const service = createGatewayAccountService(client, { authorizationReturnUrl: 'opencreator://auth/complete' });
  const result = await service.start();
  expect(new URL(result.authorizationUrl).searchParams.get('returnTo')).toBe('opencreator://auth/complete');
  expect(new URL(result.authorizationUrl).searchParams.get('grant')).toBe('attempt-1');
  expect(result.attemptId).toBe(grant.attemptId);
  await service.getState({ checkAuthorization: true });
  expect(post).toHaveBeenLastCalledWith('/gateway/auth/check', {});
});
it('displays a signed-in account when official activation is blocked', async () => {
  const snapshot = { source: 'manual', authState: 'signed_in', activationState: 'blocked', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: null, models: [], activationError: { code: 'services_not_ready', message: 'Official service is not ready' } };
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json(snapshot)) });
  await expect(createGatewayAccountService(client).getState()).resolves.toEqual(snapshot);
});

it('forces a model catalog refresh through the shared Daemon', async () => {
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json({})) });
  const read = vi.spyOn(client, 'get'); const post = vi.spyOn(client, 'post');
  const service = createGatewayAccountService(client);
  await service.getState({ refreshModels: true });
  expect(read).toHaveBeenLastCalledWith('/gateway/account?refreshModels=1');
  await service.getState({ checkAuthorization: true, refreshModels: true });
  expect(post).toHaveBeenLastCalledWith('/gateway/auth/check', {});
  expect(read).toHaveBeenCalledTimes(2);
});

it('reads the subscription summary through the shared Daemon', async () => {
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json({})) });
  const read = vi.spyOn(client, 'get');
  await createGatewayAccountService(client).getSummary();
  expect(read).toHaveBeenCalledWith('/gateway/billing/summary');
});

it('preloads credits without blocking account state and shares an in-flight read', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/gateway/account')
    ? Response.json(signedIn) : new Promise<Response>(resolve => { finish = resolve; }));
  const service = createGatewayAccountService(new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: fetcher }));
  await expect(service.getState()).resolves.toEqual(signedIn);
  const first = service.getSummary();
  expect(service.getSummary()).toBe(first);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(service.getCachedSummary('a')).toBeUndefined();
  finish(Response.json(summary));
  await expect(first).resolves.toEqual(summary);
  expect(service.getCachedSummary('a')).toEqual(summary);
  expect(service.getCachedSummary('b')).toBeUndefined();
  await service.getState();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('refreshes cached credits from the server and retains them when a refresh fails', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/gateway/account') ? signedIn : summary));
  const service = createGatewayAccountService(new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: fetcher }));
  await service.getState(); await service.getSummary();
  const updated = { ...summary, balance: { ...summary.balance, availableUnits: '8000000' } };
  fetcher.mockResolvedValueOnce(Response.json(updated));
  await expect(service.getSummary()).resolves.toEqual(updated);
  expect(service.getCachedSummary('a')).toEqual(updated);
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await expect(service.getSummary()).rejects.toThrow();
  expect(service.getCachedSummary('a')).toEqual(updated);
});

it('discards a pending credit preload when the signed-in account changes', async () => {
  let finish!: (response: Response) => void;
  const next = { ...signedIn, account: { ...signedIn.account!, id: 'b' } };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(signedIn))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(Response.json(next))
    .mockResolvedValueOnce(Response.json({ ...summary, balance: { ...summary.balance, availableUnits: '8000000' } }));
  const service = createGatewayAccountService(new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: fetcher }));
  await service.getState(); const previous = service.getSummary();
  await service.getState(); await service.getSummary();
  finish(Response.json(summary)); await previous;
  expect(service.getCachedSummary('a')).toBeUndefined();
  expect(service.getCachedSummary('b')?.balance.availableUnits).toBe('8000000');
});

it('clears cached credits on logout and ignores an earlier account response', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(signedIn))
    .mockResolvedValueOnce(Response.json(summary))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(Response.json(signedOut));
  const service = createGatewayAccountService(new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: fetcher }));
  await service.getState(); await service.getSummary();
  const pending = service.getState();
  await service.logout();
  finish(Response.json(signedIn)); await pending;
  expect(service.getCachedSummary('a')).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('cannot restore a pending credit response after logout', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(signedIn))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(Response.json(signedOut));
  const service = createGatewayAccountService(new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: fetcher }));
  await service.getState(); const pending = service.getSummary();
  await service.logout(); finish(Response.json(summary)); await pending;
  expect(service.getCachedSummary('a')).toBeUndefined();
});
it('requests a website session with the host billing return address', async () => {
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json({ url: 'https://gateway.example/auth#handoff=code' })) });
  const post = vi.spyOn(client, 'post');
  await createGatewayAccountService(client, { billingReturnUrl: 'opencreator://billing/return' }).openWebAccount('recharge', 'zh');
  expect(post).toHaveBeenLastCalledWith('/gateway/account/web', { destination: 'recharge', locale: 'zh', returnUrl: 'opencreator://billing/return' });
});
it('loads private order details and pages credit grants through the shared Daemon', async () => {
  const client = new RuntimeClient({ baseUrl: 'http://localhost', fetchImpl: vi.fn(async () => Response.json({})) });
  const read = vi.spyOn(client, 'get'); const post = vi.spyOn(client, 'post');
  const service = createGatewayAccountService(client);
  await service.getOrder('order/a');
  expect(read).toHaveBeenLastCalledWith('/gateway/billing/orders/order%2Fa');
  await service.getCreditGrants('trial:a+b');
  expect(read).toHaveBeenLastCalledWith('/gateway/billing/ledger?cursor=trial%3Aa%2Bb');
  await service.checkout('starter', 'operation-id', { locale: 'zh', currency: 'hkd' });
  expect(post).toHaveBeenLastCalledWith('/gateway/billing/checkout', { planId: 'starter', operationId: 'operation-id', locale: 'zh', currency: 'hkd' });
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
