import Fastify from 'fastify';
import { createDefaultCreatorServicesConfig, type GatewayModel } from '@opencreator/protocol';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createImageExecutor } from '../../src/creator/image/executor.js';
import { createCreatorIssueService } from '../../src/creator/issues.js';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { createGatewayCreatorSource } from '../../src/gateway/creator-service-source.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');

async function fixture(prefix: 'ocreq' | 'ocdir', invalidReceipt = false, canonical = false, rejected = false) {
  const root = await mkdtemp(join(tmpdir(), 'creator-gateway-image-'));
  const db = openRuntimeDatabase(join(root, 'runtime.sqlite'));
  const model: GatewayModel = { id: 'gpt-image-2', modality: 'image', capabilities: ['generate', 'edit'],
    imageOptions: { maxImages: 1, maxReferences: 1, aspectRatios: ['1:1'], resolutions: ['1K'], qualities: ['low'] } };
  if (canonical) {
    model.catalogSchema = 2;
    model.imageOptions = { maxImages: 1, maxReferences: 1 };
  }
  const binding = { source: 'gateway' as const, accountId: 'a', bindingVersion: 'a:gateway:v1', supplier: 'chatanywhere' as const,
    models: { image: model.id }, capabilities: { image: model.capabilities } };
  const repository = createCreatorRepository(db, { serviceBinding: () => binding });
  const issues = createCreatorIssueService(repository);
  const ledger = new CreatorProviderRequestLedger(repository, issues);
  const requestId = `${prefix}_${'a'.repeat(48)}`;
  let submissions = 0;
  const identities: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    expect(String(url)).toMatch(/^https:\/\/gateway\.example\/v1\//);
    if (options?.method === 'POST') {
      if (canonical) {
        const body = JSON.parse(String(options.body));
        expect(body).toMatchObject({ model: model.id, n: 1, prompt: 'A blue square' });
        for (const key of ['size', 'quality', 'aspect_ratio', 'resolution']) expect(body).not.toHaveProperty(key);
      }
      const identity = new Headers(options.headers).get('Idempotency-Key')!;
      expect(identity).toBeTruthy();
      identities.push(identity);
      if (submissions > 0) {
        expect(identity).toBe(identities[0]);
        return Response.json({ data: [{ b64_json: image.toString('base64') }] }, { headers: { 'X-Request-ID': requestId } });
      }
      submissions++;
      expect(new Headers(options.headers).get('Prefer')).toBe('respond-async');
      return Response.json({ requestId: invalidReceipt ? `${prefix}_${'b'.repeat(48)}` : requestId, state: 'submitting' },
        { status: 202, headers: { 'X-Request-ID': requestId } });
    }
    if (String(url).endsWith('/result')) return rejected
      ? Response.json({ error: { code: 'upstream_rejected', message: '图片未通过内容安全审核', requestId } }, { status: 400, headers: { 'X-Request-ID': requestId } })
      : Response.json({ data: [{ b64_json: image.toString('base64') }] });
    return Response.json({ requestId, state: rejected ? 'failed' : 'succeeded', billingState: rejected ? 'released' : 'settled',
      ...(rejected ? { errorCode: 'upstream_rejected' } : {}) });
  });
  let origin = '';
  const manual = createDefaultCreatorServicesConfig();
  const source = createGatewayCreatorSource({ ledger,
    readJobBinding: repository.getServiceBinding, readJobState: id => repository.getJob(id)?.state, readStageRun: repository.getStageRun,
    account: {
      peekState: () => ({ source: 'gateway', transport: 'gateway', supplier: 'chatanywhere', authState: 'signed_in', activationState: 'ready',
        account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: binding.bindingVersion,
        selectedModels: binding.models, models: [model], activationError: null }),
      modelCredentials: async () => ({ accountId: 'a', transport: 'gateway', modelKey: 'device-token', keyVersion: '1',
        bindingVersion: binding.bindingVersion, baseUrl: 'https://gateway.example/v1', defaults: binding.models, models: [model] })
    },
    manual: { read: async () => manual, write: async c => c, reset: async () => manual }, getLocalOrigin: () => origin, fetcher
  });
  const server = Fastify();
  await source.register(server);
  origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates, providerRequestLedger: ledger });
  const executor = createImageExecutor({ ledger, configStore: source.store });
  const runner = createCreatorStageRunner({ repository, templates, issueService: issues, workRoot: join(root, 'jobs'),
    executors: [{ id: 'image', run: stage => source.runForJob(stage.job.id, stage.stageRun.id, () => executor.run(stage)) }] });
  const dispatcher = createCreatorCommandDispatcher({ repository, service, receipts: createCreatorAgentRepository(db), queryProviderRequest: source.queryProviderRequest });
  const job = service.createJob({ projectId: 'project', templateId: 'image-generation', templateVersion: 2,
    state: { prompt: 'A blue square', provider: 'openai', candidateCount: 1, size: '1024x1024', quality: 'low',
      ...(canonical ? { aspectRatio: '', resolution: '', officialQuality: '' } : {}) } });
  return { job, repository, dispatcher, runner, source, fetcher, identities, issues,
    async close() { await runner.close(); await source.revoke(); await server.close(); db.close(); await rm(root, { recursive: true, force: true }); } };
}

