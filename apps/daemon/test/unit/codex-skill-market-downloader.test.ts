import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempDir = '';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock('tar');
  vi.resetModules();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skill market downloader', () => {
  it('extracts a normal tar.gz archive into the work directory', async () => {
    const { MarketArchiveDownloader, resolveMarketSkillSource } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    const archive = tarGzip([
      { path: 'repo-abc/', type: 'directory' },
      { path: 'repo-abc/skills/', type: 'directory' },
      { path: 'repo-abc/skills/writer/', type: 'directory' },
      {
        path: 'repo-abc/skills/writer/SKILL.md',
        type: 'file',
        body: '---\nname: writer\ndescription: writer\n---\n'
      }
    ]);
    mockFetch({ status: 200, body: archive });

    const root = await MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    });
    const source = resolveMarketSkillSource(root, 'skills/writer');

    expect(source).toBe(join(root, 'skills', 'writer'));
    expect(readFileSync(join(source, 'SKILL.md'), 'utf8')).toContain('writer');
  });

  it('uses a private extraction directory and preserves an existing workDir archive', async () => {
    const { MarketArchiveDownloader } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    const existingArchive = join(tempDir, 'archive.tar.gz');
    writeFileSync(existingArchive, 'caller-owned');
    mockFetch({ status: 200, body: validArchive() });

    const root = await MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    });

    expect(root).not.toBe(tempDir);
    expect(root.startsWith(`${tempDir}${sep}`)).toBe(true);
    expect((statSync(root).mode & 0o777)).toBe(0o700);
    expect(readFileSync(existingArchive, 'utf8')).toBe('caller-owned');
    expect(existsSync(join(root, 'archive.tar.gz'))).toBe(false);
    expect(existsSync(join(root, 'SKILL.md'))).toBe(true);
  });

  it('rejects content-length over the archive byte limit', async () => {
    const { MarketArchiveDownloader, MAX_MARKET_ARCHIVE_BYTES } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    mockFetch({
      status: 200,
      headers: { 'content-length': String(MAX_MARKET_ARCHIVE_BYTES + 1) },
      body: Buffer.from('too large')
    });

    await expect(MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    })).rejects.toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
  });

  it('cancels and aborts when content-length is over the archive byte limit', async () => {
    const { MarketArchiveDownloader, MAX_MARKET_ARCHIVE_BYTES } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    const abortState = mockFetch({
      status: 200,
      headers: { 'content-length': String(MAX_MARKET_ARCHIVE_BYTES + 1) },
      body: Buffer.from('too large'),
      trackCancel: true
    });

    await expect(MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    })).rejects.toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
    expect(abortState.cancelled).toBe(true);
    expect(abortState.aborted).toBe(true);
  });

  it('cancels and aborts when the streamed archive exceeds the byte limit', async () => {
    const { MarketArchiveDownloader } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    const abortState = mockLargeFetch();

    await expect(MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    })).rejects.toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
    expect(abortState.cancelled).toBe(true);
    expect(abortState.aborted).toBe(true);
  });

  it.each([
    ['absolute path', '/repo-abc/SKILL.md', 'file'],
    ['windows drive path', 'C:/repo-abc/SKILL.md', 'file'],
    ['windows drive-relative path', 'C:repo-abc/SKILL.md', 'file'],
    ['windows UNC path', '\\\\server\\share\\repo-abc\\SKILL.md', 'file'],
    ['parent directory segment', 'repo-abc/../evil/SKILL.md', 'file'],
    ['mixed windows parent segment', 'repo-abc/..\\evil/file', 'file'],
    ['stripped top-level file', 'repo-abc', 'file'],
    ['hard link', 'repo-abc/linked.md', 'hardlink'],
    ['symlink', 'repo-abc/linked.md', 'symlink']
  ] as const)('rejects an archive entry with %s', async (_label, path, type) => {
    const { MarketArchiveDownloader } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    const archive = tarGzip([
      { path: 'repo-abc/', type: 'directory' },
      {
        path,
        type,
        linkPath: type === 'file' ? undefined : 'repo-abc/SKILL.md',
        body: type === 'file' ? 'bad' : undefined
      }
    ]);
    mockFetch({ status: 200, body: archive });

    await expect(MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    })).rejects.toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
  });

  it('rejects when the archive changes after scan and before extract', async () => {
    vi.doMock('tar', async (importOriginal) => {
      const actual = await importOriginal<typeof import('tar')>();
      return {
        ...actual,
        t: async (...args: Parameters<typeof actual.t>) => {
          const result = await actual.t(...args);
          const options = args[0];
          if (!Array.isArray(options) && typeof options === 'object' && typeof options.file === 'string') {
            writeFileSync(options.file, tarGzip([
              { path: 'repo-abc/', type: 'directory' },
              { path: 'repo-abc/replaced.txt', type: 'file', body: 'changed' }
            ]));
          }
          return result;
        }
      };
    });
    const { MarketArchiveDownloader } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    mockFetch({ status: 200, body: validArchive() });

    await expect(MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    })).rejects.toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
  });

  it('wraps non-2xx HTTP responses as market download failures', async () => {
    const { MarketArchiveDownloader } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    mockFetch({ status: 404, body: Buffer.from('missing') });

    await expect(MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    })).rejects.toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
  });

  it('rejects a skillPath that escapes the extracted root', async () => {
    const { resolveMarketSkillSource } = await loadDownloader();
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    const root = join(tempDir, 'root');

    expect(() => resolveMarketSkillSource(root, '../outside')).toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
    expect(existsSync(join(tempDir, 'outside'))).toBe(false);
  });
});

