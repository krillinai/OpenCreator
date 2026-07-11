import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createSkillMarketRecordRepository } from '../../src/codex/skills/market-records.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skill market records', () => {
  it('upserts a record and loads it by skill id', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skill-market-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const records = createSkillMarketRecordRepository(db);

    const inserted = records.upsertRecord({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      marketRevision: 1
    });

    expect(inserted).toMatchObject({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      marketRevision: 1
    });
    expect(records.getRecord('frontend-slides')).toEqual(inserted);
    expect(records.getRecord('missing-skill')).toBeUndefined();
  });

  it('preserves installedAt and refreshes updatedAt on upsert conflict', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skill-market-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const records = createSkillMarketRecordRepository(db);

    const first = records.upsertRecord({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      marketRevision: 1
    });

    db.prepare(`
      UPDATE codex_skill_market_installs
      SET updated_at = ?
      WHERE skill_id = ?
    `).run('2000-01-01 00:00:00', 'frontend-slides');

    const updated = records.upsertRecord({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      skillPath: 'skills/frontend-slides',
      commit: 'c5b08f7ab26c4ef4d7cd58f8957ed6d6ae7a3df2',
      marketRevision: 2
    });

    expect(updated.installedAt).toBe(first.installedAt);
    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00');
    expect(updated).toMatchObject({
      skillId: 'frontend-slides',
      skillPath: 'skills/frontend-slides',
      commit: 'c5b08f7ab26c4ef4d7cd58f8957ed6d6ae7a3df2',
      marketRevision: 2
    });
  });

  it('lists records ordered by updatedAt desc and skillId asc', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skill-market-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const records = createSkillMarketRecordRepository(db);

    records.upsertRecord({
      skillId: 'beta-skill',
      repository: 'owner/beta-skill',
      skillPath: '.',
      commit: '1111111111111111111111111111111111111111',
      marketRevision: 1
    });
    records.upsertRecord({
      skillId: 'alpha-skill',
      repository: 'owner/alpha-skill',
      skillPath: '.',
      commit: '2222222222222222222222222222222222222222',
      marketRevision: 3
    });

    db.prepare(`
      UPDATE codex_skill_market_installs
      SET updated_at = CASE skill_id
        WHEN 'alpha-skill' THEN '2026-07-11 00:00:02'
        WHEN 'beta-skill' THEN '2026-07-11 00:00:01'
      END
    `).run();

    expect(records.listRecords().map(record => record.skillId)).toEqual([
      'alpha-skill',
      'beta-skill'
    ]);
  });
});
