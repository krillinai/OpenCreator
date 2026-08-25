import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  krillinStageTypes,
  krillinTaskStatuses,
  type CreateKrillinTaskRequest,
  type KrillinResultManifest,
  type KrillinTask,
  type KrillinTaskEventsResponse
} from '../src/index.js';

const root = resolve(import.meta.dirname, '..', '..', '..');
const schemaPath = resolve(root, 'packages/protocol/contracts/krillin-opencreator-v1.schema.json');
const goSchemaPath = resolve(root, 'KrillinAI/api/opencreator/v1/schema.json');
const fixtureRoot = resolve(import.meta.dirname, 'fixtures/krillin-opencreator-v1');

describe('KrillinAI OpenCreator Protocol V1', () => {
  it('keeps the Go schema copy identical to the unique protocol source', () => {
    expect(sha256Normalized(goSchemaPath)).toBe(sha256Normalized(schemaPath));
  });

  it('keeps status and stage enums aligned with the schema', () => {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as any;
    expect(schema.$defs.taskStatus.enum).toEqual(krillinTaskStatuses);
    expect(schema.$defs.stageType.enum).toEqual(krillinStageTypes);
  });

  it('loads the golden DTO fixtures through the exported TypeScript contract', () => {
    const request = fixture<CreateKrillinTaskRequest>('create-task.json');
    const task = fixture<KrillinTask>('task-running.json');
    const events = fixture<KrillinTaskEventsResponse>('events.json');
    const manifest = fixture<KrillinResultManifest>('success-manifest.json');
    const interrupted = fixture<KrillinTask>('task-interrupted.json');

    expect(request.protocolVersion).toBe(1);
    expect(task.status).toBe('running');
    expect(events.events.map(event => event.seq)).toEqual([2, 3]);
    expect(manifest.artifacts[0]?.relativePath).not.toMatch(/^([A-Za-z]:|\/)/);
    expect(interrupted.status).toBe('interrupted');
  });
});

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8')) as T;
}

function sha256Normalized(path: string): string {
  const contents = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  return createHash('sha256').update(contents).digest('hex');
}
