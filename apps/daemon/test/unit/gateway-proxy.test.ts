import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createGatewayClient, bootstrapSchema, type GatewayBootstrap } from '../../src/gateway/client.js';
import { createGatewayAccountService } from '../../src/gateway/account-service.js';
import { createGatewayConfigStore } from '../../src/gateway/config-store.js';
import { createDirectRuntime } from '../../src/gateway/direct-runtime.js';
import Fastify from 'fastify';
import { createGatewayCreatorSource } from '../../src/gateway/creator-service-source.js';
import { createDefaultCreatorServicesConfig, gatewayRecommendedModelId } from '@opencreator/protocol';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';

const bootstrap: GatewayBootstrap = { schemaVersion: 3, transport: 'gateway', supplier: 'chatanywhere', keyRotation: false,
  account: { id: 'wallet-user', email: 'wallet@example.test', verified: true }, keyVersion: 'gateway-v1', bindingVersion: 'wallet-user:gateway:v1',
  baseUrl: 'https://gateway.example/v1', models: [{ id: 'gpt-4o-mini', modality: 'text', capabilities: ['responses', 'chat'] }], defaults: { text: 'gpt-4o-mini' } };

it('accepts protocol 3 without supplier keys and pins the gateway origin', async () => {
  let value = { ...bootstrap };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(value));
  const client = createGatewayClient('https://gateway.example', fetcher);
  expect(await client.bootstrap('device-access-token')).toEqual(bootstrap);
  expect(fetcher.mock.calls[0]?.[0]).toContain('protocolVersion=3');
  expect(bootstrapSchema.safeParse({ ...bootstrap, modelKey: 'supplier-secret' }).success).toBe(false);
  value = { ...bootstrap, baseUrl: 'https://api.chatanywhere.tech/v1' };
  await expect(client.bootstrap('device-access-token')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
});

it('reports an expired gateway account as authentication failure before creating a creator binding', () => {
  const manual = createDefaultCreatorServicesConfig();
  const source = createGatewayCreatorSource({
    account: {
      peekState: () => ({ source: 'gateway', transport: 'gateway', authState: 'expired', activationState: 'inactive',
        account: bootstrap.account, bindingVersion: null, models: bootstrap.models, activationError: null }),
      modelCredentials: vi.fn()
    },
    manual: { read: async () => manual, write: async value => value, reset: async () => manual },
    getLocalOrigin: () => 'http://127.0.0.1:39999'
  });
  expect(() => source.snapshot()).toThrow(expect.objectContaining({ code: 'auth_required', status: 401 }));
});

