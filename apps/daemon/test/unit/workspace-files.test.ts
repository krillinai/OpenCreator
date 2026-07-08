import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeThread } from '../../src/threads/types.js';
import { createWorkspaceFileService } from '../../src/workspace-files/service.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('workspace file service', () => {
  it('lists one directory level and suggests README.md', async () => {
    const { service } = createFixture();
    writeFile('README.md', '# hello');
    writeFile('docs/guide.md', '# guide');
    mkdirSync(join(tempDir, 'src', 'nested'), { recursive: true });

    const result = await service.listDirectory({ threadId: 'thread_1', path: '' });

    expect(result.suggestedOpenPath).toBe('README.md');
    expect(result.truncated).toBe(false);
    expect(result.nodes).toEqual([
      expect.objectContaining({
        path: 'docs',
        type: 'directory',
        hasChildren: true,
        childrenLoaded: false
      }),
      expect.objectContaining({
        path: 'src',
        type: 'directory',
        hasChildren: true,
        childrenLoaded: false
      }),
      expect.objectContaining({
        path: 'README.md',
        type: 'file',
        meta: expect.objectContaining({ kind: 'markdown', editable: true })
      })
    ]);
  });

  it('reads markdown content with sha256 version token', async () => {
    const { service } = createFixture();
    writeFile('README.md', '# hello\n');

    const result = await service.readContent({ threadId: 'thread_1', path: 'README.md' });

    expect(result.content).toBe('# hello\n');
    expect(result.meta.kind).toBe('markdown');
    expect(result.meta.versionToken).toMatch(/^[0-9]+:8:sha256:[a-f0-9]{64}$/);
  });

  it('saves existing editable text when version token matches', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });

    const result = await service.saveContent({
      threadId: 'thread_1',
      path: 'README.md',
      content: '# updated\n',
      baseVersionToken: before.meta.versionToken
    });

    expect(result.saved).toBe(true);
    expect(readFileSync(join(tempDir, 'README.md'), 'utf8')).toBe('# updated\n');
    expect(result.meta.versionToken).not.toBe(before.meta.versionToken);
  });

  it('does not create a new file through saveContent', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'new.md',
        content: '# new\n',
        baseVersionToken: 'missing'
      })
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('rejects save conflicts with FILE_CONFLICT', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });
    writeFile('README.md', '# other\n');

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'README.md',
        content: '# updated\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
  });

  it('rejects absolute paths and path traversal', async () => {
    const { service } = createFixture();
    writeFile('README.md', '# hello\n');

    await expect(service.readContent({ threadId: 'thread_1', path: '/etc/passwd' })).rejects.toMatchObject({
      code: 'PATH_INVALID'
    });
    await expect(service.readContent({ threadId: 'thread_1', path: '../README.md' })).rejects.toMatchObject({
      code: 'PATH_INVALID'
    });
  });

  it('rejects symlink escapes outside canonicalCwd', async () => {
    const { service } = createFixture();
    const outside = mkdtempSync(join(tmpdir(), 'clawee-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'secret');
    symlinkSync(join(outside, 'secret.md'), join(tempDir, 'leak.md'));

    await expect(service.readContent({ threadId: 'thread_1', path: 'leak.md' })).rejects.toMatchObject({
      code: 'PATH_ESCAPE'
    });

    rmSync(outside, { recursive: true, force: true });
  });

  it('blocks sensitive files such as .env', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('.env', 'TOKEN=secret\n');

    await expect(service.readContent({ threadId: 'thread_1', path: '.env' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    });
    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: '.env',
        content: 'TOKEN=changed\n',
        baseVersionToken: 'anything'
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('blocks additional sensitive files such as .env.production, id_ed25519, and .crt', async () => {
    const { service } = createFixture();
    writeFile('.env.production', 'TOKEN=prod\n');
    writeFile('id_ed25519', 'private-key');
    writeFile('server.crt', 'certificate');

    await expect(service.readContent({ threadId: 'thread_1', path: '.env.production' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    });
    await expect(service.readContent({ threadId: 'thread_1', path: 'id_ed25519' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    });
    await expect(service.readContent({ threadId: 'thread_1', path: 'server.crt' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    });
  });

  it('allows .env.example as text', async () => {
    const { service } = createFixture();
    writeFile('.env.example', 'TOKEN=\n');

    const result = await service.readContent({ threadId: 'thread_1', path: '.env.example' });

    expect(result.content).toBe('TOKEN=\n');
    expect(result.meta.kind).toBe('text');
    expect(result.meta.editable).toBe(true);
  });

  it('blocks read-only saves with PERMISSION_DENIED', async () => {
    const { service } = createFixture({ sandbox: 'read-only' });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'README.md',
        content: '# updated\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects raw traversal and ignored segments before normalize', async () => {
    const { service } = createFixture();
    writeFile('README.md', '# hello\n');

    await expect(service.readContent({ threadId: 'thread_1', path: 'a/../README.md' })).rejects.toMatchObject({
      code: 'PATH_INVALID'
    });
    await expect(service.readContent({ threadId: 'thread_1', path: 'node_modules/../README.md' })).rejects.toMatchObject({
      code: 'PATH_IGNORED'
    });
  });

  it('skips directory entries whose symlink escapes outside root and reports warning', async () => {
    const { service } = createFixture({ sandbox: 'read-only' });
    const outside = mkdtempSync(join(tmpdir(), 'clawee-outside-tree-'));
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFile('docs/inside.md', '# inside\n');
    symlinkSync(outside, join(tempDir, 'docs', 'escape-link'));

    const result = await service.listDirectory({ threadId: 'thread_1', path: 'docs' });

    expect(result.nodes.map((node) => node.name)).toEqual(['inside.md']);
    expect(result.warnings).toContain('Skipped path outside workspace root: docs/escape-link');

    rmSync(outside, { recursive: true, force: true });
  });

  it('does not create a new file when target is concurrently deleted during saveContent', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });
    renameSync(join(tempDir, 'README.md'), join(tempDir, 'README.moved.md'));

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'README.md',
        content: '# updated\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });

    expect(() => readFileSync(join(tempDir, 'README.md'), 'utf8')).toThrow();
    expect(readFileSync(join(tempDir, 'README.moved.md'), 'utf8')).toBe('# hello\n');
  });

  it('reads jsonc toml srt and zsh as text', async () => {
    const { service } = createFixture();
    writeFile('config.jsonc', '{\n  // comment\n  \"a\": 1\n}\n');
    writeFile('config.toml', 'name = \"demo\"\n');
    writeFile('captions.srt', '1\n00:00:00,000 --> 00:00:01,000\nhello\n');
    writeFile('script.zsh', 'echo hello\n');

    const jsonc = await service.readContent({ threadId: 'thread_1', path: 'config.jsonc' });
    const toml = await service.readContent({ threadId: 'thread_1', path: 'config.toml' });
    const srt = await service.readContent({ threadId: 'thread_1', path: 'captions.srt' });
    const zsh = await service.readContent({ threadId: 'thread_1', path: 'script.zsh' });

    expect(jsonc.meta.kind).toBe('json');
    expect(toml.meta.kind).toBe('text');
    expect(srt.meta.kind).toBe('text');
    expect(zsh.meta.kind).toBe('code');
  });

  it('classifies svg as code text instead of image blob', async () => {
    const { service } = createFixture();
    writeFile('icon.svg', '<svg viewBox="0 0 10 10"></svg>');

    const content = await service.readContent({ threadId: 'thread_1', path: 'icon.svg' });

    expect(content.meta.kind).toBe('code');
    await expect(service.readBlob({ threadId: 'thread_1', path: 'icon.svg' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE'
    });
  });

  it('returns meta and buffer from readBlob', async () => {
    const { service } = createFixture();
    writeFile('image.png', 'png-bytes');

    const result = await service.readBlob({ threadId: 'thread_1', path: 'image.png' });

    expect(result.meta.kind).toBe('image');
    expect(result.buffer.equals(Buffer.from('png-bytes'))).toBe(true);
  });

  it('returns THREAD_ARCHIVED when saving archived thread content', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write', status: 'archived' });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'README.md',
        content: '# updated\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toMatchObject({ code: 'THREAD_ARCHIVED' });
  });

  it('marks directory list meta as readonly for read-only threads', async () => {
    const { service } = createFixture({ sandbox: 'read-only' });
    writeFile('README.md', '# hello\n');

    const result = await service.listDirectory({ threadId: 'thread_1', path: '' });
    const readme = result.nodes.find((node) => node.type === 'file' && node.name === 'README.md');

    expect(readme).toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({
          readonly: true
        })
      })
    );
  });

  it('calls reveal executor only after path validation', async () => {
    const calls: Array<{ absolutePath: string; mode: 'file' | 'directory' }> = [];
    const { service } = createFixture({
      revealExecutor: async (request) => {
        calls.push(request);
      }
    });
    writeFile('README.md', '# hello\n');

    await expect(service.reveal({ threadId: 'thread_1', path: '../README.md', mode: 'file' })).rejects.toMatchObject({
      code: 'PATH_INVALID'
    });
    expect(calls).toHaveLength(0);

    await expect(service.reveal({ threadId: 'thread_1', path: 'README.md', mode: 'file' })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ absolutePath: realpathSync(join(tempDir, 'README.md')), mode: 'file' }]);
  });
});

type FixtureOptions = {
  sandbox?: RuntimeThread['sandbox'];
  status?: RuntimeThread['status'];
  revealExecutor?: (request: { absolutePath: string; mode: 'file' | 'directory' }) => Promise<void> | void;
};

function createFixture(options: FixtureOptions = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-workspace-files-'));
  const thread = createThread(tempDir, options);
  const threads = new Map([[thread.id, thread]]);

  const service = createWorkspaceFileService({
    getThread(threadId) {
      return threads.get(threadId);
    },
    revealExecutor: options.revealExecutor
  });

  return { service, thread };
}

function createThread(root: string, options: FixtureOptions): RuntimeThread {
  const now = '2026-07-08T00:00:00.000Z';
  return {
    id: 'thread_1',
    title: 'Workspace',
    cwd: root,
    canonicalCwd: realpathSync(root),
    workspaceMode: 'external',
    profile: 'default',
    sandbox: options.sandbox ?? 'read-only',
    status: options.status ?? 'active',
    createdAt: now,
    updatedAt: now
  };
}

function writeFile(relativePath: string, content: string): void {
  const absolutePath = join(tempDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
