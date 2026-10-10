import { createDefaultCreatorServicesConfig, gatewayDefaultVoiceId, type CreatorServicesConfig, type CreatorProviderRequest, type CreatorStageRun, type CreatorJob, type GatewayModel } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';
import { KRILLIN_LLM_ROUTE_PREFIX } from '../creator/krillin/codex-llm-gateway.js';
import type { GatewayAccountService } from './account-service.js';
import { GatewayError } from './client.js';
import type { CreatorServiceBinding } from '../creator/repository.js';
import type { CreatorProviderRequestLedger } from '../creator/provider-requests.js';
import { createDirectTransport } from './direct-transport.js';
import { createOfficialFetch } from './official-fetch.js';

export type GatewayCreatorBinding = { accountId: string; bindingVersion: string; baseUrl: string; apiKey: string; models: Record<string, string>; catalog?: GatewayModel[]; capabilities?: Record<string, string[]>; speechVoices?: string[]; logicalId?: string; stageRunId?: string };
const bindings = new WeakMap<CreatorServicesConfig, GatewayCreatorBinding>();
export function gatewayCreatorBinding(config: CreatorServicesConfig) { return bindings.get(config); }

export function createGatewayCreatorSource(input: {
  account: Pick<GatewayAccountService, 'peekState' | 'modelCredentials'> & Partial<Pick<GatewayAccountService, 'beginModelUse'>>;
  manual: CreatorServicesConfigStore;
  getLocalOrigin(): string | undefined;
  fetcher?: typeof fetch;
  readJobBinding?(jobId: string): CreatorServiceBinding;
  readJobState?(jobId: string): CreatorJob['state'] | undefined;
  readStageRun?(stageRunId: string): CreatorStageRun | undefined;
  ledger?: CreatorProviderRequestLedger;
  directRequestsRoot?: string;
}) {
  const capabilities = new Map<string, { token: string; accountId: string; bindingVersion: string; logicalId?: string; jobId?: string }>();
  const context = new AsyncLocalStorage<{ snapshot: CreatorServiceBinding; logicalId: string; stageRunId: string; jobId: string }>();
  const inFlight = new Map<AbortController, Promise<void>>();
  const remoteTasks = new Set<string>();
  const prefix = `${KRILLIN_LLM_ROUTE_PREFIX}/gateway/v1`;
  const direct = input.directRequestsRoot ? createDirectTransport(input.directRequestsRoot,
    input.fetcher ?? createOfficialFetch({ readProxy: async () => (await input.manual.read()).proxy })) : undefined;
  function snapshot(): CreatorServiceBinding {
    const state = input.account.peekState();
    if (state.source === 'manual') return { source: 'manual' };
    if (state.authState !== 'signed_in' || state.activationState !== 'ready' || !state.account || !state.bindingVersion) throw new GatewayError('services_not_ready');
    const models: Record<string, string> = {};
    const caps: Record<string, string[]> = {};
    for (const model of state.models) {
      if (!models[model.modality] || state.selectedModels?.[model.modality] === model.id) {
        models[model.modality] = model.id; caps[model.modality] = [...model.capabilities];
      }
    }
    return { source: 'gateway', accountId: state.account.id, bindingVersion: state.bindingVersion, models, capabilities: caps };
  }
  function assertSnapshot(value: CreatorServiceBinding) {
    const state = input.account.peekState();
    if (value.source === 'gateway' && (state.authState !== 'signed_in' || state.activationState !== 'ready')) throw new GatewayError('services_not_ready');
    if (value.source !== state.source || (value.source === 'gateway' && value.accountId !== state.account?.id)) throw new GatewayError('task_source_mismatch', 409);
  }
  function assertJob(jobId: string) { if (input.readJobBinding) assertSnapshot(input.readJobBinding(jobId)); }
  async function binding(): Promise<GatewayCreatorBinding | undefined> {
    const scope = context.getStore();
    if (scope) assertSnapshot(scope.snapshot);
    if (input.account.peekState().source === 'manual') return undefined;
    const credentials = await input.account.modelCredentials();
    const local = input.getLocalOrigin();
    if (!local) throw new GatewayError('services_not_ready');
    const original = scope?.snapshot.source === 'gateway' ? scope.snapshot : undefined;
    const bindingVersion = original?.bindingVersion ?? credentials.bindingVersion;
    let capability = [...capabilities.values()].find(value => value.accountId === credentials.accountId && value.bindingVersion === bindingVersion && value.logicalId === scope?.logicalId);
    if (!capability) {
      capability = { accountId: credentials.accountId, bindingVersion, logicalId: scope?.logicalId, jobId: scope?.jobId, token: `oclocal_${randomBytes(32).toString('base64url')}` };
      capabilities.set(capability.token, capability);
    }
    const speechModel = original?.models?.speech ?? credentials.defaults.speech;
    const speechVoices = credentials.models.find(model => model.modality === 'speech' && model.id === speechModel)?.voices;
    return { accountId: credentials.accountId, bindingVersion, baseUrl: `${local}${prefix}`, apiKey: capability.token, models: original?.models ?? credentials.defaults, catalog: credentials.models, capabilities: original?.capabilities ?? Object.fromEntries(credentials.models.filter(model => credentials.defaults[model.modality] === model.id).map(model => [model.modality, model.capabilities])), speechVoices, logicalId: scope?.logicalId, stageRunId: scope?.stageRunId };
  }
  const store: CreatorServicesConfigStore = {
    async read() {
      const source = await binding(); if (!source) return input.manual.read();
      const config = createDefaultCreatorServicesConfig();
      const model = (modality: string) => ({ baseUrl: source.baseUrl, apiKey: source.apiKey, model: source.models[modality] ?? '' });
      config.proxy = (await input.manual.read()).proxy;
      config.llm = { ...model('text'), source: 'custom', jsonMode: true };
      config.image.provider = 'openai'; config.image.openai = model('image');
      config.tts.provider = 'openai'; config.tts.openai = { ...config.tts.openai, ...model('speech') };
      if (source.speechVoices?.length) config.tts.openai.defaultVoiceId = source.speechVoices[0]!;
      else if (source.capabilities?.speech?.includes('default_voice')) config.tts.openai.defaultVoiceId = gatewayDefaultVoiceId;
      config.transcription.provider = 'openai'; config.transcription.openai = model('transcription');
      bindings.set(config, source); return config;
    },
    async write(config) { if (input.account.peekState().source !== 'manual') throw new GatewayError('official_config_read_only', 409); return input.manual.write(config); },
    async reset() { if (input.account.peekState().source !== 'manual') throw new GatewayError('official_config_read_only', 409); return input.manual.reset(); }
  };
  return {
    store, binding, snapshot, assertJob,
    async runForJob<T>(jobId: string, stageRunId: string, work: () => Promise<T>): Promise<T> {
      let original = input.readJobBinding?.(jobId) ?? snapshot();
      assertSnapshot(original);
      if (original.source === 'gateway') {
        const choices = input.readJobState?.(jobId)?.officialModels;
        if (choices !== undefined) {
          if (!choices || typeof choices !== 'object' || Array.isArray(choices)) throw new GatewayError('invalid_model', 400);
          original = { ...original, models: { ...original.models }, capabilities: { ...original.capabilities } };
          const catalog = input.account.peekState().models;
          for (const [modality, id] of Object.entries(choices)) {
            const selected = catalog.find(candidate => candidate.modality === modality && candidate.id === id && (modality !== 'text' || candidate.capabilities.includes('responses')));
            if (!selected) throw new GatewayError('invalid_model', 400);
            original.models[modality] = selected.id; original.capabilities[modality] = [...selected.capabilities];
          }
        }
      }
      let logicalId = stageRunId;
      if (original.source === 'gateway' && input.readStageRun) {
        let stage = input.readStageRun(stageRunId);
        const visited = new Set<string>();
        while (stage && typeof stage.progress.resumedFromStageRunId === 'string') {
          visited.add(stage.id);
          const parent = input.readStageRun(stage.progress.resumedFromStageRunId);
          if (!parent || parent.jobId !== jobId || parent.stageId !== stage.stageId || parent.scopeKey !== stage.scopeKey || visited.has(parent.id)) throw new GatewayError('request_identity_unavailable', 409);
          logicalId = parent.id; stage = parent;
        }
      }
      return context.run({ snapshot: original, logicalId, stageRunId, jobId }, work);
    },
    async revoke() {
      capabilities.clear(); remoteTasks.clear();
      const pending = [...inFlight.values()];
      for (const controller of inFlight.keys()) controller.abort();
      await direct?.close();
      await Promise.all(pending);
    },
    isBusy() { return inFlight.size > 0 || remoteTasks.size > 0 || direct?.isBusy() === true; },
    async register(server: FastifyInstance) {
      await server.register(async scoped => {
        scoped.addContentTypeParser('multipart/form-data', { parseAs: 'buffer', bodyLimit: 64 * 1024 * 1024 }, (_r, body, done) => done(null, body));
        scoped.route({ method: ['GET', 'POST'], url: `${prefix}/*`, bodyLimit: 64 * 1024 * 1024, async handler(request, reply) {
          const token = request.headers.authorization?.replace(/^Bearer /, '');
          const original = token ? capabilities.get(token) : undefined;
          if (!original || token !== original.token) return reply.code(401).send({ error: { code: 'auth_required', message: 'Local authorization has expired' } });
          const resource = (request.params as { '*': string })['*'];
          if (!/^(chat\/completions|responses|images\/(generations|edits)|audio\/(speech|transcriptions)|video\/jobs(\/[A-Za-z0-9_-]{12,128}(\/result)?)?|videos\/tasks|requests\/[A-Za-z0-9_-]{12,128}(\/result)?)$/.test(resource)) return reply.code(404).send({ error: { code: 'capability_unsupported', message: 'Operation is unavailable' } });
          const controller = new AbortController();
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
          let complete!: () => void;
          inFlight.set(controller, new Promise<void>(resolve => { complete = resolve; }));
          let streaming = false;
          let releaseUse: (() => Promise<void>) | undefined;
          const finish = () => { inFlight.delete(controller); void releaseUse?.(); releaseUse = undefined; complete(); };
          let receipt: CreatorProviderRequest | undefined;
          let reconcile = async () => {};
          const markUnknown = () => {
            if (!receipt || !input.ledger) return;
            receipt = input.ledger.findLatest(receipt.provider, receipt.requestKey);
            if (receipt && ['submitting', 'waiting_remote'].includes(receipt.status)) receipt = input.ledger.markUnknownRemoteAcceptance(receipt.id);
          };
          try {
            const use = await input.account.beginModelUse?.(); releaseUse = use?.release;
            const credentials = use?.credentials ?? await input.account.modelCredentials();
            if (capabilities.get(original.token) !== original || credentials.accountId !== original.accountId) throw new GatewayError('auth_required', 401);
            const headers: Record<string,string> = { Authorization: `Bearer ${credentials.modelKey}`, 'Content-Type': request.headers['content-type'] ?? 'application/json' };
            const identity = request.headers['idempotency-key'];
            const body = request.method === 'GET' ? undefined : Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : JSON.stringify(request.body);
            const digest = request.method === 'POST' && (credentials.transport === 'openrouter-direct' || (original.logicalId && typeof identity !== 'string')) ? await requestDigest(request.body, headers['Content-Type']!) : undefined;
            if (request.method === 'POST') headers['Idempotency-Key'] = typeof identity === 'string' ? identity : original.logicalId
              ? `creator:${createHash('sha256').update(JSON.stringify([original.logicalId, resource, digest])).digest('hex')}`
              : randomUUID();
            if (input.ledger && original.logicalId && original.jobId && digest && /^(chat\/completions|responses|images\/(generations|edits)|audio\/(speech|transcriptions))$/.test(resource)) {
              const provider = `opencreator-gateway-${resource}`;
              const requestKey = headers['Idempotency-Key']!;
              receipt = input.ledger.findLatest(provider, requestKey) ?? input.ledger.registerBeforeSubmit({ jobId: original.jobId, stageRunId: original.logicalId, provider, requestKey, request: { operation: resource, fingerprint: digest }, gateway: { accountId: original.accountId, bindingVersion: original.bindingVersion, logicalId: requestKey } });
              if (receipt.status === 'registered') receipt = input.ledger.markSubmitting(receipt.id);
              reconcile = async () => {
                try {
                  await input.ledger!.recover(receipt!.id, { lookupByRequestKey: false, async lookup({ remoteTaskId }) {
                    if (!remoteTaskId) return { status: 'not_found' };
                    const response = credentials.transport === 'openrouter-direct' && direct
                      ? await direct.request({ account: credentials.accountId, key: credentials.modelKey, resource: `requests/${remoteTaskId}`, method: 'GET', body: undefined, contentType: 'application/json', identity: '', fingerprint: '', signal })
                      : await (input.fetcher ?? fetch)(`${credentials.baseUrl}/requests/${encodeURIComponent(remoteTaskId)}`, { method: 'GET', headers: { Authorization: `Bearer ${credentials.modelKey}` }, redirect: 'error', signal });
                    if (!response.ok) throw new GatewayError('gateway_unavailable');
                    const result = await response.json() as { requestId?: string; state?: string };
                    if (result.requestId !== remoteTaskId) throw new GatewayError('invalid_gateway_response');
                    if (result.state === 'succeeded') return { status: 'succeeded', remoteTaskId };
                    if (result.state === 'failed' || result.state === 'canceled') return { status: 'failed', remoteTaskId };
                    return result.state === 'outcome_unknown' ? { status: 'not_found' } : { status: 'waiting_remote', remoteTaskId };
                  } });
                } catch { markUnknown(); }
              };
            }
            signal.throwIfAborted();
            let response: Response;
            if (credentials.transport === 'openrouter-direct') {
              if (!direct) throw new GatewayError('services_not_ready');
              let modelMetadata: GatewayModel | undefined;
              if (request.method === 'POST') {
                const modality = resource.startsWith('images/') ? 'image' : resource === 'audio/speech' ? 'speech' : resource === 'audio/transcriptions' ? 'transcription' : resource.startsWith('video') ? 'video' : 'text';
                const model = Buffer.isBuffer(request.body)
                  ? (await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': headers['Content-Type']! }, body: new Uint8Array(request.body) }).formData()).get('model')
                  : (request.body as { model?: unknown })?.model;
                modelMetadata = credentials.models.find(candidate => candidate.modality === modality && candidate.id === model);
                if (!modelMetadata) throw new GatewayError('invalid_model', 400);
              }
              response = await direct.request({ account: credentials.accountId, key: credentials.modelKey, resource, method: request.method, body: request.body, contentType: headers['Content-Type']!, identity: headers['Idempotency-Key'] ?? '', fingerprint: digest ?? '', signal, model: modelMetadata, asyncImage: request.headers.prefer === 'respond-async' });
            } else response = await (input.fetcher ?? fetch)(`${credentials.baseUrl}/${resource}`, { method: request.method, headers, body, redirect: 'error', signal });
            signal.throwIfAborted();
            reply.code(response.status).header('Cache-Control', 'no-store');
            reply.header('Content-Type', response.headers.get('content-type') ?? 'application/json');
            const id = response.headers.get('x-request-id'); if (id) reply.header('X-Request-ID', id);
            if (receipt && input.ledger) {
              receipt = input.ledger.findLatest(receipt.provider, receipt.requestKey);
              if (receipt && ['submitting', 'waiting_remote', 'unknown_remote_acceptance'].includes(receipt.status)) {
                if (id && /^[A-Za-z0-9_-]{12,128}$/.test(id)) receipt = input.ledger.markWaitingRemote(receipt.id, id);
                else if (!response.ok && response.status >= 400 && response.status < 500 && receipt.status !== 'unknown_remote_acceptance') receipt = input.ledger.markFailed(receipt.id);
                else markUnknown();
              }
            }
            if (resource === 'video/jobs' || resource === 'videos/tasks' || (response.status === 202 && resource.startsWith('images/')) || /^(requests|video\/jobs)\/[A-Za-z0-9_-]+$/.test(resource)) {
              const value = await response.json() as { requestId?: string; state?: string };
              if (value.requestId) {
                if (['succeeded','failed','canceled','outcome_unknown'].includes(value.state ?? '')) remoteTasks.delete(value.requestId);
                else if (resource === 'video/jobs' || resource === 'videos/tasks' || remoteTasks.has(value.requestId)) remoteTasks.add(value.requestId);
                if (request.method === 'GET' && original.jobId && input.ledger && /^requests\//.test(resource)) {
                  for (const entry of input.ledger.findByRemoteTaskId(original.jobId, value.requestId).filter(item => item.provider.startsWith('opencreator-gateway-images/'))) {
                    await input.ledger.recover(entry.id, { lookupByRequestKey: false, async lookup() {
                      if (value.state === 'succeeded') return { status: 'succeeded' };
                      if (value.state === 'failed') return { status: 'failed' };
                      if (value.state === 'outcome_unknown') return { status: 'not_found' };
                      return { status: 'waiting_remote', remoteTaskId: value.requestId! };
                    } });
                  }
                }
              }
              return value;
            }
            if (!response.body) return reply.send();
            const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
            streaming = true;
            stream.once('close', () => { void reconcile().finally(finish); });
            const abort = () => stream.destroy(new Error('Official service forwarding was interrupted'));
            signal.addEventListener('abort', abort, { once: true });
            stream.once('close', () => signal.removeEventListener('abort', abort));
            return reply.send(stream);
          } catch (error) {
            if (receipt && input.ledger && error instanceof GatewayError && [400, 401, 402, 403, 404, 422, 429].includes(error.status) && ['submitting', 'waiting_remote'].includes(receipt.status)) receipt = input.ledger.markFailed(receipt.id);
            else markUnknown();
            return reply.code(error instanceof GatewayError ? error.status : 503).send({ error: { code: error instanceof GatewayError ? error.code : 'gateway_unavailable', message: 'Official service request could not be completed' } });
          } finally { if (!streaming) finish(); }
        } });
      });
    }
  };
}

async function requestDigest(body: unknown, contentType: string): Promise<string> {
  let value = body;
  if (Buffer.isBuffer(body) && contentType.startsWith('multipart/form-data')) {
    const form = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(body) }).formData();
    const fields = await Promise.all([...form.entries()].map(async ([name, item]) => [name, typeof item === 'string' ? item : {
      mime: item.type, size: item.size, digest: createHash('sha256').update(new Uint8Array(await item.arrayBuffer())).digest('hex')
    }]));
    value = fields.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => [name, canonicalValue(item)]));
  return value;
}
