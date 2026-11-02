import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeSimplifiedChineseSubtitleOutputs,
  normalizeSrtContent
} from '../../src/creator/krillin/subtitle-script.js';

const sourceSrt = `1\n00:00:00,000 --> 00:00:02,000\n這個濾光片的功能就是\n`;

describe('creator subtitle script normalization', () => {
  it('converts a zh_cn source subtitle to simplified Chinese', () => {
    expect(normalizeSrtContent(sourceSrt, {
      role: 'source',
      sourceNeedsNormalization: true
    })).toContain('这个滤光片的功能就是');
  });

  it('normalizes only the source line in a bilingual cue', () => {
    const mixed = `1\n00:00:00,000 --> 00:00:02,000\nThe filter works like this.\n這個濾光片的功能就是\n`;
    expect(normalizeSrtContent(mixed, {
      role: 'mixed',
      sourceKeys: new Set(['這個濾光片的功能就是']),
      targetKeys: new Set(['The filter works like this.']),
      bilingualTop: true,
      sourceNeedsNormalization: true,
      targetNeedsNormalization: false
    })).toContain('The filter works like this.\n这个滤光片的功能就是');
  });

  it('normalizes a short source fragment in a vertical subtitle cue', () => {
    const shortMixed = `1\n00:00:00,000 --> 00:00:01,000\n管帽管壳與管帽\n`;
    expect(normalizeSrtContent(shortMixed, {
      role: 'mixed',
      kind: 'vertical_subtitle',
      sourceKeys: new Set(['管帽管壳與管帽結合在一起的彩色部分']),
      targetKeys: new Set(['The colored section']),
      sourceNeedsNormalization: true,
      targetNeedsNormalization: false
    })).toContain('管帽管壳与管帽');
  });

  it('leaves traditional Chinese untouched when it is the selected language', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'creator-subtitle-script-'));
    const path = join(directory, 'source.srt');
    try {
      await writeFile(path, sourceSrt, 'utf8');
      await normalizeSimplifiedChineseSubtitleOutputs([{ kind: 'source_subtitle', path }], {
        originLanguage: 'zh_tw',
        targetLanguage: 'en',
        bilingualTop: true
      });
      await expect(readFile(path, 'utf8')).resolves.toBe(sourceSrt);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
