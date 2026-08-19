import { chmodSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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

  it('allows overwriteConflict=true to replace current file content after a conflict', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });
    writeFile('README.md', '# other\n');

    const result = await service.saveContent({
      threadId: 'thread_1',
      path: 'README.md',
      content: '# updated\n',
      baseVersionToken: before.meta.versionToken,
      overwriteConflict: true
    });

    expect(result.saved).toBe(true);
    expect(readFileSync(join(tempDir, 'README.md'), 'utf8')).toBe('# updated\n');
  });

  it('does not let overwriteConflict=true bypass read-only or sensitive file guards', async () => {
    const readOnly = createFixture({ sandbox: 'read-only' });
    writeFile('README.md', '# hello\n');
    const readOnlyBefore = await readOnly.service.readContent({ threadId: 'thread_1', path: 'README.md' });

    await expect(
      readOnly.service.saveContent({
        threadId: 'thread_1',
        path: 'README.md',
        content: '# changed\n',
        baseVersionToken: 'stale',
        overwriteConflict: true
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(readFileSync(join(tempDir, 'README.md'), 'utf8')).toBe(readOnlyBefore.content);

    rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';

    const writable = createFixture({ sandbox: 'workspace-write' });
    writeFile('.env', 'TOKEN=secret\n');
    await expect(
      writable.service.saveContent({
        threadId: 'thread_1',
        path: '.env',
        content: 'TOKEN=changed\n',
        baseVersionToken: 'stale',
        overwriteConflict: true
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(readFileSync(join(tempDir, '.env'), 'utf8')).toBe('TOKEN=secret\n');
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
    const outside = mkdtempSync(join(tmpdir(), 'opencreator-outside-'));
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

  it('rejects sensitive readContent before file reads or hash computation', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('.env', 'TOKEN=secret\n');
    chmodSync(join(tempDir, '.env'), 0o000);

    await expect(service.readContent({ threadId: 'thread_1', path: '.env' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    });
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

  it('rejects getMeta for sensitive files', async () => {
    const { service } = createFixture();
    writeFile('.env.production', 'TOKEN=prod\n');
    writeFile('id_rsa', 'private-key');
    writeFile('credentials.json', '{\"token\":\"secret\"}\n');

    await expect(service.getMeta({ threadId: 'thread_1', path: '.env.production' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    });
    await expect(service.getMeta({ threadId: 'thread_1', path: 'id_rsa' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    });
    await expect(service.getMeta({ threadId: 'thread_1', path: 'credentials.json' })).rejects.toMatchObject({
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
    const outside = mkdtempSync(join(tmpdir(), 'opencreator-outside-tree-'));
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFile('docs/inside.md', '# inside\n');
    symlinkSync(outside, join(tempDir, 'docs', 'escape-link'));

    const result = await service.listDirectory({ threadId: 'thread_1', path: 'docs' });

    expect(result.nodes.map((node) => node.name)).toEqual(['inside.md']);
    expect(result.warnings).toContain('Skipped path outside workspace root.');

    rmSync(outside, { recursive: true, force: true });
  });

  it('omits sensitive files from directory tree and uses generic warning', async () => {
    const { service } = createFixture();
    writeFile('.env.production', 'TOKEN=prod\n');
    writeFile('id_rsa', 'private-key');
    writeFile('credentials.json', '{\"token\":\"secret\"}\n');
    writeFile('.env.example', 'TOKEN=\n');
    writeFile('README.md', '# hello\n');

    const result = await service.listDirectory({ threadId: 'thread_1', path: '' });

    expect(result.nodes.map((node) => node.name)).toEqual(['.env.example', 'README.md']);
    expect(result.warnings).toEqual(['Skipped sensitive files.']);
  });

  it('does not create a new file when target is deleted before saveContent writes', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });
    unlinkSync(join(tempDir, 'README.md'));

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'README.md',
        content: '# updated\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });

    expect(() => readFileSync(join(tempDir, 'README.md'), 'utf8')).toThrow();
  });

  it('rejects saving through an in-workspace symlink and keeps target content unchanged', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('target.md', '# target\n');
    symlinkSync(join(tempDir, 'target.md'), join(tempDir, 'link.md'));
    const before = await service.readContent({ threadId: 'thread_1', path: 'target.md' });

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'link.md',
        content: '# changed\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toMatchObject({ code: 'PATH_ESCAPE' });

    expect(readFileSync(join(tempDir, 'target.md'), 'utf8')).toBe('# target\n');
  });

  it('writes large content fully when saveContent overwrites an existing file', async () => {
    const { service } = createFixture({ sandbox: 'workspace-write' });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });
    const largeContent = 'x'.repeat(256 * 1024);

    const result = await service.saveContent({
      threadId: 'thread_1',
      path: 'README.md',
      content: largeContent,
      baseVersionToken: before.meta.versionToken
    });

    expect(result.saved).toBe(true);
    expect(readFileSync(join(tempDir, 'README.md'), 'utf8')).toBe(largeContent);
    expect(result.meta.size).toBe(Buffer.byteLength(largeContent, 'utf8'));
  });

  it('keeps original content unchanged when atomic rename fails before replacing target', async () => {
    const renameError = Object.assign(new Error('rename failed'), { code: 'EIO' });
    const { service } = createFixture({
      sandbox: 'workspace-write',
      fileOps: {
        renameSync() {
          throw renameError;
        }
      }
    });
    writeFile('README.md', '# hello\n');
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'README.md',
        content: '# updated\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toBe(renameError);

    expect(readFileSync(join(tempDir, 'README.md'), 'utf8')).toBe('# hello\n');
    expect(readdirSync(tempDir)).toEqual(['README.md']);
  });

  it('creates atomic save temp files in resolved parentReal, not the mutable candidate parent path', async () => {
    const tempOpenPaths: string[] = [];
    const { service } = createFixture({
      sandbox: 'workspace-write',
      fileOps: {
        openSync(path, flags, mode) {
          if (String(path).includes('.opencreator-')) tempOpenPaths.push(String(path));
          return openSync(path, flags, mode);
        }
      }
    });
    mkdirSync(join(tempDir, 'real-docs'));
    writeFile('real-docs/README.md', '# hello\n');
    symlinkSync(join(tempDir, 'real-docs'), join(tempDir, 'docs'));
    const before = await service.readContent({ threadId: 'thread_1', path: 'docs/README.md' });

    await service.saveContent({
      threadId: 'thread_1',
      path: 'docs/README.md',
      content: '# updated\n',
      baseVersionToken: before.meta.versionToken
    });

    expect(readFileSync(join(tempDir, 'real-docs', 'README.md'), 'utf8')).toBe('# updated\n');
    expect(tempOpenPaths.some((path) => path.startsWith(realpathSync(join(tempDir, 'real-docs'))))).toBe(true);
    expect(tempOpenPaths.some((path) => path.startsWith(join(tempDir, 'docs')))).toBe(false);
  });

  it('does not recreate a target missing at the final pre-rename check', async () => {
    let targetChecks = 0;
    let renameCalled = false;
    let targetPath = '';
    const { service } = createFixture({
      sandbox: 'workspace-write',
      fileOps: {
        lstatSync: ((path) => {
          if (targetPath.length > 0 && String(path) === targetPath) {
            targetChecks += 1;
            if (targetChecks >= 2) {
              unlinkSync(path);
              throw Object.assign(new Error('missing'), { code: 'ENOENT' });
            }
          }
          return lstatSync(path);
        }) as typeof lstatSync,
        renameSync() {
          renameCalled = true;
          throw new Error('rename should not be called when target disappears before rename');
        }
      }
    });
    writeFile('README.md', '# hello\n');
    targetPath = realpathSync(join(tempDir, 'README.md'));
    const before = await service.readContent({ threadId: 'thread_1', path: 'README.md' });

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'README.md',
        content: '# updated\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });

    expect(renameCalled).toBe(false);
    expect(readdirSync(tempDir).some((name) => name.includes('.opencreator-'))).toBe(false);
  });

  it('does not recreate an originally resolved target when a symlinked parent changes before save', async () => {
    let mutated = false;
    let renameCalled = false;
    let candidatePath = '';
    const { service } = createFixture({
      sandbox: 'workspace-write',
      fileOps: {
        lstatSync: ((path) => {
          if (!mutated && candidatePath.length > 0 && String(path) === candidatePath) {
            mutated = true;
            unlinkSync(join(tempDir, 'docs'));
            symlinkSync(join(tempDir, 'new-docs'), join(tempDir, 'docs'));
            unlinkSync(join(tempDir, 'real-docs', 'README.md'));
          }
          return lstatSync(path);
        }) as typeof lstatSync,
        renameSync(source, target) {
          renameCalled = true;
          renameSync(source, target);
        }
      }
    });
    mkdirSync(join(tempDir, 'real-docs'));
    mkdirSync(join(tempDir, 'new-docs'));
    writeFile('real-docs/README.md', '# hello\n');
    writeFile('new-docs/README.md', '# unrelated\n');
    symlinkSync(join(tempDir, 'real-docs'), join(tempDir, 'docs'));
    const before = await service.readContent({ threadId: 'thread_1', path: 'docs/README.md' });
    candidatePath = join(realpathSync(tempDir), 'docs', 'README.md');

    await expect(
      service.saveContent({
        threadId: 'thread_1',
        path: 'docs/README.md',
        content: '# updated\n',
        baseVersionToken: before.meta.versionToken
      })
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });

    expect(renameCalled).toBe(false);
    expect(() => readFileSync(join(tempDir, 'real-docs', 'README.md'), 'utf8')).toThrow();
    expect(readFileSync(join(tempDir, 'new-docs', 'README.md'), 'utf8')).toBe('# unrelated\n');
    expect(readdirSync(join(tempDir, 'real-docs')).some((name) => name.includes('.opencreator-'))).toBe(false);
  });

  it.each([
    ['README.md', '# hello\n', 'markdown'],
    ['README.markdown', '# hello\n', 'markdown'],
    ['notes.txt', 'hello\n', 'text'],
    ['server.log', 'hello\n', 'text'],
    ['captions.srt', '1\n00:00:00,000 --> 00:00:01,000\nhello\n', 'text'],
    ['config.json', '{\"a\":1}\n', 'json'],
    ['config.jsonc', '{\n  // comment\n  \"a\": 1\n}\n', 'json'],
    ['events.jsonl', '{\"a\":1}\n', 'json'],
    ['config.yaml', 'a: 1\n', 'code'],
    ['config.yml', 'a: 1\n', 'code'],
    ['config.toml', 'name = \"demo\"\n', 'text'],
    ['data.csv', 'a,b\n1,2\n', 'text'],
    ['layout.xml', '<root />\n', 'code'],
    ['index.html', '<p>hello</p>\n', 'html'],
    ['index.htm', '<p>hello</p>\n', 'html'],
    ['styles.css', 'body {}\n', 'code'],
    ['styles.scss', '$a: red;\n', 'code'],
    ['styles.sass', 'body\n  color: red\n', 'code'],
    ['styles.less', '@a: red;\n', 'code'],
    ['app.js', 'console.log(1)\n', 'code'],
    ['app.jsx', 'export const App = () => null;\n', 'code'],
    ['app.mjs', 'export const a = 1;\n', 'code'],
    ['app.cjs', 'module.exports = 1;\n', 'code'],
    ['app.ts', 'export const a = 1;\n', 'code'],
    ['app.tsx', 'export const App = () => null;\n', 'code'],
    ['script.sh', 'echo hello\n', 'code'],
    ['script.bash', 'echo hello\n', 'code'],
    ['script.zsh', 'echo hello\n', 'code'],
    ['tool.py', 'print(\"hi\")\n', 'code'],
    ['.gitignore', 'node_modules\n', 'text'],
    ['.npmrc', 'registry=https://example.com\n', 'text'],
    ['.prettierrc', '{\"semi\":false}\n', 'text'],
    ['.eslintrc', 'module.exports = {}\n', 'code'],
    ['.env.example', 'TOKEN=\n', 'text'],
    ['.env.sample', 'TOKEN=\n', 'text']
  ])('supports base text type %s', async (filePath, content, expectedKind) => {
    const { service } = createFixture();
    writeFile(filePath, content);

    const result = await service.readContent({ threadId: 'thread_1', path: filePath });

    expect(result.content).toBe(content);
    expect(result.meta.kind).toBe(expectedKind);
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
  fileOps?: Parameters<typeof createWorkspaceFileService>[0]['fileOps'];
};

function createFixture(options: FixtureOptions = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-workspace-files-'));
  const thread = createThread(tempDir, options);
  const threads = new Map([[thread.id, thread]]);

  const service = createWorkspaceFileService({
    getThread(threadId) {
      return threads.get(threadId);
    },
    revealExecutor: options.revealExecutor,
    fileOps: options.fileOps
  });

  return { service, thread };
}

function createThread(root: string, options: FixtureOptions): RuntimeThread {
  const now = '2026-07-08T00:00:00.000Z';
  return {
    id: 'thread_1',
    title: 'Workspace',
    projectId: 'project_1',
    enterpriseSubjectId: null,
    origin: 'opencreator_created',
    cwd: root,
    canonicalCwd: realpathSync(root),
    workspaceMode: 'external',
    profile: 'default',
    sandbox: options.sandbox ?? 'read-only',
    status: options.status ?? 'active',
    purpose: 'conversation',
    createdAt: now,
    updatedAt: now
  };
}

function writeFile(relativePath: string, content: string): void {
  const absolutePath = join(tempDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
