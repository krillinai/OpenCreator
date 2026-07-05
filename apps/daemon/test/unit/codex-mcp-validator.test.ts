import { describe, expect, it } from 'vitest';
import {
  assertMcpAddRequestSupported,
  isValidMcpEnvKey,
  isValidMcpName,
  validateMcpAddRequest
} from '../../src/codex/mcp/validator.js';
import type { McpAddCapabilityFlags } from '../../src/codex/mcp/types.js';

const allCapabilities = {
  mcpAdd: true,
  mcpAddEnv: true,
  mcpAddUrl: true,
  mcpAddBearerTokenEnvVar: true,
  mcpAddOAuth: true
} satisfies McpAddCapabilityFlags;

class CustomMcpRequest {
  name = 'github';
  transport = 'stdio';
  command = 'node';
}

describe('codex mcp validator', () => {
  it('validates mcp names and env keys', () => {
    expect(isValidMcpName('github')).toBe(true);
    expect(isValidMcpName('team.github_1')).toBe(true);
    expect(isValidMcpName('../github')).toBe(false);
    expect(isValidMcpName('bad name')).toBe(false);
    expect(isValidMcpName('')).toBe(false);

    expect(isValidMcpEnvKey('GITHUB_TOKEN')).toBe(true);
    expect(isValidMcpEnvKey('_TOKEN1')).toBe(true);
    expect(isValidMcpEnvKey('1TOKEN')).toBe(false);
    expect(isValidMcpEnvKey('BAD-NAME')).toBe(false);
  });

  it('validates stdio add requests', () => {
    expect(validateMcpAddRequest({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'secret' }
    })).toEqual({
      ok: true,
      value: {
        name: 'github',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { GITHUB_TOKEN: 'secret' }
      }
    });

    expect(validateMcpAddRequest({
      name: 'github',
      transport: 'stdio',
      command: 'node'
    })).toEqual({
      ok: true,
      value: {
        name: 'github',
        transport: 'stdio',
        command: 'node',
        args: [],
        env: {}
      }
    });

    expect(validateMcpAddRequest({ name: 'bad name', transport: 'stdio', command: 'node' })).toEqual({
      ok: false,
      message: 'name must be a valid MCP server name'
    });
    expect(validateMcpAddRequest({ name: 'github', transport: 'stdio', command: '' })).toEqual({
      ok: false,
      message: 'command must be a non-empty string'
    });
    expect(validateMcpAddRequest({ name: 'github', transport: 'stdio', command: 'node', args: 'server.js' })).toEqual({
      ok: false,
      message: 'args must be an array of strings'
    });
    expect(validateMcpAddRequest({ name: 'github', transport: 'stdio', command: 'node', env: { 'BAD-NAME': 'secret' } })).toEqual({
      ok: false,
      message: 'env keys must be valid environment variable names'
    });
    expect(validateMcpAddRequest({ name: 'github', transport: 'stdio', command: 'node', env: { TOKEN: 1 } })).toEqual({
      ok: false,
      message: 'env values must be strings'
    });
    expect(validateMcpAddRequest(new CustomMcpRequest())).toEqual({
      ok: false,
      message: 'body must be an object'
    });
    expect(validateMcpAddRequest(new Date())).toEqual({
      ok: false,
      message: 'body must be an object'
    });
    expect(validateMcpAddRequest({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      env: new Date()
    })).toEqual({
      ok: false,
      message: 'env must be an object'
    });
    expect(validateMcpAddRequest({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      env: new CustomMcpRequest()
    })).toEqual({
      ok: false,
      message: 'env must be an object'
    });
  });

  it('validates url add requests and capability gates', () => {
    const request = {
      name: 'remote',
      transport: 'http' as const,
      url: 'https://example.test/mcp',
      bearerTokenEnvVar: 'REMOTE_TOKEN'
    };

    expect(validateMcpAddRequest(request)).toEqual({ ok: true, value: { ...request, env: {} } });
    expect(validateMcpAddRequest({ ...request, url: 'http://example.test/mcp' })).toEqual({
      ok: true,
      value: { ...request, url: 'http://example.test/mcp', env: {} }
    });
    expect(validateMcpAddRequest({ ...request, url: 'file:///tmp/mcp' })).toEqual({
      ok: false,
      message: 'url must use http or https'
    });
    expect(validateMcpAddRequest({ ...request, bearerTokenEnvVar: 'BAD-NAME' })).toEqual({
      ok: false,
      message: 'bearerTokenEnvVar must be a valid environment variable name'
    });
    expect(validateMcpAddRequest({ ...request, oauthClientId: 1 })).toEqual({
      ok: false,
      message: 'oauthClientId must be a string'
    });
    expect(validateMcpAddRequest({ ...request, oauthResource: 1 })).toEqual({
      ok: false,
      message: 'oauthResource must be a string'
    });
    expect(validateMcpAddRequest({ ...request, confirmWriteToCodexHome: false })).toEqual({
      ok: false,
      message: 'confirmWriteToCodexHome must be true when provided'
    });

    expect(assertMcpAddRequestSupported(request, allCapabilities)).toEqual({ ok: true });
    expect(assertMcpAddRequestSupported(request, { ...allCapabilities, mcpAdd: false })).toEqual({
      ok: false,
      code: 'CODEX_INCOMPATIBLE',
      message: 'Current Codex does not support mcp add'
    });
    expect(assertMcpAddRequestSupported(request, { ...allCapabilities, mcpAddBearerTokenEnvVar: false })).toEqual({
      ok: false,
      code: 'CODEX_INCOMPATIBLE',
      message: 'Current Codex does not support --bearer-token-env-var for mcp add'
    });
    expect(assertMcpAddRequestSupported({
      name: 'oauth',
      transport: 'sse',
      url: 'https://example.test/sse',
      env: {},
      oauthClientId: 'client',
      oauthResource: 'https://example.test'
    }, { ...allCapabilities, mcpAddOAuth: false })).toEqual({
      ok: false,
      code: 'CODEX_INCOMPATIBLE',
      message: 'Current Codex does not support OAuth flags for mcp add'
    });
    expect(assertMcpAddRequestSupported({
      name: 'remote',
      transport: 'http',
      url: 'https://example.test/mcp',
      env: { REMOTE_TOKEN: 'secret' }
    }, { ...allCapabilities, mcpAddEnv: false })).toEqual({
      ok: false,
      code: 'CODEX_INCOMPATIBLE',
      message: 'Current Codex does not support --env for mcp add'
    });
    expect(assertMcpAddRequestSupported({
      name: 'remote',
      transport: 'http',
      url: 'https://example.test/mcp',
      env: {}
    }, { ...allCapabilities, mcpAddUrl: false })).toEqual({
      ok: false,
      code: 'CODEX_INCOMPATIBLE',
      message: 'Current Codex does not support --url for mcp add'
    });
  });
});
