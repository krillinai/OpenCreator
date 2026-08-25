import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RuntimeImportValidationError,
  runRuntimeDataImport
} from '../src/main/workers/data-migration-worker.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Runtime data migration', () => {
  it('copies a validated Runtime database into an empty target', () => {
    const { source, target } = createFixture();
    writeFileSync(join(source, 'note.txt'), 'preserved');

    expect(runRuntimeDataImport({ source, target })).toEqual({
      imported: true,
      source: realpathSync(source),
      target
    });
    const copied = new DatabaseSync(join(target, 'app.sqlite'), {
      readOnly: true
    });
    expect(copied.prepare('select value from settings').get()).toEqual({
      value: 'ready'
    });
    copied.close();
  });

  it('keeps an existing non-empty target unchanged', () => {
    const { source, target } = createFixture();
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'keep.txt'), 'existing');

    expect(runRuntimeDataImport({ source, target })).toEqual({
      imported: false,
      reason: 'TARGET_EXISTS'
    });
  });

  it('rejects parent-child source and target paths', () => {
    const { source } = createFixture();
    expect(() => runRuntimeDataImport({
      source,
      target: join(source, 'nested-target')
    })).toThrowError(RuntimeImportValidationError);
  });

  it('rejects symbolic links inside the source tree', () => {
    const { source, target } = createFixture();
    const external = join(tempDir, process.platform === 'win32' ? 'external' : 'external.txt');
    if (process.platform === 'win32') {
      mkdirSync(external);
      writeFileSync(join(external, 'outside.txt'), 'outside');
      symlinkSync(external, join(source, 'external-link'), 'junction');
    } else {
      writeFileSync(external, 'outside');
      symlinkSync(external, join(source, 'external-link'));
    }

    expect(() => runRuntimeDataImport({ source, target }))
      .toThrow(/symbolic link/i);
  });

  it('rejects a corrupt SQLite database without changing the source', () => {
    const { source, target } = createFixture(false);
    const databasePath = join(source, 'app.sqlite');
    writeFileSync(databasePath, 'not sqlite');

    expect(() => runRuntimeDataImport({ source, target }))
      .toThrow(/quick_check/i);
  });
});

function createFixture(validDatabase = true): {
  source: string;
  target: string;
} {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-migration-'));
  const source = join(tempDir, 'source');
  const target = join(tempDir, 'target');
  mkdirSync(source);
  if (validDatabase) {
    const database = new DatabaseSync(join(source, 'app.sqlite'));
    database.exec('create table settings (value text not null)');
    database.prepare('insert into settings (value) values (?)').run('ready');
    database.close();
  }
  return { source, target };
}
