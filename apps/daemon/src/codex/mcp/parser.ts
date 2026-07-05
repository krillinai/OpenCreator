import type {
  CodexHomeMode,
  CodexMcpListResponse,
  CodexMcpServerResponse,
  CodexMcpTransport
} from '@clawee/protocol';
import { redactMcpText } from './redaction.js';

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
    return mapServer(parsed, {
      fallbackName: input.name,
      codexHome: input.codexHome,
      codexHomeMode: input.codexHomeMode,
      diagnosticText: input.stderr
    });
  }

  const missing = isMcpNotFoundOutput(output);
  return {
    name: input.name,
    transport: 'unknown',
    status: missing ? 'missing' : input.exitCode === 0 ? 'configured' : 'unknown',
    envKeys: [],
    hasSecrets: false,
    codexHome: input.codexHome,
    codexHomeMode: input.codexHomeMode,
    diagnostics: [
      missing
        ? 'codex mcp get output indicates server is missing'
        : 'codex mcp get output was not fully recognized'
    ],
    raw: redactMcpText(output)
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
  return /\b(?:not found|not configured|no mcp server named|missing)\b/i.test(output);
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
  const command = typeof server.command === 'string' ? redactMcpText(server.command, sensitiveValues) : undefined;
  const originalArgs =
    Array.isArray(server.args) && server.args.every((arg) => typeof arg === 'string') ? server.args : undefined;
  const args = originalArgs?.map((arg) => redactMcpText(arg, sensitiveValues));
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
    .map((diagnostic) => redactMcpText(diagnostic, sensitiveValues));
}

function redactedTextDiagnostics(text: string, sensitiveValues: string[]): string[] {
  const diagnostic = redactMcpText(text, sensitiveValues).trim();
  return diagnostic.length === 0 ? [] : [diagnostic];
}
