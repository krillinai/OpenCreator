const REDACTED = '[REDACTED]';
const TOKEN_LIKE_FLAG_NAME = /(?:token|secret|password|api[-_]?key|apikey|access[-_]?token|bearer[-_]?token)/i;
const TOKEN_LIKE_KEY =
  /([A-Za-z_][A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?TOKEN|KEY)[A-Za-z0-9_.-]*)(\s*[=:]\s*)([^\s'"`<>;&]+)/gi;
const AUTHORIZATION_HEADER = /(Authorization\s*:\s*)(?:(Bearer|Basic|token)\s+)?[^\r\n]*/gi;
const URL_QUERY_SECRET = /([?&](?:token|secret|password|key|api[_-]?key|access[_-]?token)=)[^&#\s]+/gi;

export function redactMcpArgv(argv: string[]): string[] {
  const redacted: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    redacted.push(arg === undefined ? '' : redactMcpText(arg));

    if (arg === '--env' && index + 1 < argv.length) {
      index += 1;
      redacted.push(redactKeyValue(argv[index] ?? ''));
      continue;
    }

    if (isSecretArgFlag(arg ?? '') && index + 1 < argv.length) {
      redacted[redacted.length - 1] = REDACTED;
      index += 1;
      redacted.push(REDACTED);
    }
  }
  return redacted;
}

export function redactMcpText(input: string, sensitiveValues: string[] = []): string {
  let output = input;

  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length === 0) {
      continue;
    }
    output = output.split(sensitiveValue).join(REDACTED);
  }

  return output
    .replace(AUTHORIZATION_HEADER, (_match, prefix: string, scheme: string | undefined) =>
      scheme === undefined ? `${prefix}${REDACTED}` : `${prefix}${scheme} ${REDACTED}`
    )
    .replace(URL_QUERY_SECRET, `$1${REDACTED}`)
    .replace(TOKEN_LIKE_KEY, `$1$2${REDACTED}`);
}

function redactKeyValue(value: string): string {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex === -1) {
    return REDACTED;
  }
  return `${value.slice(0, separatorIndex + 1)}${REDACTED}`;
}

function isSecretArgFlag(arg: string): boolean {
  return arg.startsWith('--') && TOKEN_LIKE_FLAG_NAME.test(arg.slice(2));
}
