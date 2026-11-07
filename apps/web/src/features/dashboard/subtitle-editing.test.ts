import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from './VideoTranslationResultWorkspace.js';
import { mergeSubtitle, retimeSubtitle, sameSubtitleCues, splitSubtitle, subtitleSeconds, subtitleTimestamp, waveformPeaks } from './subtitle-editing.js';

const cues: SubtitleCue[] = [
  { id: 4, start: '00:00:01,250', end: '00:00:05,750', text: 'Hello world, welcome home.', sourceText: '你好世界，欢迎回家。' },
  { id: 9, start: '00:00:06,000', end: '00:00:08,000', text: 'Next sentence.', sourceText: '下一句。' }
];

describe('subtitle editing', () => {
  it('round-trips millisecond boundaries and long recordings without rolling seconds past 59', () => {
    for (const value of [0, .001, 59.999, 60, 3599.999, 3600, 90061.123]) expect(subtitleSeconds(subtitleTimestamp(value))).toBeCloseTo(value, 3);
    expect(subtitleTimestamp(59.9996)).toBe('00:01:00,000');
    expect(subtitleSeconds('00:61:00,000')).toBeNaN();
    expect(subtitleSeconds('00:00:01.25')).toBe(1.25);
  });

  it('rejects invalid intervals and preserves text and identity during retiming', () => {
    for (const [start, end] of [[-1, 5], [4, 4], [5, 4], [Number.NaN, 5], [0, .01]]) expect(retimeSubtitle(cues, 4, start!, end!)).toBe(cues);
    const retimed = retimeSubtitle(cues, 4, 2.125, 5.625);
    expect(retimed[0]).toEqual({ ...cues[0], start: '00:00:02,125', end: '00:00:05,625' });
    expect(cues[0]!.start).toBe('00:00:01,250');
    expect(sameSubtitleCues(cues, retimed)).toBe(false);
  });

  it('splits both languages at one boundary with a fresh ID, retaining every word', () => {
    const split = splitSubtitle(cues, 4, 3.5);
    expect(split).toHaveLength(3);
    expect(split[0]!.end).toBe(split[1]!.start);
    expect(split[0]!.end).toBe('00:00:03,500');
    expect(split[1]!.id).toBe(10);
    expect(split[0]!.text + ' ' + split[1]!.text).toBe(cues[0]!.text);
    expect(split[0]!.sourceText! + split[1]!.sourceText!).toBe(cues[0]!.sourceText);
    expect(split[2]).toBe(cues[1]);
    expect(splitSubtitle(cues, 4, 1.25)).toBe(cues);
    expect(splitSubtitle(cues, 4, 7)).toBe(cues);
  });

  it('merges nested or overlapping intervals without losing their duration or bilingual text', () => {
    const nested = [cues[0]!, { ...cues[1]!, start: '00:00:02,000', end: '00:00:03,000' }];
    const merged = mergeSubtitle(nested, 4);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.end).toBe('00:00:05,750');
    expect(merged[0]!.text).toBe(cues.map(cue => cue.text).join('\n'));
    expect(merged[0]!.sourceText).toBe(cues.map(cue => cue.sourceText).join('\n'));
    expect(mergeSubtitle(cues, 9)).toBe(cues);
  });

  it('detects structural and source edits, including reordering and changed IDs', () => {
    expect(sameSubtitleCues(cues, cues.map(cue => ({ ...cue })))).toBe(true);
    expect(sameSubtitleCues(cues, [...cues].reverse())).toBe(false);
    expect(sameSubtitleCues(cues, [{ ...cues[0]!, sourceText: 'Changed' }, cues[1]!])).toBe(false);
    expect(sameSubtitleCues(cues, splitSubtitle(cues, 4, 3))).toBe(false);
  });

  it('uses RMS energy from every channel and keeps silent audio flat', () => {
    expect(waveformPeaks([new Float32Array([0, -.8, 0, 0]), new Float32Array([0, 0, 0, .5])], 2)).toEqual([
      expect.closeTo(.8 / Math.sqrt(2)), expect.closeTo(.5 / Math.sqrt(2))
    ]);
    expect(waveformPeaks([new Float32Array(10)], 4)).toEqual([0, 0, 0, 0]);
    expect(waveformPeaks([])).toEqual([]);
  });
});
