import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import type { GatewayModel } from '@opencreator/protocol';
import { readPrivateJsonFile, writePrivateJsonFile } from '../config/private-json-file.js';
import type { GatewayBootstrap } from './client.js';

const allowedTTL = 24 * 60 * 60_000;
const blockedTTL = 60 * 60_000;
const retryTTL = 5 * 60_000;
const entrySchema = z.object({
  status: z.enum(['allowed', 'blocked', 'unknown']),
  nextCheck: z.number(), representative: z.string(), alternate: z.boolean().optional()
});
const cacheSchema = z.object({ version: z.literal(1), base: z.string(), network: z.string(), groups: z.record(entrySchema) });
type AccessCache = z.infer<typeof cacheSchema>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function modelAccessGroup(model: GatewayModel): string | undefined {
  const [vendor, slug] = model.id.replace(/^~/, '').split('/');
  if (!slug) return undefined;
  if (vendor === 'openai') return slug.startsWith('gpt-oss') ? 'openai-oss' : 'openai';
  if (vendor === 'google') return slug.startsWith('gemma') ? 'google-gemma' : 'google-gemini';
  return vendor;
}

export function officialModelPolicy(models: GatewayModel[]) {
  return models.filter(model => modelAccessGroup(model) !== 'anthropic'
    && !model.id.endsWith(':batch')
    && !(model.modality === 'text' && modelAccessGroup(model) === 'openrouter'));
}

export function withModelCatalog(bootstrap: GatewayBootstrap, models: GatewayModel[]): GatewayBootstrap {
  const defaults: Record<string, string> = {};
  for (const model of models) {
    if (model.modality === 'text' && !model.capabilities.includes('responses')) continue;
    if (!defaults[model.modality] || bootstrap.defaults[model.modality] === model.id) defaults[model.modality] = model.id;
  }
  return { ...bootstrap, models, defaults };
}

const preferred: Record<string, string[]> = {
  openai: ['openai/gpt-4.1-mini', 'openai/gpt-6-sol', 'openai/gpt-4o-mini'],
  'google-gemini': ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'],
  deepseek: ['deepseek/deepseek-v3.2', 'deepseek/deepseek-chat'],
  qwen: ['qwen/qwen3-coder', 'qwen/qwen3-max'],
  'openai-oss': ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  'google-gemma': ['google/gemma-3-12b-it', 'google/gemma-3-27b-it']
};

