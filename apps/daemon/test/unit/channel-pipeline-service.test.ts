import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import {
  createChannelPipelineService,
  type ChannelSpawnFunction
} from '../../src/channel/service.js';

const roots: string[] = [];

describe('Channel pipeline service', () => {


  afterEach(() => {
    roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));

  });

  it('runs allowlisted Channel CLI commands with uv and no shell', async () => {
    const root = temporaryChannelRoot();
    const service = createChannelPipelineService({
      repoPath: root,
      spawnImpl: fakeSpawn(['pipeline ready'])
    });

    const result = await service.process({ jobId: '0123456789abcdef0123456789abcdef' });

    expect(result.command).toEqual([
      'uv',
      'run',
      '--no-sync',
      'pipeline',
      'process',
      '0123456789abcdef0123456789abcdef'
    ]);
    expect(result.cwd).toBe(root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('pipeline ready');
  });

  it('builds compliant ingest and publish commands', async () => {
    const root = temporaryChannelRoot();
    const service = createChannelPipelineService({
      repoPath: root,
      spawnImpl: fakeSpawn(['ok'])
    });

    const ingest = await service.ingest({
      url: 'https://example.com/video',
      source: 'licensed'
    });
    expect(ingest.command.slice(-5)).toEqual([
      'ingest',
      '--url',
      'https://example.com/video',
      '--source',
      'licensed'
    ]);

    const publish = await service.publish({
      jobId: '0123456789abcdef0123456789abcdef',
      targets: ['manual', 'bilibili'],
      force: true
    });
    expect(publish.command.slice(-5)).toEqual([
      'publish',
      '0123456789abcdef0123456789abcdef',
      '--to',
      'manual,bilibili',
      '--force'
    ]);
  });

  it('rejects unsupported targets and unsafe job IDs before spawning', async () => {
    const root = temporaryChannelRoot();
    const spawnImpl = vi.fn();
    const service = createChannelPipelineService({ repoPath: root, spawnImpl });

    await expect(service.publish({
      jobId: '0123456789abcdef0123456789abcdef',
      targets: ['facebook' as never]
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(service.process({ jobId: '../escape' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('reports missing or invalid repo configuration without spawning', async () => {
    delete process.env.OPENCREATOR_CHANNEL_REPO;
    delete process.env.CHANNEL_REPO;
    const spawnImpl = vi.fn();
    const service = createChannelPipelineService({ spawnImpl });

    await expect(service.status())
      .rejects.toMatchObject({ code: 'CHANNEL_REPO_NOT_CONFIGURED' });
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});

type FakeChildProcess = ChildProcess & { close(code: number | null): void };

function temporaryChannelRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-channel-'));
  writeFileSync(join(root, 'pyproject.toml'), '[project]\nname = "channel"\n');
  roots.push(root);
  return root;
}

function fakeSpawn(stdout: string[]): ChannelSpawnFunction {
  return () => {
    const child = new EventEmitter() as FakeChildProcess;
    child.stdout = Readable.from(stdout);
    child.stderr = Readable.from([]);
    child.kill = () => true;

    setImmediate(() => {
      child.emit('close', 0, null);
    });
    return child;
  };
}
