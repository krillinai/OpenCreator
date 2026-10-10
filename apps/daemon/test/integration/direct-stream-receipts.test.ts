import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createDirectTransport } from '../../src/gateway/direct-transport.js';
import { readPrivateJsonFile, writePrivateJsonFile } from '../../src/config/private-json-file.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const encoder = new TextEncoder();
const delta = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
const done = 'data: [DONE]\n\n';

async function fixture(content: string) {
  const root = await mkdtemp(join(tmpdir(), 'oc-direct-stream-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(content)); }, cancel
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const transport = createDirectTransport(root, fetcher);
  cleanup.push(() => transport.close());
  const input = { account: 'account', key: 'test-key', resource: 'chat/completions', method: 'POST',
    body: { model: 'text', messages: [], stream: true }, contentType: 'application/json',
    identity: 'same-request', fingerprint: 'same-payload', signal: AbortSignal.timeout(3000) };
  const id = 'ocdir_' + createHash('sha256').update(JSON.stringify([input.account, input.identity])).digest('hex').slice(0, 48);
  return { root, input, id, transport, fetcher, cancel };
}

it('persists completion before forwarding DONE and survives immediate caller cancellation', async () => {
  const f = await fixture(delta + done);
  const response = await f.transport.request(f.input);
  const reader = response.body!.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done || new TextDecoder().decode(chunk.value).includes('[DONE]')) break;
  }
  await reader.cancel();
  await vi.waitFor(async () => expect(await readPrivateJsonFile(join(f.root, f.id + '.json'))).toMatchObject({ state: 'succeeded' }));
  const restarted = createDirectTransport(f.root, f.fetcher);
  expect(await (await restarted.request(f.input)).text()).toBe(delta + done);
  expect(f.fetcher).toHaveBeenCalledOnce();
  expect(f.cancel).toHaveBeenCalledOnce();
});

it('completes Responses at its terminal event even while upstream HTTP remains open', async () => {
  const completed = 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n';
  const f = await fixture(completed);
  const response = await f.transport.request({ ...f.input, resource: 'responses' });
  expect(await response.text()).toBe(completed);
  expect(await readPrivateJsonFile(join(f.root, f.id + '.json'))).toMatchObject({ state: 'succeeded' });
  expect(f.cancel).toHaveBeenCalledOnce();
});

it.each([
  delta,
  'data: {"choices":[{"delta":{"content":"the literal [DONE] is model text"}}]}\n\n',
  'data: {"type":"error","error":{"message":"failed"}}\n\n' + done,
  'data: {"type":"response.completed","response":{"status":"failed"}}\n\n' + done
])('preserves unknown acceptance when the caller cancels an incomplete or failed stream (%s)', async content => {
  const f = await fixture(content);
  const reader = (await f.transport.request(f.input)).body!.getReader();
  await reader.read();
  await reader.cancel();
  expect(await readPrivateJsonFile(join(f.root, f.id + '.json'))).toMatchObject({ state: 'outcome_unknown' });
  await expect(createDirectTransport(f.root, f.fetcher).request(f.input)).rejects.toMatchObject({ code: 'request_outcome_unknown' });
  expect(f.fetcher).toHaveBeenCalledOnce();
});

it.each([true, false])('recovers only a cached stream with verified completion (complete=%s)', async complete => {
  const f = await fixture('');
  await writePrivateJsonFile(join(f.root, f.id + '.json'), {
    account: f.input.account, fingerprint: f.input.fingerprint, state: 'outcome_unknown', status: 200,
    mime: 'text/event-stream', content: Buffer.from(delta + (complete ? done : '')).toString('base64')
  });
  const result = await f.transport.request({ ...f.input, resource: 'requests/' + f.id, method: 'GET' });
  expect(await result.json()).toMatchObject({ state: complete ? 'succeeded' : 'outcome_unknown' });
  expect(f.fetcher).not.toHaveBeenCalled();
});
