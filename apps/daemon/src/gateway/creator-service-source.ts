import { gatewayModelIdMatches } from '@opencreator/protocol';
import { isDirectTransport } from './supplier.js';
import { createDefaultCreatorServicesConfig, gatewayDefaultVoiceId, gatewayModelReady, gatewayTranslationFlashModel, type CreatorServicesConfig, type CreatorProviderRequest, type CreatorStageRun, type CreatorJob, type GatewayModel } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';
import { KRILLIN_LLM_ROUTE_PREFIX } from '../creator/krillin/codex-llm-gateway.js';
import type { GatewayAccountService } from './account-service.js';
import { GatewayError } from './client.js';
import type { CreatorServiceBinding } from '../creator/repository.js';
import type { CreatorProviderRequestLedger, CreatorProviderLookupResult } from '../creator/provider-requests.js';
import { createDirectTransport, directRequestId } from './direct-transport.js';
import { createOfficialFetch } from './official-fetch.js';
import { chatAnywhereImage } from './chatanywhere-media.js';
import { resolveGatewaySpeech } from './speech-response.js';

export type GatewayCreatorBinding = { accountId: string; bindingVersion: string; baseUrl: string; apiKey: string; models: Record<string, string>; catalog?: GatewayModel[]; capabilities?: Record<string, string[]>; speechVoices?: string[]; logicalId?: string; stageRunId?: string };
const bindings = new WeakMap<CreatorServicesConfig, GatewayCreatorBinding>();
export function gatewayCreatorBinding(config: CreatorServicesConfig) { return bindings.get(config); }

