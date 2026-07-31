const assignmentSecretPattern = /([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)[A-Z0-9_]*)=(?!\[REDACTED\])([^\s"',}\]]+)/gi;
const labeledSecretPattern = /(\b(?:password|passwd|token|api[\s_-]?key|secret)\b\s*[:=]\s*)(?!\[REDACTED\])([^\s"',}\]]+)/gi;
const authorizationHeaderPattern = /(Authorization:\s*[A-Za-z][A-Za-z0-9._~-]*\s+)([^\s"',}\]]+)/gi;
const cookieHeaderPattern = /((?:Set-)?Cookie:\s*)(?!\[REDACTED\])([^\r\n]+)/gi;
const agentCapabilityPattern = /\bclwcap_[A-Za-z0-9_-]+\b/g;
const standaloneOpenAiKeyPattern = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const REDACTED = '[REDACTED]';

export function redactText(input: string): string {
  return input
    .replace(assignmentSecretPattern, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(labeledSecretPattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(authorizationHeaderPattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(cookieHeaderPattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(agentCapabilityPattern, REDACTED)
    .replace(standaloneOpenAiKeyPattern, REDACTED);
}

export function redactValue(input: unknown): unknown {
  if (typeof input === 'string') return redactText(input);
  if (Array.isArray(input)) return input.map(redactValue);
  if (typeof input !== 'object' || input === null) return input;
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      isSensitiveField(key) && !isAlreadyRedacted(value)
        ? REDACTED
        : redactValue(value)
    ])
  );
}

function isSensitiveField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    'accesstoken',
    'authorization',
    'cookie',
    'expiresat',
    'password',
    'passwd',
    'setcookie'
  ].includes(normalized);
}

function isAlreadyRedacted(value: unknown): boolean {
  return typeof value === 'string' && value.includes(REDACTED);
}
