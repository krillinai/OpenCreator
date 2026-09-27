import type { CreatorJson } from '@opencreator/protocol';
import { open } from 'node:fs/promises';
import { validateSrtFile } from './validators/srt.js';
import type {
  CreatorOutputValidationFinding,
  CreatorStageOutputValidator
} from './templates/types.js';

const MIN_MEANINGFUL_CHARACTERS = 8;
const MIN_CHINESE_RATIO = 0.2;

export class CreatorOutputValidationError extends Error {
  constructor(
    readonly finding: CreatorOutputValidationFinding
  ) {
    super(finding.message);
    this.name = 'CreatorOutputValidationError';
  }

  get code(): string {
    return this.finding.code;
  }
}

export async function validateCreatorStageOutputs(input: Parameters<CreatorStageOutputValidator>[0]) {
  const findings: CreatorOutputValidationFinding[] = await validateCompletedOutputFiles(input);
  for (const validator of input.stage.outputValidators ?? []) {
    findings.push(...await validator(input));
  }
  return findings;
}

async function validateCompletedOutputFiles(
  input: Parameters<CreatorStageOutputValidator>[0]
): Promise<CreatorOutputValidationFinding[]> {
  const findings: CreatorOutputValidationFinding[] = [];
  for (const output of input.candidateOutputs) {
    if (output.status !== 'completed' || output.path === null) continue;
    try {
      const handle = await open(output.path, 'r');
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size <= 0) {
          findings.push({
            code: 'creator_output_file_empty',
            severity: 'blocking',
            message: '生成的输出文件为空，请重新执行当前步骤。',
            evidence: { artifactKind: output.kind }
          });
          continue;
        }
        await handle.read(Buffer.alloc(1), 0, 1, 0);
      } finally {
        await handle.close();
      }
    } catch {
      findings.push({
        code: 'creator_output_file_unreadable',
        severity: 'blocking',
        message: '生成的输出文件无法读取，请重新执行当前步骤。',
        evidence: { artifactKind: output.kind }
      });
    }
  }
  return findings;
}

export const validateTranslationOutputLanguage: CreatorStageOutputValidator = async input => {
  const targetLanguage = readLanguage(input.job.state.targetLanguage);
  const sourceLanguage = readLanguage(input.job.state.sourceLanguage);
  if (!isChinese(targetLanguage) || targetLanguage === sourceLanguage) return [];
  const target = input.candidateOutputs.find(output => (
    output.kind === 'target_subtitle' && output.status === 'completed'
  ));
  if (target?.path === null || target?.path === undefined) return [];

  let targetText: string;
  try {
    const cues = await validateSrtFile(target.path, { allowOverlaps: true });
    targetText = cues.map(cue => cue.text).join('\n');
  } catch {
    return [{
      code: 'creator_translation_output_invalid',
      severity: 'blocking',
      message: '翻译字幕文件无法解析，请重新生成。',
      evidence: { artifactKind: 'target_subtitle' }
    }];
  }

  const metrics = languageMetrics(targetText);
  if (
    metrics.meaningfulCharacters < MIN_MEANINGFUL_CHARACTERS
      ? metrics.hanCharacters > 0
      : metrics.chineseRatio >= MIN_CHINESE_RATIO
  ) return [];

  const source = input.candidateOutputs.find(output => (
    output.kind === 'source_subtitle' && output.status === 'completed' && output.path !== null
  ));
  const similarity = source?.path === undefined || source.path === null
    ? null
    : await subtitleSimilarity(source.path, targetText);
  return [{
    code: 'creator_translation_output_language_mismatch',
    severity: 'blocking',
    message: '目标语言为中文，但翻译结果仍主要是英文，请重新生成。',
    evidence: compactEvidence({
      targetLanguage,
      sampleCharacters: metrics.meaningfulCharacters,
      chineseRatio: Number(metrics.chineseRatio.toFixed(3)),
      sourceSimilarity: similarity === null ? null : Number(similarity.toFixed(3)),
      threshold: MIN_CHINESE_RATIO
    })
  }];
};

function languageMetrics(value: string) {
  const clean = normalizeText(value);
  const hanCharacters = (clean.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinCharacters = (clean.match(/[a-z]/gi) ?? []).length;
  const meaningfulCharacters = hanCharacters + latinCharacters;
  return {
    hanCharacters,
    meaningfulCharacters,
    chineseRatio: meaningfulCharacters === 0 ? 0 : hanCharacters / meaningfulCharacters
  };
}

async function subtitleSimilarity(path: string, targetText: string): Promise<number | null> {
  try {
    const cues = await validateSrtFile(path, { allowOverlaps: true });
    return diceCoefficient(
      normalizeText(cues.map(cue => cue.text).join('\n')),
      normalizeText(targetText)
    );
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/<[^>]+>|\{\\[^}]+\}/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

function diceCoefficient(left: string, right: string): number {
  const leftParts = ngrams(left.replace(/\s+/g, ''), 3);
  const rightParts = ngrams(right.replace(/\s+/g, ''), 3);
  if (leftParts.length === 0 || rightParts.length === 0) return left === right ? 1 : 0;
  const counts = new Map<string, number>();
  for (const part of leftParts) counts.set(part, (counts.get(part) ?? 0) + 1);
  let intersection = 0;
  for (const part of rightParts) {
    const count = counts.get(part) ?? 0;
    if (count <= 0) continue;
    intersection += 1;
    counts.set(part, count - 1);
  }
  return 2 * intersection / (leftParts.length + rightParts.length);
}

function ngrams(value: string, size: number): string[] {
  if (value.length < size) return value.length === 0 ? [] : [value];
  return Array.from({ length: value.length - size + 1 }, (_, index) => value.slice(index, index + size));
}

function readLanguage(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace('-', '_') : '';
}

function isChinese(language: string): boolean {
  return language === 'zh' || language.startsWith('zh_') || language === 'chinese';
}

function compactEvidence(input: Record<string, CreatorJson>): Record<string, CreatorJson> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null));
}
