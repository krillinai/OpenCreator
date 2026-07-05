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
  const parsed = parseJson(output);

  if (isPlainObject(parsed)) {
    return mapServer(parsed, {
      fallbackName: input.name,
      codexHome: input.codexHome,
      codexHomeMode: input.codexHomeMode
    });
  }

  const diagnostics = ['codex mcp get output was not fully recognized'];
  return {
    name: input.name,
    transport: 'unknown',
    status: input.exitCode === 0 ? 'configured' : 'unknown',
    envKeys: [],
    hasSecrets: false,
    codexHome: input.codexHome,
    codexHomeMode: input.codexHomeMode,
    diagnostics,
    raw: redactMcpText(output)
  };
}

export function parseMcpListOutput(input: ParseMcpListOutputInput): CodexMcpListResponse {
  const output = combineOutput(input.stdout, input.stderr);
  const parsed = parseJson(output);

  if (Array.isArray(parsed)) {
    return {
      codexHome: input.codexHome,
      codexHomeMode: input.codexHomeMode,
      requiresWriteConfirmation: input.codexHomeMode === 'global',
      servers: parsed
        .filter(isPlainObject)
        .map((server) =>
          mapServer(server, {
            fallbackName: '',
            codexHome: input.codexHome,
            codexHomeMode: input.codexHomeMode
          })
        ),
      diagnostics: []
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
  }
): CodexMcpServerResponse {
  const envKeys = getEnvKeys(server.env);
  const sensitiveValues = getEnvValues(server.env);
  const result: CodexMcpServerResponse = {
    name: typeof server.name === 'string' ? server.name : context.fallbackName,
    transport: normalizeTransport(server.transport),
    status: 'configured',
    envKeys,
    hasSecrets: envKeys.length > 0,
    codexHome: context.codexHome,
    codexHomeMode: context.codexHomeMode,
    diagnostics: getDiagnostics(server.diagnostics, sensitiveValues)
  };

  if (typeof server.command === 'string') {
    result.command = server.command;
  }

  if (Array.isArray(server.args) && server.args.every((arg) => typeof arg === 'string')) {
    result.args = server.args;
  }

  if (typeof server.url === 'string') {
    result.url = redactMcpText(server.url, sensitiveValues);
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
