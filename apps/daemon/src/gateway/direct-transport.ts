import { createHash } from 'node:crypto';
import { gatewayDefaultVoiceId, gatewayVideoSizeParameters, type GatewayModel } from '@opencreator/protocol';
import { join } from 'node:path';
import { readPrivateJsonFile, writePrivateJsonFile } from '../config/private-json-file.js';
import { GatewayError } from './client.js';
import { officialEventStream } from './official-stream.js';

type Receipt = { account: string; fingerprint: string; state: 'submitting' | 'waiting_upstream' | 'succeeded' | 'failed' | 'outcome_unknown'; remoteId?: string; status?: number; mime?: string; content?: string; errorCode?: string; errorStatus?: number };
const base = 'https://openrouter.ai/api/v1';
export const DIRECT_IMAGE_TIMEOUT_MS = 10 * 60_000;

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function completeImageResponse(content: Buffer): boolean {
  try {
    const value = JSON.parse(content.toString('utf8')) as { data?: Array<{ b64_json?: unknown }> };
    return Array.isArray(value.data) && value.data.length > 0
      && value.data.every(image => typeof image?.b64_json === 'string' && image.b64_json.length > 0);
  } catch { return false; }
}

function completeEventStream(content: Buffer, resource?: string): boolean {
  let completed = false;
  for (const frame of content.toString('utf8').replace(/\r\n/g, '\n').split('\n\n').slice(0, -1)) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (data === '[DONE]' && resource !== 'responses') { completed = true; continue; }
    try {
      const event = JSON.parse(data) as { type?: string; error?: unknown; response?: { status?: string; error?: unknown } };
      if (event.error || event.response?.error || ['error', 'response.failed', 'response.incomplete'].includes(event.type ?? '')
        || ['failed', 'incomplete', 'cancelled'].includes(event.response?.status ?? '')) return false;
      if (event.type === 'response.completed' && resource !== 'chat/completions') completed = true;
    } catch {}
  }
  return completed;
}

