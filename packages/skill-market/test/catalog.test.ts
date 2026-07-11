import { describe, expect, it } from 'vitest';
import {
  getSkillMarketEntry,
  skillMarketCatalog,
  skillMarketCategories,
  skillMarketSourceCommit,
} from '../src/index.js';

describe('skill market catalog', () => {
  it('contains the reviewed 55-entry snapshot with unique ids', () => {
    expect(skillMarketCatalog).toHaveLength(55);
    expect(new Set(skillMarketCatalog.map((entry) => entry.id)).size).toBe(55);
  });

  it('only enables the six reviewed root skills', () => {
    expect(
      skillMarketCatalog
        .filter((entry) => entry.install.available)
        .map((entry) => entry.id)
        .sort()
    ).toEqual([
      'biliup',
      'codebase-to-course',
      'follow-builders',
      'frontend-slides',
      'guizang-social-card-skill',
      'op7418-humanizer-zh',
    ]);
  });

  it('pins the reviewed installable entries to the exact source snapshot', () => {
    expect(skillMarketSourceCommit).toBe(
      '91302f79937b8f4e194e56554afdbb2ca939a1d5'
    );

    expect(getSkillMarketEntry('biliup')?.install).toEqual({
      available: true,
      repository: 'biliup/biliup',
      skillPath: '.',
      commit: '18c5bf086e943e07e9d88a905d2e5d407d6305bb',
      marketRevision: 1,
    });

    expect(getSkillMarketEntry('codebase-to-course')?.install).toEqual({
      available: true,
      repository: 'zarazhangrui/codebase-to-course',
      skillPath: '.',
      commit: 'ff8837ecf8e9f6ce9874ffa42e42633394a52a00',
      marketRevision: 1,
    });

    expect(getSkillMarketEntry('follow-builders')?.install).toEqual({
      available: true,
      repository: 'zarazhangrui/follow-builders',
      skillPath: '.',
      commit: 'aa6769f2a0be11fe663c4594a48d9679075f06c1',
      marketRevision: 1,
    });

    expect(getSkillMarketEntry('frontend-slides')?.install).toEqual({
      available: true,
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      marketRevision: 1,
    });

    expect(getSkillMarketEntry('guizang-social-card-skill')?.install).toEqual({
      available: true,
      repository: 'op7418/guizang-social-card-skill',
      skillPath: '.',
      commit: 'cf4b810fac1c73fb65a2bb31d8c9278d82cbc4c5',
      marketRevision: 1,
    });

    expect(getSkillMarketEntry('op7418-humanizer-zh')?.install).toEqual({
      available: true,
      repository: 'op7418/Humanizer-zh',
      skillPath: '.',
      commit: '91f3d394db8419c20d67ebe22a96cf8fee0a404b',
      marketRevision: 1,
    });
  });

  it('marks garrytan-gstack as an unsafe archive', () => {
    expect(getSkillMarketEntry('garrytan-gstack')?.install).toEqual({
      available: false,
      reason: 'unsafe_archive',
    });
  });

  it('deep-freezes catalog and category data without mutating the JSON-derived snapshot', () => {
    const entry = skillMarketCatalog.find((candidate) => candidate.examples.length > 0);
    expect(entry).toBeDefined();
    expect(Object.isFrozen(skillMarketCatalog)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry?.platforms)).toBe(true);
    expect(Object.isFrozen(entry?.tasks)).toBe(true);
    expect(Object.isFrozen(entry?.creator)).toBe(true);
    expect(Object.isFrozen(entry?.examples)).toBe(true);
    expect(Object.isFrozen(entry?.examples[0])).toBe(true);
    expect(Object.isFrozen(entry?.inputs)).toBe(true);
    expect(Object.isFrozen(entry?.outputs)).toBe(true);
    expect(Object.isFrozen(entry?.risks)).toBe(true);
    expect(Object.isFrozen(entry?.risks.notes)).toBe(true);
    expect(Object.isFrozen(entry?.install)).toBe(true);
    expect(Object.isFrozen(skillMarketCategories)).toBe(true);
    expect(Object.isFrozen(skillMarketCategories[0])).toBe(true);
  });
});
