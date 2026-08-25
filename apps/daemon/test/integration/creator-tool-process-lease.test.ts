import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentCapabilityTokenStore } from '../../src/agent-tools/capability-token.js';
import { buildServer } from '../../src/api/server.js';

let server: FastifyInstance | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator tool process lease', () => {
  it('allows only the active Turn job and rejects inactive or forged requests', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-tool-lease-'));
    const capabilities = createAgentCapabilityTokenStore();
    server = await buildServer({
      token: 'public-secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      agentCapabilityTokens: capabilities
    });
    const firstJob = await createJob('project-1');
    const secondJob = await createJob('project-2');
    const lease = capabilities.issueProcess({
      createdBy: 'api',
      maxScopes: ['creator:context', 'creator:artifact:read', 'creator:action']
    });

    expect((await creatorGet('/internal/agent-tools/creator/context', lease.token)).statusCode)
      .toBe(403);
    lease.activate({
      runId: 'run-1',
      threadId: 'thread-1',
      jobId: firstJob.id,
      projectId: 'project-1',
      processGeneration: 11,
      createdBy: 'api',
      scopes: ['creator:context', 'creator:artifact:read', 'creator:action']
    });

    const context = await creatorGet('/internal/agent-tools/creator/context', lease.token);
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({ jobId: firstJob.id, revision: 0 });

    const forged = await creatorPost('/internal/agent-tools/creator/actions', lease.token, {
      jobId: secondJob.id,
      action: 'update-settings',
      expectedRevision: 0,
      idempotencyKey: 'forged-1',
      input: { patch: { targetLanguage: 'fr' } }
    });
    expect(forged.statusCode).toBe(400);

    const updated = await creatorPost('/internal/agent-tools/creator/actions', lease.token, {
      action: 'update-settings',
      expectedRevision: 0,
      idempotencyKey: 'agent-settings-1',
      input: { patch: { targetLanguage: 'ja' } }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      job: { id: firstJob.id, revision: 1, state: { targetLanguage: 'ja' } },
      commandReceipt: { actor: 'agent', status: 'committed' }
    });
    expect((await readJob(secondJob.id)).state.targetLanguage).toBe('en');

    expect(lease.deactivate('run-1')).toBe(true);
    expect((await creatorGet('/internal/agent-tools/creator/context', lease.token)).statusCode)
      .toBe(403);
    capabilities.close();
  });
});

async function createJob(projectId: string) {
  const response = await server!.inject({
    method: 'POST',
    url: '/creator/jobs',
    headers: { authorization: 'Bearer public-secret' },
    payload: {
      projectId,
      templateId: 'video-translation',
      state: { targetLanguage: 'en' }
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json().job as { id: string };
}

async function readJob(id: string) {
  const response = await server!.inject({
    method: 'GET',
    url: `/creator/jobs/${id}`,
    headers: { authorization: 'Bearer public-secret' }
  });
  return response.json().job as { state: Record<string, unknown> };
}

function creatorGet(path: string, token: string) {
  return server!.inject({
    method: 'GET',
    url: path,
    headers: { authorization: `Bearer ${token}` }
  });
}

function creatorPost(path: string, token: string, payload: object) {
  return server!.inject({
    method: 'POST',
    url: path,
    headers: { authorization: `Bearer ${token}` },
    payload
  });
}