it.each(['ocreq', 'ocdir'] as const)('saves a complete Creator image result from an asynchronous %s receipt', async prefix => {
  const f = await fixture(prefix);
  try {
    const command = f.dispatcher.dispatch(f.job.id, { action: 'run-stage', expectedRevision: f.job.revision,
      idempotencyKey: 'generate', input: { stageId: 'generate' } }, 'user');
    await f.runner.runStageRun(command.commandReceipt.stageRunId!);
    const result = f.repository.getJob(f.job.id)!;
    expect(result.status).toBe('completed');
    expect(result.state.latestResultVersion).toBe(1);
    const artifact = result.artifacts.find(a => a.kind === 'generated_image')!;
    expect(await readFile(artifact.path!)).toEqual(image);
    expect(result.providerRequests.every(r => r.status === 'succeeded')).toBe(true);
    expect(f.repository.listIssues(result.id).filter(i => i.status !== 'resolved')).toEqual([]);
    expect(f.identities).toHaveLength(1);
    expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/result'))).toBe(true);
  } finally { await f.close(); }
});

it('preserves the gateway reason for a rejected asynchronous image', async () => {
  const f = await fixture('ocreq', false, false, true);
  try {
    const command = f.dispatcher.dispatch(f.job.id, { action: 'run-stage', expectedRevision: f.job.revision,
      idempotencyKey: 'rejected-generate', input: { stageId: 'generate' } }, 'user');
    await f.runner.runStageRun(command.commandReceipt.stageRunId!);
    const result = f.repository.getJob(f.job.id)!;
    expect(result.stages[0]).toMatchObject({ status: 'failed' });
    expect(f.repository.listIssues(result.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ publicFacts: expect.objectContaining({ httpStatus: 400,
        upstreamCode: 'upstream_rejected', upstreamMessage: '图片未通过内容安全审核' }) })
    ]));
    expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/result'))).toBe(true);
    expect(f.identities).toHaveLength(1);
  } finally { await f.close(); }
});

it('saves a catalog image without leaking legacy size or empty options into the canonical request', async () => {
  const f = await fixture('ocreq', false, true);
  try {
    const command = f.dispatcher.dispatch(f.job.id, { action: 'run-stage', expectedRevision: f.job.revision,
      idempotencyKey: 'canonical-generate', input: { stageId: 'generate' } }, 'user');
    await f.runner.runStageRun(command.commandReceipt.stageRunId!);
    const result = f.repository.getJob(f.job.id)!;
    expect(result.status).toBe('completed');
    expect(await readFile(result.artifacts.find(a => a.kind === 'generated_image')!.path!)).toEqual(image);
    expect(f.identities).toHaveLength(1);
  } finally { await f.close(); }
});

it('rejects a mismatched receipt and recovers its paid image on retry with the original identity', async () => {
  const f = await fixture('ocreq', true);
  try {
    const command = f.dispatcher.dispatch(f.job.id, { action: 'run-stage', expectedRevision: f.job.revision,
      idempotencyKey: 'generate', input: { stageId: 'generate' } }, 'user');
    await f.runner.runStageRun(command.commandReceipt.stageRunId!);
    let job = f.repository.getJob(f.job.id)!;
    expect(job.stages[0]).toMatchObject({ status: 'failed', errorMessage: 'Invalid image generation receipt' });
    const receipt = job.providerRequests.find(r => r.provider === 'opencreator-gateway-image')!;
    const queried = await f.dispatcher.dispatchAsync(job.id, { action: 'resolve-provider-request', expectedRevision: job.revision,
      idempotencyKey: 'query', input: { ledgerId: receipt.id, decision: 'query' } }, 'user');
    expect(queried.job.providerRequests.find(r => r.id === receipt.id)?.status).toBe('succeeded');
    const retried = f.dispatcher.dispatch(job.id, { action: 'retry-stage', expectedRevision: queried.job.revision,
      idempotencyKey: 'recover', input: { stageId: 'generate' } }, 'user');
    const stageIssue = f.repository.listIssues(job.id).find(i => i.code === 'image_generation_failed')!;
    f.issues.beginResolution({ jobId: job.id, issueId: stageIssue.id, resolutionAttemptId: retried.commandReceipt.stageRunId!,
      associationKind: 'stage-run', associationId: retried.commandReceipt.stageRunId!, stageRunId: retried.commandReceipt.stageRunId! });
    await f.runner.runStageRun(retried.commandReceipt.stageRunId!);
    job = f.repository.getJob(job.id)!;
    expect(job.status).toBe('completed');
    expect(await readFile(job.artifacts.find(a => a.kind === 'generated_image')!.path!)).toEqual(image);
    expect(f.identities).toHaveLength(2);
    expect(new Set(f.identities).size).toBe(1);
    expect(job.providerRequests.every(r => r.status === 'succeeded')).toBe(true);
    expect(f.repository.listIssues(job.id).filter(i => i.status !== 'resolved')).toEqual([]);
  } finally { await f.close(); }
});
