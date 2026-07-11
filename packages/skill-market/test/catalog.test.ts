import { describe, expect, it } from 'vitest';
import { skillMarketCatalog } from '../src/index.js';

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

  it('pins every installable entry to a full commit and positive revision', () => {
    for (const entry of skillMarketCatalog) {
      if (!entry.install.available) continue;
      expect(entry.install.repository).toMatch(/^[^/]+\/[^/]+$/);
      expect(entry.install.skillPath).toBe('.');
      expect(entry.install.commit).toMatch(/^[a-f0-9]{40}$/);
      expect(entry.install.marketRevision).toBeGreaterThan(0);
    }
  });
});
