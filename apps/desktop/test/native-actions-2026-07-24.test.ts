import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNamedProjectDirectory,
  ensureDefaultProjectDirectory
} from '../src/main/native-actions.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('desktop project directories', () => {
  it('creates default and named projects under the Clawee directory', () => {
    const root = createTemporaryRoot();

    expect(ensureDefaultProjectDirectory(root)).toBe(join(root, 'Clawee', 'Default Project'));
    expect(createNamedProjectDirectory(root, '产品官网')).toBe(join(root, 'Clawee', '产品官网'));
  });

  it.each(['', '   ', '.', '..', '../outside', 'nested/project', 'nested\\project'])(
    'rejects invalid project name %j',
    name => {
      expect(() => createNamedProjectDirectory(createTemporaryRoot(), name)).toThrow();
    }
  );

  it('rejects an existing project directory', () => {
    const root = createTemporaryRoot();
    createNamedProjectDirectory(root, '重复项目');

    expect(() => createNamedProjectDirectory(root, '重复项目')).toThrow('同名项目已存在');
  });

  it('keeps project creation out of the native folder picker path', () => {
    const source = readFileSync('src/main/main.ts', 'utf8');
    const handlerStart = source.indexOf('handle(desktopIpc.createProjectDirectory');
    const nextHandlerStart = source.indexOf(
      'handle(desktopIpc.selectProjectDirectory',
      handlerStart
    );
    const handlerSource = source.slice(handlerStart, nextHandlerStart);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(nextHandlerStart).toBeGreaterThan(handlerStart);
    expect(handlerSource).toContain('createNamedProjectDirectory(');
    expect(handlerSource).not.toContain('dialog.showOpenDialog');
  });
});

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clawee-projects-'));
  temporaryRoots.push(root);
  return root;
}
