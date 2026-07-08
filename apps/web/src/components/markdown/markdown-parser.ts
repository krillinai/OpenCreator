export type TableAlign = 'left' | 'right' | 'center' | null;

export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'unordered-list'; items: string[] }
  | { kind: 'ordered-list'; items: string[] }
  | { kind: 'blockquote'; text: string }
  | { kind: 'code'; lang: string | null; body: string }
  | { kind: 'table'; headers: string[]; aligns: TableAlign[]; rows: string[][] }
  | { kind: 'hr' };

function isHeading(line: string): boolean {
  return /^(#{1,4})\s+/.test(line);
}

function isHr(line: string): boolean {
  return /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isUnorderedList(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line);
}

function isOrderedList(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}

function isBlockquote(line: string): boolean {
  return /^\s*>\s?/.test(line);
}

function isFence(line: string): RegExpExecArray | null {
  return /^```([A-Za-z0-9_+-]+)?\s*$/.exec(line);
}

export function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  let index = 0;

  while (line[index] === ' ') index++;
  if (line[index] === '|') index++;

  for (; index < line.length; index++) {
    const char = line[index]!;
    if (char === '\\' && line[index + 1] === '|') {
      current += '|';
      index++;
      continue;
    }
    if (char === '`') {
      inCode = !inCode;
      current += char;
      continue;
    }
    if (char === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  const tail = current.trim();
  if (cells.length === 0 || tail !== '') cells.push(tail);
  return cells;
}

export function parseTableAlignRow(line: string): TableAlign[] | null {
  if (!line.includes('|')) return null;
  const cells = splitTableCells(line);
  if (cells.length === 0) return null;

  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-{1,}:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return aligns;
}

function isTableStartAt(lines: string[], index: number): boolean {
  const header = lines[index];
  const separator = lines[index + 1];
  if (header === undefined || separator === undefined) return false;
  if (!header.includes('|')) return false;
  return parseTableAlignRow(separator) !== null;
}

function isParagraphBoundary(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (line.trim() === '') return true;
  if (isFence(line)) return true;
  if (isHeading(line)) return true;
  if (isHr(line)) return true;
  if (isUnorderedList(line)) return true;
  if (isOrderedList(line)) return true;
  if (isBlockquote(line)) return true;
  return isTableStartAt(lines, index);
}

export function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index++;
      continue;
    }

    const fence = isFence(line);
    if (fence) {
      const lang = fence[1] ?? null;
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index++;
      }
      if (index < lines.length) index++;
      blocks.push({ kind: 'code', lang, body: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3 | 4,
        text: heading[2]!
      });
      index++;
      continue;
    }

    if (isHr(line)) {
      blocks.push({ kind: 'hr' });
      index++;
      continue;
    }

    if (isBlockquote(line)) {
      const body: string[] = [];
      while (index < lines.length && isBlockquote(lines[index] ?? '')) {
        body.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index++;
      }
      blocks.push({ kind: 'blockquote', text: body.join('\n') });
      continue;
    }

    if (isUnorderedList(line)) {
      const items: string[] = [];
      while (index < lines.length && isUnorderedList(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*+]\s+/, ''));
        index++;
      }
      blocks.push({ kind: 'unordered-list', items });
      continue;
    }

    if (isTableStartAt(lines, index)) {
      const headers = splitTableCells(lines[index] ?? '');
      const aligns = parseTableAlignRow(lines[index + 1] ?? '') ?? [];
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = lines[index] ?? '';
        if (row.trim() === '' || !row.includes('|')) break;
        rows.push(splitTableCells(row));
        index++;
      }
      blocks.push({ kind: 'table', headers, aligns, rows });
      continue;
    }

    if (isOrderedList(line)) {
      const items: string[] = [];
      while (index < lines.length && isOrderedList(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''));
        index++;
      }
      blocks.push({ kind: 'ordered-list', items });
      continue;
    }

    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && !isParagraphBoundary(lines, index)) {
      paragraph.push(lines[index] ?? '');
      index++;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }

  return blocks;
}
