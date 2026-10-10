import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig, type GatewayAccountState } from '@opencreator/protocol';
import { registerCreatorServicesRoutes } from '../../src/api/routes.creator-services.js';
import { createGatewayCreatorSource } from '../../src/gateway/creator-service-source.js';

const servers: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); });

it('edits shared networking while signed in and preserves all custom settings across sign-out', async () => {
  let custom = createDefaultCreatorServicesConfig();
  custom.llm = { source: 'custom', baseUrl: 'https://custom.test/v1', apiKey: 'private-key', model: 'custom-model', jsonMode: false };
  const original = structuredClone(custom);
  const network = { read: async () => structuredClone(custom), write: async (config: typeof custom) => { custom = config; return config; }, reset: async () => { custom = createDefaultCreatorServicesConfig(); return custom; } };
  const models = [{ id: 'official/text', modality: 'text' as const, capabilities: ['responses'] }];
  const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', models, activationError: null };
  const source = createGatewayCreatorSource({ manual: network, getLocalOrigin: () => 'http://127.0.0.1:1234', account: {
    peekState: () => state, modelCredentials: async () => ({ accountId: 'a', bindingVersion: '1', keyVersion: '1', baseUrl: 'https://official.test', modelKey: 'official-key', models, defaults: { text: 'official/text' } })
  } });
  const server = Fastify(); servers.push(server);
  await registerCreatorServicesRoutes(server, source.store, undefined, undefined, undefined, undefined, undefined, network);
  const proxy = 'http://127.0.0.1:7897';
  expect((await server.inject({ method: 'PATCH', url: '/creator-services/network', payload: { proxy } })).json()).toEqual({ proxy });
  expect((await server.inject('/creator-services/network')).body).not.toContain('private-key');
  expect(await source.store.read()).toMatchObject({ proxy, llm: { model: 'official/text' } });
  expect(custom).toEqual({ ...original, proxy });
  state.source = 'manual'; state.authState = 'signed_out';
  expect(await source.store.read()).toEqual({ ...original, proxy });
  const staleForm = { ...original, proxy: '', llm: { ...original.llm, apiKey: '', model: 'edited-model' } };
  expect((await server.inject({ method: 'PATCH', url: '/creator-services/config', payload: staleForm })).statusCode).toBe(200);
  expect(custom.proxy).toBe(proxy); expect(custom.llm.apiKey).toBe('private-key'); expect(custom.llm.model).toBe('edited-model');
  expect((await server.inject({ method: 'DELETE', url: '/creator-services/config' })).statusCode).toBe(200);
  expect(custom.proxy).toBe(proxy);
  expect((await server.inject({ method: 'PATCH', url: '/creator-services/network', payload: { proxy: '' } })).json()).toEqual({ proxy: '' });
});

it.each([{ proxy: 'socks5://127.0.0.1:1080' }, { proxy: 'http://127.0.0.1:7897/path' }, { proxy: '', llm: {} }])('rejects invalid or unrelated network fields: %j', async payload => {
  const config = createDefaultCreatorServicesConfig();
  const store = { read: async () => config, write: vi.fn(async () => config), reset: async () => config };
  const server = Fastify(); servers.push(server); await registerCreatorServicesRoutes(server, store);
  expect((await server.inject({ method: 'PATCH', url: '/creator-services/network', payload })).statusCode).toBe(400);
  expect(store.write).not.toHaveBeenCalled();
});
