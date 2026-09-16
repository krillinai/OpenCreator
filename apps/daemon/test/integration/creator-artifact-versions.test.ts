import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { appendCreatorResultSnapshot } from '../../src/creator/result-snapshots.js';

it('selects history through the Dispatcher, persists a revision once, and downloads stale history without rewriting it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'creator-artifact-versions-'));
  const databasePath = join(directory, 'app.sqlite');
  const db = openRuntimeDatabase(databasePath);
  const repository = createCreatorRepository(db);
  const service = createCreatorService({ repository, templates: createDefaultCreatorTemplateRegistry() });
  const job = service.createJob({ projectId: 'project', templateId: 'image-generation' });
  const sourcePath = join(directory, 'source.txt');
  writeFileSync(sourcePath, 'historical source');
  const source = repository.insertArtifact({ jobId: job.id, kind: 'source_text', path: sourcePath, status: 'stale', sourceArtifactIds: [], metadata: {} });
  for (const version of [1, 2]) {
    const path = join(directory, `result-${version}.txt`);
    writeFileSync(path, `result ${version}`);
    const artifact = repository.insertArtifact({ jobId: job.id, kind: 'generated_image', path, status: version === 1 ? 'stale' : 'completed', sourceArtifactIds: [source.id], metadata: { resultVersion: version } });
    const current = repository.getJob(job.id)!;
    repository.updateJob({ id: job.id, status: 'completed', revision: 0, state: {
      ...current.state,
      ...appendCreatorResultSnapshot({ job: current, version, changedArtifacts: [artifact], action: 'stage-succeeded', stageId: 'generate', description: `Generation ${version}`, artifactRefsPatch: { source_text: [] } })
    } });
  }
  const before = repository.getJob(job.id)!;
  const server = await buildServer({ db, token: 'secret', dataDir: directory, codexHome: join(directory, 'codex-home') });
  try {
    const payload = { action: 'select-result-version', expectedRevision: 0, idempotencyKey: 'select-v1', input: { version: 1 } };
    const post = (body: typeof payload) => server.inject({ method: 'POST', url: `/creator/jobs/${job.id}/actions`, headers: { authorization: 'Bearer secret' }, payload: body });
    const first = await post(payload);
    expect(first.statusCode).toBe(200);
    expect(first.json().job).toMatchObject({ revision: 1, state: { resultVersion: 1, latestResultVersion: 2 } });
    expect((await post(payload)).statusCode).toBe(200);
    expect(repository.getJob(job.id)!.revision).toBe(1);
    expect(repository.getJob(job.id)!.artifacts).toEqual(before.artifacts);
    expect(repository.getJob(job.id)!.state.resultSnapshots).toEqual(before.state.resultSnapshots);
    expect(repository.getJob(job.id)!.activities.filter(activity => activity.action === 'select-result-version')).toHaveLength(1);
    expect(repository.getJob(job.id)!.stages).toHaveLength(0);
    expect((await post({ ...payload, idempotencyKey: 'conflict', input: { version: 2 } })).statusCode).toBe(409);
    const invalid = await post({ ...payload, expectedRevision: 1, idempotencyKey: 'missing', input: { version: 999 } });
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
    for (const artifact of before.artifacts) {
      const response = await server.inject({ method: 'GET', url: `/creator/jobs/${job.id}/artifacts/${artifact.id}/content`, headers: { authorization: 'Bearer secret' } });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(artifact.id === source.id ? 'historical source' : 'result');
    }
    const unauthenticated = await server.inject({ method: 'GET', url: `/creator/jobs/${job.id}/artifacts/${source.id}/content` });
    expect(unauthenticated.statusCode).toBe(401);
    repository.createStageRun({ jobId: job.id, stageId: 'generate', executor: 'image', status: 'running' });
    const active = await post({ ...payload, expectedRevision: 1, idempotencyKey: 'active', input: { version: 2 } });
    expect(active.statusCode).toBeGreaterThanOrEqual(400);
    expect(repository.getJob(job.id)!.revision).toBe(1);
  } finally {
    await server.close();
    if (db.open) db.close();
  }
  const reopened = openRuntimeDatabase(databasePath);
  try {
    const restored = createCreatorRepository(reopened).getJob(job.id)!;
    expect(restored.state.resultVersion).toBe(1);
    expect(restored.artifacts).toEqual(before.artifacts);
    expect(restored.artifacts.find(artifact => artifact.metadata.resultVersion === 1)!.status).toBe('stale');
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
