import Fastify from 'fastify';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { afterEach, expect, it, vi } from 'vitest';
import * as module from '../../src/gateway/creator-service-source.js';
import { createVideoGenerationService } from '../../src/video-generation/service.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';

const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const callback of close.splice(0)) await callback(); });
it('reuses the persisted legacy request identity after acceptance loss and Daemon restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-gateway-restart-'));
  const upstream = Fastify();
  const identities: string[] = [];
  const accepted = new Set<string>();
  upstream.post('/v1/chat/completions', async (request, reply) => {
    const identity = request.headers['idempotency-key'] as string;
    identities.push(identity); accepted.add(identity);
    if (identities.length === 1) { reply.hijack(); reply.raw.destroy(); return; }
    return reply.header('X-Request-ID', 'gateway_original_receipt').send({ choices: [{ message: { content: 'original result' } }] });
  });
  upstream.get('/v1/requests/gateway_original_receipt', async () => ({ requestId: 'gateway_original_receipt', state: 'succeeded' }));
  const origin = await upstream.listen({ host: '127.0.0.1', port: 0 });
  let db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  let repository = createCreatorRepository(db);
  const job = repository.createJob({ projectId: 'project', templateId: 'wechat-article', templateVersion: 1, status: 'running', state: {} });
  const stage = repository.createStageRun({ jobId: job.id, stageId: 'article', executor: 'wechat-article', status: 'running' });
  let currentStage = stage.id;
  const manual = createDefaultCreatorServicesConfig();
  const buildSource = () => module.createGatewayCreatorSource({
    ledger: new CreatorProviderRequestLedger(repository),
    readJobBinding: () => ({ source: 'gateway', accountId: 'a', bindingVersion: 'a:1', models: { text: 'text' }, capabilities: { text: ['chat'] } }),
    readStageRun: (id: string) => repository.getStageRun(id),
    account: { peekState: () => ({ source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', models: [], activationError: null }), modelCredentials: async () => ({ accountId: 'a', modelKey: 'cloud-secret', keyVersion: '1', bindingVersion: 'a:1', baseUrl: `${origin}/v1`, defaults: { text: 'text' }, models: [] }) },
    manual: { read: async () => manual, write: async c => c, reset: async () => manual }, getLocalOrigin: () => 'http://127.0.0.1:39999'
  });
  let server = Fastify();
  let source = buildSource();
  const submit = () => source.runForJob(job.id, currentStage, async () => {
    const config = await source.store.read();
    return server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/chat/completions', headers: { Authorization: `Bearer ${config.llm.apiKey}` }, payload: { model: 'text', messages: [{ role: 'user', content: 'write article' }] } });
  });
  try {
    await source.register(server);
    expect((await submit()).statusCode).toBe(503);
    expect(repository.getJob(job.id)!.providerRequests).toHaveLength(1);
    expect(repository.getJob(job.id)!.providerRequests[0]!.status).toBe('unknown_remote_acceptance');
    await source.revoke(); await server.close(); db.close();
    db = openRuntimeDatabase(join(root, 'runtime.sqlite')); repository = createCreatorRepository(db);
    currentStage = repository.createStageRun({ jobId: job.id, stageId: 'article', executor: 'wechat-article', status: 'running', progress: { resumedFromStageRunId: stage.id } }).id;
    server = Fastify(); source = buildSource(); await source.register(server);
    expect((await submit()).statusCode).toBe(200);
    await vi.waitFor(() => expect(repository.getJob(job.id)!.providerRequests[0]).toMatchObject({ status: 'succeeded', remoteTaskId: 'gateway_original_receipt' }));
    expect(repository.getJob(job.id)!.providerRequests).toHaveLength(1);
    expect(identities).toHaveLength(2);
    expect(identities[1]).toBe(identities[0]);
    expect(accepted.size).toBe(1);
  } finally {
    await source.revoke(); await server.close(); db.close(); await upstream.close(); await rm(root, { recursive: true, force: true });
  }
});
it('stores one original gateway receipt for managed legacy model retries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-gateway-receipt-')); close.push(() => rm(root, { recursive: true, force: true }));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite')); close.push(async () => { db.close(); });
  const repository = createCreatorRepository(db);
  const job = repository.createJob({ projectId: 'project', templateId: 'wechat-article', templateVersion: 1, status: 'running', state: {} });
  const stage = repository.createStageRun({ jobId: job.id, stageId: 'article', executor: 'wechat-article', status: 'running' });
  const manual = createDefaultCreatorServicesConfig();
  const server = Fastify(); close.push(() => server.close());
  const state = { source: 'gateway' as const, authState: 'signed_in' as const, activationState: 'ready' as const, account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', models: [], activationError: null };
  const source = module.createGatewayCreatorSource({ ledger: new CreatorProviderRequestLedger(repository),
    readJobBinding: () => ({ source: 'gateway', accountId: 'a', bindingVersion: 'a:1', models: { text: 'text' }, capabilities: { text: ['chat'] } }),
    account: { peekState: () => state, modelCredentials: async () => ({ accountId: 'a', modelKey: 'cloud-secret', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://gateway.example/v1', defaults: { text: 'text' }, models: [] }) },
    manual: { read: async () => manual, write: async c => c, reset: async () => manual }, getLocalOrigin: () => 'http://127.0.0.1:39999',
    fetcher: vi.fn(async (_url, options) => options?.method === 'GET'
      ? Response.json({ requestId: 'gateway_original_receipt', state: 'succeeded' })
      : Response.json({ choices: [{ message: { content: 'article' } }] }, { headers: { 'X-Request-ID': 'gateway_original_receipt' } }))
  });
  await source.register(server);
  await source.runForJob(job.id, stage.id, async () => {
    const config = await source.store.read();
    for (let retry = 0; retry < 2; retry++) {
      expect((await server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/chat/completions', headers: { Authorization: `Bearer ${config.llm.apiKey}` }, payload: { model: 'text', messages: [{ role: 'user', content: 'write article' }] } })).statusCode).toBe(200);
    }
  });
  await vi.waitFor(() => expect(repository.getJob(job.id)!.providerRequests).toHaveLength(1));
  await vi.waitFor(() => expect(repository.getJob(job.id)!.providerRequests[0]).toMatchObject({ gateway: { accountId: 'a', bindingVersion: 'a:1' }, remoteTaskId: 'gateway_original_receipt', status: 'succeeded' }));
  await source.revoke();
});
it('official services share one local capability and inject the cloud Key only during forwarding', async () => {
  expect(module).toHaveProperty('createGatewayCreatorSource', expect.any(Function));
  const manual = createDefaultCreatorServicesConfig(); manual.llm.apiKey = 'personal-key';
  let active = true;
  let coordinatedUses = 0;
  const state = { source: 'gateway' as const, authState: 'signed_in' as const, activationState: 'ready' as const, account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', models: [], activationError: null };
  const credentials = { accountId: 'a', modelKey: 'cloud-secret', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://gateway.example/v1', defaults: { text: 'text', image: 'image', speech: 'speech', transcription: 'transcription', video: 'video' }, models: ['text','image','speech','transcription','video'].map(id => ({ id, modality: id as 'text', capabilities: [] })) };
  const server = Fastify(); close.push(() => server.close());
  const fetcher = vi.fn(async (_url, options) => {
    expect(coordinatedUses).toBe(1);
    return new Response(JSON.stringify({ usage: {}, text: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'owned-request' } });
  }) as typeof fetch;
  const source = module.createGatewayCreatorSource({
    account: { peekState: () => state, modelCredentials: async () => { if (!active) throw new Error('signed out'); return credentials; },
      beginModelUse: async () => { if (!active) throw new Error('signed out'); coordinatedUses++; return { credentials, async release() { coordinatedUses--; } }; } },
    manual: { read: async () => structuredClone(manual), write: async config => config, reset: async () => manual },
    getLocalOrigin: () => 'http://127.0.0.1:39999', fetcher,
    readJobBinding: () => ({ source: 'gateway', accountId: 'a', bindingVersion: 'a:1', models: credentials.defaults, capabilities: {} })
  });
  await source.register(server);
  const config = await source.store.read();
  expect(config.llm.apiKey).not.toBe('cloud-secret');
  expect(config.image.openai.apiKey).toBe(config.llm.apiKey);
  expect(config.tts.openai.apiKey).toBe(config.llm.apiKey);
  expect(config.transcription.openai.apiKey).toBe(config.llm.apiKey);
  for (const operation of ['chat/completions','images/generations','audio/speech','audio/transcriptions']) {
    const res = await server.inject({ method: 'POST', url: `/internal/krillin-llm/gateway/v1/${operation}`, headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Idempotency-Key': `stable-${operation}` }, payload: { model: credentials.defaults.text, input: 'hello' } });
    expect(res.statusCode).toBe(200);
    const options = vi.mocked(fetcher).mock.lastCall?.[1];
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer cloud-secret');
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(`stable-${operation}`);
    await vi.waitFor(() => expect(coordinatedUses).toBe(0));
  }
  await source.runForJob('job-original', 'stage-original', async () => {
    const scoped = await source.store.read();
    const call = () => server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/chat/completions', headers: { Authorization: `Bearer ${scoped.llm.apiKey}` }, payload: { model: 'text', messages: [{ role: 'user', content: 'retry the same work' }] } });
    await call();
    const first = new Headers(vi.mocked(fetcher).mock.lastCall?.[1]?.headers).get('Idempotency-Key');
    await call();
    expect(new Headers(vi.mocked(fetcher).mock.lastCall?.[1]?.headers).get('Idempotency-Key')).toBe(first);
    const multipart = async () => {
      const form = new FormData(); form.set('model', 'transcription'); form.set('file', new Blob(['same audio'], { type: 'audio/wav' }), 'audio.wav');
      const request = new Request('http://localhost', { method: 'POST', body: form });
      await server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/audio/transcriptions', headers: { Authorization: `Bearer ${scoped.llm.apiKey}`, 'Content-Type': request.headers.get('Content-Type')! }, payload: Buffer.from(await request.arrayBuffer()) });
      return new Headers(vi.mocked(fetcher).mock.lastCall?.[1]?.headers).get('Idempotency-Key');
    };
    expect(await multipart()).toBe(await multipart());
  });
  const originalAccount = state.account;
  state.account = { ...originalAccount, id: 'b' };
  await expect(source.runForJob('job-original', 'stage-original', async () => source.store.read())).rejects.toThrow();
  state.account = originalAccount;
  let forwardingSignal: AbortSignal | undefined;
  let release!: () => void;
  vi.mocked(fetcher).mockImplementationOnce(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    forwardingSignal = options!.signal!;
    release = () => reject(new Error('request closed'));
    forwardingSignal.addEventListener('abort', release, { once: true });
  }));
  const pending = server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/chat/completions', headers: { Authorization: `Bearer ${config.llm.apiKey}` }, payload: { model: 'text' } });
  await vi.waitFor(() => expect(forwardingSignal).toBeDefined());
  await source.revoke();
  try { expect(forwardingSignal!.aborted).toBe(true); } finally { release(); await pending; }
  active = false; await source.revoke();
  expect((await server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/chat/completions', headers: { Authorization: `Bearer ${config.llm.apiKey}` }, payload: {} })).statusCode).toBe(401);
  expect(manual.llm.apiKey).toBe('personal-key');
});

it('uses a task-specific official model without changing account defaults and rejects custom choices before execution', async () => {
  const models = [{ id: 'official/text', modality: 'text' as const, capabilities: ['responses'] }, { id: 'official/image-first', modality: 'image' as const, capabilities: [] }, { id: 'official/image-second', modality: 'image' as const, capabilities: ['edit'] }];
  const state = { source: 'gateway' as const, authState: 'signed_in' as const, activationState: 'ready' as const, account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', selectedModels: { text: 'official/text', image: 'official/image-first' }, models, activationError: null };
  const credentials = { accountId: 'a', modelKey: 'cloud-secret', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://gateway.example/v1', defaults: { ...state.selectedModels }, models };
  let choices = { image: 'official/image-second' };
  const manual = createDefaultCreatorServicesConfig();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
  const source = module.createGatewayCreatorSource({
    account: { peekState: () => state, modelCredentials: async () => credentials },
    manual: { read: async () => manual, write: async c => c, reset: async () => manual },
    getLocalOrigin: () => 'http://127.0.0.1:39999', fetcher,
    readJobBinding: () => ({ source: 'gateway', accountId: 'a', bindingVersion: 'a:1', models: { ...credentials.defaults }, capabilities: { text: ['responses'], image: [] } }),
    readJobState: () => ({ officialModels: choices })
  });
  const server = Fastify(); close.push(() => server.close());
  await source.register(server);
  await source.runForJob('job', 'stage', async () => {
    const config = await source.store.read();
    expect(config.image.openai.model).toBe('official/image-second');
    expect(module.gatewayCreatorBinding(config)?.capabilities?.image).toEqual(['edit']);
    expect((await server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/images/generations', headers: { Authorization: `Bearer ${config.image.openai.apiKey}` }, payload: { model: config.image.openai.model, prompt: 'draw' } })).statusCode).toBe(200);
  });
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toMatchObject({ model: 'official/image-second' });
  expect(credentials.defaults.image).toBe('official/image-first');
  expect(state.selectedModels.image).toBe('official/image-first');
  choices = { image: 'personal-model' };
  const execute = vi.fn();
  await expect(source.runForJob('job', 'stage', execute)).rejects.toMatchObject({ code: 'invalid_model' });
  expect(execute).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledOnce();
  await source.revoke();
});

it('video uses the unified gateway task and preserves its account for query and download', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-gateway-video-')); close.push(() => rm(root, { recursive: true, force: true }));
  const fetcher = vi.fn(async (url: URL | RequestInfo, options?: RequestInit) => {
    if (String(url).endsWith('/video/jobs')) return Response.json({ requestId: 'gateway_request_original', state: 'waiting_upstream' }, { status: 202 });
    if (String(url).endsWith('/result')) return new Response(new Uint8Array([1,2,3]), { headers: { 'Content-Type': 'video/mp4' } });
    return Response.json({ requestId: 'gateway_request_original', state: 'succeeded' });
  }) as typeof fetch;
  const binding = { accountId: 'a', bindingVersion: 'a:1', baseUrl: 'http://127.0.0.1:39999/internal/krillin-llm/gateway/v1', apiKey: 'local-token', models: { video: 'gateway-video' }, catalog: [{ id: 'gateway-video', modality: 'video' as const, capabilities: [], sizes: ['1280x720', '720x1280'], durations: [4, 5] }] };
  const service = createVideoGenerationService({ dataDir: root, configStore: { read: async () => createDefaultCreatorServicesConfig(), write: async c => c, reset: async () => createDefaultCreatorServicesConfig() }, fetchImpl: fetcher, gatewaySource: { binding: async () => binding } });
  await expect(service.create({ prompt: 'test', provider: 'seedance', model: 'personal-model', size: '1280x720', duration: 5 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(service.create({ prompt: 'test', provider: 'seedance', size: '1024x1024', duration: 5 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(service.create({ prompt: 'test', provider: 'seedance', size: '1280x720', duration: 8 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(fetcher).not.toHaveBeenCalled();
  const result = await service.create({ prompt: 'test', provider: 'seedance', size: '1280x720', duration: 5 }, { logicalId: 'stage-original' });
  expect(result.status).toBe('in_progress');
  expect(String(vi.mocked(fetcher).mock.calls[0]?.[0])).toContain('/video/jobs');
  expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'gateway-video', size: '1280x720', duration: 5 });
  expect(new Headers(vi.mocked(fetcher).mock.calls[0]?.[1]?.headers).get('Idempotency-Key')).toBe('stage-original');
  const completed = await service.refresh(result.id);
  expect(completed.status).toBe('completed');
  expect((await service.read(result.id)).content).toEqual(Buffer.from([1,2,3]));
  binding.accountId = 'other';
  await expect(service.refresh(result.id)).rejects.toThrow();
  binding.accountId = 'a';
  await expect(service.create({ prompt: 'official model duration', provider: 'veo', size: '720x1280', duration: 5 })).resolves.toMatchObject({ status: 'in_progress', videoSize: '720x1280' });
});
