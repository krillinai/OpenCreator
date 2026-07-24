import { describe, expect, it, vi } from 'vitest';
import { exportDesktopDiagnostics } from '../src/main/diagnostics.js';

describe('Desktop diagnostics', () => {
  it('recursively redacts the final payload before writing', async () => {
    let writtenPayload = '';

    await expect(exportDesktopDiagnostics({
      state: {
        phase: 'failed',
        startedAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
        attempt: 1,
        error: {
          code: 'TEST',
          message: 'Authorization: Bearer secret-value'
        }
      },
      dataDir: '/tmp/TOKEN=secret-value/data',
      logDir: '/tmp/logs',
      dependencies: {
        showSaveDialog: vi.fn(async () => ({
          canceled: false,
          filePath: '/tmp/diagnostics.json'
        })),
        getAppVersion: () => '0.1.0',
        writeFile: async (_path, contents) => {
          writtenPayload = contents;
        },
        now: () => new Date('2026-07-16T00:00:00.000Z')
      }
    })).resolves.toEqual({ ok: true });

    const payload = writtenPayload;
    expect(payload).not.toContain('secret-value');
    expect(payload).toContain('[REDACTED]');
    expect(payload).toContain('/tmp/');
  });

  it('does not write when the user cancels the export', async () => {
    const writeFile = vi.fn(async (
      _path: string,
      _contents: string,
      _options: { mode: number }
    ) => undefined);
    const result = await exportDesktopDiagnostics({
      state: {
        phase: 'idle',
        startedAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
        attempt: 0
      },
      dataDir: '/tmp/data',
      logDir: '/tmp/logs',
      dependencies: {
        showSaveDialog: vi.fn(async () => ({ canceled: true })),
        getAppVersion: () => '0.1.0',
        writeFile,
        now: () => new Date('2026-07-16T00:00:00.000Z')
      }
    });

    expect(result).toMatchObject({ ok: false });
    expect(writeFile).not.toHaveBeenCalled();
  });
});
