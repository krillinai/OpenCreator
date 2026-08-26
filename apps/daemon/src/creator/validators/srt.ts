import { readFile } from 'node:fs/promises';

export type SrtCue = { index: number; startMs: number; endMs: number; text: string };
export type ParseSrtOptions = { allowOverlaps?: boolean };

export async function validateSrtFile(path: string, options: ParseSrtOptions = {}): Promise<SrtCue[]> {
  return parseSrt(await readFile(path, 'utf8'), options);
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
  const parts = value.replace(',', '.').split(':');
  return Number(parts[0]) * 3_600_000 + Number(parts[1]) * 60_000 + Number(parts[2]) * 1_000;
}
