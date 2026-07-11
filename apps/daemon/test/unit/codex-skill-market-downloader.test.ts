import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MarketArchiveDownloader,
  MAX_MARKET_ARCHIVE_BYTES,
  resolveMarketSkillSource
} from '../../src/codex/skills/market-downloader.js';

let tempDir = '';

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skill market downloader', () => {
  it('extracts a normal tar.gz archive into the work directory', async () => {
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

    expect(source).toBe(join(tempDir, 'skills', 'writer'));
    expect(readFileSync(join(source, 'SKILL.md'), 'utf8')).toContain('writer');
  });

  it('rejects content-length over the archive byte limit', async () => {
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

  it.each([
    ['absolute path', '/repo-abc/SKILL.md', 'file'],
    ['parent directory segment', 'repo-abc/../evil/SKILL.md', 'file'],
    ['hard link', 'repo-abc/linked.md', 'hardlink'],
    ['symlink', 'repo-abc/linked.md', 'symlink']
  ] as const)('rejects an archive entry with %s', async (_label, path, type) => {
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

  it('wraps non-2xx HTTP responses as market download failures', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    mockFetch({ status: 404, body: Buffer.from('missing') });

    await expect(MarketArchiveDownloader.download({
      repository: 'owner/repo',
      commit: 'abc',
      workDir: tempDir
    })).rejects.toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
  });

  it('rejects a skillPath that escapes the extracted root', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-market-download-'));
    const root = join(tempDir, 'root');

    expect(() => resolveMarketSkillSource(root, '../outside')).toThrow(/CODEX_SKILL_MARKET_DOWNLOAD_FAILED/);
    expect(existsSync(join(tempDir, 'outside'))).toBe(false);
  });
});

function mockFetch(input: {
  status: number;
  headers?: Record<string, string>;
  body: Buffer;
}): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(input.body as unknown as BodyInit, {
    status: input.status,
    headers: {
      'content-type': 'application/gzip',
      ...(input.headers ?? {})
    }
  }));
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
