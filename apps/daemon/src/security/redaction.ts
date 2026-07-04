const secretPattern = /(KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)=([^\s"',}\]]+)/gi;

export function redactText(input: string): string {
  return input.replace(secretPattern, (_match, key: string) => `${key}=[REDACTED]`);
}
