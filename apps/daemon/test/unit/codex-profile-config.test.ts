import { describe, expect, it } from 'vitest';
import {
  isValidProfileName,
  parseCodexProfileOverlay,
  profileNameFromFileName,
  validateProfileConfig
} from '../../src/codex/profiles/config.js';

describe('codex profile config parser', () => {
  it('parses a profile overlay file', () => {
    const result = parseCodexProfileOverlay('review', [
      'model = "gpt-5.3-codex"',
      'model_reasoning_effort = "medium"',
      ''
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected parser success');
    expect(result.profile).toEqual(expect.objectContaining({
      name: 'review',
      status: 'valid',
      config: {
        model: 'gpt-5.3-codex',
        model_reasoning_effort: 'medium'
      },
      source: 'review.config.toml'
    }));
  });

  it('returns diagnostics for invalid toml without throwing', () => {
    const result = parseCodexProfileOverlay('review', 'model = "x');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected parser failure');
    expect(result.diagnostics[0]).toContain('Failed to parse');
  });

  it('returns diagnostics for invalid profile names without throwing', () => {
    let result: ReturnType<typeof parseCodexProfileOverlay> | undefined;

    expect(() => {
      result = parseCodexProfileOverlay('../secret', 'model = "x"');
    }).not.toThrow();

    expect(result?.ok).toBe(false);
    expect(result?.profile.status).toBe('invalid');
    expect(result?.profile.source).toBe('invalid.config.toml');
    expect(result?.diagnostics[0]).toContain('invalid profile name');
  });

  it('validates profile names', () => {
    expect(isValidProfileName('default')).toBe(true);
    expect(isValidProfileName('review-1')).toBe(true);
    expect(isValidProfileName('team.alpha')).toBe(true);
    expect(isValidProfileName('')).toBe(false);
    expect(isValidProfileName('../secret')).toBe(false);
    expect(isValidProfileName('bad/name')).toBe(false);
  });

  it('maps only profile overlay file names to profile names', () => {
    expect(profileNameFromFileName('review.config.toml')).toBe('review');
    expect(profileNameFromFileName('team.alpha.config.toml')).toBe('team.alpha');
    expect(profileNameFromFileName('config.toml')).toBeUndefined();
    expect(profileNameFromFileName('review.config.toml.tmp')).toBeUndefined();
    expect(profileNameFromFileName('../secret.config.toml')).toBeUndefined();
  });

  it('rejects nested profile values in R3 first version', () => {
    expect(validateProfileConfig({ model: 'gpt-5.3-codex', effort: 'high' }).ok).toBe(true);
    expect(validateProfileConfig({ enabled: true, count: 2 }).ok).toBe(true);
    expect(validateProfileConfig({ tags: ['a', 'b'] }).ok).toBe(true);
    expect(validateProfileConfig({ counts: [1, 2] }).ok).toBe(true);
    expect(validateProfileConfig({ ratios: [1.5, 2.5] }).ok).toBe(true);
    expect(validateProfileConfig({ flags: [true, false] }).ok).toBe(true);
    expect(validateProfileConfig({ empty: [] }).ok).toBe(true);
    expect(validateProfileConfig({ mixed: ['writer', 3, false] }).ok).toBe(false);
    expect(validateProfileConfig({ mixedNumbers: [1, 2.5] }).ok).toBe(false);
    expect(validateProfileConfig({ nan: Number.NaN }).ok).toBe(false);
    expect(validateProfileConfig({ infinity: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(validateProfileConfig({ negativeInfinity: Number.NEGATIVE_INFINITY }).ok).toBe(false);
    expect(validateProfileConfig({ arrayNan: [Number.NaN] }).ok).toBe(false);
    expect(validateProfileConfig({ arrayInfinity: [Number.POSITIVE_INFINITY] }).ok).toBe(false);
    expect(validateProfileConfig({ nested: { bad: true } }).ok).toBe(false);
  });
});