async function loadDownloader(): Promise<typeof import('../../src/codex/skills/market-downloader.js')> {
  return import('../../src/codex/skills/market-downloader.js');
}

function mockFetch(input: {
  status: number;
  headers?: Record<string, string>;
  body: Buffer;
  trackCancel?: boolean;
}): { aborted: boolean; cancelled: boolean } {
  const state = { aborted: false, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input.body);
      controller.close();
    },
    cancel() {
      if (input.trackCancel) state.cancelled = true;
    }
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(input.body as unknown as BodyInit, {
    status: input.status,
    headers: {
      'content-type': 'application/gzip',
      ...(input.headers ?? {})
    }
  }));
  if (input.trackCancel) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      signal?.addEventListener('abort', () => {
        state.aborted = true;
      });
      return Promise.resolve(new Response(stream, {
        status: input.status,
        headers: {
          'content-type': 'application/gzip',
          ...(input.headers ?? {})
        }
      }));
    });
  }
  return state;
}

function mockLargeFetch(): { aborted: boolean; cancelled: boolean } {
  const state = { aborted: false, cancelled: false };
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks += 1;
      if (chunks <= 14) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      } else {
        controller.close();
      }
    },
    cancel() {
      state.cancelled = true;
    }
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    const signal = (init as RequestInit | undefined)?.signal;
    signal?.addEventListener('abort', () => {
      state.aborted = true;
    });
    return Promise.resolve(new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'application/gzip'
      }
    }));
  });
  return state;
}

type TestTarEntry = {
  path: string;
  type: 'directory' | 'file' | 'hardlink' | 'symlink';
  body?: string;
  linkPath?: string;
};

function tarGzip(entries: TestTarEntry[]): Buffer {
  return gzipSync(Buffer.concat([
    ...entries.flatMap((entry) => encodeTarEntry(entry)),
    Buffer.alloc(1024)
  ]));
}

function encodeTarEntry(entry: TestTarEntry): Buffer[] {
  const body = Buffer.from(entry.body ?? '');
  const header = Buffer.alloc(512);
  header.write(entry.path, 0, 100, 'utf8');
  writeOctal(header, 100, 8, entry.type === 'directory' ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.type === 'file' ? body.length : 0);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(typeFlag(entry.type), 156, 1, 'ascii');
  if (entry.linkPath) header.write(entry.linkPath, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, 148, 8, checksum);

  const blocks = [header];
  if (entry.type === 'file') {
    blocks.push(body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  return blocks;
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  buffer.write(`${text}\0`, offset, length, 'ascii');
}

function typeFlag(type: TestTarEntry['type']): string {
  if (type === 'directory') return '5';
  if (type === 'hardlink') return '1';
  if (type === 'symlink') return '2';
  return '0';
}

function validArchive(): Buffer {
  return tarGzip([
    { path: 'repo-abc/', type: 'directory' },
    {
      path: 'repo-abc/SKILL.md',
      type: 'file',
      body: '---\nname: writer\ndescription: writer\n---\n'
    }
  ]);
}
