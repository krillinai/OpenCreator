import { afterEach, describe, expect, it } from 'vitest';
import { readSavedSkillIds, writeSavedSkillIds } from './skill-market-storage.js';

describe('skill market storage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('reads saved ids from the task storage key', () => {
    window.localStorage.setItem(
      'clawee.skill-market.saved.v1',
      JSON.stringify(['frontend-slides', 'guizang-social-card-skill'])
    );

    expect(readSavedSkillIds()).toEqual([
      'frontend-slides',
      'guizang-social-card-skill',
    ]);
  });

  it('returns an empty list and removes corrupt json values', () => {
    window.localStorage.setItem('clawee.skill-market.saved.v1', '{bad json');

    expect(readSavedSkillIds()).toEqual([]);
    expect(window.localStorage.getItem('clawee.skill-market.saved.v1')).toBeNull();
  });

  it('returns an empty list and removes invalid shapes', () => {
    window.localStorage.setItem(
      'clawee.skill-market.saved.v1',
      JSON.stringify(['frontend-slides', 1, '', null])
    );

    expect(readSavedSkillIds()).toEqual([]);
    expect(window.localStorage.getItem('clawee.skill-market.saved.v1')).toBeNull();
  });

  it('deduplicates, filters empty values, and preserves first-seen order on write', () => {
    writeSavedSkillIds([
      'frontend-slides',
      '',
      'guizang-social-card-skill',
      'frontend-slides',
      '   ',
      'beili-sensor-mini-class',
      'guizang-social-card-skill',
    ]);

    expect(JSON.parse(window.localStorage.getItem('clawee.skill-market.saved.v1') ?? 'null')).toEqual([
      'frontend-slides',
      'guizang-social-card-skill',
      'beili-sensor-mini-class',
    ]);
  });
});
