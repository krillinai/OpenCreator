import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('runtime api', () => {
  it('rejects unauthorized requests', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({ method: 'GET', url: '/codex/status' });
    expect(response.statusCode).toBe(401);
  });

  it('returns health without auth', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('returns codex status with auth', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({
      method: 'GET',
      url: '/codex/status',
      headers: { authorization: 'Bearer secret' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ codexHomeMode: 'global' });
  });
});
