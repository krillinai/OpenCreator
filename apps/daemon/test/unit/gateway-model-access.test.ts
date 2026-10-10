import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { GatewayModel } from '@opencreator/protocol';
import type { GatewayBootstrap } from '../../src/gateway/client.js';
import { createOfficialModelAccess, modelAccessGroup, officialModelPolicy } from '../../src/gateway/model-access.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const text = (id: string): GatewayModel => ({ id, modality: 'text', capabilities: ['responses'] });
const bootstrap = (models: GatewayModel[]): GatewayBootstrap => ({
  schemaVersion: 1, transport: 'openrouter-direct', account: { id: 'account-a', email: 'a@test', verified: true },
  modelKey: 'private-model-key', keyVersion: 'key-v1', bindingVersion: 'binding-v1', baseUrl: 'https://openrouter.ai/api/v1',
  models, defaults: { text: models.find(model => model.modality === 'text')!.id }
});
const success = () => Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'oc_access_check', arguments: '{"ready":true}' }] });
const denied = () => Response.json({ error: { message: 'The request is prohibited due to a violation of provider Terms Of Service.' } }, { status: 403 });
async function fixture(models: GatewayModel[], reply: (id: string) => Response | Promise<Response> = success) {
  const root = await mkdtemp(join(tmpdir(), 'oc-model-access-')); roots.push(root);
  let proxy = 'http://127.0.0.1:7897'; let ip = '203.0.113.1';
  const calls: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (target, options) => {
    if (String(target).endsWith('/cdn-cgi/trace')) return new Response(`ip=${ip}\nloc=JP\n`);
    const body = JSON.parse(String(options?.body)); calls.push(body.model);
    expect(body).toMatchObject({ store: false, stream: false, max_output_tokens: 512 });
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer private-model-key');
    return reply(body.model);
  });
  const input = { dataDir: root, fetcher, readProxy: async () => proxy };
  const access = createOfficialModelAccess(input); const value = bootstrap(models);
  const run = (target = value) => access.refresh(target, new AbortController().signal, async () => undefined);
  return { root, input, access, value, run, calls, fetcher, setIP(value: string) { ip = value; }, setProxy(value: string) { proxy = value; } };
}

it('keeps hosted GPT and Gemini separate from open weight models and removes unsupported catalog entries', () => {
  expect(modelAccessGroup(text('openai/gpt-6-sol'))).toBe('openai');
  expect(modelAccessGroup(text('~openai/gpt-6-sol'))).toBe('openai');
  expect(modelAccessGroup(text('openai/gpt-oss-20b'))).toBe('openai-oss');
  expect(modelAccessGroup(text('google/gemma-3-12b-it'))).toBe('google-gemma');
  expect(modelAccessGroup(text('google/gemini-2.5-flash'))).toBe('google-gemini');
  expect(officialModelPolicy(['anthropic/claude-sonnet-4.6', '~anthropic/claude-opus-4.6', 'openai/gpt-4.1:batch', 'openrouter/auto', 'deepseek/deepseek-v3.2'].map(text)).map(model => model.id)).toEqual(['deepseek/deepseek-v3.2']);
});

it('checks one representative per family and filters all explicitly denied family members', async () => {
  const image: GatewayModel = { id: 'openai/gpt-image-1', modality: 'image', capabilities: [] };
  const f = await fixture([text('deepseek/deepseek-v3.2'), text('openai/gpt-6-sol'), text('openai/gpt-4.1-mini'), image, text('google/gemini-2.5-flash'), text('google/gemini-2.5-flash-lite'), text('openai/gpt-oss-20b'), text('google/gemma-3-12b-it'), text('anthropic/claude-sonnet-4.6')], id => /gpt-4.1-mini|gemini/.test(id) ? denied() : success());
  expect((await f.access.prepare(f.value)).models.filter(model => model.modality === 'text').map(model => model.id)).toEqual(['deepseek/deepseek-v3.2']);
  await f.run();
  expect(f.calls).toHaveLength(5);
  expect(f.calls).toContain('openai/gpt-4.1-mini');
  expect(f.calls).not.toContain('openai/gpt-6-sol');
  expect(f.calls).toContain('google/gemini-2.5-flash-lite');
  expect(f.calls).not.toContain(image.id);
  expect(f.access.filter(f.value).models.map(model => model.id)).toEqual(['deepseek/deepseek-v3.2', 'openai/gpt-oss-20b', 'google/gemma-3-12b-it']);
  const saved = await readFile(join(f.root, 'config/gateway-model-access.json'), 'utf8');
  expect(saved).not.toMatch(/private-model-key|203\.0\.113|a@test/);
});

