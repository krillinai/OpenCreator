import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import { createGatewayCreatorSource } from '../../src/gateway/creator-service-source.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(firstStatus: 503 | 202 | 400 = 503) {
  const root = await mkdtemp(join(tmpdir(), 'oc-gateway-transcription-'));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const job = repository.createJob({ projectId: 'project', templateId: 'video-translation', templateVersion: 1, status: 'running', state: {} });
  const stage = repository.createStageRun({ jobId: job.id, stageId: 'subtitle', executor: 'krillin', status: 'running' });
  const manual = createDefaultCreatorServicesConfig();
  const transcript = { text: 'Hello', language: 'en', segments: [{ start: 0, end: 1, text: 'Hello' }] };
  let originalState: 'outcome_unknown' | 'waiting_upstream' | 'succeeded' | 'failed' = 'outcome_unknown';
  let originalBillingState: 'reconciling' | 'released' = 'reconciling';
  const postedKeys: string[] = [];
  const originalId = () => `ocreq_${createHash('sha256').update(`a:${postedKeys[0]}`).digest('hex').slice(0, 48)}`;
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (options?.method === 'POST') {
      const key = new Headers(options.headers).get('idempotency-key')!;
      postedKeys.push(key);
      const id = `ocreq_${createHash('sha256').update(`a:${key}`).digest('hex').slice(0, 48)}`;
      return postedKeys.length === 1
        ? Response.json(firstStatus === 202 ? { requestId: id, state: 'outcome_unknown' }
          : { error: { code: firstStatus === 400 ? 'invalid_request' : 'request_outcome_unknown' } },
          { status: firstStatus, headers: firstStatus === 400 ? {} : { 'X-Request-ID': id } })
        : Response.json(transcript, { headers: { 'X-Request-ID': id } });
    }
    if (String(url).endsWith('/result')) return Response.json(transcript, { headers: { 'X-Request-ID': originalId() } });
    const id = String(url).split('/').at(-1)!;
    if (firstStatus === 400 && id === originalId()) return Response.json({ error: { code: 'request_not_found' } }, { status: 404 });
    return Response.json({ requestId: id, state: id === originalId() ? originalState : 'succeeded',
      billingState: id === originalId() ? originalState === 'succeeded' ? 'settled' : originalBillingState : 'settled' });
  });
  const source = createGatewayCreatorSource({ ledger: new CreatorProviderRequestLedger(repository), readStageRun: repository.getStageRun,
    readJobBinding: () => ({ source: 'gateway', accountId: 'a', bindingVersion: 'a:1', models: { transcription: 'whisper-1' }, capabilities: { transcription: ['subtitle_timestamps'] } }),
    account: {
      peekState: () => ({ source: 'gateway', transport: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', models: [], activationError: null }),
      modelCredentials: async () => ({ accountId: 'a', transport: 'gateway', modelKey: 'offline-key', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://gateway.example/v1', defaults: { transcription: 'whisper-1' }, models: [] })
    },
    manual: { read: async () => manual, write: async value => value, reset: async () => manual },
    getLocalOrigin: () => 'http://127.0.0.1:39999', fetcher
  });
  const server = Fastify();
  await source.register(server);
  cleanup.push(async () => { await source.revoke(); await server.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  const transcribe = (stageId = stage.id) => source.runForJob(job.id, stageId, async () => {
    const config = await source.store.read();
    const form = new FormData();
    form.set('model', 'whisper-1');
    form.set('response_format', 'verbose_json');
    form.set('file', new Blob(['offline-audio'], { type: 'audio/wav' }), 'segment.wav');
    const request = new Request('http://localhost', { method: 'POST', body: form });
    return server.inject({ method: 'POST', url: '/internal/krillin-llm/gateway/v1/audio/transcriptions',
      headers: { Authorization: `Bearer ${config.transcription.openai.apiKey}`, 'Content-Type': request.headers.get('content-type')! },
      payload: Buffer.from(await request.arrayBuffer()) });
  });
  const retryStage = () => repository.createStageRun({ jobId: job.id, stageId: 'subtitle', executor: 'krillin', status: 'running',
    progress: { resumedFromStageRunId: stage.id } });
  return { repository, job, stage, transcribe, retryStage, postedKeys,
    setOriginalState: (state: typeof originalState, billing: typeof originalBillingState = 'reconciling') => { originalState = state; originalBillingState = billing; } };
}

it.each([503, 202] as const)('keeps an uncertain transcription from HTTP %i on its original request and recovers its result', async status => {
  const f = await fixture(status);
  expect((await f.transcribe()).statusCode).toBe(409);
  expect((await f.transcribe()).statusCode).toBe(409);
  expect(f.postedKeys).toHaveLength(1);
  f.setOriginalState('succeeded');
  const result = await f.transcribe(f.retryStage().id);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ text: 'Hello' });
  expect(f.postedKeys).toHaveLength(1);
});

it('uses a new request identity only after the uncertain transcription is released', async () => {
  const f = await fixture();
  expect((await f.transcribe()).statusCode).toBe(409);
  f.setOriginalState('failed', 'reconciling');
  const retry = f.retryStage();
  expect((await f.transcribe(retry.id)).statusCode).toBe(409);
  expect(f.postedKeys).toHaveLength(1);
  f.setOriginalState('failed', 'released');
  const result = await f.transcribe(retry.id);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ text: 'Hello' });
  expect(f.postedKeys).toHaveLength(2);
  expect(f.postedKeys[1]).not.toBe(f.postedKeys[0]);
});

it('resubmits a rejected transcription on a new stage without waiting for a nonexistent request', async () => {
  const f = await fixture(400);
  expect((await f.transcribe()).statusCode).toBe(400);
  const result = await f.transcribe(f.retryStage().id);
  expect(result.statusCode).toBe(200);
  expect(f.postedKeys).toHaveLength(2);
  expect(f.postedKeys[1]).not.toBe(f.postedKeys[0]);
});

it.each(['outcome_unknown', 'waiting_upstream', 'failed'] as const)('blocks an unrelated stage while transcription is %s and not released', async state => {
  const f = await fixture();
  f.setOriginalState(state);
  expect((await f.transcribe()).statusCode).toBe(409);
  if (state === 'failed') expect((await f.transcribe(f.retryStage().id)).statusCode).toBe(409);
  const unrelated = f.repository.createStageRun({ jobId: f.job.id, stageId: 'subtitle', executor: 'krillin', status: 'running' });
  expect((await f.transcribe(unrelated.id)).statusCode).toBe(409);
  expect(f.postedKeys).toHaveLength(1);
});