it('loads a gateway account, clears old supplier credentials and refreshes device authentication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-proxy-account-'));
  const store = createGatewayConfigStore(root);
  await store.writeConfiguration({ source: 'gateway', bindingVersion: 'old-binding' });
  await store.writeCredentials({ schemaVersion: 2, transport: 'supplier-direct', supplier: 'chatanywhere', modelKey: 'old-supplier-secret',
    account: bootstrap.account, keyVersion: 'old', bindingVersion: 'old-binding', baseUrl: 'https://api.chatanywhere.tech/v1', models: bootstrap.models, defaults: bootstrap.defaults,
    accessToken: 'initial-device-access', refreshToken: 'initial-device-refresh', expiresIn: 900, accessExpiresAt: new Date(Date.now() + 900000).toISOString() });
  const refresh = vi.fn(async () => ({ accessToken: 'renewed-device-access', refreshToken: 'renewed-device-refresh', expiresIn: 900 }));
  const activation = vi.fn(async (_bootstrap: GatewayBootstrap) => undefined);
  const client = { origin: 'https://gateway.example', bootstrap: vi.fn(async () => structuredClone(bootstrap)), refresh,
    startDevice: vi.fn(), pollDevice: vi.fn(), cancelDevice: vi.fn(), logout: vi.fn(), avatar: vi.fn(), request: vi.fn(async () => ({})) };
  const service = createGatewayAccountService({ dataDir: root, client, activateRuntime: activation, closeRuntime: async () => undefined,
    hasActiveTasks: () => false, automaticPolling: false, probeModel: async () => undefined });
  try {
    await service.initialize();
    expect(service.peekState()).toMatchObject({ transport: 'gateway', supplier: 'chatanywhere', activationState: 'ready' });
    const initial = await service.modelCredentials();
    expect(initial.modelKey).toBe('initial-device-access');
    expect(activation).toHaveBeenCalledWith(expect.not.objectContaining({ modelKey: expect.anything() }));
    const disk = await readFile(join(root, 'config', 'gateway-credentials.json'), 'utf8');
    expect(disk).not.toContain('old-supplier-secret'); expect(JSON.parse(disk)).not.toHaveProperty('modelKey');
    const recovered = await service.recoverModelCredentials(initial.keyVersion);
    expect(recovered.modelKey).toBe('renewed-device-access'); expect(recovered.keyVersion).not.toBe(initial.keyVersion);
    await expect(service.probeModel('text', 'gpt-4o-mini')).resolves.toMatchObject({ costBearer: 'customer' });
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

it('gives Runtime a local token and preserves one request identity across a 401 refresh', async () => {
  const seen: Array<{ key: string | null; id: string | null }> = [];
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    expect(url).toBe('https://gateway.example/v1/responses');
    const h = new Headers(options?.headers); seen.push({ key: h.get('authorization'), id: h.get('idempotency-key') });
    return seen.length === 1 ? Response.json({}, { status: 401 }) : Response.json({ status: 'completed', output: [] });
  });
  const runtime = await createDirectRuntime('initial-device-token', fetcher,
    async () => ({ key: 'initial-device-token', keyVersion: 'old', baseUrl: bootstrap.baseUrl, models: bootstrap.models, release: async () => undefined }),
    async () => ({ key: 'renewed-device-token', keyVersion: 'new' }), bootstrap.baseUrl, true);
  try {
    expect(runtime.token).not.toContain('device-token');
    const result = await fetch(`${runtime.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini', input: 'Hello' }) });
    expect(result.status).toBe(200); await result.text();
    expect(seen).toHaveLength(2); expect(seen[0]!.id).toBeTruthy(); expect(seen[1]!.id).toBe(seen[0]!.id);
    expect(seen[1]!.key).toBe('Bearer renewed-device-token');
  } finally { await runtime.close(); }
});

it.each([400, 402, 404, 422, 429, 500, 502])('preserves gateway %s and sanitized error facts through the Runtime relay', async status => {
  const failure = vi.fn(); const recover = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { code: 'upstream_rejected', upstreamCode: 'invalid_parameter',
    message: 'Invalid temperature; device-access-token https://private.test/path', requestId: 'ocreq_rejected' } }, { status }));
  const runtime = await createDirectRuntime('device-access-token', fetcher,
    async () => ({ key: 'device-access-token', keyVersion: 'one', models: bootstrap.models, release: async () => undefined, onModelFailure: failure }),
    recover, bootstrap.baseUrl, true);
  try {
    const result = await fetch(`${runtime.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini', input: 'Hello' }) });
    expect(result.status).toBe(status);
    expect(result.headers.get('x-request-id')).toBe('ocreq_rejected');
    const body = await result.json();
    expect(body).toMatchObject({ error: { code: 'invalid_parameter', requestId: 'ocreq_rejected', message: expect.stringContaining('Invalid temperature') } });
    expect(JSON.stringify(body)).not.toMatch(/device-access-token|private\.test/);
    expect(failure).toHaveBeenCalledWith('gpt-4o-mini', 'text', expect.objectContaining({ httpStatus: status, upstreamCode: 'invalid_parameter' }));
    expect(fetcher).toHaveBeenCalledOnce(); expect(recover).not.toHaveBeenCalled();
  } finally { await runtime.close(); }
});

it.each([400, 422, 429])('records a definitive gateway %s rejection despite a trace ID without querying an unaccepted request', async status => {
  const root = await mkdtemp(join(tmpdir(), 'gateway-admission-test-'));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const job = repository.createJob({ projectId: 'project_test', templateId: 'video-translation', templateVersion: 2, status: 'running', state: {} });
  const stage = repository.createStageRun({ jobId: job.id, stageId: 'subtitle', executor: 'krillin', status: 'running' });
  const ledger = new CreatorProviderRequestLedger(repository);
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { code: 'output_too_large', message: 'Requested output exceeds the gateway limit of 4096 tokens' } },
    { status, headers: { 'X-Request-ID': 'trace_admission_rejected' } }));
  const manual = createDefaultCreatorServicesConfig();
  const source = createGatewayCreatorSource({ account: {
    peekState: () => ({ source: 'gateway', transport: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: bootstrap.account, bindingVersion: bootstrap.bindingVersion, models: bootstrap.models, selectedModels: bootstrap.defaults, activationError: null }),
    modelCredentials: async () => ({ accountId: bootstrap.account.id, transport: 'gateway', modelKey: 'device-test', keyVersion: '1',
      bindingVersion: bootstrap.bindingVersion, baseUrl: bootstrap.baseUrl, models: bootstrap.models, defaults: bootstrap.defaults })
  }, manual: { read: async () => manual, write: async value => value, reset: async () => manual },
  getLocalOrigin: () => 'http://127.0.0.1:39999', ledger, fetcher });
  const app = Fastify();
  try {
    await source.register(app);
    await source.runForJob(job.id, stage.id, async () => {
      const config = await source.store.read();
      const result = await app.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/chat/completions',
        headers: { Authorization: `Bearer ${config.llm.apiKey}` }, payload: { model: config.llm.model, messages: [{ role: 'user', content: 'Translate' }], max_tokens: 6500 } });
      expect(result.statusCode).toBe(status);
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(ledger.requestsForStage(stage.id)).toEqual([expect.objectContaining({ status: 'failed', remoteTaskId: null })]);
  } finally {
    await source.revoke(); await app.close(); db.close(); await rm(root, { recursive: true, force: true });
  }
});