export function createOfficialModelAccess(input: { dataDir: string; fetcher: typeof fetch; readProxy(): Promise<string> }) {
  const path = join(input.dataDir, 'config', 'gateway-model-access.json');
  let cache: AccessCache = { version: 1, base: '', network: '', groups: {} };
  let loaded: Promise<void> | undefined;
  let saving = Promise.resolve();
  let networkCheckedAt = 0;
  async function prepare(bootstrap: GatewayBootstrap) {
    loaded ??= (async () => {
      try {
        const parsed = cacheSchema.safeParse(await readPrivateJsonFile(path));
        if (parsed.success) cache = parsed.data;
      } catch { /* A broken availability cache must not prevent sign-in. */ }
    })();
    await loaded;
    const base = digest([bootstrap.account.id, bootstrap.keyVersion, await input.readProxy()]);
    if (cache.base !== base) {
      cache = { version: 1, base, network: '', groups: {} };
      networkCheckedAt = 0;
    }
    return filter(bootstrap);
  }
  function filter(bootstrap: GatewayBootstrap) {
    const eligible = officialModelPolicy(bootstrap.models);
    const status = (model: GatewayModel) => cache.groups[modelAccessGroup(model) ?? '']?.status;
    const text = eligible.filter(model => model.modality === 'text' && model.capabilities.includes('responses'));
    const selected = text.find(model => model.id === bootstrap.defaults.text);
    const fallback = (selected && status(selected) !== 'blocked' ? selected : undefined)
      ?? text.find(model => status(model) === 'allowed')
      ?? text.find(model => status(model) !== 'blocked');
    const fallbackGroup = fallback && modelAccessGroup(fallback);
    return withModelCatalog(bootstrap, eligible.filter(model => {
      const group = modelAccessGroup(model);
      if (group === undefined) return true;
      if (cache.groups[group]?.status === 'blocked') return false;
      return model.modality !== 'text' || cache.groups[group]?.status === 'allowed' || group === fallbackGroup;
    }));
  }
  function save() {
    const snapshot = structuredClone(cache);
    saving = saving.catch(() => undefined).then(() => writePrivateJsonFile(path, snapshot));
    return saving;
  }
  async function check(model: GatewayModel, key: string, signal: AbortSignal): Promise<{ status: 'allowed' | 'blocked' | 'unknown'; alternate?: boolean }> {
    try {
      const response = await input.fetcher('https://openrouter.ai/api/v1/responses', {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.id, input: 'Call oc_access_check with ready true.', store: false, stream: false, max_output_tokens: 512,
          tools: [{ type: 'function', name: 'oc_access_check', description: 'Confirm model access.', parameters: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'], additionalProperties: false } }],
          tool_choice: { type: 'function', name: 'oc_access_check' } })
      });
      const value = await response.json() as { status?: string; error?: { message?: unknown }; output?: Array<{ type?: string; name?: string; arguments?: string }> };
      const message = typeof value.error?.message === 'string' ? value.error.message : '';
      if (response.status === 403 && /provider terms of service|(?:country|region|location).{0,80}(?:not supported|restricted|not allowed|unavailable|prohibited)|(?:not available|unavailable|unsupported|restricted).{0,80}(?:country|region|location)/i.test(message)) return { status: 'blocked' };
      if (!response.ok) return { status: 'unknown', alternate: response.status === 400 || response.status === 404 };
      const call = value.output?.find(item => item.type === 'function_call' && item.name === 'oc_access_check');
      return value.status === 'completed' && call && JSON.parse(call.arguments ?? '{}').ready === true ? { status: 'allowed' } : { status: 'unknown', alternate: true };
    } catch { return { status: 'unknown' }; }
  }
  async function refresh(bootstrap: GatewayBootstrap, signal: AbortSignal, onChange: () => Promise<void>) {
    await prepare(bootstrap);
    if (signal.aborted) return;
    if (Date.now() - networkCheckedAt > 60_000) {
      networkCheckedAt = Date.now();
      try {
        const response = await input.fetcher('https://openrouter.ai/cdn-cgi/trace', { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) });
        const fields = new URLSearchParams((await response.text()).replace(/\r?\n/g, '&'));
        const ip = fields.get('ip') ?? ''; const country = fields.get('loc') ?? '';
        if (response.ok && isIP(ip) && /^[A-Z]{2}$/.test(country)) {
          const network = digest([ip, country]);
          if (cache.network !== network) {
            cache = { ...cache, network, groups: {} };
            await save(); await onChange();
          }
        }
      } catch { /* Keep prior results when the network identity endpoint is unavailable. */ }
    }
    const groups = new Map<string, GatewayModel[]>();
    for (const model of officialModelPolicy(bootstrap.models)) {
      const group = modelAccessGroup(model);
      if (model.modality !== 'text' || !model.capabilities.includes('responses') || !group) continue;
      groups.set(group, [...(groups.get(group) ?? []), model]);
    }
    const priority = ['openai', 'google-gemini', 'deepseek', 'qwen', 'openai-oss', 'google-gemma'];
    const pending = [...groups].filter(([group]) => (cache.groups[group]?.nextCheck ?? 0) <= Date.now())
      .sort(([a], [b]) => {
        const rank = (group: string) => priority.includes(group) ? priority.indexOf(group) : priority.length;
        return rank(a) - rank(b);
      }).slice(0, 12);
    const expectedBase = cache.base;
    const deadline = Date.now() + 20_000;
    async function worker() {
      while (pending.length && !signal.aborted && Date.now() < deadline && cache.base === expectedBase) {
        const [group, models] = pending.shift()!;
        const previous = cache.groups[group];
        const choices = [...models].sort((a, b) => {
          const rank = (id: string) => { const index = preferred[group]?.indexOf(id) ?? -1; return index < 0 ? 100 : index; };
          return rank(a.id) - rank(b.id);
        });
        const representative = (previous?.alternate ? choices.find(model => model.id !== previous.representative) : undefined) ?? choices[0]!;
        const result = await check(representative, bootstrap.modelKey, signal);
        if (signal.aborted || cache.base !== expectedBase) return;
        cache.groups[group] = {
          status: result.status === 'unknown' ? previous?.status ?? 'unknown' : result.status,
          representative: representative.id, alternate: result.alternate,
          nextCheck: Date.now() + (result.status === 'allowed' ? allowedTTL : result.status === 'blocked' ? blockedTTL : retryTTL)
        };
        await save(); await onChange();
      }
    }
    await Promise.all([worker(), worker()]);
  }
  return { prepare, filter, refresh };
}

export type OfficialModelAccess = ReturnType<typeof createOfficialModelAccess>;