export function createGatewayCreatorSource(input: {
  account: Pick<GatewayAccountService, 'peekState' | 'modelCredentials'> & Partial<Pick<GatewayAccountService, 'beginModelUse' | 'recoverModelCredentials' | 'reportModelFailure' | 'reportModelSuccess'>>;
  manual: CreatorServicesConfigStore;
  getLocalOrigin(): string | undefined;
  fetcher?: typeof fetch;
  readJobBinding?(jobId: string): CreatorServiceBinding;
  readJobState?(jobId: string): CreatorJob['state'] | undefined;
  readJobTemplateId?(jobId: string): string | undefined;
  readStageRun?(stageRunId: string): CreatorStageRun | undefined;
  ledger?: CreatorProviderRequestLedger;
  directRequestsRoot?: string;
}) {
  const capabilities = new Map<string, { token: string; accountId: string; bindingVersion: string; supplierBase: string; logicalId?: string; stageRunId?: string; jobId?: string }>();
  const context = new AsyncLocalStorage<{ snapshot: CreatorServiceBinding; logicalId: string; stageRunId: string; jobId: string }>();
  const inFlight = new Map<AbortController, { stageRunId?: string; done: Promise<void> }>();
  const remoteTasks = new Set<string>();
  const prefix = `${KRILLIN_LLM_ROUTE_PREFIX}/gateway/v1`;
  const direct = input.directRequestsRoot ? createDirectTransport(input.directRequestsRoot,
    input.fetcher ?? createOfficialFetch({ readProxy: async () => (await input.manual.read()).proxy }),
    input.account.recoverModelCredentials ? async (accountId, failedKey, baseUrl) => {
      const current = await input.account.modelCredentials();
      if (current.accountId !== accountId) throw new GatewayError('auth_required', 401);
      const updated = current.modelKey !== failedKey ? current : await input.account.recoverModelCredentials!(current.keyVersion);
      if (updated.accountId !== accountId) throw new GatewayError('auth_required', 401);
      if (updated.baseUrl !== baseUrl) throw new GatewayError('supplier_binding_changed', 409);
      return updated.modelKey !== failedKey ? updated.modelKey : undefined;
    } : undefined) : undefined;
  function snapshot(templateId?: string): CreatorServiceBinding {
    const state = input.account.peekState();
    if (state.source === 'manual') return { source: 'manual' };
    if (state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
    if (state.activationState !== 'ready' || !state.account || !state.bindingVersion) throw new GatewayError('services_not_ready');
    const models: Record<string, string> = {};
    const caps: Record<string, string[]> = {};
    for (const model of state.models) {
      if(!gatewayModelReady(model))continue;
      if (!models[model.modality] || state.selectedModels?.[model.modality] === model.id) {
        models[model.modality] = model.id; caps[model.modality] = [...model.capabilities];
      }
    }
    if(state.transport==='gateway'){
      for (const modality of ['text','image','video','speech','transcription'] as const) {
        const id = state.selectedModels?.[modality];
        const selected = state.models.find(model => gatewayModelIdMatches(model.id, id) && model.modality === modality && gatewayModelReady(model)
          && (modality !== 'text' || model.capabilities.includes('chat'))
          && (modality !== 'transcription' || model.capabilities.includes('subtitle_timestamps')));
        if (selected) { models[modality] = selected.id; caps[modality] = [...selected.capabilities]; }
        else { delete models[modality]; delete caps[modality]; }
      }
    }
    const flash = templateId === 'video-translation' ? gatewayTranslationFlashModel(state.models) : undefined;
    if (flash) { models.text = flash.id; caps.text = [...flash.capabilities]; }
    return { source: 'gateway', accountId: state.account.id, bindingVersion: state.bindingVersion, supplier: state.supplier ?? 'openrouter', models, capabilities: caps };
  }
  function assertSnapshot(value: CreatorServiceBinding, recovery = false) {
    const state = input.account.peekState();
    if (value.source === 'gateway' && state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
    if (value.source === 'gateway' && (!recovery && state.activationState !== 'ready')) throw new GatewayError('services_not_ready');
    if (value.source !== state.source || (value.source === 'gateway' && value.accountId !== state.account?.id)) throw new GatewayError('task_source_mismatch', 409);
    if (value.source === 'gateway' && state.supplier) {
      const supplier = value.supplier ?? (value.bindingVersion.startsWith(`${value.accountId}:88api:`) ? '88api'
        : value.bindingVersion.startsWith(`${value.accountId}:chatanywhere:`) ? 'chatanywhere' : 'openrouter');
      if (supplier !== state.supplier) throw new GatewayError('supplier_binding_changed', 409);
    }
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
    let capability = [...capabilities.values()].find(value => value.accountId === credentials.accountId && value.bindingVersion === bindingVersion && value.supplierBase === credentials.baseUrl && value.logicalId === scope?.logicalId && value.stageRunId === scope?.stageRunId);
    if (!capability) {
      capability = { accountId: credentials.accountId, bindingVersion, supplierBase: credentials.baseUrl, logicalId: scope?.logicalId, stageRunId: scope?.stageRunId, jobId: scope?.jobId, token: `oclocal_${randomBytes(32).toString('base64url')}` };
      capabilities.set(capability.token, capability);
    }
    const speechModel = original?.models?.speech ?? credentials.defaults.speech;
    const speechVoices = credentials.models.find(model => model.modality === 'speech' && gatewayModelIdMatches(model.id, speechModel))?.voices;
    const defaults={...credentials.defaults};
    if(credentials.transport==='gateway')defaults.transcription=credentials.models.find(model=>model.id===defaults.transcription&&model.capabilities.includes('subtitle_timestamps')&&gatewayModelReady(model))?.id??'';
    return { accountId: credentials.accountId, bindingVersion, baseUrl: `${local}${prefix}`, apiKey: capability.token, models: original?.models ?? defaults, catalog: credentials.models, capabilities: original?.capabilities ?? Object.fromEntries(credentials.models.filter(model => defaults[model.modality] === model.id).map(model => [model.modality, model.capabilities])), speechVoices, logicalId: scope?.logicalId, stageRunId: scope?.stageRunId };
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
  async function queryProviderRequest(request: CreatorProviderRequest) {
      if (input.readJobBinding) assertSnapshot(input.readJobBinding(request.jobId), true);
      if (!input.ledger || !request.gateway || !request.provider.startsWith('opencreator-gateway-')) throw new GatewayError('capability_unsupported', 400);
      const use = await input.account.beginModelUse?.({ recovery: true });
      try {
        let credentials = use?.credentials ?? await input.account.modelCredentials();
        if (credentials.accountId !== request.gateway.accountId) throw new GatewayError('task_source_mismatch', 409);
        const requestId = request.remoteTaskId ?? (isDirectTransport(credentials.transport)
          ? directRequestId(credentials.accountId, request.requestKey)
          : credentials.transport === 'gateway'
            ? `ocreq_${createHash('sha256').update(`${credentials.accountId}:${request.requestKey}`).digest('hex').slice(0, 48)}`
            : undefined);
        if (!requestId) throw new GatewayError('request_outcome_unknown', 409);
        const signal = AbortSignal.timeout(30_000);
        let lookupResult: Promise<CreatorProviderLookupResult> | undefined;
        let refreshedCredentials = false;
        const lookupOnce = async (): Promise<CreatorProviderLookupResult> => {
          let response: Response;
          try {
            response = isDirectTransport(credentials.transport) && direct
              ? await direct.request({ account: credentials.accountId, baseUrl: credentials.baseUrl, key: credentials.modelKey, resource: `requests/${requestId}`, method: 'GET', body: undefined, contentType: 'application/json', identity: '', fingerprint: '', signal,
                onModelFailure: async (id, modality, facts) => { await input.account.reportModelFailure?.(credentials, id, modality, facts); },
                onModelSuccess: async (id, modality, operation) => { await input.account.reportModelSuccess?.(credentials, id, modality, operation); } })
              : await (input.fetcher ?? fetch)(`${credentials.baseUrl}/requests/${encodeURIComponent(requestId)}`, { method: 'GET', headers: { Authorization: `Bearer ${credentials.modelKey}` }, redirect: 'error', signal });
          } catch (error) { if (error instanceof GatewayError && error.code === 'request_not_found') return { status: 'not_found' }; throw error; }
          if (response.status === 401 && !refreshedCredentials && credentials.transport === 'gateway' && input.account.recoverModelCredentials) {
            refreshedCredentials = true;
            await response.body?.cancel();
            const updated = await input.account.recoverModelCredentials(credentials.keyVersion);
            if (updated.accountId !== credentials.accountId || updated.baseUrl !== credentials.baseUrl) throw new GatewayError('supplier_binding_changed', 409);
            if (updated.modelKey !== credentials.modelKey) {
              credentials = updated;
              return lookupOnce();
            }
          }
          if (response.status === 401) throw new GatewayError('auth_required', 401);
          if (response.status === 404) return { status: 'not_found' };
          if (!response.ok) throw new GatewayError('gateway_unavailable');
          const result = await response.json() as { requestId?: string; state?: string };
          if (result.requestId !== requestId) throw new GatewayError('invalid_gateway_response');
          if (result.state === 'succeeded') return { status: 'succeeded', remoteTaskId: requestId };
          if (result.state === 'failed' || result.state === 'canceled') return { status: 'failed', remoteTaskId: requestId };
          if (result.state === 'outcome_unknown') return { status: 'not_found' };
          if (!['submitting', 'waiting_upstream'].includes(result.state ?? '')) throw new GatewayError('invalid_gateway_response');
          return { status: 'waiting_remote', remoteTaskId: requestId };
        };
        const lookup = async (): Promise<CreatorProviderLookupResult> => {
          for (let attempt = 0; ; attempt++) {
            try { return await lookupOnce(); }
            catch (error) {
              if (attempt >= 2 || signal.aborted || error instanceof GatewayError && ['task_source_mismatch', 'supplier_binding_changed', 'auth_required'].includes(error.code)) throw error;
              await delay(250 * 2 ** attempt, undefined, { signal });
            }
          }
        };
        const provider = { lookupByRequestKey: true, lookup: () => lookupResult ??= lookup() };
        await input.ledger.recover(request.id, provider);
        for (const related of input.ledger.findByRemoteTaskId(request.jobId, requestId)) {
          if (related.id !== request.id && related.gateway?.accountId === credentials.accountId && related.provider.startsWith('opencreator-gateway-')) await input.ledger.recover(related.id, provider);
        }
      } finally { await use?.release(); }
  }
  return {
    store, binding, snapshot, assertJob, queryProviderRequest,
    async runForJob<T>(jobId: string, stageRunId: string, work: () => Promise<T>): Promise<T> {
      let original = input.readJobBinding?.(jobId) ?? snapshot();
      assertSnapshot(original);
      if (original.source === 'gateway') {
        const choices = input.readJobState?.(jobId)?.officialModels;
        // Task choices below still take precedence; never change the Agent/global default.
        const flash = input.readJobTemplateId?.(jobId) === 'video-translation'
          ? gatewayTranslationFlashModel(input.account.peekState().models) : undefined;
        if (flash) original = { ...original, models: { ...original.models, text: flash.id },
          capabilities: { ...original.capabilities, text: [...flash.capabilities] } };
        if (choices !== undefined) {
          if (!choices || typeof choices !== 'object' || Array.isArray(choices)) throw new GatewayError('invalid_model', 400);
          original = { ...original, models: { ...original.models }, capabilities: { ...original.capabilities } };
          const catalog = input.account.peekState().models;
          for (const [modality, id] of Object.entries(choices)) {
            const selected = catalog.find(candidate => candidate.modality === modality && gatewayModelIdMatches(candidate.id, id) && gatewayModelReady(candidate) && (modality !== 'text' || candidate.capabilities.includes('chat') || candidate.capabilities.includes('responses')));
            if (!selected) {
              const resumed = typeof input.readStageRun?.(stageRunId)?.progress.resumedFromStageRunId === 'string';
              if (!resumed || !['image', 'video'].includes(modality) || typeof id !== 'string') throw new GatewayError('invalid_model', 400);
              original.models[modality] = id;
              continue;
            }
            original.models[modality] = typeof id === 'string' ? id : selected.id; original.capabilities[modality] = [...selected.capabilities];
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
      let failed = false;
      try {
        return await context.run({ snapshot: original, logicalId, stageRunId, jobId }, work);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        // A completed response can precede the gateway's accounting receipt.
        const requests = [...inFlight.entries()].filter(([, entry]) => entry.stageRunId === stageRunId);
        if (failed) for (const [controller] of requests) controller.abort();
        await Promise.all(requests.map(([, entry]) => entry.done));
        const pending = input.ledger?.requestsForStage(stageRunId).filter(request => request.gateway !== undefined
          && ['submitting', 'waiting_remote', 'unknown_remote_acceptance'].includes(request.status)) ?? [];
        for (let offset = 0; offset < pending.length; offset += 3) {
          await Promise.allSettled(pending.slice(offset, offset + 3).map(queryProviderRequest));
        }
      }
    },
    async revoke() {
      capabilities.clear(); remoteTasks.clear();
      const pending = [...inFlight.values()].map(entry => entry.done);
      for (const controller of inFlight.keys()) controller.abort();
      await direct?.close();
      await Promise.all(pending);
    },
    isBusy() { return inFlight.size > 0 || remoteTasks.size > 0 || direct?.isBusy() === true; },
    async register(server: FastifyInstance) {
      await server.register(async scoped => {
        scoped.addContentTypeParser('multipart/form-data', { parseAs: 'buffer', bodyLimit: 64 * 1024 * 1024 }, (_r, body, done) => done(null, body));
        scoped.addContentTypeParser(/^(image|video|audio)\//, { parseAs: 'buffer', bodyLimit: 100_000_000 }, (_r, body, done) => done(null, body));
        scoped.route({ method: ['GET', 'POST'], url: `${prefix}/*`, bodyLimit: 100_000_000, async handler(request, reply) {
          const token = request.headers.authorization?.replace(/^Bearer /, '');
          const original = token ? capabilities.get(token) : undefined;
          if (!original || token !== original.token) return reply.code(401).send({ error: { code: 'auth_required', message: 'Local authorization has expired' } });
          const resource = (request.params as { '*': string })['*'];
          if (!/^(chat\/completions|responses|images\/(generations|edits)|audio\/(speech|transcriptions)|video\/(quotes|assets|jobs(\/[A-Za-z0-9_-]{12,128}(\/result)?)?)|videos\/tasks|requests\/[A-Za-z0-9_-]{12,128}(\/result)?)$/.test(resource)) return reply.code(404).send({ error: { code: 'capability_unsupported', message: 'Operation is unavailable' } });
          const controller = new AbortController();
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(resource === 'audio/speech' ? 600_000 : 180_000)]);
          let complete!: () => void;
          inFlight.set(controller, { stageRunId: original.stageRunId, done: new Promise<void>(resolve => { complete = resolve; }) });
          let streaming = false;
          let releaseUse: (() => Promise<void>) | undefined;
          const chatStream = request.method === 'POST' && resource === 'chat/completions' && (request.body as { stream?: unknown })?.stream === true;
          let heartbeat: NodeJS.Timeout | undefined;
          const disconnected = () => { if (!reply.raw.writableFinished) controller.abort(); };
          reply.raw.once('close', disconnected);
          const finish = () => {
            clearInterval(heartbeat); reply.raw.removeListener('close', disconnected);
            inFlight.delete(controller); void releaseUse?.(); releaseUse = undefined; complete();
          };
          const sendStreamError = (error: unknown) => {
            if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end(`data: ${JSON.stringify({ error: {
              code: error instanceof GatewayError ? error.code : 'gateway_unavailable',
              type: 'upstream_error',
              message: 'Official service request could not be completed'
            } })}\n\n`);
          };
          let receipt: CreatorProviderRequest | undefined;
          let reconcile = async () => {};
          const markUnknown = (error?: unknown) => {
            if (!receipt || !input.ledger) return;
            receipt = input.ledger.findLatest(receipt.provider, receipt.requestKey);
            if (receipt && ['submitting', 'waiting_remote'].includes(receipt.status)) receipt = input.ledger.markUnknownRemoteAcceptance(receipt.id, error);
            if (error !== undefined) request.log.warn({ requestId: receipt?.remoteTaskId, code: error instanceof GatewayError ? error.code : 'gateway_status_lookup_failed' }, 'Gateway request status could not be confirmed');
          };
          try {
            // 提前建立 SSE 连接，避免账号协调和上游准备耗尽 Krillin 的响应头等待时间。
            if (chatStream) {
              reply.hijack();
              reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store, no-transform', connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
              // go-openai includes SSE comments in its error buffer, obscuring later API errors.
              const keepAlive = `data: ${JSON.stringify({ id: `chatcmpl-${randomUUID()}`, object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000), model: (request.body as { model?: string })?.model ?? '', choices: [] })}\n\n`;
              reply.raw.write(keepAlive);
              heartbeat = setInterval(() => { if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(keepAlive); }, 10_000);
              heartbeat.unref();
            }
            const use = await input.account.beginModelUse?.({ recovery: request.method === 'GET' }); releaseUse = use?.release;
            signal.throwIfAborted();
            const credentials = use?.credentials ?? await input.account.modelCredentials();
            signal.throwIfAborted();
            if (capabilities.get(original.token) !== original || credentials.accountId !== original.accountId) throw new GatewayError('auth_required', 401);
            if (credentials.baseUrl !== original.supplierBase) throw new GatewayError('supplier_binding_changed', 409);
            const headers: Record<string,string> = { Authorization: `Bearer ${credentials.modelKey}`, 'Content-Type': request.headers['content-type'] ?? 'application/json' };
            if (request.headers.prefer === 'respond-async' && resource.startsWith('images/')) headers.Prefer = 'respond-async';
            const identity = request.headers['idempotency-key'];
            let body = request.method === 'GET' ? undefined : Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : JSON.stringify(request.body);
            const digest = request.method === 'POST' && resource !== 'video/assets' && (isDirectTransport(credentials.transport) || (original.logicalId && typeof identity !== 'string')) ? await requestDigest(request.body, headers['Content-Type']!) : undefined;
            signal.throwIfAborted();
            if (request.method === 'POST') headers['Idempotency-Key'] = typeof identity === 'string' ? identity : original.logicalId
              ? `creator:${createHash('sha256').update(JSON.stringify([original.logicalId, resource, digest])).digest('hex')}`
              : randomUUID();
            if (input.ledger && original.logicalId && original.jobId && digest && /^(chat\/completions|responses|images\/(generations|edits)|audio\/(speech|transcriptions))$/.test(resource)) {
              const provider = `opencreator-gateway-${resource}`;
              const requestKey = headers['Idempotency-Key']!;
              receipt = input.ledger.findLatest(provider, requestKey) ?? input.ledger.registerBeforeSubmit({ jobId: original.jobId, stageRunId: original.stageRunId ?? original.logicalId,
                scopeKey: input.readStageRun?.(original.stageRunId ?? original.logicalId)?.scopeKey,
                provider, requestKey, request: { operation: resource, fingerprint: digest }, gateway: { accountId: original.accountId, bindingVersion: original.bindingVersion, logicalId: requestKey } });
              if (receipt.status === 'registered') receipt = input.ledger.markSubmitting(receipt.id);
              reconcile = async () => {
                try {
                  await queryProviderRequest(input.ledger!.findLatest(receipt!.provider, receipt!.requestKey) ?? receipt!);
                } catch (error) { markUnknown(error); }
              };
            }
            signal.throwIfAborted();
            let response: Response;
            if (isDirectTransport(credentials.transport)) {
              if (!direct) throw new GatewayError('services_not_ready');
              let modelMetadata: GatewayModel | undefined;
              let cachedResponse: Response | undefined;
              if (request.method === 'POST') {
                const modality = resource.startsWith('images/') ? 'image' : resource === 'audio/speech' ? 'speech' : resource === 'audio/transcriptions' ? 'transcription' : resource.startsWith('video') ? 'video' : 'text';
                const model = Buffer.isBuffer(request.body)
                  ? (await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': headers['Content-Type']! }, body: new Uint8Array(request.body) }).formData()).get('model')
                  : (request.body as { model?: unknown })?.model;
                modelMetadata = credentials.models.find(candidate => candidate.modality === modality && gatewayModelIdMatches(candidate.id, model));
                if (!modelMetadata) {
                  if (modality === 'image' || modality === 'video') cachedResponse = await direct.replay(credentials.accountId, headers['Idempotency-Key']!, digest ?? '');
                  if (!cachedResponse) throw new GatewayError('invalid_model', 400);
                }
              }
              response = cachedResponse ?? await direct.request({ account: credentials.accountId, baseUrl: credentials.baseUrl, key: credentials.modelKey, resource, method: request.method, body: request.body, contentType: headers['Content-Type']!, identity: headers['Idempotency-Key'] ?? '', fingerprint: digest ?? '', signal, model: modelMetadata, asyncImage: request.headers.prefer === 'respond-async',
                onModelFailure: async (id, modality, facts) => { await input.account.reportModelFailure?.(credentials, id, modality, facts); },
                onModelSuccess: async (id, modality, operation) => { await input.account.reportModelSuccess?.(credentials, id, modality, operation); } });
            } else {
              if (credentials.transport === 'gateway' && request.method === 'POST' && resource.startsWith('images/')) {
                const id = Buffer.isBuffer(request.body)
                  ? (await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': headers['Content-Type']! }, body: new Uint8Array(request.body) }).formData()).get('model')
                  : (request.body as { model?: unknown })?.model;
                const model = credentials.models.find(model => gatewayModelIdMatches(model.id, id) && model.modality === 'image');
                const native = model?.catalogSchema === 2 ? { body: request.body, contentType: headers['Content-Type']! }
                  : await chatAnywhereImage(resource, request.body, headers['Content-Type']!, model);
                headers['Content-Type'] = native.contentType;
                body = Buffer.isBuffer(native.body) ? new Uint8Array(native.body) : JSON.stringify(native.body);
              }
              const gatewayRequest = async (target: string, method = 'GET', payload?: typeof body): Promise<Response> => {
                let result = await (input.fetcher ?? fetch)(`${credentials.baseUrl}/${target}`, { method, headers, body: payload, redirect: 'error', signal });
                if (credentials.transport === 'gateway' && result.status === 401 && input.account.recoverModelCredentials) {
                  await result.body?.cancel();
                  const updated = await input.account.recoverModelCredentials(credentials.keyVersion);
                  if (updated.accountId !== credentials.accountId || updated.baseUrl !== credentials.baseUrl) throw new GatewayError('supplier_binding_changed', 409);
                  if (updated.modelKey !== headers.Authorization?.replace(/^Bearer /, '')) {
                    headers.Authorization = `Bearer ${updated.modelKey}`;
                    result = await (input.fetcher ?? fetch)(`${credentials.baseUrl}/${target}`, { method, headers, body: payload, redirect: 'error', signal });
                  }
                }
                return result;
              };
              const resumeSpeech = credentials.transport === 'gateway' && resource === 'audio/speech' && request.method === 'POST' && receipt?.remoteTaskId;
              const speechResponse = (accepted?: Response) => resolveGatewaySpeech({ response: accepted, requestId: receipt?.remoteTaskId ?? undefined,
                  signal, request: gatewayRequest, async onReceipt(value) {
                    if (!receipt || !input.ledger) return;
                    if (['submitting', 'waiting_remote', 'unknown_remote_acceptance'].includes(receipt.status)) receipt = input.ledger.markWaitingRemote(receipt.id, value.requestId);
                    receipt = await input.ledger.recover(receipt.id, { lookupByRequestKey: false, async lookup() {
                      if (value.state === 'succeeded') return { status: 'succeeded', remoteTaskId: value.requestId };
                      if (value.state === 'failed' || value.state === 'canceled') return { status: 'failed', remoteTaskId: value.requestId };
                      if (value.state === 'outcome_unknown') return { status: 'not_found' };
                      return { status: 'waiting_remote', remoteTaskId: value.requestId };
                    } });
                  } });
              if (resumeSpeech) response = await speechResponse();
              else {
                response = await gatewayRequest(resource, request.method, body);
                if (credentials.transport === 'gateway' && resource === 'audio/speech' && request.method === 'POST' && response.status === 202) response = await speechResponse(response);
              }
            }
            signal.throwIfAborted();
            const id = response.headers.get('x-request-id');
            if (!chatStream) {
              reply.code(response.status).header('Cache-Control', 'no-store');
              reply.header('Content-Type', response.headers.get('content-type') ?? 'application/json');
              if (id) reply.header('X-Request-ID', id);
            }
            if (receipt && input.ledger) {
              receipt = input.ledger.findLatest(receipt.provider, receipt.requestKey);
              if (receipt && ['submitting', 'waiting_remote', 'unknown_remote_acceptance'].includes(receipt.status)) {
                // A trace ID on a rejected request is not an accepted model request.
                if (!response.ok && [400, 401, 402, 403, 404, 413, 415, 422, 429].includes(response.status)
                  && receipt.status !== 'unknown_remote_acceptance') receipt = input.ledger.markFailed(receipt.id);
                else if (id && /^[A-Za-z0-9_-]{12,128}$/.test(id)) receipt = input.ledger.markWaitingRemote(receipt.id, id);
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
            if (chatStream && (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream'))) {
              await response.body?.cancel();
              throw new GatewayError(response.ok ? 'invalid_gateway_response' : 'official_service_unavailable', response.ok ? 503 : response.status);
            }
            if (!response.body) return reply.send();
            const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
            streaming = true;
            stream.once('close', () => { void reconcile().finally(finish); });
            const abort = () => stream.destroy(new Error('Official service forwarding was interrupted'));
            signal.addEventListener('abort', abort, { once: true });
            stream.once('close', () => signal.removeEventListener('abort', abort));
            if (chatStream) {
              stream.once('error', sendStreamError);
              stream.pipe(reply.raw);
              return reply;
            }
            return reply.send(stream);
          } catch (error) {
            if (receipt?.remoteTaskId) await reconcile();
            else if (receipt && input.ledger && error instanceof GatewayError && [400, 401, 402, 403, 404, 422, 429].includes(error.status) && ['submitting', 'waiting_remote'].includes(receipt.status)) receipt = input.ledger.markFailed(receipt.id);
            else markUnknown();
            if (chatStream) { sendStreamError(error); return reply; }
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
