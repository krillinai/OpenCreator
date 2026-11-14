import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig, gatewayDefaultVoiceId, type GatewayModel } from '@opencreator/protocol';
import { createGatewayCreatorSource } from '../../src/gateway/creator-service-source.js';
import type { GatewayAccountService } from '../../src/gateway/account-service.js';
import { createDirectTransport } from '../../src/gateway/direct-transport.js';
import { createDirectRuntime } from '../../src/gateway/direct-runtime.js';
import { registerCreatorServicesRoutes } from '../../src/api/routes.creator-services.js';
import { createVideoGenerationService } from '../../src/video-generation/service.js';
import { officialEventStream } from '../../src/gateway/official-stream.js';
import { createKrillinTtsService } from '../../src/creator/krillin/tts-service.js';
import { generateImageContents } from '../../src/image-generation/provider.js';
import { readPrivateJsonFile } from '../../src/config/private-json-file.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import { createCreatorIssueService } from '../../src/creator/issues.js';
import { createImageExecutor } from '../../src/creator/image/executor.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
it('redacts provider errors from fragmented events while preserving model text', async () => {
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"type":"error","error":{"message":"OpenRou'));
    controller.enqueue(encoder.encode('ter private service failure"}}\n\n')); controller.close();
  } });
  const text = await new Response(officialEventStream(source)).text();
  expect(text).toContain('hello'); expect(text).not.toContain('OpenRouter'); expect(text).toContain('official_service_unavailable');
});
async function fixture(ledger?: CreatorProviderRequestLedger, options: Partial<Parameters<typeof createGatewayCreatorSource>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const manual = createDefaultCreatorServicesConfig(); manual.llm = { source: 'custom', baseUrl: 'https://personal.test/v1', apiKey: 'personal-key', model: 'personal-model', jsonMode: true };
  const models: GatewayModel[] = [
    { id: 'vendor/text', modality: 'text' as const, capabilities: ['responses', 'chat'] },
    { id: 'vendor/image', modality: 'image' as const, capabilities: ['edit'] },
    { id: 'vendor/video', modality: 'video' as const, capabilities: ['image_to_video'], sizes: ['1280x720', '720x1280'], durations: [5, 10] },
    { id: 'vendor/speech', modality: 'speech' as const, capabilities: [], voices: ['tested_voice'] },
    { id: 'vendor/transcription', modality: 'transcription' as const, capabilities: [] }
  ];
  const defaults = Object.fromEntries(models.map(model => [model.modality, model.id]));
  const reportModelFailure = vi.fn(async () => undefined);
  const state = { source: 'gateway' as 'gateway' | 'manual', authState: 'signed_in' as const, activationState: 'ready' as const, account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: 'a:1', models, selectedModels: defaults, activationError: null };
  const fetcher = vi.fn(async (url: URL | RequestInfo, options?: RequestInit) => {
    if (String(url).endsWith('/videos')) return Response.json({ id: 'video_upstream', status: 'pending' });
    if (String(url).includes('/videos/video_upstream/content')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } });
    if (String(url).endsWith('/videos/video_upstream')) return Response.json({ status: 'completed' });
    if (String(url).endsWith('/audio/speech')) return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
    if (String(url).endsWith('/audio/transcriptions')) return Response.json({ text: 'recognized' });
    if (String(url).endsWith('/images')) return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
    return Response.json({ choices: [{ message: { content: 'text result' } }] });
  }) as typeof fetch;
  const account: Pick<GatewayAccountService, 'peekState' | 'modelCredentials'> & Partial<Pick<GatewayAccountService, 'beginModelUse' | 'reportModelFailure'>> = {
    reportModelFailure, peekState: () => state, modelCredentials: async () => ({ accountId: 'a', bindingVersion: 'a:1', keyVersion: '1', modelKey: 'private-user-key', baseUrl: 'https://openrouter.ai/api/v1', transport: 'openrouter-direct', models, defaults })
  };
  const manualStore = { read: async () => structuredClone(manual), write: async (config: typeof manual) => { Object.assign(manual, config); return structuredClone(manual); }, reset: async () => manual };
  const source = createGatewayCreatorSource({ ...options, directRequestsRoot: join(root, 'receipts'), ledger, account,
    manual: manualStore, getLocalOrigin: () => 'http://127.0.0.1:39999', fetcher
  });
  const server = Fastify(); cleanup.push(() => server.close()); cleanup.push(() => source.revoke());
  await source.register(server); await registerCreatorServicesRoutes(server, source.store, undefined, undefined, undefined, undefined, undefined, undefined, manualStore);
  return { server, source, fetcher, state, manual, root, account, reportModelFailure };
}
it('uses the manual video configuration for a signed-in local video task', async () => {
  const f = await fixture(undefined, {
    readJobBinding: () => ({ source: 'manual' }),
    readJobTemplateId: () => 'video-generation',
    readJobState: () => ({ videoServiceSource: 'manual' }) as never
  });
  const credentials = vi.spyOn(f.account, 'modelCredentials');
  const config = await f.source.runForJob('local-video', 'stage-1', () => f.source.store.read());
  expect(config.video).toEqual(f.manual.video);
  expect(credentials).not.toHaveBeenCalled();
});
it('routes a signed-in local video request to its configured provider', async () => {
  const f = await fixture(undefined, {
    readJobBinding: () => ({ source: 'gateway', accountId: 'a', bindingVersion: 'a:1', models: { video: 'vendor/video' }, capabilities: { video: ['image_to_video'] } }),
    readJobTemplateId: () => 'video-generation',
    readJobState: () => ({ videoServiceSource: 'manual', model: 'local-model', provider: 'seedance' }) as never
  });
  f.manual.video.seedance.baseUrl = 'https://personal-video.test/api/v3';
  f.manual.video.seedance.apiKey = 'local-test-key';
  f.manual.video.seedance.model = 'local-model';
  vi.mocked(f.fetcher).mockResolvedValue(Response.json({ id: 'local-task', status: 'queued' }));
  const service = createVideoGenerationService({ dataDir: f.root, configStore: f.source.store, gatewaySource: f.source, fetchImpl: f.fetcher });
  await f.source.runForJob('local-video', 'stage-1', () => service.create({ prompt: 'A city', provider: 'seedance', model: 'local-model', size: '1280x720', duration: 5 }));
  expect(String(vi.mocked(f.fetcher).mock.calls[0]?.[0])).toContain('personal-video.test');
  expect(vi.mocked(f.fetcher).mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer local-test-key' });
});
it('routes a formerly local video task through the selected official model after sign-in', async () => {
  const f = await fixture(undefined, {
    readJobBinding: () => ({ source: 'manual' }),
    readJobTemplateId: () => 'video-generation',
    readJobState: () => ({ videoServiceSource: 'gateway', officialModels: { video: 'vendor/video' } }) as never
  });
  const config = await f.source.runForJob('official-video', 'stage-1', () => f.source.store.read());
  expect(config.video.provider).toBe('seedance');
  expect(await f.source.runForJob('official-video', 'stage-2', () => f.source.binding())).toMatchObject({ models: { video: 'vendor/video' } });
});
it('reads and saves local video settings without changing signed-in official settings', async () => {
  const f = await fixture();
  const read = await f.server.inject('/creator-services/video/local');
  expect(read.statusCode).toBe(200);
  expect(read.json().config.video).toEqual(expect.objectContaining({ provider: f.manual.video.provider }));
  const video = { ...read.json().config.video, provider: 'veo' };
  const saved = await f.server.inject({ method: 'PATCH', url: '/creator-services/video/local', payload: { video } });
  expect(saved.statusCode).toBe(200);
  expect(f.manual.video.provider).toBe('veo');
  expect((await f.server.inject('/creator-services/config')).json().config.video.provider).not.toBe('veo');
});
it.each(['tech', 'org'])('routes Creator subtitle transcription directly through ChatAnywhere (%s)', async domain => {
  const f = await fixture();
  const transcription: GatewayModel = { id: 'whisper-1', modality: 'transcription', capabilities: ['transcription_text', 'subtitle_timestamps'] };
  f.state.models.splice(0, f.state.models.length, transcription);
  f.state.selectedModels.transcription = transcription.id;
  f.account.modelCredentials = async () => ({ accountId: 'a', bindingVersion: 'a:chatanywhere:1', keyVersion: 'ca-1', modelKey: 'private-ca-key', baseUrl: `https://api.chatanywhere.${domain}/v1`, transport: 'supplier-direct', models: f.state.models, defaults: { transcription: transcription.id } });
  vi.mocked(f.fetcher).mockImplementation(async (_url, options) => {
    const body = await new Request('http://localhost', { method: 'POST', headers: options?.headers, body: options?.body }).formData();
    expect(body.get('file')).toBeInstanceOf(File);
    expect(body.has('timestamp_granularities[]')).toBe(false);
    return Response.json({ text: 'recognized', segments: [{ text: 'recognized', start: 0, end: 1 }] });
  });
  const config = await f.source.store.read();
  const form = new FormData(); form.set('model', transcription.id); form.set('response_format', 'verbose_json');
  form.set('timestamp_granularities[]', 'segment'); form.set('file', new Blob(['audio'], { type: 'audio/wav' }), 'audio.wav');
  const request = new Request('http://localhost', { method: 'POST', body: form });
  const response = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/audio/transcriptions', headers: { Authorization: `Bearer ${config.transcription.openai.apiKey}`, 'Content-Type': request.headers.get('content-type')!, 'Idempotency-Key': 'ca-asr' }, payload: Buffer.from(await request.arrayBuffer()) });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ segments: [{ start: 0, end: 1 }] });
  expect(f.fetcher).toHaveBeenCalledOnce();
  expect(vi.mocked(f.fetcher).mock.lastCall?.[0]).toBe(`https://api.chatanywhere.${domain}/v1/audio/transcriptions`);
});

it('rejects a Creator capability issued before a supplier change without submitting inference', async () => {
  const f = await fixture();
  const config = await f.source.store.read();
  const original = await f.account.modelCredentials();
  f.account.modelCredentials = async () => ({ ...original, baseUrl: 'https://api.chatanywhere.tech/v1', modelKey: 'new-ca-key', transport: 'supplier-direct' });
  const response = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/audio/speech', headers: { Authorization: `Bearer ${config.tts.openai.apiKey}` }, payload: { model: 'vendor/speech', input: 'test', voice: 'tested_voice' } });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: { code: 'supplier_binding_changed' } });
  expect(f.fetcher).not.toHaveBeenCalled();
});
it.each(['account', 'headers', 'first-token'])('opens the translation stream before slow %s preparation and reuses the completed result', async delayed => {
  const f = await fixture();
  const origin = await f.server.listen({ host: '127.0.0.1', port: 0 });
  const config = await f.source.store.read();
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const release = vi.fn(async () => undefined);
  f.account.beginModelUse = async () => {
    if (delayed === 'account') await waiting;
    return { credentials: await f.account.modelCredentials(), release };
  };
  vi.mocked(f.fetcher).mockImplementation(async () => {
    if (delayed === 'headers') await waiting;
    return new Response(new ReadableStream<Uint8Array>({ async start(controller) {
      if (delayed === 'first-token') await waiting;
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"translated"}}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const submit = () => fetch(`${origin}/internal/krillin-llm/gateway/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'same-translation' },
    body: JSON.stringify({ model: 'vendor/text', messages: [], stream: true }), signal: AbortSignal.timeout(2_000)
  });
  try {
    const response = await submit();
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const firstFrame = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(firstFrame.replace(/^data: /, '').trim())).toMatchObject({ object: 'chat.completion.chunk', choices: [] });
    if (delayed === 'account') expect(f.fetcher).not.toHaveBeenCalled();
    resume();
    let content = '';
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; content += new TextDecoder().decode(chunk.value); }
    expect(content).toContain('[DONE]');
    reader.releaseLock();
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(await (await submit()).text()).toContain('translated');
    expect(f.fetcher).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(f.source.isBusy()).toBe(false));
  } finally { resume(); }
});
it('does not submit a paid translation after the caller disconnects during account preparation', async () => {
  const f = await fixture();
  const origin = await f.server.listen({ host: '127.0.0.1', port: 0 });
  const config = await f.source.store.read();
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const release = vi.fn(async () => undefined);
  f.account.beginModelUse = async () => { await waiting; return { credentials: await f.account.modelCredentials(), release }; };
  const disconnected = new Promise<void>(resolve => f.server.server.once('request', (_request, response) => response.once('close', resolve)));
  try {
    const response = await fetch(`${origin}/internal/krillin-llm/gateway/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'vendor/text', messages: [], stream: true }), signal: AbortSignal.timeout(2_000)
    });
    await response.body!.cancel();
    await disconnected;
    resume();
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.source.isBusy()).toBe(false));
    expect(f.fetcher).not.toHaveBeenCalled();
  } finally { resume(); }
});
it('reports rejected streaming translations without exposing upstream details', async () => {
  const f = await fixture();
  const config = await f.source.store.read();
  vi.mocked(f.fetcher).mockImplementation(async () => Response.json({ error: { message: 'OpenRouter private failure' } }, { status: 402 }));
  const response = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/chat/completions',
    headers: { Authorization: `Bearer ${config.llm.apiKey}` }, payload: { model: 'vendor/text', messages: [], stream: true } });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('credits_insufficient');
  expect(response.body).not.toMatch(/OpenRouter|private-user-key|private failure/);
  await vi.waitFor(() => expect(f.source.isBusy()).toBe(false));
});
it.each([
  ['images/generations', 'image'], ['audio/speech', 'speech'], ['audio/transcriptions', 'transcription'], ['video/jobs', 'video']
])('forwards exact model failure feedback from the real Creator route %s', async (resource, modality) => {
  const f = await fixture();
  const config = await f.source.store.read();
  vi.mocked(f.fetcher).mockImplementation(async () => Response.json({ error: { message: 'Model unavailable in this country private-user-key' } }, { status: 403 }));
  const response = await f.server.inject({ method: 'POST', url: `/internal/krillin-llm/gateway/v1/${resource}`, headers: { Authorization: `Bearer ${config.llm.apiKey}` },
    payload: { model: `vendor/${modality}`, prompt: 'test', input: 'test', voice: 'tested_voice', size: '1280x720', duration: 5 } });
  expect(response.statusCode).toBe(403);
  expect(response.body).not.toContain('private-user-key');
  expect(f.reportModelFailure).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'a', keyVersion: '1' }), `vendor/${modality}`, modality,
    expect.objectContaining({ httpStatus: 403, upstreamMessage: 'Model unavailable in this country [redacted]' }));
});
it('reconciles a streamed chat result without creating an unknown-acceptance issue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-chat-ledger-'));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const issues = createCreatorIssueService(repository);
  const f = await fixture(new CreatorProviderRequestLedger(repository, issues));
  const job = repository.createJob({ projectId: 'project', templateId: 'video-translation', templateVersion: 1, status: 'running', state: {} });
  const stage = repository.createStageRun({ jobId: job.id, stageId: 'subtitle', executor: 'krillinai', status: 'running' });
  vi.mocked(f.fetcher).mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"translated"}}]}\n\ndata: [DONE]\n\n')); }
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  try {
    await f.source.runForJob(job.id, stage.id, async () => {
      const config = await f.source.store.read();
      const response = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/chat/completions',
        headers: { Authorization: 'Bearer ' + config.llm.apiKey }, payload: { model: 'vendor/text', messages: [], stream: true } });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('[DONE]');
    });
    await vi.waitFor(() => expect(repository.listProviderRequests(job.id)).toMatchObject([{ status: 'succeeded' }]));
    expect(issues.list(job.id)).toHaveLength(0);
    expect(f.fetcher).toHaveBeenCalledOnce();
  } finally { await f.source.revoke(); db.close(); await rm(root, { recursive: true, force: true }); }
});
it('hides official addresses and credentials, preserving custom configuration across source switches', async () => {
  const f = await fixture();
  const official = (await f.server.inject('/creator-services/config')).json();
  expect(JSON.stringify(official)).not.toMatch(/openrouter|oclocal_|private-user-key|personal-key|39999/i);
  expect(official.config.llm.baseUrl).toBe('');
  f.state.source = 'manual'; const custom = await f.source.store.read();
  expect(custom.llm).toMatchObject({ baseUrl: 'https://personal.test/v1', apiKey: 'personal-key', model: 'personal-model' });
  f.state.source = 'gateway'; expect((await f.source.store.read()).llm.model).toBe('vendor/text');
  expect(f.manual.llm.apiKey).toBe('personal-key');
});
it('sends multimodal requests directly, translates image edits, and replays a paid result locally', async () => {
  const f = await fixture(); const config = await f.source.store.read();
  const submit = (operation: string, payload: Record<string, unknown>, key = operation) => f.server.inject({ method: 'POST', url: `/internal/krillin-llm/gateway/v1/${operation}`, headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Idempotency-Key': key }, payload });
  expect((await submit('chat/completions', { model: 'vendor/text', messages: [{ role: 'user', content: 'hello' }] })).statusCode).toBe(200);
  expect((await submit('images/generations', { model: 'vendor/image', prompt: 'image', n: 1, size: '1536x1024', response_format: 'b64_json' })).statusCode).toBe(200);
  const imageBody = JSON.parse(String(vi.mocked(f.fetcher).mock.lastCall?.[1]?.body));
  expect(imageBody).toMatchObject({ aspect_ratio: '3:2' });
  expect(imageBody).not.toHaveProperty('output_format');
  expect(imageBody).not.toHaveProperty('size'); expect(imageBody).not.toHaveProperty('response_format');
  expect((await submit('audio/speech', { model: 'vendor/speech', input: 'hello', voice: 'tested_voice', response_format: 'wav' })).headers['content-type']).toBe('audio/mpeg');
  expect(JSON.parse(String(vi.mocked(f.fetcher).mock.lastCall?.[1]?.body))).not.toHaveProperty('response_format');
  const form = new FormData(); form.set('model', 'vendor/image'); form.set('prompt', 'edit'); form.set('image[]', new Blob(['image'], { type: 'image/png' }), 'image.png');
  const request = new Request('http://localhost', { method: 'POST', body: form });
  const edited = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/images/edits', headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Content-Type': request.headers.get('content-type')!, 'Idempotency-Key': 'edit' }, payload: Buffer.from(await request.arrayBuffer()) });
  expect(edited.statusCode).toBe(200);
  expect(vi.mocked(f.fetcher).mock.lastCall?.[0]).toBe('https://openrouter.ai/api/v1/images');
  expect(JSON.parse(String(vi.mocked(f.fetcher).mock.lastCall?.[1]?.body))).toMatchObject({ input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }] });
  const transcription = new FormData(); transcription.set('model', 'vendor/transcription'); transcription.set('file', new Blob(['audio'], { type: 'audio/wav' }), 'audio.wav');
  const audioRequest = new Request('http://localhost', { method: 'POST', body: transcription });
  expect((await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/audio/transcriptions', headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Content-Type': audioRequest.headers.get('content-type')!, 'Idempotency-Key': 'asr' }, payload: Buffer.from(await audioRequest.arrayBuffer()) })).json()).toEqual({ text: 'recognized' });
  const count = vi.mocked(f.fetcher).mock.calls.length;
  await submit('images/generations', { model: 'vendor/image', prompt: 'image', n: 1, size: '1536x1024', response_format: 'b64_json' });
  expect(vi.mocked(f.fetcher).mock.calls).toHaveLength(count);
  expect(vi.mocked(f.fetcher).mock.calls.every(([url, options]) => String(url).startsWith('https://openrouter.ai/api/v1/') && new Headers(options?.headers).get('Authorization') === 'Bearer private-user-key')).toBe(true);
  expect((await submit('images/generations', { model: 'unauthorized', prompt: 'image' }, 'bad-model')).statusCode).toBe(400);
});
it('retains an async video receipt and downloads content locally without exposing upstream URLs', async () => {
  const f = await fixture(); const origin = await f.server.listen({ host: '127.0.0.1', port: 0 });
  const service = createVideoGenerationService({ dataDir: f.root, configStore: f.source.store, gatewaySource: { async binding() { const binding = await f.source.binding(); return binding ? { ...binding, baseUrl: `${origin}/internal/krillin-llm/gateway/v1` } : undefined; } } });
  const task = await service.create({ provider: 'seedance', prompt: 'video', size: '1280x720', duration: 5 });
  expect(task.status).toBe('in_progress');
  expect(JSON.parse(String(vi.mocked(f.fetcher).mock.calls[0]?.[1]?.body))).toMatchObject({ size: '1280x720' });
  expect((await service.refresh(task.id)).status).toBe('completed');
  expect((await service.read(task.id)).content).toEqual(Buffer.from([1, 2, 3]));
});

