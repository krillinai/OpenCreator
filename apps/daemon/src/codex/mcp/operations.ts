import type {
  CodexMcpOperationResponse,
  CodexMcpOperationStatus,
  CodexMcpOperationType
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export type InsertMcpOperationInput = {
  operation: CodexMcpOperationType;
  serverName?: string | null;
  codexHome: string;
  command: string[];
  status: CodexMcpOperationStatus;
  exitCode?: number | null;
  timedOut: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type McpOperationRepository = {
  insertOperation(input: InsertMcpOperationInput): CodexMcpOperationResponse;
  listOperations(limit?: number): CodexMcpOperationResponse[];
};

export function createMcpOperationRepository(db: Database.Database): McpOperationRepository {
  const insert = db.prepare(`
    INSERT INTO codex_mcp_operations (
      id, operation, server_name, codex_home, command_json, status,
      exit_code, timed_out, error_code, error_message
    ) VALUES (
      @id, @operation, @serverName, @codexHome, @commandJson, @status,
      @exitCode, @timedOut, @errorCode, @errorMessage
    )
  `);
  const get = db.prepare<string>('SELECT * FROM codex_mcp_operations WHERE id = ?');
  const list = db.prepare<{ limit: number }>(`
    SELECT *
    FROM codex_mcp_operations
    ORDER BY rowid DESC
    LIMIT @limit
  `);

  return {
    insertOperation(input): CodexMcpOperationResponse {
      const id = `mcpop_${nanoid()}`;
      insert.run({
        id,
        serverName: null,
        exitCode: null,
        errorCode: null,
        errorMessage: null,
        ...input,
        commandJson: JSON.stringify(input.command),
        timedOut: input.timedOut ? 1 : 0
      });
      const row = get.get(id) as McpOperationRow;
      return mapRow(row);
    },
    listOperations(limit = 50): CodexMcpOperationResponse[] {
      const normalizedLimit = Math.max(1, Math.min(limit, 200));
      return (list.all({ limit: normalizedLimit }) as McpOperationRow[]).map(mapRow);
    }
  };
}

type McpOperationRow = {
  id: string;
  operation: CodexMcpOperationType;
  server_name: string | null;
  codex_home: string;
  command_json: string;
  status: CodexMcpOperationStatus;
  exit_code: number | null;
  timed_out: 0 | 1;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

function mapRow(row: McpOperationRow): CodexMcpOperationResponse {
  return {
    id: row.id,
    operation: row.operation,
    serverName: row.server_name,
    codexHome: row.codex_home,
    command: JSON.parse(row.command_json) as string[],
    status: row.status,
    exitCode: row.exit_code,
    timedOut: row.timed_out === 1,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}
