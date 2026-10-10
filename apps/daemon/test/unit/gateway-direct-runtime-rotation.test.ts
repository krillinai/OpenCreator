import { expect, it, vi } from 'vitest';
import { createDirectRuntime } from '../../src/gateway/direct-runtime.js';

it('uses the current coordinated supplier key for each request in the same Runtime', async () => {
  let key = 'first-user-key'; let busy = 0;
  const keys: string[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://openrouter.ai/api/v1/responses');
    expect(busy).toBe(1);
    keys.push(new Headers(init?.headers).get('Authorization')!);
    return Response.json({ output: [] });
  }) as typeof fetch;
  const runtime = await createDirectRuntime('stale-cached-key', fetcher, async () => {
    busy++; return { key, async release() { busy--; } };
  });
  try {
    for (const next of ['first-user-key', 'replacement-user-key']) {
      key = next;
      const response = await fetch(`${runtime.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'test/text', input: 'test' }) });
      expect(response.status).toBe(200); await response.json();
      await vi.waitFor(() => expect(busy).toBe(0));
    }
    expect(keys).toEqual(['Bearer first-user-key', 'Bearer replacement-user-key']);
  } finally { await runtime.close(); }
});

it('does not submit a supplier request when coordination denies admission', async () => {
  const fetcher = vi.fn() as typeof fetch;
  const runtime = await createDirectRuntime('user-key', fetcher, async () => { throw new Error('Coordination unavailable'); });
  try {
    const response = await fetch(`${runtime.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'test' }) });
    expect(response.status).toBe(503); await response.json();
    expect(fetcher).not.toHaveBeenCalled();
  } finally { await runtime.close(); }
});
