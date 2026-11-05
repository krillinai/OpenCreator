import type { SubtitleCue } from './VideoTranslationResultWorkspace.js';

export function parseTranscriptionSrt(value: string): SubtitleCue[] {
  return value.replace(/^\uFEFF/, '').split(/\r?\n\r?\n/).flatMap((block, index) => {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) return [];
    const start = lines[timingIndex]?.split('-->')[0]?.trim() ?? '';
    const end = lines[timingIndex]?.split('-->')[1]?.trim() ?? '';
    const text = lines.slice(timingIndex + 1).join('\n').trim();
    const id = Number(lines[timingIndex - 1]?.trim());
    return text ? [{
      id: Number.isSafeInteger(id) && id > 0 ? id : index + 1,
      start,
      end,
      text
    }] : [];
  });
}

export function transcriptionSrtToText(value: string): string {
  return parseTranscriptionSrt(value).map(cue => cue.text).join('\n');
}