it('forwards Creator text, image, speech and subtitles through the gateway with native image parameters', async () => {
  const app = Fastify();
  const models = [...bootstrap.models,
    { id: 'gpt-image-2', modality: 'image' as const, capabilities: ['generate', 'edit'], imageOptions: { maxImages: 1, maxReferences: 1, aspectRatios: ['3:2'], resolutions: ['1K'] } },
    { id: 'tts-1', modality: 'speech' as const, capabilities: ['speech'], voices: ['alloy'] },
    { id: 'whisper-1', modality: 'transcription' as const, capabilities: ['transcription_text', 'subtitle_timestamps'] }];
  const credentials = { accountId: bootstrap.account.id, transport: 'gateway' as const, modelKey: 'device-access-token', keyVersion: 'device-v1', bindingVersion: bootstrap.bindingVersion,
    baseUrl: bootstrap.baseUrl, models, defaults: { text: 'gpt-4o-mini', image: 'gpt-image-2', speech: 'tts-1', transcription: 'whisper-1' } };
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    expect(String(url)).toMatch(/^https:\/\/gateway\.example\/v1\//);
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer device-access-token');
    expect(new Headers(options?.headers).get('idempotency-key')).toBeTruthy();
    if (String(url).endsWith('/images/generations')) {
      expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'gpt-image-2', size: '1536x1024', n: 1 });
      expect(String(options?.body)).not.toContain('aspect_ratio');
      expect(new Headers(options?.headers).get('prefer')).toBe('respond-async');
      return Response.json({ requestId: 'ocreq_gateway_image', state: 'submitting' }, { status: 202 });
    }
    if (String(url).endsWith('/audio/transcriptions')) {
      const form = await new Request('http://localhost', { method: 'POST', headers: options?.headers, body: options?.body }).formData();
      expect(form.get('model')).toBe('whisper-1'); expect(form.get('response_format')).toBe('verbose_json');
      return Response.json({ text: 'Hello', segments: [{ start: 0, end: 1, text: 'Hello' }] });
    }
    return Response.json({ output: [], text: 'OK' });
  });
  const manual = createDefaultCreatorServicesConfig();
  const source = createGatewayCreatorSource({ account: {
    peekState: () => ({ source: 'gateway', transport: 'gateway', authState: 'signed_in', activationState: 'ready', account: bootstrap.account, bindingVersion: bootstrap.bindingVersion, models, activationError: null }),
    modelCredentials: async () => credentials
  }, manual: { read: async () => manual, write: async value => value, reset: async () => manual }, getLocalOrigin: () => 'http://127.0.0.1:39999', fetcher });
  try {
    await source.register(app); const config = await source.store.read();
    expect(config.llm.apiKey).not.toBe('device-access-token');
    for (const [operation, payload, extra, status] of [
      ['responses', { model: 'gpt-4o-mini', input: 'Hello' }, {}, 200],
      ['images/generations', { model: 'gpt-image-2', prompt: 'Circle', aspect_ratio: '3:2', resolution: '1K' }, { prefer: 'respond-async' }, 202],
      ['audio/speech', { model: 'tts-1', input: 'Hello', voice: 'alloy' }, {}, 200]
    ] as const) {
      const result = await app.inject({ method: 'POST', url: `/internal/krillin-llm/gateway/v1/${operation}`, headers: { Authorization: `Bearer ${config.llm.apiKey}`, ...extra }, payload });
      expect(result.statusCode).toBe(status);
    }
    const form = new FormData(); form.set('model', 'whisper-1'); form.set('response_format', 'verbose_json'); form.set('file', new Blob(['fixture'], { type: 'audio/wav' }), 'sample.wav');
    const request = new Request('http://localhost', { method: 'POST', body: form });
    const result = await app.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/audio/transcriptions', headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Content-Type': request.headers.get('content-type')! }, payload: Buffer.from(await request.arrayBuffer()) });
    expect(result.statusCode).toBe(200); expect(result.json().segments[0]).toMatchObject({ start: 0, end: 1 });
    expect(fetcher).toHaveBeenCalledTimes(4);
  } finally { await source.revoke(); await app.close(); }
});

