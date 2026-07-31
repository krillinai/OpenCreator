import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEnterpriseInstallRecordRepository
} from '../../src/enterprise/install-records-2026-07-30.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { force: true, recursive: true });
  tempDir = '';
});

describe('enterprise skill install records', () => {
  it('migrates enterprise install records without adding credential columns', () => {
    openDatabase();

    expect(columnNames(db!, 'enterprise_skill_installs')).toEqual([
      'skill_id',
      'name',
      'version_id',
      'version',
      'package_sha256',
      'installed_content_sha256',
      'installed_at',
      'updated_at'
    ]);
    expect(
      db!.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_enterprise_skill_installs_updated_at'
      `).get()
    ).toEqual({ name: 'idx_enterprise_skill_installs_updated_at' });
    expect(columnNames(db!, 'enterprise_skill_installs')).not.toEqual(
      expect.arrayContaining([
        'access_token',
        'authorization',
        'cookie',
        'password'
      ])
    );
  });

  it('upserts and queries records by remote id and local name', () => {
    openDatabase();
    const records = createEnterpriseInstallRecordRepository(db!);

    const inserted = records.upsertRecord(recordInput({
      skillId: 'skill_1',
      name: 'code-review'
    }));
    expect(inserted).toMatchObject({
      skillId: 'skill_1',
      name: 'code-review',
      versionId: 'version_1',
      packageSha256: 'a'.repeat(64),
      installedContentSha256: 'b'.repeat(64)
    });
    expect(records.getBySkillId('skill_1')).toEqual(inserted);
    expect(records.getByName('code-review')).toEqual(inserted);
    expect(records.listRecords()).toEqual([inserted]);
  });

  it('preserves the previous enterprise record when an atomic upsert aborts', () => {
    openDatabase();
    const records = createEnterpriseInstallRecordRepository(db!);
    const previous = records.upsertRecord(recordInput({
      skillId: 'skill_1',
      name: 'code-review'
    }));
    db!.exec(`
      CREATE TRIGGER abort_enterprise_update
      BEFORE UPDATE ON enterprise_skill_installs
      BEGIN
        SELECT RAISE(ABORT, 'forced enterprise update failure');
      END;
      CREATE TRIGGER abort_enterprise_insert
      BEFORE INSERT ON enterprise_skill_installs
      WHEN NEW.skill_id = 'skill_2'
      BEGIN
        SELECT RAISE(ABORT, 'forced enterprise insert failure');
      END;
    `);

    expect(() => records.upsertRecord(recordInput({
      skillId: 'skill_1',
      name: 'code-review',
      versionId: 'version_2',
      version: '2.0',
      packageSha256: 'c'.repeat(64),
      installedContentSha256: 'd'.repeat(64)
    }))).toThrow('forced enterprise update failure');
    expect(records.getBySkillId('skill_1')).toEqual(previous);

    expect(() => records.upsertRecord(recordInput({
      skillId: 'skill_2',
      name: 'new-skill'
    }))).toThrow('forced enterprise insert failure');
    expect(records.getBySkillId('skill_2')).toBeUndefined();
  });
});

function openDatabase(): void {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-records-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
}

function recordInput(overrides: Record<string, string> = {}) {
  return {
    skillId: 'skill_1',
    name: 'code-review',
    versionId: 'version_1',
    version: '1.0',
    packageSha256: 'a'.repeat(64),
    installedContentSha256: 'b'.repeat(64),
    ...overrides
  };
}

function columnNames(database: Database.Database, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map(row => row.name);
}
