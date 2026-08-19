import type { RuntimeErrorCode } from '@opencreator/protocol';

export type McpTransport = 'stdio' | 'http' | 'sse';

export type AddMcpServerInput =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      confirmWriteToCodexHome?: true;
    }
  | {
      name: string;
      transport: 'http' | 'sse';
      url: string;
      env?: Record<string, string>;
      oauthClientId?: string;
      oauthResource?: string;
      bearerTokenEnvVar?: string;
      confirmWriteToCodexHome?: true;
    };

export type NormalizedAddMcpServerInput =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
      confirmWriteToCodexHome?: true;
    }
  | {
      name: string;
      transport: 'http' | 'sse';
      url: string;
      env: Record<string, string>;
      oauthClientId?: string;
      oauthResource?: string;
      bearerTokenEnvVar?: string;
      confirmWriteToCodexHome?: true;
    };

export type McpAddCapabilityFlags = {
  mcpAdd: boolean;
  mcpAddEnv: boolean;
  mcpAddUrl: boolean;
  mcpAddBearerTokenEnvVar: boolean;
  mcpAddOAuth: boolean;
};

export type McpValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export type McpCapabilityResult =
  | { ok: true }
  | { ok: false; code: RuntimeErrorCode; message: string };
