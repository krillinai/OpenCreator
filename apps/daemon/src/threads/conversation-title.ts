const DEFAULT_TITLE = '新对话';
const ATTACHMENT_TITLE = '查看附件';
const MAX_TITLE_WIDTH = 30;

const REQUEST_MARKERS = [
  '## My request for Codex:',
  '用户描述：',
  '用户描述:',
  '用户需求：',
  '用户需求:',
  '任务描述：',
  '任务描述:',
];

export function createConversationTitle(input: string, fallback = DEFAULT_TITLE): string {
  const publicInput = extractPublicConversationInput(input);
  const extracted = publicInput === undefined ? undefined : extractRequest(publicInput);
  if (extracted === undefined) {
    return input.includes('# Files mentioned by the user:') ? ATTACHMENT_TITLE : fallback;
  }

  const command = /<command>\s*([\s\S]*?)\s*<\/command>/i.exec(extracted)?.[1];
  if (command !== undefined) {
    return limitTitle(`执行 ${normalizeWhitespace(command)}`, fallback);
  }

  const withoutSkill = extracted
    .replace(/^\s*\[\$?[^\]]+\]\([^)]+\)\s*/u, '')
    .replace(/^\s*\$[A-Za-z0-9:_-]+\s+/u, '');
  const candidates = withoutSkill
    .split(/[\n。！？!?；;，,]+/u)
    .map(cleanCandidate)
    .filter(candidate => candidate.length > 0 && !isGenericCandidate(candidate));
  const candidate = candidates[0] ?? cleanCandidate(withoutSkill);

  return limitTitle(shortenCandidate(candidate), fallback);
}

export function extractPublicConversationInput(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;

  const managedContextPrefix = '[OpenCreator 用户显式管理的上下文]';
  if (trimmed.startsWith(managedContextPrefix)) {
    return extractAfterMarker(
      trimmed,
      managedContextPrefix,
      '\n用户当前请求：\n'
    );
  }

  const rotationContextPrefix = '[OpenCreator 执行上下文恢复摘要]';
  if (trimmed.startsWith(rotationContextPrefix)) {
    return extractAfterMarker(
      trimmed,
      rotationContextPrefix,
      '\n本次公开任务输入：\n'
    );
  }

  if (
    trimmed.startsWith('# AGENTS.md instructions')
    || trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('Another language model started to solve this problem')
  ) {
    return undefined;
  }
  return trimmed;
}

function extractAfterMarker(
  input: string,
  prefix: string,
  marker: string
): string | undefined {
  if (!input.startsWith(prefix)) return undefined;
  const markerIndex = input.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const publicInput = input.slice(markerIndex + marker.length).trim();
  return publicInput.length === 0 ? undefined : publicInput;
}

function extractRequest(input: string): string | undefined {
  let source = input.trim();
  if (source.length === 0) return undefined;

  let markerEnd = -1;
  for (const marker of REQUEST_MARKERS) {
    const index = source.lastIndexOf(marker);
    if (index >= 0) markerEnd = Math.max(markerEnd, index + marker.length);
  }
  if (markerEnd >= 0) source = source.slice(markerEnd).trim();
  if (
    markerEnd < 0
    && source.startsWith('你是 OpenCreator 的计划任务配置助手')
  ) {
    return '创建计划任务';
  }

  if (source.startsWith('# Files mentioned by the user:')) {
    return undefined;
  }

  const lines = source
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !isInstructionMetadata(line));

  return lines.length === 0 ? undefined : lines.join(' ');
}

function isInstructionMetadata(line: string): boolean {
  return line.startsWith('# AGENTS.md instructions')
    || line.startsWith('<environment_context>')
    || line.startsWith('<image ')
    || line.startsWith('你是 ')
    || line.startsWith('不要调用工具')
    || line.startsWith('用户所在时区：')
    || line.startsWith('只输出一个 JSON')
    || line.startsWith('JSON 格式：')
    || line.startsWith('days 使用 ')
    || line.startsWith('如果用户没有给出');
}

function cleanCandidate(value: string): string {
  let result = normalizeWhitespace(value)
    .replace(/^(?:请帮我|请你|请|帮我|麻烦帮我|麻烦|我想要|我想|我需要|现在开始|现在)\s*/u, '')
    .replace(/^为什么(?:我的)?\s*/u, '')
    .replace(/重新详细/u, '')
    .replace(/(?:看一下|看下)/gu, '查看')
    .replace(/(?:分析一下|分析下)/gu, '分析')
    .replace(/(?:梳理一下|梳理下)/gu, '梳理')
    .replace(/当前项目最近的进展/gu, '项目进展')
    .replace(/(?:当前|这个)项目的/gu, '项目')
    .replace(/里面的/gu, '的')
    .replace(/创建的逻辑/gu, '创建逻辑')
    .replace(/每个工作日(?:上午|下午|晚上)?[零〇一二三四五六七八九十两\d:：点半分]*/gu, '工作日')
    .replace(/每(?:天|日)(?:上午|下午|晚上)?[零〇一二三四五六七八九十两\d:：点半分]*/gu, '每日')
    .replace(/(每周[一二三四五六日天]?)(?:上午|下午|晚上)?[零〇一二三四五六七八九十两\d:：点半分]*/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();

  result = result.replace(/(?:一下|看看)$/u, '').trim();
  return result;
}

function shortenCandidate(value: string): string {
  const detail = value.split(/(?:为什么|如何|以及|还有哪些|都有什么|并且|同时|然后)/u)[0];
  const candidate = cleanCandidate(detail ?? value);
  if (visualWidth(candidate) <= MAX_TITLE_WIDTH) return candidate;

  const conjunction = candidate.split(/(?:和|与|及)/u)[0];
  if (conjunction !== undefined && visualWidth(conjunction) >= 8) {
    return conjunction.trim();
  }
  return candidate;
}

function isGenericCandidate(value: string): boolean {
  return /^(?:(?:我)?发现)?问题(?:了|是)?$/u.test(value)
    || /^(?:有)?一个小?\s*bug$/iu.test(value)
    || /^(?:好的|没问题|继续|ok)$/iu.test(value);
}

function limitTitle(value: string, fallback: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) return fallback;
  if (visualWidth(normalized) <= MAX_TITLE_WIDTH) return normalized;

  const targetWidth = MAX_TITLE_WIDTH - 2;
  let width = 0;
  let result = '';
  for (const character of Array.from(normalized)) {
    const nextWidth = characterWidth(character);
    if (width + nextWidth > targetWidth) break;
    result += character;
    width += nextWidth;
  }

  if (/[A-Za-z0-9._:/-]$/u.test(result) && /[A-Za-z0-9._:/-]/u.test(normalized[result.length] ?? '')) {
    const withoutPartialWord = result.replace(/[A-Za-z0-9._:/-]+$/u, '').trimEnd();
    if (visualWidth(withoutPartialWord) >= targetWidth * 0.6) {
      result = withoutPartialWord;
    }
  }
  return `${result || normalized.slice(0, 1)}…`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function visualWidth(value: string): number {
  return Array.from(value).reduce((total, character) => total + characterWidth(character), 0);
}

function characterWidth(character: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u
    .test(character)
    ? 2
    : 1;
}
