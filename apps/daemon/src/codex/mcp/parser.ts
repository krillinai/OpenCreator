import type {
  CodexHomeMode,
  CodexMcpListResponse,
  CodexMcpServerResponse,
  CodexMcpTransport
} from '@clawee/protocol';
import { redactMcpText } from './redaction.js';

const REDACTED = '[REDACTED]';
const SECRET_ARG_FLAGS = new Set([
  '--api-key',
  '--api_key',
  '--token',
  '--secret',
  '--password',
  '--access-token',
  '--access_token',
  '--bearer-token',
  '--bearer_token'
]);
const SECRET_ARG_FLAG_IN_COMMAND =
  /(--(?:api[-_]key|token|secret|password|access[-_]token|bearer[-_]token))(\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi;
const QUOTED_SECRET_KEY_VALUE =
  /([A-Za-z_][A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?TOKEN|KEY)[A-Za-z0-9_.-]*\s*[=:]\s*)(["'])[^"'\r\n]*\2/gi;
const QUOTED_SECRET_FLAG_VALUE =
  /(--(?:api[-_]key|token|secret|password|access[-_]token|bearer[-_]token)=)(["'])[^"'\r\n]*\2/gi;

export type ParseMcpGetOutputInput = {
  name: string;
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type ParseMcpListOutputInput = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export function parseMcpGetOutput(input: ParseMcpGetOutputInput): CodexMcpServerResponse {
  const output = combineOutput(input.stdout, input.stderr);
  const parsed = parsePreferredJson(input.stdout, output);

  if (isPlainObject(parsed)) {
    if (jsonObjectIndicatesMissing(parsed)) {
      return missingServerResponse(input);
    }

    return mapServer(parsed, {
      fallbackName: input.name,
      codexHome: input.codexHome,
      codexHomeMode: input.codexHomeMode,
      diagnosticText: input.stderr
    });
  }

  const missing = isMcpNotFoundOutput(output);
  const redactedRaw = redactMcpFreeText(output);
  return missing
    ? missingServerResponse(input, output)
    : {
        name: input.name,
        transport: 'unknown',
        status: input.exitCode === 0 ? 'configured' : 'unknown',
        envKeys: [],
        hasSecrets: redactedRaw !== output,
        codexHome: input.codexHome,
        codexHomeMode: input.codexHomeMode,
        diagnostics: ['codex mcp get output was not fully recognized'],
        raw: redactedRaw
      };
}

export function parseMcpListOutput(input: ParseMcpListOutputInput): CodexMcpListResponse {
  const output = combineOutput(input.stdout, input.stderr);
  const parsed = parsePreferredJson(input.stdout, output);

  if (Array.isArray(parsed)) {
    const plainServers = parsed.filter(isPlainObject);
    const sensitiveValues = plainServers.flatMap((server) => getEnvValues(server.env));
    const diagnostics = redactedTextDiagnostics(input.stderr, sensitiveValues);
    if (plainServers.length !== parsed.length) {
      diagnostics.push('codex mcp list output contained non-object entries');
    }

    return {
      codexHome: input.codexHome,
      codexHomeMode: input.codexHomeMode,
      requiresWriteConfirmation: input.codexHomeMode === 'global',
      servers: plainServers.map((server) =>
        mapServer(server, {
          fallbackName: '',
          codexHome: input.codexHome,
          codexHomeMode: input.codexHomeMode
        })
      ),
      diagnostics
    };
  }

  return {
    codexHome: input.codexHome,
    codexHomeMode: input.codexHomeMode,
    requiresWriteConfirmation: input.codexHomeMode === 'global',
    servers: [],
    diagnostics: output.length > 0 ? ['codex mcp list output was not fully recognized'] : []
  };
}

export function isMcpNotFoundOutput(output: string): boolean {
  return /\b(?:not found|not configured|no mcp server named|missing\s+mcp\s+server)\b/i.test(
    output
  );
}

function mapServer(
  server: Record<string, unknown>,
  context: {
    fallbackName: string;
    codexHome: string;
    codexHomeMode: CodexHomeMode;
    diagnosticText?: string;
  }
): CodexMcpServerResponse {
  const envKeys = getEnvKeys(server.env);
  const sensitiveValues = getEnvValues(server.env);
  const command = typeof server.command === 'string' ? redactMcpCommand(server.command, sensitiveValues) : undefined;
  const originalArgs =
    Array.isArray(server.args) && server.args.every((arg) => typeof arg === 'string') ? server.args : undefined;
  const args = originalArgs === undefined ? undefined : redactMcpArgs(originalArgs, sensitiveValues);
  const url = typeof server.url === 'string' ? redactMcpText(server.url, sensitiveValues) : undefined;
  const redactionChanged =
    (command !== undefined && command !== server.command) ||
    (args !== undefined && originalArgs !== undefined && args.some((arg, index) => arg !== originalArgs[index])) ||
    (url !== undefined && url !== server.url);
  const result: CodexMcpServerResponse = {
    name: typeof server.name === 'string' ? server.name : context.fallbackName,
    transport: normalizeTransport(server.transport),
    status: 'configured',
    envKeys,
    hasSecrets: envKeys.length > 0 || redactionChanged,
    codexHome: context.codexHome,
    codexHomeMode: context.codexHomeMode,
    diagnostics: [
      ...getDiagnostics(server.diagnostics, sensitiveValues),
      ...redactedTextDiagnostics(context.diagnosticText ?? '', sensitiveValues)
    ]
  };

  if (command !== undefined) {
    result.command = command;
  }

  if (args !== undefined) {
    result.args = args;
  }

  if (url !== undefined) {
    result.url = url;
  }

  return result;
}

function missingServerResponse(
  input: {
    name: string;
    codexHome: string;
    codexHomeMode: CodexHomeMode;
  },
  rawOutput?: string
): CodexMcpServerResponse {
  const result: CodexMcpServerResponse = {
    name: input.name,
    transport: 'unknown',
    status: 'missing',
    envKeys: [],
    hasSecrets: false,
    codexHome: input.codexHome,
    codexHomeMode: input.codexHomeMode,
    diagnostics: ['codex mcp get output indicates server is missing']
  };

  if (rawOutput !== undefined) {
    result.raw = redactMcpFreeText(rawOutput);
  }

  return result;
}

function combineOutput(stdout: string, stderr: string): string {
  if (stdout.length === 0) {
    return stderr;
  }
  if (stderr.length === 0) {
    return stdout;
  }
  return `${stdout}\n${stderr}`;
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

function parsePreferredJson(stdout: string, output: string): unknown {
  const parsedStdout = parseJson(stdout);
  return parsedStdout === undefined ? parseJson(output) : parsedStdout;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeTransport(transport: unknown): CodexMcpTransport {
  return transport === 'stdio' || transport === 'http' || transport === 'sse' ? transport : 'unknown';
}

function getEnvKeys(env: unknown): string[] {
  if (!isPlainObject(env)) {
    return [];
  }
  return Object.keys(env);
}

function getEnvValues(env: unknown): string[] {
  if (!isPlainObject(env)) {
    return [];
  }
  return Object.values(env).filter((value): value is string => typeof value === 'string');
}

function getDiagnostics(diagnostics: unknown, sensitiveValues: string[]): string[] {
  if (!Array.isArray(diagnostics)) {
    return [];
  }
  return diagnostics
    .filter((diagnostic): diagnostic is string => typeof diagnostic === 'string')
    .map((diagnostic) => redactMcpFreeText(diagnostic, sensitiveValues));
}

function redactedTextDiagnostics(text: string, sensitiveValues: string[]): string[] {
  const diagnostic = redactMcpFreeText(text, sensitiveValues).trim();
  return diagnostic.length === 0 ? [] : [diagnostic];
}

function jsonObjectIndicatesMissing(value: Record<string, unknown>): boolean {
  if (typeof value.error === 'string' && isMcpNotFoundOutput(value.error)) {
    return true;
  }
  if (typeof value.message === 'string' && isMcpNotFoundOutput(value.message)) {
    return true;
  }
  if (Array.isArray(value.diagnostics)) {
    return value.diagnostics.some(
      (diagnostic) => typeof diagnostic === 'string' && isMcpNotFoundOutput(diagnostic)
    );
  }
  return false;
}

function redactMcpCommand(command: string, sensitiveValues: string[]): string {
  return redactMcpFreeText(command, sensitiveValues);
}

function redactMcpArgs(args: string[], sensitiveValues: string[]): string[] {
  const redactedArgs = args.map((arg) => redactMcpText(arg, sensitiveValues));

  for (let index = 0; index < redactedArgs.length - 1; index += 1) {
    if (isSecretArgFlag(args[index] ?? '') || isSecretArgFlag(redactedArgs[index] ?? '')) {
      index += 1;
      redactedArgs[index] = REDACTED;
    }
  }

  return redactedArgs;
}

function isSecretArgFlag(arg: string): boolean {
  return SECRET_ARG_FLAGS.has(arg.toLowerCase());
}

function redactMcpFreeText(text: string, sensitiveValues: string[] = []): string {
  return redactMcpText(text, sensitiveValues)
    .replace(QUOTED_SECRET_KEY_VALUE, `$1${REDACTED}`)
    .replace(QUOTED_SECRET_FLAG_VALUE, `$1${REDACTED}`)
    .replace(SECRET_ARG_FLAG_IN_COMMAND, (_match, flag: string, separator: string) => `${flag}${separator}${REDACTED}`);
}
