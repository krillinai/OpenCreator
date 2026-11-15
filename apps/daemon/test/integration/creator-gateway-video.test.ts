import Fastify from 'fastify';
import { createDefaultCreatorServicesConfig, type GatewayModel } from '@opencreator/protocol';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createVideoExecutor } from '../../src/creator/video/executor.js';
import { createVideoGenerationService } from '../../src/video-generation/service.js';
import { createCreatorIssueService } from '../../src/creator/issues.js';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { createGatewayCreatorSource } from '../../src/gateway/creator-service-source.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

const video = Buffer.from('gateway-generated-video');
const asset = `ocasset_${'c'.repeat(48)}`;

async function fixture(invalidReceipt = false) {
  const root = await mkdtemp(join(tmpdir(), 'creator-gateway-video-'));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  const model: GatewayModel = { id: 'grok-video-3', modality: 'video', capabilities: ['generate', 'image_to_video'],
    resolutions: ['720p'], aspectRatios: ['16:9'], durations: [4], price: { version: 'v1', videoUnitsPerSecond: { '720p': 2_000_000 } },
    videoOptions: { profile: 'grok', maxImages: 1, maxVideos: 0, maxAudios: 0, firstLastFrames: false, framesExclusive: false, generateAudio: true, referenceDuration: 0 } };
  const binding = { source: 'gateway' as const, accountId: 'a', bindingVersion: 'a:gateway:v1', supplier: 'chatanywhere' as const,
    models: { video: model.id }, capabilities: { video: model.capabilities } };
  const repository = createCreatorRepository(db, { serviceBinding: () => binding });
  const issues = createCreatorIssueService(repository);
  const ledger = new CreatorProviderRequestLedger(repository, issues);
  const requestId = `ocreq_${'a'.repeat(48)}`;
  let submissions = 0;
  let polls = 0;
  const identities: string[] = [];
  const receipt = (body: Record<string, unknown>, status = 200) => Response.json({ requestId, ...body }, { status, headers: { 'X-Request-ID': requestId } });
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    expect(String(url)).toMatch(/^https:\/\/gateway\.example\/v1\//);
    if (String(url).endsWith('/video/assets')) return Response.json({ assetId: asset, expiresAt: '2030-01-01T00:00:00Z' });
    if (options?.method === 'POST') {
      submissions++;
      identities.push(new Headers(options.headers).get('Idempotency-Key')!);
      const payload = JSON.parse(String(options.body));
      expect(payload).toMatchObject({ model: model.id, duration: 4, size: '720p@16:9', images: [asset], generate_audio: true });
      expect(payload).not.toHaveProperty('priceVersion');
      return receipt({ requestId: invalidReceipt ? `ocreq_${'b'.repeat(48)}` : requestId, state: 'submitting', phase: 'pending', status: 'queued' }, 202);
    }
    if (String(url).endsWith('/result')) return new Response(new Uint8Array(video), { headers: { 'Content-Type': 'video/mp4' } });
    polls++;
    if (polls === 1) return receipt({ state: 'outcome_unknown', billingState: 'reconciling', phase: 'unknown', status: 'unknown' });
    return receipt({ state: 'succeeded', billingState: 'settled', phase: 'finished', status: 'completed', progress: 100 });
  });
  let origin = '';
  const manual = createDefaultCreatorServicesConfig();
  const source = createGatewayCreatorSource({ ledger, readJobBinding: repository.getServiceBinding, readJobState: id => repository.getJob(id)?.state, readStageRun: repository.getStageRun,
    account: {
      peekState: () => ({ source: 'gateway', transport: 'gateway', supplier: 'chatanywhere', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: binding.bindingVersion, selectedModels: binding.models, models: [model], activationError: null }),
      modelCredentials: async () => ({ accountId: 'a', transport: 'gateway', modelKey: 'device-token', keyVersion: '1', bindingVersion: binding.bindingVersion, baseUrl: 'https://gateway.example/v1', defaults: binding.models, models: [model] })
    }, manual: { read: async () => manual, write: async c => c, reset: async () => manual }, getLocalOrigin: () => origin, fetcher });
  const server = Fastify(); await source.register(server); origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates, providerRequestLedger: ledger });
  const generation = () => createVideoGenerationService({ dataDir: root, configStore: source.store, gatewaySource: source });
  const executor = createVideoExecutor({ ledger, service: generation(), sleep: async () => undefined,
    probeVideo: async () => ({ duration: 4, width: 1280, height: 720, hasVideo: true, hasAudio: false }) });
  const runner = createCreatorStageRunner({ repository, templates, issueService: issues, workRoot: join(root, 'jobs'),
    executors: [{ id: 'video', run: stage => source.runForJob(stage.job.id, stage.stageRun.id, () => executor.run(stage)) }] });
  const dispatcher = createCreatorCommandDispatcher({ repository, service, receipts: createCreatorAgentRepository(db), queryProviderRequest: source.queryProviderRequest });
  const job = service.createJob({ projectId: 'project', templateId: 'video-generation', templateVersion: 1,
    state: { officialModels: binding.models, prompt: 'A square', provider: 'seedance', model: model.id, duration: 4, size: '720p@16:9', videoPriceVersion: 'v1', generateAudio: true,
      videoReferences: [{ role: 'image', assetId: asset, fileName: 'reference.png' }] } });
  return { job, repository, dispatcher, runner, source, generation, fetcher, identities, submissions: () => submissions,
    async close() { await runner.close(); await source.revoke(); await server.close(); db.close(); await rm(root, { recursive: true, force: true }); } };
}

it('completes an official video through the scoped gateway and shared Creator task without a final error during reconciliation', async () => {
  const f = await fixture();
  try {
    const command = f.dispatcher.dispatch(f.job.id, { action: 'run-stage', expectedRevision: f.job.revision, idempotencyKey: 'generate', input: { stageId: 'generate' } }, 'user');
    await f.runner.runStageRun(command.commandReceipt.stageRunId!);
    const job = f.repository.getJob(f.job.id)!;
    expect(job.status).toBe('completed');
    expect(await readFile(job.artifacts.find(a => a.kind === 'generated_video')!.path!)).toEqual(video);
    expect(job.providerRequests.every(r => r.status === 'succeeded')).toBe(true);
    expect(f.repository.listIssues(job.id).filter(i => i.status !== 'resolved')).toEqual([]);
    expect(f.identities).toHaveLength(1);
    expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/result'))).toBe(true);
  } finally { await f.close(); }
});

it('rejects a mismatched receipt and resumes persisted video parameters with the same logical identity', async () => {
  const f = await fixture(true);
  try {
    let localId = '';
    await expect(f.source.runForJob(f.job.id, 'stage', () => f.generation().create({ provider: 'seedance', model: 'grok-video-3', prompt: 'A square', duration: 4,
      size: '720p@16:9', generateAudio: true, references: [{ role: 'image', assetId: asset, fileName: 'reference.png' }] },
      { logicalId: 'logical-original', onPending: id => { localId = id; } }))).rejects.toThrow('Invalid official video receipt');
    expect(localId).toBeTruthy();
    await expect(f.source.runForJob(f.job.id, 'stage', () => f.generation().refresh(localId))).rejects.toThrow('Invalid official video receipt');
    expect(f.identities).toHaveLength(2);
    expect(new Set(f.identities).size).toBe(1);
  } finally { await f.close(); }
});