it('persists and resumes a video using dynamic official options beyond custom presets', async () => {
  const f = await fixture();
  const model = f.state.models.find(model => model.modality === 'video')!;
  model.sizes = []; model.resolutions = ['1080p']; model.aspectRatios = ['1:1']; model.durations = [12];
  const origin = await f.server.listen({ host: '127.0.0.1', port: 0 });
  const service = createVideoGenerationService({ dataDir: f.root, configStore: f.source.store, gatewaySource: { async binding() { const binding = await f.source.binding(); return binding ? { ...binding, baseUrl: `${origin}/internal/krillin-llm/gateway/v1` } : undefined; } } });
  const task = await service.create({ provider: 'seedance', prompt: 'test', size: '1080p@1:1', duration: 12 });
  expect(await service.get(task.id)).toMatchObject({ videoSize: '1080p@1:1', duration: 12 });
  expect((await service.refresh(task.id)).status).toBe('completed');
  expect((await service.read(task.id)).content).toEqual(Buffer.from([1, 2, 3]));
  await expect(service.create({ provider: 'seedance', prompt: 'test', size: '720p@1:1', duration: 12 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  f.state.source = 'manual';
  await expect(service.create({ provider: 'seedance', prompt: 'test', size: '1080p@1:1', duration: 12 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});
it('uses the selected official speech model voice catalog and rejects incompatible voices', async () => {
  const f = await fixture();
  const synthesize = vi.fn(async () => ({ content: Buffer.from('audio'), format: 'mp3' as const }));
  const service = createKrillinTtsService({ resourceRoot: f.root, workRoot: f.root, configStore: f.source.store, executeSynthesis: synthesize });
  expect(await service.listVoices('openai')).toMatchObject({ model: 'vendor/speech', voices: [{ id: 'tested_voice' }] });
  expect(await service.synthesize({ text: 'Hello' })).toMatchObject({ voiceId: 'tested_voice', model: 'vendor/speech', format: 'mp3' });
  await expect(service.synthesize({ text: 'Hello', voiceId: 'alloy' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(synthesize).toHaveBeenCalledOnce();
});

it('passes multiple official references through the Creator image provider using the selected profile', async () => {
  const f = await fixture();
  f.state.models.find(model => model.modality === 'image')!.imageOptions = { maxImages: 1, maxReferences: 14 };
  const config = await f.source.store.read();
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    const form = await new Request('http://localhost', { method: 'POST', headers: options?.headers, body: options?.body }).formData();
    expect(form.getAll('image[]')).toHaveLength(2);
    return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
  });
  const result = await generateImageContents({ provider: 'openai', prompt: 'test', size: '1024x1024', quality: 'medium', count: 1 }, config,
    { fetchImpl: fetcher, referenceImages: [{ content: Buffer.from('one'), mime: 'image/png' }, { content: Buffer.from('two'), mime: 'image/png' }] });
  expect(result.contents).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('delivers a playable WAV for an official PCM-only speech model', async () => {
  const f = await fixture();
  f.state.models.find(model => model.modality === 'speech')!.capabilities = ['pcm_speech'];
  vi.mocked(f.fetcher).mockImplementation(async () => new Response(Buffer.from([0, 1, 0, 2]), { headers: { 'content-type': 'audio/pcm;rate=44100;channels=1' } }));
  const config = await f.source.store.read();
  const response = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/audio/speech', headers: { Authorization: `Bearer ${config.tts.openai.apiKey}`, 'Idempotency-Key': 'pcm' }, payload: { model: 'vendor/speech', input: 'Hello', voice: 'tested_voice' } });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('audio/wav');
  expect(response.rawPayload.toString('ascii', 0, 4)).toBe('RIFF');
  expect(JSON.parse(String(vi.mocked(f.fetcher).mock.lastCall?.[1]?.body))).toMatchObject({ response_format: 'pcm' });
});
it.each(['cancelled', 'expired', 'failed'])('terminates video jobs with upstream status %s', async status => {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-video-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fetcher = vi.fn(async (url: URL | RequestInfo) => Response.json(String(url).endsWith('/videos') ? { id: 'remote-video', status: 'pending' } : { status }));
  const transport = createDirectTransport(root, fetcher);
  const input = { account: 'a', key: 'private', resource: 'video/jobs', method: 'POST', body: { model: 'video', prompt: 'test' }, contentType: 'application/json', identity: 'video', fingerprint: 'video', signal: AbortSignal.timeout(3000) };
  const { requestId } = await (await transport.request(input)).json();
  expect(await (await transport.request({ ...input, resource: `requests/${requestId}`, method: 'GET' })).json()).toMatchObject({ state: 'failed' });
  await expect(transport.request({ ...input, resource: `requests/${requestId}/result`, method: 'GET' })).rejects.toMatchObject({ code: 'request_outcome_unknown' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('never resubmits an ambiguous accepted request after transport recreation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-loss-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fetcher = vi.fn(async () => { throw new Error('lost after acceptance'); });
  const input = { account: 'a', key: 'private', resource: 'images/generations', method: 'POST', body: { model: 'image', prompt: 'same' }, contentType: 'application/json', identity: 'same', fingerprint: 'same', signal: AbortSignal.timeout(3000) };
  await expect(createDirectTransport(root, fetcher).request(input)).rejects.toThrow();
  await expect(createDirectTransport(root, fetcher).request(input)).rejects.toMatchObject({ code: 'request_outcome_unknown' });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('uses image model parameters and raster formats, and rejects invalid options before a paid request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-image-options-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fetcher = vi.fn(async (_url: URL | RequestInfo, _options?: RequestInit) => Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] }));
  const transport = createDirectTransport(root, fetcher);
  const model: GatewayModel = { id: 'image', modality: 'image', capabilities: [], imageOptions: { aspectRatios: ['16:9'], resolutions: ['2K'], qualities: [], outputFormats: ['jpeg'], maxImages: 1, maxReferences: 0 } };
  const input = { account: 'a', key: 'test', resource: 'images/generations', method: 'POST', body: { model: 'image', prompt: 'test', n: 1, size: '1024x1024', aspect_ratio: '16:9', resolution: '2K' }, contentType: 'application/json', identity: 'image', fingerprint: 'image', signal: AbortSignal.timeout(3_000), model };
  await transport.request(input);
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: 'image', prompt: 'test', n: 1, stream: false, aspect_ratio: '16:9', resolution: '2K', output_format: 'jpeg' });
  await expect(transport.request({ ...input, identity: 'invalid', fingerprint: 'invalid', body: { ...input.body, quality: 'high' } })).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('passes normalized resolution and ratio when the video catalog has no pixel sizes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-video-options-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fetcher = vi.fn(async (_url: URL | RequestInfo, _options?: RequestInit) => Response.json({ id: 'remote', status: 'pending' }));
  const model: GatewayModel = { id: 'video', modality: 'video', capabilities: [], resolutions: ['1080p'], aspectRatios: ['1:1'], durations: [12] };
  await createDirectTransport(root, fetcher).request({ account: 'a', key: 'test', resource: 'video/jobs', method: 'POST', body: { model: 'video', prompt: 'test', size: '1080p@1:1', duration: 12 }, contentType: 'application/json', identity: 'video', fingerprint: 'video', signal: AbortSignal.timeout(3_000), model });
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: 'video', prompt: 'test', resolution: '1080p', aspect_ratio: '1:1', duration: 12 });
});

it('omits the voice for official models that supply a default, preserving custom speech behavior', async () => {
  const f = await fixture();
  const speech = f.state.models.find(model => model.modality === 'speech')!;
  speech.capabilities = ['default_voice']; speech.voices = [];
  const service = createKrillinTtsService({ resourceRoot: f.root, workRoot: f.root, configStore: f.source.store, executeSynthesis: vi.fn(async () => ({ content: Buffer.from('audio'), format: 'mp3' as const })) });
  expect(await service.listVoices('openai')).toMatchObject({ voices: [{ id: gatewayDefaultVoiceId }] });
  expect(await service.synthesize({ text: 'hello' })).toMatchObject({ voiceId: gatewayDefaultVoiceId });
  const config = await f.source.store.read();
  const response = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/audio/speech', headers: { Authorization: `Bearer ${config.llm.apiKey}` }, payload: { model: 'vendor/speech', input: 'hello', voice: gatewayDefaultVoiceId } });
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(String(vi.mocked(f.fetcher).mock.lastCall?.[1]?.body))).not.toHaveProperty('voice');
});
it('keeps an image request alive after the caller disconnects and replays its durable result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-image-async-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  let release!: (response: Response) => void;
  const fetcher = vi.fn((_url: URL | RequestInfo, _options?: RequestInit) => new Promise<Response>(resolve => { release = resolve; }));
  const transport = createDirectTransport(root, fetcher); cleanup.push(() => transport.close());
  const caller = new AbortController();
  const input = { account: 'a', key: 'private', resource: 'images/generations', method: 'POST', body: { model: 'image', prompt: 'same' }, contentType: 'application/json', identity: 'same', fingerprint: 'same', signal: caller.signal, asyncImage: true };
  const accepted = await transport.request(input);
  const { requestId } = await accepted.json();
  expect(accepted.status).toBe(202);
  expect(transport.isBusy()).toBe(true);
  caller.abort();
  expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(false);
  expect((await transport.request({ ...input, signal: AbortSignal.timeout(3_000) })).status).toBe(202);
  await expect(transport.request({ ...input, fingerprint: 'different' })).rejects.toMatchObject({ code: 'operation_conflict' });
  release(Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] }));
  const lookup = { ...input, resource: `requests/${requestId}`, method: 'GET', signal: AbortSignal.timeout(3_000) };
  await vi.waitFor(async () => expect(await (await transport.request(lookup)).json()).toMatchObject({ state: 'succeeded' }));
  const restarted = createDirectTransport(root, fetcher);
  expect(await (await restarted.request({ ...lookup, resource: `${lookup.resource}/result` })).json()).toEqual({ data: [{ b64_json: 'aW1hZ2U=' }] });
  expect((await restarted.request({ ...input, signal: AbortSignal.timeout(3_000) })).status).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('saves complete image JSON without waiting for a stuck upstream stream to close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-image-open-stream-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const cancel = vi.fn();
  const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }))); }, cancel }), { headers: { 'Content-Type': 'application/json' } }));
  const transport = createDirectTransport(root, fetcher);
  const result = await transport.request({ account: 'a', key: 'private', resource: 'images/generations', method: 'POST', body: { model: 'image', prompt: 'same' }, contentType: 'application/json', identity: 'same', fingerprint: 'same', signal: AbortSignal.timeout(1_000) });
  expect(await result.json()).toMatchObject({ data: [{ b64_json: 'aW1hZ2U=' }] });
  expect(cancel).toHaveBeenCalledOnce();
});
it('finishes image worker shutdown even when the upstream ignores abort and never returns headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-image-abort-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fetcher = vi.fn(() => new Promise<Response>(() => {}));
  const transport = createDirectTransport(root, fetcher);
  const input = { account: 'a', key: 'private', resource: 'images/generations', method: 'POST', body: { model: 'image', prompt: 'same' }, contentType: 'application/json', identity: 'same', fingerprint: 'same', signal: AbortSignal.timeout(1_000), asyncImage: true };
  const { requestId } = await (await transport.request(input)).json();
  await transport.close();
  expect(await (await transport.request({ ...input, resource: `requests/${requestId}`, method: 'GET' })).json()).toMatchObject({ state: 'outcome_unknown' });
  await expect(createDirectTransport(root, fetcher).request(input)).rejects.toMatchObject({ code: 'request_outcome_unknown' });
  expect(fetcher).toHaveBeenCalledOnce();
});
it('polls an official image receipt and downloads a cached image without making another paid request', async () => {
  const f = await fixture();
  const origin = await f.server.listen({ host: '127.0.0.1', port: 0 });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
  vi.mocked(f.fetcher).mockImplementation(async () => Response.json({ data: [{ b64_json: image.toString('base64') }] }));
  const config = await f.source.store.read(); config.image.openai.baseUrl = `${origin}/internal/krillin-llm/gateway/v1`;
  const onGatewayRequest = vi.fn();
  const result = await generateImageContents({ provider: 'openai', prompt: 'test', size: '1024x1024', quality: 'medium', count: 1 }, config, { logicalId: 'paid-once', onGatewayRequest });
  expect(result.contents[0]?.content).toEqual(image);
  expect(onGatewayRequest).toHaveBeenCalledWith(expect.stringMatching(/^ocdir_/));
  expect(await readPrivateJsonFile(join(f.root, 'receipts', `${onGatewayRequest.mock.calls[0]![0]}.json`))).toMatchObject({ state: 'succeeded' });
  await generateImageContents({ provider: 'openai', prompt: 'test', size: '1024x1024', quality: 'medium', count: 1 }, config, { logicalId: 'paid-once' });
  expect(f.fetcher).toHaveBeenCalledOnce();
});
it('recognizes a zero-limit 403 as insufficient credits without exposing upstream details', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-image-quota-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fetcher = vi.fn(async () => Response.json({ error: { message: 'Key limit exceeded (total limit). Manage it using https://openrouter.ai/private' } }, { status: 403 }));
  const transport = createDirectTransport(root, fetcher);
  const input = { account: 'a', key: 'private', resource: 'images/generations', method: 'POST', body: { model: 'image', prompt: 'same' }, contentType: 'application/json', identity: 'same', fingerprint: 'same', signal: AbortSignal.timeout(3_000), asyncImage: true };
  const { requestId } = await (await transport.request(input)).json();
  await vi.waitFor(async () => {
    const result = await (await transport.request({ ...input, resource: `requests/${requestId}`, method: 'GET' })).json();
    expect(result).toMatchObject({ state: 'failed', error: { code: 'credits_insufficient', status: 403 } });
    expect(JSON.stringify(result)).not.toContain('openrouter');
  });
});
it.each([true, false])('reconciles both image ledgers and records usable progress (success=%s)', async success => {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-image-ledger-'));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const ledger = new CreatorProviderRequestLedger(repository);
  const f = await fixture(ledger);
  const origin = await f.server.listen({ host: '127.0.0.1', port: 0 });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
  vi.mocked(f.fetcher).mockImplementation(async () => success ? Response.json({ data: [{ b64_json: image.toString('base64') }] }) : Response.json({ error: { message: 'Key limit exceeded (total limit)' } }, { status: 403 }));
  const job = repository.createJob({ projectId: 'project', templateId: 'image-generation', templateVersion: 2, status: 'running', state: { prompt: 'test', provider: 'openai', candidateCount: 1, size: '1024x1024', quality: 'medium' } });
  const stage = repository.createStageRun({ jobId: job.id, stageId: 'generate', executor: 'image', status: 'running' });
  const executor = createImageExecutor({ ledger, configStore: { async read() { const config = await f.source.store.read(); config.image.openai.baseUrl = `${origin}/internal/krillin-llm/gateway/v1`; return config; } } });
  const reportProgress = vi.fn();
  try {
    const run = f.source.runForJob(job.id, stage.id, () => executor.run({ job, stageRun: stage, workdir: root, inputArtifacts: [], signal: AbortSignal.timeout(3_000), reportProgress }));
    if (success) expect((await run).outputs).toHaveLength(1);
    else {
      await expect(run).rejects.toMatchObject({ code: 'image_generation_failed' });
      expect(reportProgress.mock.lastCall?.[0]).toMatchObject({ status: 'failed', completed: 0, failed: 1, percent: 10 });
    }
    const receipts = repository.getJob(job.id)!.providerRequests;
    expect(receipts).toHaveLength(2);
    expect(receipts.every(receipt => receipt.status === (success ? 'succeeded' : 'failed'))).toBe(true);
    expect(f.source.isBusy()).toBe(false);
  } finally { await f.source.revoke(); db.close(); await rm(root, { recursive: true, force: true }); }
});
it('uses a local Runtime capability and stateless Responses with safe upstream errors', async () => {
  const fetcher = vi.fn(async (_url: URL | RequestInfo, _options?: RequestInit) => Response.json({ error: { message: 'Insufficient provider credits token=private-provider-secret key=private-user-key' } }, { status: 402 }));
  const runtime = await createDirectRuntime('private-user-key', fetcher); cleanup.push(() => runtime.close());
  const result = await fetch(`${runtime.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'vendor/text', input: [], store: true }) });
  expect(result.status).toBe(402);
  const error = await result.json();
  expect(error).toMatchObject({ error: { code: 'official_service_unavailable', message: expect.stringContaining('Insufficient provider credits') } });
  expect(JSON.stringify(error)).not.toContain('private-provider-secret');
  expect(JSON.stringify(error)).not.toContain('private-user-key');
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toMatchObject({ store: false });
  expect((await fetch(`${runtime.baseUrl}/responses`, { method: 'POST', body: '{}' })).status).toBe(401);
});

it('queries a saved paid image receipt and resolves related ledgers without resubmitting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-query-paid-image-'));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const ledger = new CreatorProviderRequestLedger(repository);
  const f = await fixture(ledger);
  const job = repository.createJob({ projectId: 'project', templateId: 'image-generation', templateVersion: 2, status: 'failed', state: {} });
  const stage = repository.createStageRun({ jobId: job.id, stageId: 'generate', executor: 'image', status: 'failed' });
  try {
    const config = await f.source.store.read();
    const response = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/images/generations', headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Idempotency-Key': 'query-paid-image' }, payload: { model: 'vendor/image', prompt: 'test' } });
    expect(response.statusCode).toBe(200);
    const requestId = String(response.headers['x-request-id']);
    const register = (provider: string) => {
      const receipt = ledger.registerBeforeSubmit({ jobId: job.id, stageRunId: stage.id, provider, requestKey: 'query-paid-image', request: {}, gateway: { accountId: 'a', bindingVersion: 'a:1', logicalId: 'query-paid-image' } });
      ledger.markSubmitting(receipt.id); ledger.markWaitingRemote(receipt.id, requestId);
      return ledger.markUnknownRemoteAcceptance(receipt.id);
    };
    const outer = register('opencreator-gateway-image');
    register('opencreator-gateway-images/generations');
    await f.source.queryProviderRequest(outer);
    expect(repository.listProviderRequests(job.id).map(receipt => receipt.status)).toEqual(['succeeded', 'succeeded']);
    expect(f.fetcher).toHaveBeenCalledOnce();
    await expect(f.source.queryProviderRequest({ ...outer, gateway: { ...outer.gateway!, accountId: 'different-account' } })).rejects.toMatchObject({ code: 'task_source_mismatch' });
    expect(f.fetcher).toHaveBeenCalledOnce();
  } finally { await f.source.revoke(); db.close(); await rm(root, { recursive: true, force: true }); }
});

it('replays an existing image after model quarantine and rejects new requests to that model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-quarantined-media-'));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const job = repository.createJob({ projectId: 'project', templateId: 'image-generation', templateVersion: 2, status: 'failed', state: { officialModels: { image: 'vendor/image' } } });
  const original = repository.createStageRun({ jobId: job.id, stageId: 'generate', executor: 'image', status: 'failed' });
  const resumed = repository.createStageRun({ jobId: job.id, stageId: 'generate', executor: 'image', status: 'running', progress: { resumedFromStageRunId: original.id } });
  const f = await fixture(undefined, { readJobState: id => repository.getJob(id)?.state, readStageRun: repository.getStageRun,
    readJobBinding: () => ({ source: 'gateway', accountId: 'a', bindingVersion: 'a:1', models: { image: 'vendor/image', text: 'vendor/text' }, capabilities: { image: ['edit'] } }) });
  const origin = await f.server.listen({ host: '127.0.0.1', port: 0 });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
  vi.mocked(f.fetcher).mockImplementation(async () => Response.json({ data: [{ b64_json: image.toString('base64') }] }));
  const generate = async () => {
    const config = await f.source.store.read(); config.image.openai.baseUrl = `${origin}/internal/krillin-llm/gateway/v1`;
    return generateImageContents({ provider: 'openai', prompt: 'test', size: '1024x1024', quality: 'medium', count: 1 }, config, { logicalId: 'quarantined-paid-image' });
  };
  try {
    await f.source.runForJob(job.id, original.id, generate);
    f.state.models.splice(f.state.models.findIndex(model => model.modality === 'image'), 1);
    expect((await f.source.runForJob(job.id, resumed.id, generate)).contents[0]!.content).toEqual(image);
    expect(f.fetcher).toHaveBeenCalledOnce();
    await expect(f.source.runForJob(job.id, original.id, generate)).rejects.toMatchObject({ code: 'invalid_model' });
    const config = await f.source.store.read();
    const response = await f.server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/images/generations', headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Idempotency-Key': 'new-quarantined-image' }, payload: { model: 'vendor/image', prompt: 'test' } });
    expect(response.statusCode).toBe(400);
    expect(f.fetcher).toHaveBeenCalledOnce();
  } finally { await f.source.revoke(); db.close(); await rm(root, { recursive: true, force: true }); }
});
