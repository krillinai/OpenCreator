import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { McpManager } from '../codex/mcp/manager.js';
import { isValidMcpName, validateMcpAddRequest } from '../codex/mcp/validator.js';
import { apiError } from './errors.js';

export async function registerMcpRoutes(
  server: FastifyInstance,
  input: { mcpManager: McpManager }
): Promise<void> {
  server.get('/codex/mcp', async () => input.mcpManager.listServers());

  server.get<{ Querystring: { limit?: string } }>('/codex/mcp/operations', async (request) => {
    return { operations: input.mcpManager.listOperations(parseLimit(request.query.limit)) };
  });

  server.get<{ Params: { name: string } }>('/codex/mcp/:name', async (request, reply) => {
    if (!isValidMcpName(request.params.name)) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'name must be a valid MCP server name'));
    }

    try {
      const server = await input.mcpManager.getServer(request.params.name);
      if (server.status === 'missing') {
        return reply.code(404).send(apiError('MCP_SERVER_NOT_FOUND', 'MCP server not found'));
      }
      return { server };
    } catch (error) {
      return sendMcpError(error, reply);
    }
  });

  server.post<{ Body: unknown }>('/codex/mcp/add', async (request, reply) => {
    const body = validateMcpAddRequest(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

    try {
      const result = await input.mcpManager.addServer(body.value);
      return reply.code(201).send(result);
    } catch (error) {
      return sendMcpError(error, reply);
    }
  });

  server.patch<{ Params: { name: string }; Body: unknown }>(
    '/codex/mcp/:name',
    async (request, reply) => {
      if (!isValidMcpName(request.params.name)) {
        return reply.code(400).send(
          apiError('VALIDATION_FAILED', 'name must be a valid MCP server name')
        );
      }
      const parsed = z.object({
        enabled: z.boolean(),
        confirmWriteToCodexHome: z.literal(true).optional()
      }).strict().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          apiError('VALIDATION_FAILED', 'enabled must be a boolean')
        );
      }
      try {
        return await input.mcpManager.setServerEnabled(
          request.params.name,
          parsed.data.enabled,
          parsed.data.confirmWriteToCodexHome === true
        );
      } catch (error) {
        return sendMcpError(error, reply);
      }
    }
  );

  server.delete<{ Params: { name: string }; Querystring: { confirmWriteToCodexHome?: string } }>(
    '/codex/mcp/:name',
    async (request, reply) => {
      if (!isValidMcpName(request.params.name)) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'name must be a valid MCP server name'));
      }

      try {
        const result = await input.mcpManager.removeServer(
          request.params.name,
          request.query.confirmWriteToCodexHome === 'true'
        );
        return { removed: result.removed };
      } catch (error) {
        return sendMcpError(error, reply);
      }
    }
  );

  server.post<{
    Params: { name: string };
    Querystring: { confirmWriteToCodexHome?: string };
    Body: unknown;
  }>(
    '/codex/mcp/:name/login',
    async (request, reply) => handleAuthOperation(request.params.name, reply, () =>
      input.mcpManager.loginServer(
        request.params.name,
        isWriteConfirmed(request.query.confirmWriteToCodexHome, request.body)
      )
    )
  );

  server.post<{
    Params: { name: string };
    Querystring: { confirmWriteToCodexHome?: string };
    Body: unknown;
  }>(
    '/codex/mcp/:name/logout',
    async (request, reply) => handleAuthOperation(request.params.name, reply, () =>
      input.mcpManager.logoutServer(
        request.params.name,
        isWriteConfirmed(request.query.confirmWriteToCodexHome, request.body)
      )
    )
  );
}

async function handleAuthOperation(
  name: string,
  reply: FastifyReply,
  operation: () => Promise<{ operation: unknown }>
) {
  if (!isValidMcpName(name)) {
    return reply.code(400).send(apiError('VALIDATION_FAILED', 'name must be a valid MCP server name'));
  }

  try {
    return await operation();
  } catch (error) {
    return sendMcpError(error, reply);
  }
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 200));
}

function isWriteConfirmed(queryValue: string | undefined, body: unknown): boolean {
  if (queryValue === 'true') return true;
  return isPlainObject(body) && body.confirmWriteToCodexHome === true;
}

function sendMcpError(error: unknown, reply: FastifyReply) {
  const code = getCodexErrorCode(error);
  if (code === 'MCP_WRITE_CONFIRMATION_REQUIRED') {
    return reply
      .code(409)
      .send(apiError(code, 'Global CODEX_HOME MCP write requires confirmation'));
  }
  if (code === 'MCP_SERVER_NOT_FOUND') {
    return reply.code(404).send(apiError(code, 'MCP server not found'));
  }
  if (code === 'MCP_SERVER_EXISTS') {
    return reply.code(409).send(apiError(code, 'MCP server already exists'));
  }
  if (code === 'MCP_SERVER_INVALID') {
    return reply.code(422).send(apiError(code, 'MCP server is invalid'));
  }
  if (code === 'CODEX_INCOMPATIBLE') {
    return reply.code(501).send(apiError(code, 'Codex does not support this MCP operation'));
  }
  return reply.code(502).send(apiError('MCP_COMMAND_FAILED', 'Codex MCP command failed'));
}

function getCodexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.split(':', 1)[0];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
