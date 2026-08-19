import type {
  CodexMcpListResponse,
  CodexMcpOperationResponse,
  CodexMcpOperationType,
  CodexMcpServerResponse
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import type { RuntimeCapabilityMatrix } from '../capabilities.js';
import type { ResolvedCodexHome } from '../home.js';
import {
  buildMcpAddArgs,
  buildMcpGetArgs,
  buildMcpListArgs,
  buildMcpLoginArgs,
  buildMcpLogoutArgs,
  buildMcpRemoveArgs
} from './argv.js';
import { setCodexMcpServerEnabled } from './config-store-2026-08-12.js';
import { createMcpOperationRepository } from './operations.js';
import { isMcpNotFoundOutput, parseMcpGetOutput, parseMcpListOutput } from './parser.js';
import { runMcpCommand, type McpCommandResult } from './runner.js';
import type { AddMcpServerInput, McpAddCapabilityFlags } from './types.js';
import { assertMcpAddRequestSupported } from './validator.js';

export type McpManager = {
  listServers(): Promise<CodexMcpListResponse>;
  getServer(name: string): Promise<CodexMcpServerResponse>;
  addServer(input: AddMcpServerInput): Promise<{
    server?: CodexMcpServerResponse;
    operation: CodexMcpOperationResponse;
  }>;
  removeServer(
    name: string,
    confirmed: boolean
  ): Promise<{ removed: true; operation: CodexMcpOperationResponse }>;
  setServerEnabled(
    name: string,
    enabled: boolean,
    confirmed: boolean
  ): Promise<{
    server: CodexMcpServerResponse;
    operation: CodexMcpOperationResponse;
  }>;
  loginServer(name: string, confirmed: boolean): Promise<{ operation: CodexMcpOperationResponse }>;
  logoutServer(name: string, confirmed: boolean): Promise<{ operation: CodexMcpOperationResponse }>;
  listOperations(limit?: number): CodexMcpOperationResponse[];
};

export function createMcpManager(input: {
  codexBin: string;
  codexHome: ResolvedCodexHome;
  db: Database.Database;
  capabilities: Pick<RuntimeCapabilityMatrix, keyof McpAddCapabilityFlags>;
  timeoutMs?: number;
  onConfigurationChanged?(reason: string): void;
}): McpManager {
  const operations = createMcpOperationRepository(input.db);
  let configWriteQueue = Promise.resolve();

  const run = (
    operation: CodexMcpOperationType,
    serverName: string | null,
    args: string[],
    sensitiveValues: string[] = []
  ) => {
    const result = runMcpCommand({
      codexBin: input.codexBin,
      codexHome: input.codexHome.path,
      args,
      timeoutMs: input.timeoutMs,
      sensitiveValues
    });
    const operationResponse = operations.insertOperation({
      operation,
      serverName,
      codexHome: input.codexHome.path,
      command: result.redactedCommand,
      status: result.exitCode === 0 ? 'succeeded' : 'failed',
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ...(result.exitCode === 0
        ? {}
        : {
            errorCode: getMcpErrorCode(result),
            errorMessage: getMcpErrorMessage(result)
          })
    });
    return { result, operation: operationResponse };
  };

  const listServers = async (): Promise<CodexMcpListResponse> => {
    const { result } = run('list', null, buildMcpListArgs());
    if (result.exitCode !== 0) {
      return {
        codexHome: input.codexHome.path,
        codexHomeMode: input.codexHome.mode,
        requiresWriteConfirmation: input.codexHome.mode === 'global',
        servers: [],
        diagnostics: [getMcpErrorMessage(result)]
      };
    }
    return parseMcpListOutput({
      codexHome: input.codexHome.path,
      codexHomeMode: input.codexHome.mode,
      stdout: result.stdout,
      stderr: result.redactedStderr,
      exitCode: result.exitCode
    });
  };

  const getServer = async (name: string): Promise<CodexMcpServerResponse> => {
    const { result } = run('get', name, buildMcpGetArgs(name));
    assertCommandSucceeded(result);
    return parseMcpGetOutput({
      name,
      codexHome: input.codexHome.path,
      codexHomeMode: input.codexHome.mode,
      stdout: result.stdout,
      stderr: result.redactedStderr,
      exitCode: result.exitCode
    });
  };

  const addServer: McpManager['addServer'] = async (request) => {
    requireWriteConfirmation(input.codexHome, request.confirmWriteToCodexHome === true);
    const supported = assertMcpAddRequestSupported(request, input.capabilities);
    if (!supported.ok) {
      throw new Error(`${supported.code}: ${supported.message}`);
    }
    const { result, operation } = run(
      'add',
      request.name,
      buildMcpAddArgs(request),
      Object.values(request.env ?? {})
    );
    assertCommandSucceeded(result);
    input.onConfigurationChanged?.('codex_mcp_added');

    let server: CodexMcpServerResponse | undefined;
    try {
      server = await getServer(request.name);
    } catch {
      server = undefined;
    }
    return { server, operation };
  };

  const removeServer: McpManager['removeServer'] = async (name, confirmed) => {
    requireWriteConfirmation(input.codexHome, confirmed);
    const { result, operation } = run('remove', name, buildMcpRemoveArgs(name));
    assertCommandSucceeded(result);
    input.onConfigurationChanged?.('codex_mcp_removed');
    return { removed: true, operation };
  };

  const setServerEnabled: McpManager['setServerEnabled'] = async (
    name,
    enabled,
    confirmed
  ) => {
    requireWriteConfirmation(input.codexHome, confirmed);
    const operationType = enabled ? 'enable' : 'disable';
    const command = [
      'config',
      'set',
      `mcp_servers.${name}.enabled=${String(enabled)}`
    ];
    let operation: CodexMcpOperationResponse;
    try {
      const write = configWriteQueue.then(() =>
        setCodexMcpServerEnabled({
          codexHome: input.codexHome.path,
          name,
          enabled
        })
      );
      configWriteQueue = write.catch(() => undefined);
      await write;
      operation = operations.insertOperation({
        operation: operationType,
        serverName: name,
        codexHome: input.codexHome.path,
        command,
        status: 'succeeded',
        exitCode: 0,
        timedOut: false
      });
      input.onConfigurationChanged?.(
        enabled ? 'codex_mcp_enabled' : 'codex_mcp_disabled'
      );
    } catch (error) {
      operations.insertOperation({
        operation: operationType,
        serverName: name,
        codexHome: input.codexHome.path,
        command,
        status: 'failed',
        exitCode: 1,
        timedOut: false,
        errorCode: getConfigWriteErrorCode(error),
        errorMessage: getConfigWriteErrorMessage(error)
      });
      throw error;
    }
    return {
      server: await getServer(name),
      operation
    };
  };

  const loginServer: McpManager['loginServer'] = async (name, confirmed) => {
    requireWriteConfirmation(input.codexHome, confirmed);
    const { result, operation } = run('login', name, buildMcpLoginArgs(name));
    assertCommandSucceeded(result);
    input.onConfigurationChanged?.('codex_mcp_login_changed');
    return { operation };
  };

  const logoutServer: McpManager['logoutServer'] = async (name, confirmed) => {
    requireWriteConfirmation(input.codexHome, confirmed);
    const { result, operation } = run('logout', name, buildMcpLogoutArgs(name));
    assertCommandSucceeded(result);
    input.onConfigurationChanged?.('codex_mcp_login_changed');
    return { operation };
  };

  return {
    listServers,
    getServer,
    addServer,
    removeServer,
    setServerEnabled,
    loginServer,
    logoutServer,
    listOperations(limit) {
      return operations.listOperations(limit);
    }
  };
}

function getConfigWriteErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'MCP_COMMAND_FAILED';
  return error.message.split(':', 1)[0] || 'MCP_COMMAND_FAILED';
}

function getConfigWriteErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Codex MCP config write failed';
  const separator = error.message.indexOf(':');
  return separator < 0
    ? error.message
    : error.message.slice(separator + 1).trim();
}

function requireWriteConfirmation(codexHome: ResolvedCodexHome, confirmed: boolean): void {
  if (codexHome.mode === 'global' && !confirmed) {
    throw new Error(
      'MCP_WRITE_CONFIRMATION_REQUIRED: global CODEX_HOME MCP write requires confirmation'
    );
  }
}

function assertCommandSucceeded(result: McpCommandResult): void {
  if (result.exitCode === 0) return;
  throw new Error(`${getMcpErrorCode(result)}: ${getMcpErrorMessage(result)}`);
}

function getMcpErrorCode(result: McpCommandResult): 'MCP_SERVER_NOT_FOUND' | 'MCP_COMMAND_FAILED' {
  return isMcpNotFoundOutput(`${result.stdout}\n${result.stderr}`) ? 'MCP_SERVER_NOT_FOUND' : 'MCP_COMMAND_FAILED';
}

function getMcpErrorMessage(result: McpCommandResult): string {
  const output = `${result.redactedStderr}${result.redactedStdout}`.trim();
  if (output.length > 0) {
    return output;
  }
  if (result.errorMessage !== null) {
    return result.errorMessage;
  }
  if (result.timedOut) {
    return 'codex mcp command timed out';
  }
  return 'codex mcp command failed';
}
