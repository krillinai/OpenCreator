import { readFile, writeFile } from 'node:fs/promises';
import { Converter } from 'opencc-js/t2cn';

type SubtitleOutput = {
  kind: string;
  path: string;
};

type NormalizeOptions = {
  originLanguage?: unknown;
  targetLanguage?: unknown;
  bilingualTop: boolean;
};

const toSimplified = Converter({ from: 't', to: 'cn' });

export async function normalizeSimplifiedChineseSubtitleOutputs(
  outputs: readonly SubtitleOutput[],
  options: NormalizeOptions
): Promise<void> {
  const sourceNeedsNormalization = isSimplifiedChinese(options.originLanguage);
  const targetNeedsNormalization = isSimplifiedChinese(options.targetLanguage);
  if (!sourceNeedsNormalization && !targetNeedsNormalization) return;

  const source = outputs.find(output => output.kind === 'source_subtitle');
  const target = outputs.find(output => output.kind === 'target_subtitle');
  const [sourceText, targetText] = await Promise.all([
    source === undefined ? undefined : readFile(source.path, 'utf8'),
    target === undefined ? undefined : readFile(target.path, 'utf8')
  ]);
  const sourceKeys = new Set(sourceText === undefined ? [] : subtitleTextKeys(sourceText));
  const targetKeys = new Set(targetText === undefined ? [] : subtitleTextKeys(targetText));

  await Promise.all(outputs
    .filter(output => ['source_subtitle', 'target_subtitle', 'bilingual_subtitle', 'vertical_subtitle'].includes(output.kind))
    .map(async output => {
      const content = output.kind === 'source_subtitle' && sourceText !== undefined
        ? sourceText
        : output.kind === 'target_subtitle' && targetText !== undefined
          ? targetText
          : await readFile(output.path, 'utf8');
      const role = output.kind === 'source_subtitle'
        ? sourceNeedsNormalization ? 'source' : 'none'
        : output.kind === 'target_subtitle'
          ? targetNeedsNormalization ? 'target' : 'none'
          : 'mixed';
      const normalized = normalizeSrtContent(content, {
        role,
        kind: output.kind === 'vertical_subtitle' ? 'vertical_subtitle' : 'bilingual_subtitle',
        sourceKeys,
        targetKeys,
        bilingualTop: options.bilingualTop,
        sourceNeedsNormalization,
        targetNeedsNormalization
      });
      if (normalized !== content) await writeFile(output.path, normalized, 'utf8');
    }));
}

export function normalizeSrtContent(
  content: string,
  options: {
    role: 'source' | 'target' | 'mixed' | 'none';
    kind?: 'bilingual_subtitle' | 'vertical_subtitle';
    sourceKeys?: ReadonlySet<string>;
    targetKeys?: ReadonlySet<string>;
    bilingualTop?: boolean;
    sourceNeedsNormalization?: boolean;
    targetNeedsNormalization?: boolean;
  }
): string {
  if (options.role === 'none') return content;
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  for (let index = 0; index + 2 < lines.length;) {
    const cueIndex = lines[index];
    const timestamp = lines[index + 1];
    if (cueIndex === undefined || timestamp === undefined
      || !/^\d+$/.test(cueIndex.trim()) || !isSrtTimestampLine(timestamp)) {
      index++;
      continue;
    }
    let end = index + 2;
    while (end < lines.length && lines[end]?.trim() !== '') end++;
    const textLines = lines.slice(index + 2, end);
    for (let offset = 0; offset < textLines.length; offset++) {
      const textLine = textLines[offset];
      if (textLine === undefined) continue;
      const key = subtitleTextKey(textLine);
      let shouldNormalize = options.role === 'source'
        ? options.sourceNeedsNormalization === true
        : options.role === 'target'
          ? options.targetNeedsNormalization === true
          : false;
      if (options.role === 'mixed') {
        const isSource = subtitleKeyMatches(options.sourceKeys, key);
        const isTarget = subtitleKeyMatches(options.targetKeys, key);
        if (isSource && !isTarget) shouldNormalize = options.sourceNeedsNormalization === true;
        else if (isTarget && !isSource) shouldNormalize = options.targetNeedsNormalization === true;
        else if (options.kind === 'vertical_subtitle' && textLines.length === 1) {
          shouldNormalize = options.sourceNeedsNormalization === true;
        }
        else {
          const targetOffset = options.bilingualTop === false ? textLines.length - 1 : 0;
          shouldNormalize = offset === targetOffset
            ? options.targetNeedsNormalization === true
            : options.sourceNeedsNormalization === true;
        }
      }
      if (shouldNormalize) lines[index + 2 + offset] = toSimplified(textLine);
    }
    index = end;
  }
  const result = lines.join(lineEnding);
  return content.endsWith(lineEnding) && !result.endsWith(lineEnding) ? `${result}${lineEnding}` : result;
}

function subtitleTextKeys(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const keys: string[] = [];
  for (let index = 0; index + 2 < lines.length;) {
    const cueIndex = lines[index];
    const timestamp = lines[index + 1];
    if (cueIndex === undefined || timestamp === undefined
      || !/^\d+$/.test(cueIndex.trim()) || !isSrtTimestampLine(timestamp)) {
      index++;
      continue;
    }
    let end = index + 2;
    while (end < lines.length && lines[end]?.trim() !== '') end++;
    for (const line of lines.slice(index + 2, end)) {
      const key = subtitleTextKey(line);
      if (key) keys.push(key);
    }
    index = end;
  }
  return keys;
}

function subtitleTextKey(value: string): string {
  return value.replace(/<[^>]+>|\{\\[^}]+\}/g, '').trim();
}

function subtitleKeyMatches(keys: ReadonlySet<string> | undefined, value: string): boolean {
  if (value === '' || keys === undefined) return false;
  for (const key of keys) {
    if (key === value || key.includes(value) || value.includes(key)) return true;
  }
  return false;
}

function isSrtTimestampLine(value: string): boolean {
  return /^\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(value);
}

function isSimplifiedChinese(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase().replace('-', '_');
  return normalized === 'zh_cn' || normalized === 'zh_hans';
}
