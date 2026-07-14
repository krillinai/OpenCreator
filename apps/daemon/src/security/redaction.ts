const assignmentSecretPattern = /([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)[A-Z0-9_]*)=(?!\[REDACTED\])([^\s"',}\]]+)/gi;
const labeledSecretPattern = /(\b(?:password|passwd|token|api[\s_-]?key|secret)\b\s*[:=]\s*)(?!\[REDACTED\])([^\s"',}\]]+)/gi;
const authorizationHeaderPattern = /(Authorization:\s*Bearer\s+)([^\s"',}\]]+)/gi;
const agentCapabilityPattern = /\bclwcap_[A-Za-z0-9_-]+\b/g;
const standaloneOpenAiKeyPattern = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

export function redactText(input: string): string {
  return input
    .replace(assignmentSecretPattern, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(labeledSecretPattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(authorizationHeaderPattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(agentCapabilityPattern, '[REDACTED]')
    .replace(standaloneOpenAiKeyPattern, '[REDACTED]');
}