it('preserves the selected family while another family finishes its check first', async () => {
  let finishSelected!: () => void;
  const waiting = new Promise<void>(resolve => { finishSelected = resolve; });
  const f = await fixture([text('deepseek/deepseek-v3.2'), text('openai/gpt-4.1-mini')], async id => {
    if (id.startsWith('deepseek/')) await waiting;
    return success();
  });
  const work = f.run();
  await expect.poll(() => f.access.filter(f.value).models.length).toBe(2);
  expect(f.access.filter(f.value).defaults.text).toBe('deepseek/deepseek-v3.2');
  finishSelected(); await work;
  expect(f.access.filter(f.value).defaults.text).toBe('deepseek/deepseek-v3.2');
});

it.each([429, 503, 403])('retains a previously accessible family for a transient or unrelated HTTP %s failure', async status => {
  let failure = false;
  const f = await fixture([text('deepseek/deepseek-v3.2'), text('openai/gpt-4.1-mini')], () => failure
    ? Response.json({ error: { message: status === 403 ? 'Key limit exceeded' : 'Temporarily unavailable' } }, { status }) : success());
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  await f.run(); failure = true; clock.mockReturnValue(Date.now() + 24 * 60 * 60_000 + 1);
  await f.run();
  expect(f.access.filter(f.value).models).toHaveLength(2);
});

it('keeps success across a network exception without caching a secret error message', async () => {
  let failed = false;
  const f = await fixture([text('deepseek/deepseek-v3.2'), text('qwen/qwen3-coder')], () => {
    if (failed) throw new Error('private-model-key');
    return success();
  });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  await f.run(); failed = true; clock.mockReturnValue(Date.now() + 24 * 60 * 60_000 + 1); await f.run();
  expect(f.access.filter(f.value).models).toHaveLength(2);
  expect(await readFile(join(f.root, 'config/gateway-model-access.json'), 'utf8')).not.toContain('private-model-key');
});

it('preserves cached results when the network identity endpoint is unavailable', async () => {
  const f = await fixture([text('deepseek/deepseek-v3.2'), text('openai/gpt-4.1-mini')], id => id.startsWith('openai/') ? denied() : success());
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  await f.run(); const count = f.calls.length;
  clock.mockReturnValue(Date.now() + 60_001);
  f.fetcher.mockRejectedValueOnce(new Error('trace unavailable'));
  await f.run();
  expect(f.calls).toHaveLength(count);
  expect(f.access.filter(f.value).models.map(model => model.id)).toEqual(['deepseek/deepseek-v3.2']);
});

it('reuses persisted results and retries a blocked family after one hour', async () => {
  const f = await fixture([text('deepseek/deepseek-v3.2'), text('openai/gpt-4.1-mini')], id => id.startsWith('openai/') ? denied() : success());
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  await f.run(); const count = f.calls.length;
  const restored = createOfficialModelAccess(f.input);
  expect((await restored.prepare(f.value)).models.map(model => model.id)).toEqual(['deepseek/deepseek-v3.2']);
  await restored.refresh(f.value, new AbortController().signal, async () => undefined);
  expect(f.calls).toHaveLength(count);
  clock.mockReturnValue(Date.now() + 60 * 60_000 + 1); await f.run();
  expect(f.calls.slice(count)).toEqual(['openai/gpt-4.1-mini']);
});

it('invalidates results for account, key, proxy and exit changes', async () => {
  const f = await fixture([text('deepseek/deepseek-v3.2'), text('openai/gpt-4.1-mini')]);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  await f.run();
  const key = { ...f.value, keyVersion: 'key-v2' };
  expect((await f.access.prepare(key)).models).toHaveLength(1); await f.run(key);
  const account = { ...key, account: { ...key.account, id: 'account-b' } };
  expect((await f.access.prepare(account)).models).toHaveLength(1); await f.run(account);
  f.setProxy('http://127.0.0.1:8888'); expect((await f.access.prepare(account)).models).toHaveLength(1); await f.run(account);
  f.setIP('203.0.113.2'); clock.mockReturnValue(Date.now() + 60_001); await f.run(account);
  expect(f.calls).toHaveLength(10);
});

it('tries another representative after a model-specific parameter or missing-model error', async () => {
  const f = await fixture([text('deepseek/deepseek-v3.2'), text('openai/gpt-4.1-mini'), text('openai/gpt-6-sol')], id => id === 'openai/gpt-4.1-mini'
    ? Response.json({ error: { message: 'Model is unavailable' } }, { status: 404 }) : success());
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  await f.run(); clock.mockReturnValue(Date.now() + 5 * 60_000 + 1); await f.run();
  expect(f.calls.filter(id => id.startsWith('openai/'))).toEqual(['openai/gpt-4.1-mini', 'openai/gpt-6-sol']);
  expect(f.access.filter(f.value).models).toHaveLength(3);
});

it('bounds each background pass and stops starting probes after cancellation', async () => {
  const f = await fixture(Array.from({ length: 20 }, (_, i) => text(`vendor-${i}/model`)));
  await f.run(); expect(f.calls).toHaveLength(12);
  const controller = new AbortController(); controller.abort();
  await f.access.refresh(f.value, controller.signal, async () => undefined);
  expect(f.calls).toHaveLength(12);
});
