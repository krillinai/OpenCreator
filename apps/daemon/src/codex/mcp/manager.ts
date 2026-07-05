import type {
  CodexMcpListResponse,
  CodexMcpOperationResponse,
  CodexMcpOperationType,
  CodexMcpServerResponse
} from '@clawee/protocol';
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
}): McpManager {
  const operations = createMcpOperationRepository(input.db);

  const run = (operation: CodexMcpOperationType, serverName: string | null, args: string[]) => {
    const result = runMcpCommand({
      codexBin: input.codexBin,
      codexHome: input.codexHome.path,
      args,
      timeoutMs: input.timeoutMs
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

  const getServerWithoutOperation = async (name: string): Promise<CodexMcpServerResponse> => {
    const result = runMcpCommand({
      codexBin: input.codexBin,
      codexHome: input.codexHome.path,
      args: buildMcpGetArgs(name),
      timeoutMs: input.timeoutMs
    });
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

  return {
    async listServers() {
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
    },
    async getServer(name) {
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
    },
    async addServer(request) {
      const supported = assertMcpAddRequestSupported(request, input.capabilities);
      if (!supported.ok) {
        throw new Error(`${supported.code}: ${supported.message}`);
      }
      requireWriteConfirmation(input.codexHome, request.confirmWriteToCodexHome === true);
      const { result, operation } = run('add', request.name, buildMcpAddArgs(request));
      assertCommandSucceeded(result);

      let server: CodexMcpServerResponse | undefined;
      try {
        server = await getServerWithoutOperation(request.name);
      } catch {
        server = undefined;
      }
      return { server, operation };
    },
    async removeServer(name, confirmed) {
      requireWriteConfirmation(input.codexHome, confirmed);
      const { result, operation } = run('remove', name, buildMcpRemoveArgs(name));
      assertCommandSucceeded(result);
      return { removed: true, operation };
    },
    async loginServer(name, confirmed) {
      requireWriteConfirmation(input.codexHome, confirmed);
      const { result, operation } = run('login', name, buildMcpLoginArgs(name));
      assertCommandSucceeded(result);
      return { operation };
    },
    async logoutServer(name, confirmed) {
      requireWriteConfirmation(input.codexHome, confirmed);
      const { result, operation } = run('logout', name, buildMcpLogoutArgs(name));
      assertCommandSucceeded(result);
      return { operation };
    },
    listOperations(limit) {
      return operations.listOperations(limit);
    }
  };
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
