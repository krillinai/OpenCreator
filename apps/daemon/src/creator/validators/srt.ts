import { readFile } from 'node:fs/promises';

export type SrtCue = { index: number; startMs: number; endMs: number; text: string };
export type ParseSrtOptions = { allowOverlaps?: boolean };

export async function validateSrtFile(path: string, options: ParseSrtOptions = {}): Promise<SrtCue[]> {
  return parseSrt(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)), options);
}

export function parseSrt(content: string, options: ParseSrtOptions = {}): SrtCue[] {
  const blocks = content.replace(/^\uFEFF/, '').trim().split(/\r?\n\r?\n+/);
  if (blocks.length === 0 || (blocks.length === 1 && blocks[0] === '')) throw new Error('invalid_srt: empty subtitle');
  let previousEnd = -1;
  return blocks.map((block, offset) => {
    const lines = block.split(/\r?\n/);
    const index = Number(lines.shift());
    const timing = lines.shift()?.match(/^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})$/);
    const text = lines.join('\n').trim();
    if (!Number.isInteger(index) || index <= 0 || !timing || !text) throw new Error(`invalid_srt: cue ${offset + 1}`);
    const startMs = timestamp(timing[1]!);
    const endMs = timestamp(timing[2]!);
    if (endMs <= startMs || (!options.allowOverlaps && startMs < previousEnd)) {
      throw new Error(`invalid_srt: timeline ${offset + 1}`);
    }
    previousEnd = Math.max(previousEnd, endMs);
    return { index, startMs, endMs, text };
  });
}

function timestamp(value: string): number {
  const [hours, minutes, seconds, milliseconds] = value.split(/[:,.]/).map(Number);
  if (minutes! >= 60 || seconds! >= 60) throw new Error('invalid_srt: timestamp out of range');
  return hours! * 3_600_000 + minutes! * 60_000 + seconds! * 1_000 + milliseconds!;
}

export function formatSrtTimestamp(value: number): string {
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const milliseconds = value % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}
