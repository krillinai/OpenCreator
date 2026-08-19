import type {
  CodexHomeMode,
  CodexMcpListResponse,
  CodexMcpServerResponse,
  CodexMcpTransport
} from '@opencreator/protocol';
import { redactMcpText } from './redaction.js';

const REDACTED = '[REDACTED]';
const TOKEN_LIKE_FLAG_NAME = /(?:token|secret|password|api[-_]?key|apikey|access[-_]?token|bearer[-_]?token)/i;
const SECRET_ARG_FLAG_IN_COMMAND =
  /(--[A-Za-z0-9_.-]*(?:token|secret|password|api[-_]?key|apikey|access[-_]?token|bearer[-_]?token)[A-Za-z0-9_.-]*)(\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi;
const QUOTED_SECRET_KEY_VALUE =
  /([A-Za-z_][A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?TOKEN|KEY)[A-Za-z0-9_.-]*\s*[=:]\s*)(["'])[^"'\r\n]*\2/gi;
const QUOTED_SECRET_FLAG_VALUE =
  /(--[A-Za-z0-9_.-]*(?:token|secret|password|api[-_]?key|apikey|access[-_]?token|bearer[-_]?token)[A-Za-z0-9_.-]*=)(["'])[^"'\r\n]*\2/gi;

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
    if (jsonObjectIndicatesError(parsed)) {
      return errorServerResponse(input, parsed);
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
      enabled: true,
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
  return (
    /\b(?:server\s+not\s+found|mcp\s+server\s+not\s+found|no\s+mcp\s+server\s+named|mcp\s+server\s+not\s+configured|server\s+not\s+configured|missing\s+mcp\s+server)\b/i.test(
      output
    )
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
  const transportConfig = isPlainObject(server.transport)
    ? server.transport
    : server;
  const envKeys = getEnvKeys(transportConfig.env);
  const sensitiveValues = getEnvValues(transportConfig.env);
  const command = typeof transportConfig.command === 'string'
    ? redactMcpCommand(transportConfig.command, sensitiveValues)
    : undefined;
  const originalArgs =
    Array.isArray(transportConfig.args)
    && transportConfig.args.every((arg) => typeof arg === 'string')
      ? transportConfig.args
      : undefined;
  const args = originalArgs === undefined ? undefined : redactMcpArgs(originalArgs, sensitiveValues);
  const url = typeof transportConfig.url === 'string'
    ? redactMcpText(transportConfig.url, sensitiveValues)
    : undefined;
  const bearerTokenEnvVar =
    typeof transportConfig.bearer_token_env_var === 'string'
      ? transportConfig.bearer_token_env_var
      : typeof transportConfig.bearerTokenEnvVar === 'string'
        ? transportConfig.bearerTokenEnvVar
        : undefined;
  const redactionChanged =
    (command !== undefined && command !== transportConfig.command) ||
    (args !== undefined && originalArgs !== undefined && args.some((arg, index) => arg !== originalArgs[index])) ||
    (url !== undefined && url !== transportConfig.url);
  const result: CodexMcpServerResponse = {
    name: typeof server.name === 'string' ? server.name : context.fallbackName,
    enabled: server.enabled !== false,
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

  if (bearerTokenEnvVar !== undefined) {
    result.bearerTokenEnvVar = bearerTokenEnvVar;
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
    enabled: false,
    transport: 'unknown',
    status: 'missing',
    envKeys: [],
    hasSecrets: false,
    codexHome: input.codexHome,
    codexHomeMode: input.codexHomeMode,
    diagnostics: ['codex mcp get output indicates server is missing']
  };

  if (rawOutput !== undefined) {
    const redactedRaw = redactMcpFreeText(rawOutput);
    result.raw = redactedRaw;
    result.hasSecrets = redactedRaw !== rawOutput;
  }

  return result;
}

function errorServerResponse(
  input: {
    name: string;
    codexHome: string;
    codexHomeMode: CodexHomeMode;
  },
  errorObject: Record<string, unknown>
): CodexMcpServerResponse {
  const diagnostics = getErrorDiagnostics(errorObject);
  return {
    name: input.name,
    enabled: false,
    transport: 'unknown',
    status: 'unknown',
    envKeys: [],
    hasSecrets: diagnostics.some((diagnostic) => diagnostic.includes(REDACTED)),
    codexHome: input.codexHome,
    codexHomeMode: input.codexHomeMode,
    diagnostics
  };
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
  if (transport === 'stdio' || transport === 'http' || transport === 'sse') {
    return transport;
  }
  if (!isPlainObject(transport)) return 'unknown';
  const type = transport.type;
  if (type === 'stdio') return 'stdio';
  if (
    type === 'http'
    || type === 'streamable_http'
    || type === 'streamable-http'
  ) {
    return 'http';
  }
  return type === 'sse' ? 'sse' : 'unknown';
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
  if (
    isPlainObject(value.error) &&
    typeof value.error.message === 'string' &&
    isMcpNotFoundOutput(value.error.message)
  ) {
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

function jsonObjectIndicatesError(value: Record<string, unknown>): boolean {
  if (typeof value.error === 'string' || typeof value.message === 'string') {
    return true;
  }
  return isPlainObject(value.error) && typeof value.error.message === 'string';
}

function getErrorDiagnostics(value: Record<string, unknown>): string[] {
  const diagnostics: string[] = [];
  if (typeof value.error === 'string') {
    diagnostics.push(redactMcpFreeText(value.error));
  }
  if (isPlainObject(value.error) && typeof value.error.message === 'string') {
    diagnostics.push(redactMcpFreeText(value.error.message));
  }
  if (typeof value.message === 'string') {
    diagnostics.push(redactMcpFreeText(value.message));
  }
  return diagnostics.length === 0 ? ['codex mcp get output contained an error'] : diagnostics;
}

function redactMcpCommand(command: string, sensitiveValues: string[]): string {
  return redactMcpFreeText(command, sensitiveValues);
}

function redactMcpArgs(args: string[], sensitiveValues: string[]): string[] {
  const redactedArgs = args.map((arg) => redactMcpFreeText(arg, sensitiveValues));

  for (let index = 0; index < redactedArgs.length - 1; index += 1) {
    if (isSecretArgFlag(args[index] ?? '') || isSecretArgFlag(redactedArgs[index] ?? '')) {
      index += 1;
      redactedArgs[index] = REDACTED;
    }
  }

  return redactedArgs;
}

function isSecretArgFlag(arg: string): boolean {
  if (!arg.startsWith('--')) {
    return false;
  }
  return TOKEN_LIKE_FLAG_NAME.test(arg.slice(2));
}

function redactMcpFreeText(text: string, sensitiveValues: string[] = []): string {
  return redactMcpText(text, sensitiveValues)
    .replace(QUOTED_SECRET_KEY_VALUE, `$1${REDACTED}`)
    .replace(QUOTED_SECRET_FLAG_VALUE, `$1${REDACTED}`)
    .replace(SECRET_ARG_FLAG_IN_COMMAND, (_match, flag: string, separator: string) => `${flag}${separator}${REDACTED}`);
}
