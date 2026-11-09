import type { SubtitleCue } from './VideoTranslationResultWorkspace.js';

export function subtitleSeconds(value: string): number {
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:[,.](\d{1,3}))?$/.exec(value.trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    + Number((match[4] ?? '').padEnd(3, '0')) / 1000;
}

export function subtitleTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

export function sameSubtitleCues(a: SubtitleCue[], b: SubtitleCue[]): boolean {
  return a.length === b.length && a.every((cue, i) => {
    const other = b[i];
    return other && cue.id === other.id && cue.start === other.start && cue.end === other.end
      && cue.text === other.text && cue.sourceText === other.sourceText;
  });
}

export function retimeSubtitle(cues: SubtitleCue[], id: number, start: number, end: number): SubtitleCue[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || Math.round(end * 1000) - Math.round(start * 1000) < 80) return cues;
  return cues.map(cue => cue.id === id ? { ...cue, start: subtitleTimestamp(start), end: subtitleTimestamp(end) } : cue)
    .sort((a, b) => subtitleSeconds(a.start) - subtitleSeconds(b.start));
}

function splitText(text: string, fraction: number): [string, string] {
  const chars = Array.from(text);
  if (chars.length < 2) return [text, text];
  let at = Math.max(1, Math.min(chars.length - 1, Math.round(chars.length * fraction)));
  // Prefer a word boundary near the temporal split; CJK text can split between characters.
  for (let distance = 0; distance < Math.min(12, chars.length / 3); distance++) {
    const boundary = [at + distance, at - distance].find(i => i > 0 && i < chars.length && /\s/.test(chars[i]!));
    if (boundary !== undefined) { at = boundary; break; }
  }
  return [chars.slice(0, at).join('').trim(), chars.slice(at).join('').trim()];
}

export function splitSubtitle(cues: SubtitleCue[], id: number, time: number): SubtitleCue[] {
  const index = cues.findIndex(cue => cue.id === id);
  const cue = cues[index];
  if (!cue) return cues;
  const start = subtitleSeconds(cue.start), end = subtitleSeconds(cue.end);
  if (!Number.isFinite(time) || time - start < 0.08 || end - time < 0.08) return cues;
  const fraction = (time - start) / (end - start);
  const text = splitText(cue.text, fraction);
  const source = cue.sourceText === undefined ? undefined : splitText(cue.sourceText, fraction);
  const nextId = Math.max(0, ...cues.map(item => item.id)) + 1;
  return [
    ...cues.slice(0, index),
    { ...cue, end: subtitleTimestamp(time), text: text[0], ...(source ? { sourceText: source[0] } : {}) },
    { ...cue, id: nextId, start: subtitleTimestamp(time), text: text[1], ...(source ? { sourceText: source[1] } : {}) },
    ...cues.slice(index + 1)
  ];
}

export function mergeSubtitle(cues: SubtitleCue[], id: number): SubtitleCue[] {
  const index = cues.findIndex(cue => cue.id === id);
  const cue = cues[index], next = cues[index + 1];
  if (!cue || !next) return cues;
  return [...cues.slice(0, index), {
    ...cue,
    start: subtitleTimestamp(Math.min(subtitleSeconds(cue.start), subtitleSeconds(next.start))),
    end: subtitleTimestamp(Math.max(subtitleSeconds(cue.end), subtitleSeconds(next.end))),
    text: [cue.text, next.text].filter(Boolean).join('\n'),
    ...(cue.sourceText !== undefined || next.sourceText !== undefined
      ? { sourceText: [cue.sourceText, next.sourceText].filter(Boolean).join('\n') } : {})
  }, ...cues.slice(index + 2)];
}

export function waveformPeaks(channels: Float32Array[], bins = 2400): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return [];
  const count = Math.min(bins, length);
  return Array.from({ length: count }, (_, bin) => {
    let level = 0;
    const start = Math.floor(bin * length / count), end = Math.floor((bin + 1) * length / count);
    for (const channel of channels) {
      let energy = 0;
      for (let i = start; i < end; i++) {
        const sample = channel[i] ?? 0;
        energy += sample * sample;
      }
      const rms = Math.sqrt(energy / Math.max(1, end - start));
      level = Math.max(level, rms);
    }
    return level;
  });
}
