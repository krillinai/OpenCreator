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
    expect(skillMarketCatalog.every((entry) => /^[\w.-]+\/[\w.-]+$/.test(entry.githubRepository))).toBe(true);
    expect(getSkillMarketEntry('invokeai')?.githubRepository).toBe('invoke-ai/InvokeAI');
  });

  it('provides a Codex Skill Installer source for every catalog entry', () => {
    expect(
      skillMarketCatalog.filter((entry) => {
        const install = entry.install as unknown as Record<string, unknown>;
        return (
          install.repository !== entry.githubRepository ||
          typeof install.skillPath !== 'string' ||
          install.skillPath.trim().length === 0 ||
          typeof install.ref !== 'string' ||
          install.ref.trim().length === 0 ||
          install.marketRevision !== 1
        );
      })
    ).toEqual([]);
  });

  it('provides current GitHub-hosted examples for the detail gallery', () => {
    const examples = skillMarketCatalog.flatMap((entry) => entry.examples);
    const frontendSlides = getSkillMarketEntry('frontend-slides');

    expect(examples.length).toBeGreaterThan(6);
    expect(examples.every((example) => (
      example.url.startsWith('https://raw.githubusercontent.com/')
      || example.url.startsWith('https://github.com/user-attachments/')
    ))).toBe(true);
    expect(frontendSlides?.examples).toHaveLength(3);
    expect(frontendSlides?.examples[0]?.url).toContain(
      'zarazhangrui/beautiful-html-templates/main/screenshots/'
    );
  });

  it('uses the catalog repository and default branch as the install source', () => {
    expect(skillMarketSourceCommit).toBe(
      '91302f79937b8f4e194e56554afdbb2ca939a1d5'
    );

    expect(getSkillMarketEntry('biliup')?.install).toEqual({
      repository: 'biliup/biliup',
      skillPath: '.',
      ref: 'master',
      marketRevision: 1,
    });

    expect(getSkillMarketEntry('frontend-slides')?.install).toEqual({
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      ref: 'main',
      marketRevision: 1,
    });

    expect(getSkillMarketEntry('garrytan-gstack')?.install).toEqual({
      repository: 'garrytan/gstack',
      skillPath: '.',
      ref: 'main',
      marketRevision: 1,
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
