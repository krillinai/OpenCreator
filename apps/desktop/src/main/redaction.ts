const assignmentSecretPattern =
  /([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)[A-Z0-9_]*)=(?!\[REDACTED\])([^\s"',}\]]+)/gi;
const labeledSecretPattern =
  /(\b(?:password|passwd|token|api[\s_-]?key|secret)\b\s*[:=]\s*)(?!\[REDACTED\])([^\s"',}\]]+)/gi;
const jsonSecretPattern =
  /("(?:[^"]*(?:password|passwd|token|apiKey|secret|authorization)[^"]*)"\s*:\s*")(?!\[REDACTED\])([^"]+)(")/gi;
const authorizationHeaderPattern =
  /(Authorization:\s*Bearer\s+)([^\s"',}\]]+)/gi;
const agentCapabilityPattern = /\bclwcap_[A-Za-z0-9_-]+\b/g;
const standaloneOpenAiKeyPattern = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

export function redactText(input: string): string {
  return input
    .replace(jsonSecretPattern, '$1[REDACTED]$3')
    .replace(assignmentSecretPattern, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(labeledSecretPattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(authorizationHeaderPattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(agentCapabilityPattern, '[REDACTED]')
    .replace(standaloneOpenAiKeyPattern, '[REDACTED]');
}

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === 'string') return redactText(value);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => (
    sensitiveKey(key)
      ? [key, '[REDACTED]']
      : [key, redactValue(entry)]
  )));
}

function sensitiveKey(key: string): boolean {
  return /(token|authorization|password|secret|apiKey|cookie|auth)/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