it('refreshes a gateway catalog during active work without probes or Runtime replacement, preserving choices across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-catalog-refresh-'));
  const store = createGatewayConfigStore(root);
  const text = bootstrap.models[0]!;
  const chat = { id: 'chat-only', modality: 'text' as const, capabilities: ['chat'] };
  const catalog = { models: [text, chat], defaults: { text: text.id }, catalogVersion: 'v2', catalogUpdatedAt: new Date().toISOString(), catalogRefreshState: 'ready' };
  const current = { ...bootstrap, catalogVersion: 'v1' };
  await store.writeConfiguration({ source: 'gateway', bindingVersion: current.bindingVersion });
  await store.writeCredentials({ ...current, accessToken: 'device', refreshToken: 'refresh', expiresIn: 900, accessExpiresAt: new Date(Date.now()+900000).toISOString() });
  const activation = vi.fn(async () => undefined), probe = vi.fn(async () => undefined), closeRuntime = vi.fn(async () => undefined);
  const request = vi.fn(async () => structuredClone(catalog));
  const client = { origin: 'https://gateway.example', bootstrap: vi.fn(async () => structuredClone(current)), refresh: vi.fn(), startDevice: vi.fn(), pollDevice: vi.fn(), cancelDevice: vi.fn(), logout: vi.fn(), avatar: vi.fn(), request };
  const create = () => createGatewayAccountService({ dataDir: root, client, activateRuntime: activation, closeRuntime, hasActiveTasks: () => true, automaticPolling: false, probeModel: probe });
  let service = create();
  try {
    await service.initialize(); activation.mockClear(); closeRuntime.mockClear();
    expect(await service.readState({ refreshModels: true })).toMatchObject({ catalogVersion: 'v2', selectedModels: { text: text.id }, models: [text] });
    expect(request).toHaveBeenCalledOnce(); expect(activation).not.toHaveBeenCalled(); expect(closeRuntime).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
    await expect(service.selectModel('text', chat.id)).rejects.toMatchObject({ code: 'invalid_model' });
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(service.readState({ refreshModels: true })).rejects.toThrow('offline');
    expect(service.peekState()).toMatchObject({ catalogError: 'model_catalog_unavailable', selectedModels: { text: text.id }, models: [text] });
    await service.close(); service = create(); await service.initialize();
    expect(service.peekState().selectedModels).toEqual({ text: text.id });
    expect(probe).not.toHaveBeenCalled();
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

it('migrates defaults, follows new recommendations when idle and persists explicit manual preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-model-preferences-'));
  const store = createGatewayConfigStore(root);
  const text = (id: string) => ({ id, modality: 'text' as const, capabilities: ['responses', 'chat', 'tools'] });
  let current: GatewayBootstrap = { ...bootstrap, models: [text('gpt-4o-mini'), text('gpt-6.1-sol')], defaults: { text: 'gpt-6.1-sol' } };
  await store.writeConfiguration({ source: 'gateway', bindingVersion: bootstrap.bindingVersion, selectedModels: { text: 'gpt-4o-mini', textProcessing: 'gpt-4o-mini' } });
  await store.writeCredentials({ ...bootstrap, accessToken: 'device', refreshToken: 'refresh', expiresIn: 900, accessExpiresAt: new Date(Date.now() + 900000).toISOString() });
  let busy = false;
  const activation = vi.fn(async (_value: GatewayBootstrap) => undefined), probe = vi.fn();
  const client = { origin: 'https://gateway.example', bootstrap: vi.fn(async () => structuredClone(current)), refresh: vi.fn(), startDevice: vi.fn(), pollDevice: vi.fn(), cancelDevice: vi.fn(), logout: vi.fn(), avatar: vi.fn(),
    request: vi.fn(async (path: string) => path?.startsWith('/api/v1/client/models') ? { models: current.models, defaults: current.defaults, catalogVersion: current.defaults.text } : { account: current.account }) };
  const create = () => createGatewayAccountService({ dataDir: root, client, activateRuntime: activation, closeRuntime: async () => undefined, hasActiveTasks: () => busy, hasPendingTasks: () => true, automaticPolling: false, probeModel: probe });
  let service = create();
  try {
    await service.initialize();
    expect(service.peekState()).toMatchObject({ selectedModels: { text: 'gpt-6.1-sol' }, modelSelectionModes: { text: 'recommended' } });
    expect(service.peekState().selectedModels).not.toHaveProperty('textProcessing');
    current = { ...current, models: [...current.models, text('gpt-6.2-sol')], defaults: { text: 'gpt-6.2-sol' } };
    busy = true; activation.mockClear();
    await service.readState({ refreshModels: true });
    expect(service.peekState().selectedModels?.text).toBe('gpt-6.1-sol');
    expect(activation).not.toHaveBeenCalled();
    busy = false;
    await service.readState();
    expect(service.peekState().selectedModels?.text).toBe('gpt-6.2-sol');
    expect(activation).toHaveBeenLastCalledWith(expect.objectContaining({ defaults: { text: 'gpt-6.2-sol' } }));
    const manual = createDefaultCreatorServicesConfig();
    const source = createGatewayCreatorSource({ account: service, manual: { read: async () => manual, write: async value => value, reset: async () => manual }, getLocalOrigin: () => 'http://localhost:39999' });
    expect((await source.store.read()).llm.model).toBe('gpt-6.2-sol');
    await service.selectModel('text', 'gpt-6.1-sol');
    current = { ...current, models: [...current.models, text('gpt-6.10-sol')], defaults: { text: 'gpt-6.10-sol' } };
    await service.readState({ refreshModels: true });
    expect(service.peekState()).toMatchObject({ selectedModels: { text: 'gpt-6.1-sol' }, recommendedModels: { text: 'gpt-6.10-sol' }, modelSelectionModes: { text: 'manual' } });
    await service.close(); service = create(); await service.initialize();
    expect(service.peekState()).toMatchObject({ selectedModels: { text: 'gpt-6.1-sol' }, modelSelectionModes: { text: 'manual' } });
    await service.selectModel('text', gatewayRecommendedModelId);
    expect(service.peekState()).toMatchObject({ selectedModels: { text: 'gpt-6.10-sol' }, modelSelectionModes: { text: 'recommended' } });
    expect((await store.readConfiguration()).manualModels).toEqual({});
    expect(probe).not.toHaveBeenCalled();
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});