function pixelAspectRatio(size: unknown) {
  const match = typeof size === 'string' ? /^(\d+)x(\d+)$/.exec(size) : null;
  if (!match) return undefined;
  const width = Number(match[1]); const height = Number(match[2]);
  if (!width || !height) throw new GatewayError('invalid_media_size', 400);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

export function statelessResponses(body: Record<string, unknown>) {
  if (body.previous_response_id) throw new GatewayError('capability_unsupported', 400);
  const { previous_response_id: _previous, store: _store, ...rest } = body;
  return { ...rest, store: false };
}

export function createDirectTransport(root: string, fetcher: typeof fetch = fetch) {
  const pending = new Map<string, Promise<Response>>();
  const fingerprints = new Map<string, string>();
  const workers = new Map<string, AbortController>();
  const path = (id: string) => join(root, `${id}.json`);
  const read = async (id: string) => {
    const record = await readPrivateJsonFile(path(id)) as Receipt | undefined;
    // Older callers could cancel after completion and overwrite the terminal state.
    if (record?.state === 'outcome_unknown' && record.status !== undefined && record.status >= 200 && record.status < 300
      && record.mime?.includes('text/event-stream') && record.content && completeEventStream(Buffer.from(record.content, 'base64'))) {
      record.state = 'succeeded';
      await write(id, record);
    }
    return record;
  };
  const write = (id: string, record: Receipt) => writePrivateJsonFile(path(id), record);
  const response = (id: string, record: Receipt) => new Response(Buffer.from(record.content ?? '', 'base64'), { status: record.status ?? 200, headers: { 'Content-Type': record.mime ?? 'application/json', 'X-Request-ID': id } });
  const accepted = (id: string) => Response.json({ requestId: id, state: 'waiting_upstream' }, { status: 202, headers: { 'X-Request-ID': id } });
  async function call(resource: string, options: RequestInit, key: string) {
    const work = fetcher(`${base}/${resource}`, { ...options, redirect: 'error', headers: { ...options.headers, Authorization: `Bearer ${key}` } });
    let result: Response;
    try { result = options.signal ? await abortable(work, options.signal) : await work; }
    catch (error) {
      void work.then(value => value.body?.cancel()).catch(() => undefined);
      throw error;
    }
    if (!result.ok) {
      let limitExceeded = false;
      if (result.status === 403) {
        try {
          const payload = await abortable(result.json() as Promise<{ error?: { message?: unknown } }>, options.signal!);
          limitExceeded = typeof payload.error?.message === 'string' && /^Key limit exceeded\b/i.test(payload.error.message);
        } catch {}
      } else void result.body?.cancel().catch(() => undefined);
      throw new GatewayError(result.status === 402 || limitExceeded ? 'credits_insufficient' : 'official_service_unavailable', result.status >= 400 && result.status < 500 ? result.status : 503);
    }
    return result;
  }
  return {
    isBusy() { return workers.size > 0; },
    async close() {
      const work = [...workers.keys()].map(id => pending.get(id));
      for (const controller of workers.values()) controller.abort();
      await Promise.allSettled(work);
    },
    async request(input: { account: string; key: string; resource: string; method: string; body: unknown; contentType: string; identity: string; fingerprint: string; signal: AbortSignal; model?: GatewayModel; asyncImage?: boolean }): Promise<Response> {
      const { account, key, resource } = input;
      const asyncImage = input.asyncImage === true && /^images\/(generations|edits)$/.test(resource) && input.method === 'POST';
      const controller = asyncImage ? new AbortController() : undefined;
      const signal = controller ? AbortSignal.any([controller.signal, AbortSignal.timeout(DIRECT_IMAGE_TIMEOUT_MS)]) : input.signal;
      const lookup = /^(?:requests|video\/jobs)\/(ocdir_[a-f0-9]{48})(\/result)?$/.exec(resource);
      if (lookup) {
        const id = lookup[1]!; const record = await read(id);
        if (!record || record.account !== account) throw new GatewayError('request_not_found', 404);
        if (!record.remoteId && ['submitting', 'waiting_upstream'].includes(record.state) && !pending.has(id)) {
          record.state = 'outcome_unknown'; await write(id, record);
        }
        if (record.remoteId) {
          if (lookup[2]) {
            if (record.state !== 'succeeded') throw new GatewayError('request_outcome_unknown', 409);
            return call(`videos/${encodeURIComponent(record.remoteId)}/content?index=0`, { method: 'GET', signal }, key);
          }
          const remote = await (await call(`videos/${encodeURIComponent(record.remoteId)}`, { method: 'GET', signal }, key)).json() as { status?: string };
          record.state = remote.status === 'completed' ? 'succeeded' : ['failed', 'cancelled', 'expired'].includes(remote.status ?? '') ? 'failed' : 'waiting_upstream';
          await write(id, record);
        }
        if (lookup[2]) { if (record.state !== 'succeeded') throw new GatewayError('request_outcome_unknown', 409); return response(id, record); }
        return Response.json({ requestId: id, state: record.state, ...(record.errorCode ? { error: { code: record.errorCode, status: record.errorStatus } } : {}) }, { headers: { 'X-Request-ID': id } });
      }
      if (input.method !== 'POST') throw new GatewayError('capability_unsupported', 404);
      const id = 'ocdir_' + createHash('sha256').update(JSON.stringify([account, input.identity])).digest('hex').slice(0, 48);
      const existing = pending.get(id);
      if (existing) {
        if (fingerprints.get(id) !== input.fingerprint) throw new GatewayError('operation_conflict', 409);
        if (asyncImage) return accepted(id);
        await existing; return this.request(input);
      }
      let registered!: () => void;
      const ready = new Promise<void>(resolve => { registered = resolve; });
      const work = (async () => {
        const saved = await read(id);
        if (saved && (saved.account !== account || saved.fingerprint !== input.fingerprint)) throw new GatewayError('operation_conflict', 409);
        if (saved?.remoteId) return Response.json({ requestId: id, state: saved.state }, { status: 202, headers: { 'X-Request-ID': id } });
        if (saved?.state === 'succeeded') return response(id, saved);
        if (saved && saved.state !== 'failed') throw new GatewayError('request_outcome_unknown', 409);
        let body = input.body;
        let endpoint = resource;
        let contentType = input.contentType;
        if (resource === 'responses') body = statelessResponses(body as Record<string, unknown>);
        if (resource === 'images/edits') {
          const form = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(body as Buffer) }).formData();
          const fields: Record<string, unknown> = {}; const references: unknown[] = [];
          for (const [name, value] of form.entries()) {
            if (typeof value === 'string') fields[name] = name === 'n' ? Number(value) : value;
            else if (name === 'image' || name === 'image[]') references.push({ type: 'image_url', image_url: { url: `data:${value.type || 'image/png'};base64,${Buffer.from(await value.arrayBuffer()).toString('base64')}` } });
          }
          body = { ...fields, input_references: references }; contentType = 'application/json'; endpoint = 'images';
        }
        if (resource === 'images/generations') endpoint = 'images';
        if (endpoint === 'images') {
          const { response_format: _format, size, quality, aspect_ratio, resolution, ...fields } = body as Record<string, unknown>;
          const options = input.model?.imageOptions;
          const aspectRatio = aspect_ratio || pixelAspectRatio(size);
          const valid = (value: unknown, allowed?: string[]) => value === undefined || value === '' || (typeof value === 'string' && !!allowed?.includes(value));
          if (options && (!valid(aspect_ratio, options.aspectRatios) || !valid(resolution, options.resolutions) || !valid(quality, options.qualities)
            || (Number(fields.n ?? 1) > options.maxImages) || (Array.isArray(fields.input_references) && fields.input_references.length > options.maxReferences))) throw new GatewayError('capability_unsupported', 400);
          const selectedRatio = options?.aspectRatios?.length && !options.aspectRatios.includes(String(aspectRatio)) ? options.aspectRatios[0] : aspectRatio;
          const outputFormat = ['png', 'jpeg', 'webp'].find(format => !options?.outputFormats?.length || options.outputFormats.includes(format));
          if (!outputFormat) throw new GatewayError('capability_unsupported', 400);
          body = { ...fields, ...(selectedRatio ? { aspect_ratio: selectedRatio } : {}), ...(resolution ? { resolution } : {}), ...(quality ? { quality } : {}), output_format: outputFormat };
        }
        if (resource === 'audio/speech') {
          const { voice, ...fields } = body as Record<string, unknown>;
          if (input.model?.capabilities.includes('default_voice')) {
            if (voice && voice !== gatewayDefaultVoiceId) throw new GatewayError('capability_unsupported', 400);
            body = { ...fields, response_format: 'mp3' };
          } else body = { ...fields, voice, response_format: 'mp3' };
        }
        if (resource === 'video/jobs' || resource === 'videos/tasks') {
          const value = body as { model: string; prompt: string; duration?: number; size?: string; image?: string };
          const sizeParams = input.model ? gatewayVideoSizeParameters(input.model, value.size ?? '') : value.size ? { size: value.size } : {};
          if (!sizeParams || (input.model?.durations && !input.model.durations.includes(value.duration!))) throw new GatewayError('capability_unsupported', 400);
          body = { model: value.model, prompt: value.prompt, duration: value.duration, ...sizeParams, ...(value.image ? { frame_images: [{ type: 'image_url', image_url: { url: value.image }, frame_type: 'first_frame' }] } : {}) };
          endpoint = 'videos';
        }
        const record: Receipt = { account, fingerprint: input.fingerprint, state: asyncImage ? 'waiting_upstream' : 'submitting' };
        await write(id, record);
        registered();
        try {
          const remote = await call(endpoint, { method: 'POST', signal, headers: { 'Content-Type': contentType }, body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) }, key);
          if (endpoint === 'videos') {
            const value = await remote.json() as { id?: string };
            if (!value.id || !/^[A-Za-z0-9_-]{1,200}$/.test(value.id)) throw new GatewayError('invalid_gateway_response');
            record.remoteId = value.id; record.state = 'waiting_upstream'; await write(id, record);
            return Response.json({ requestId: id, state: record.state }, { status: 202, headers: { 'X-Request-ID': id } });
          }
          record.status = remote.status; record.mime = remote.headers.get('content-type') ?? 'application/json';
          await write(id, record);
          const reader = (record.mime.includes('text/event-stream') && remote.body ? officialEventStream(remote.body) : remote.body)?.getReader(); if (!reader) throw new GatewayError('invalid_gateway_response');
          const chunks: Uint8Array[] = []; let size = 0;
          if (!record.mime.includes('text/event-stream')) {
            try {
              for (;;) {
                const item = await abortable(reader.read(), signal); if (item.done) break;
                size += item.value.length; if (size > 64 * 1024 * 1024) throw new GatewayError('invalid_gateway_response');
                chunks.push(item.value);
                // Buffered image JSON can be complete before the upstream closes its HTTP stream.
                if (endpoint === 'images' && Buffer.from(item.value).toString('utf8').trimEnd().endsWith('}') && completeImageResponse(Buffer.concat(chunks))) break;
              }
            } finally { void reader.cancel().catch(() => undefined); }
            if (endpoint === 'images' && !completeImageResponse(Buffer.concat(chunks))) throw new GatewayError('invalid_gateway_response');
            record.content = Buffer.concat(chunks).toString('base64'); record.state = 'succeeded'; await write(id, record);
            return response(id, record);
          }
          let settlement = Promise.resolve();
          const settleStream = (content?: Buffer) => {
            settlement = settlement.then(async () => {
              if (record.state === 'succeeded') return;
              record.state = content ? 'succeeded' : 'outcome_unknown';
              if (content) record.content = content.toString('base64');
              await write(id, record);
            });
            return settlement;
          };
          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const item = await reader.read();
                if (item.done) {
                  const content = Buffer.concat(chunks);
                  if (!completeEventStream(content, resource)) throw new GatewayError('request_outcome_unknown', 409);
                  await settleStream(content); controller.close(); return;
                }
                size += item.value.length; if (size > 64 * 1024 * 1024) throw new GatewayError('invalid_gateway_response');
                chunks.push(item.value);
                if (completeEventStream(Buffer.from(item.value), resource)) {
                  const content = Buffer.concat(chunks);
                  if (!completeEventStream(content, resource)) throw new GatewayError('request_outcome_unknown', 409);
                  await settleStream(content);
                  controller.enqueue(item.value); controller.close();
                  void reader.cancel().catch(() => undefined);
                  return;
                }
                controller.enqueue(item.value);
              } catch {
                await settleStream(); await reader.cancel().catch(() => undefined);
                if (record.state !== 'succeeded') controller.error(new GatewayError('request_outcome_unknown', 409));
              }
            },
            async cancel() {
              const content = Buffer.concat(chunks);
              await settleStream(completeEventStream(content, resource) ? content : undefined);
              await reader.cancel();
            }
          });
          return new Response(stream, { status: remote.status, headers: { 'Content-Type': record.mime, 'X-Request-ID': id } });
        } catch (error) {
          record.state = error instanceof GatewayError && [400, 401, 402, 403, 404, 422, 429].includes(error.status) ? 'failed' : 'outcome_unknown';
          if (error instanceof GatewayError) { record.errorCode = error.code; record.errorStatus = error.status; }
          await write(id, record); throw error;
        }
      })();
      pending.set(id, work);
      fingerprints.set(id, input.fingerprint);
      if (controller) workers.set(id, controller);
      void work.finally(() => { pending.delete(id); fingerprints.delete(id); workers.delete(id); }).catch(() => undefined);
      return asyncImage ? Promise.race([ready.then(() => accepted(id)), work]) : work;
    }
  };
}
