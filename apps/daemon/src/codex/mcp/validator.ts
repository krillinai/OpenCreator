import type {
  AddMcpServerInput,
  McpAddCapabilityFlags,
  McpCapabilityResult,
  McpValidationResult,
  NormalizedAddMcpServerInput
} from './types.js';

const MCP_NAME_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidMcpName(name: string): boolean {
  return MCP_NAME_PATTERN.test(name);
}

export function isValidMcpEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

export function validateMcpAddRequest(body: unknown): McpValidationResult<NormalizedAddMcpServerInput> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (typeof body.name !== 'string' || !isValidMcpName(body.name)) {
    return { ok: false, message: 'name must be a valid MCP server name' };
  }
  if (body.transport !== 'stdio' && body.transport !== 'http' && body.transport !== 'sse') {
    return { ok: false, message: 'transport must be stdio, http, or sse' };
  }
  if (body.confirmWriteToCodexHome !== undefined && body.confirmWriteToCodexHome !== true) {
    return { ok: false, message: 'confirmWriteToCodexHome must be true when provided' };
  }

  const env = normalizeEnv(body.env);
  if (!env.ok) return env;

  if (body.transport === 'stdio') {
    if (typeof body.command !== 'string' || body.command.trim().length === 0) {
      return { ok: false, message: 'command must be a non-empty string' };
    }
    if (body.args !== undefined && !isStringArray(body.args)) {
      return { ok: false, message: 'args must be an array of strings' };
    }
    return {
      ok: true,
      value: {
        name: body.name,
        transport: 'stdio',
        command: body.command,
        args: body.args ?? [],
        env: env.value,
        ...(body.confirmWriteToCodexHome === true ? { confirmWriteToCodexHome: true } : {})
      }
    };
  }

  if (typeof body.url !== 'string' || !isHttpUrl(body.url)) {
    return { ok: false, message: 'url must use http or https' };
  }
  if (
    body.bearerTokenEnvVar !== undefined
    && (typeof body.bearerTokenEnvVar !== 'string' || !isValidMcpEnvKey(body.bearerTokenEnvVar))
  ) {
    return { ok: false, message: 'bearerTokenEnvVar must be a valid environment variable name' };
  }
  if (body.oauthClientId !== undefined && typeof body.oauthClientId !== 'string') {
    return { ok: false, message: 'oauthClientId must be a string' };
  }
  if (body.oauthResource !== undefined && typeof body.oauthResource !== 'string') {
    return { ok: false, message: 'oauthResource must be a string' };
  }

  return {
    ok: true,
    value: {
      name: body.name,
      transport: body.transport,
      url: body.url,
      env: env.value,
      ...(body.bearerTokenEnvVar === undefined ? {} : { bearerTokenEnvVar: body.bearerTokenEnvVar }),
      ...(body.oauthClientId === undefined ? {} : { oauthClientId: body.oauthClientId }),
      ...(body.oauthResource === undefined ? {} : { oauthResource: body.oauthResource }),
      ...(body.confirmWriteToCodexHome === true ? { confirmWriteToCodexHome: true } : {})
    }
  };
}

export function assertMcpAddRequestSupported(
  input: AddMcpServerInput | NormalizedAddMcpServerInput,
  capabilities: McpAddCapabilityFlags
): McpCapabilityResult {
  if (!capabilities.mcpAdd) {
    return { ok: false, code: 'CODEX_INCOMPATIBLE', message: 'Current Codex does not support mcp add' };
  }
  if (Object.keys(input.env ?? {}).length > 0 && !capabilities.mcpAddEnv) {
    return { ok: false, code: 'CODEX_INCOMPATIBLE', message: 'Current Codex does not support --env for mcp add' };
  }
  if (input.transport !== 'stdio' && !capabilities.mcpAddUrl) {
    return { ok: false, code: 'CODEX_INCOMPATIBLE', message: 'Current Codex does not support --url for mcp add' };
  }
  if (input.transport !== 'stdio' && input.bearerTokenEnvVar !== undefined && !capabilities.mcpAddBearerTokenEnvVar) {
    return {
      ok: false,
      code: 'CODEX_INCOMPATIBLE',
      message: 'Current Codex does not support --bearer-token-env-var for mcp add'
    };
  }
  if (
    input.transport !== 'stdio'
    && (input.oauthClientId !== undefined || input.oauthResource !== undefined)
    && !capabilities.mcpAddOAuth
  ) {
    return { ok: false, code: 'CODEX_INCOMPATIBLE', message: 'Current Codex does not support OAuth flags for mcp add' };
  }
  return { ok: true };
}

function normalizeEnv(value: unknown): McpValidationResult<Record<string, string>> {
  if (value === undefined) return { ok: true, value: {} };
  if (!isPlainObject(value)) return { ok: false, message: 'env must be an object' };

  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isValidMcpEnvKey(key)) return { ok: false, message: 'env keys must be valid environment variable names' };
    if (typeof raw !== 'string') return { ok: false, message: 'env values must be strings' };
    env[key] = raw;
  }
  return { ok: true, value: env };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
