import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { collectRunDiagnostics } from '../../src/api/routes.diagnostics.js';

let tempDir = '';
let server: FastifyInstance | undefined;

afterEach(async () => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
  await server?.close();
  server = undefined;
});

describe('diagnostics', () => {
  it('collects redacted run diagnostics files', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
    const runDir = join(tempDir, 'runs', 'run_1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'meta.json'), '{"id":"run_1"}');
    writeFileSync(join(runDir, 'events.ndjson'), '{"type":"done"}\n');
    writeFileSync(join(runDir, 'stderr.redacted.log'), 'TOKEN=[REDACTED]');
    writeFileSync(join(runDir, 'diagnostics.json'), '{"exitCode":0}');
    writeFileSync(join(runDir, 'raw.redacted.ndjson'), '{"secret":"[REDACTED]"}\n');

    const files = collectRunDiagnostics(tempDir, 'run_1');
    expect(files.map(file => file.name).sort()).toEqual([
      'diagnostics.json',
      'events.ndjson',
      'meta.json',
      'stderr.redacted.log',
    ]);
  });

  it('returns no files for path traversal run ids', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
    const outsideDir = join(tempDir, 'outside');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'meta.json'), '{"id":"outside"}');

    expect(collectRunDiagnostics(tempDir, '../outside')).toEqual([]);
  });

  it('does not export allowed diagnostic names when they are symlinks', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
    const runDir = join(tempDir, 'runs', 'run_1');
    const outsideDir = join(tempDir, 'outside');
    mkdirSync(runDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'meta.json'), '{"secret":"outside"}');
    writeFileSync(join(runDir, 'events.ndjson'), '{"type":"done"}\n');
    symlinkSync(join(outsideDir, 'meta.json'), join(runDir, 'meta.json'));

    const files = collectRunDiagnostics(tempDir, 'run_1');
    expect(files).toEqual([{ name: 'events.ndjson', content: '{"type":"done"}\n' }]);
  });

  it('rejects unauthorized diagnostics route requests', async () => {
    server = await buildServer({ token: 'secret' });

    const response = await server.inject({ method: 'GET', url: '/runs/run_1/diagnostics' });

    expect(response.statusCode).toBe(401);
  });

  it('returns diagnostics response for authorized route requests', async () => {
    server = await buildServer({ token: 'secret' });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics',
      headers: { authorization: 'Bearer secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ runId: 'run_1', files: [] });
  });
});
