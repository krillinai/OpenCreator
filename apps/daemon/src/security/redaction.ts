const assignmentSecretPattern = /([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)[A-Z0-9_]*)=([^\s"',}\]]+)/gi;
const authorizationHeaderPattern = /(Authorization:\s*Bearer\s+)([^\s"',}\]]+)/gi;
const agentCapabilityPattern = /\bclwcap_[A-Za-z0-9_-]+\b/g;

export function redactText(input: string): string {
  return input
    .replace(assignmentSecretPattern, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(authorizationHeaderPattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(agentCapabilityPattern, '[REDACTED]');
}
