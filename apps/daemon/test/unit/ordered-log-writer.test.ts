import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OrderedLogBackpressureError,
  OrderedLogWriterClosedError,
  createOrderedLogWriter
} from '../../src/runs/ordered-log-writer.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('ordered log writer', () => {
  it('serializes concurrent appends in call order', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-ordered-log-'));
    const writes: string[] = [];
    let activeWrites = 0;
    let peakActiveWrites = 0;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const writer = createOrderedLogWriter({
      directory: tempDir,
      appendFile: async (_path, content) => {
        activeWrites += 1;
        peakActiveWrites = Math.max(peakActiveWrites, activeWrites);
        writes.push(content);
        if (content === 'first\n') await firstBlocked;
        activeWrites -= 1;
      }
    });

    const first = writer.append('events.ndjson', 'first\n');
    const second = writer.append('events.ndjson', 'second\n');
    const third = writer.append('stderr.redacted.log', 'third\n');

    await expect.poll(() => writes).toEqual(['first\n']);
    releaseFirst();
    await Promise.all([first, second, third]);

    expect(writes).toEqual(['first\n', 'second\n', 'third\n']);
    expect(peakActiveWrites).toBe(1);
    expect(writer.getMetrics()).toMatchObject({
      writesAttempted: 3,
      writesCompleted: 3,
      failureCount: 0,
      queuedBytes: 0
    });
  });

  it('reports high-water pressure and rejects work above the hard queue limit', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-ordered-log-'));
    let releaseWrite!: () => void;
    const blocked = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    const writer = createOrderedLogWriter({
      directory: tempDir,
      highWaterMarkBytes: 4,
      maxQueuedBytes: 6,
      appendFile: async () => blocked
    });

    const accepted = writer.append('events.ndjson', '1234');

    await expect(
      writer.append('events.ndjson', '5678')
    ).rejects.toBeInstanceOf(OrderedLogBackpressureError);
    expect(writer.getMetrics()).toMatchObject({
      highWaterMarkHits: 1,
      backpressureRejects: 1,
      peakQueuedBytes: 4,
      queuedBytes: 4
    });

    releaseWrite();
    await accepted;
    expect(writer.getMetrics().queuedBytes).toBe(0);
  });

  it('records write failures without poisoning later queued writes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-ordered-log-'));
    const writes: string[] = [];
    const writer = createOrderedLogWriter({
      directory: tempDir,
      appendFile: async (_path, content) => {
        writes.push(content);
        if (content === 'broken\n') throw new Error('disk unavailable');
      }
    });

    const failed = writer.append('events.ndjson', 'broken\n');
    const recovered = writer.append('events.ndjson', 'recovered\n');

    await expect(failed).rejects.toThrow('disk unavailable');
    await recovered;

    expect(writes).toEqual(['broken\n', 'recovered\n']);
    expect(writer.getMetrics()).toMatchObject({
      writesAttempted: 2,
      writesCompleted: 1,
      failureCount: 1
    });
    expect(writer.getMetrics().failures[0]).toMatchObject({
      file: 'events.ndjson',
      message: 'disk unavailable'
    });
  });

  it('waits for queued writes during drain and rejects appends after close', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-ordered-log-'));
    let releaseWrite!: () => void;
    const blocked = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    const writer = createOrderedLogWriter({
      directory: tempDir,
      appendFile: async () => blocked
    });

    const append = writer.append('events.ndjson', 'pending\n');
    let drained = false;
    const drain = writer.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    releaseWrite();
    await append;
    await drain;
    await writer.close();

    expect(writer.getMetrics()).toMatchObject({
      drainCount: 2,
      queuedBytes: 0,
      closed: true
    });
    await expect(
      writer.append('events.ndjson', 'late\n')
    ).rejects.toBeInstanceOf(OrderedLogWriterClosedError);
  });
});
