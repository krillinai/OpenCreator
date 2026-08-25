import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from 'fastify';
import type { AgentCapabilityTokenStore } from './capability-token.js';
import { AgentCapabilityTokenError } from './capability-token.js';
import {
  AGENT_SCHEDULE_MCP_ROUTE,
  AGENT_TOOL_ROUTE_PREFIX,
  readBearerToken
} from './internal-routes.js';
import {
  createAgentScheduleHttpClient
} from './schedule-tools.js';
import { createAgentScheduleMcpServer } from './stdio-server.js';
import { AGENT_KNOWLEDGE_MCP_ROUTE, toolNamesForScopes } from './run-injection.js';
import {
  createKnowledgeMcpServer
} from './knowledge-tools-2026-08-05.js';
import type {
  KnowledgeConversationManager
} from '../enterprise/knowledge-conversation-2026-08-05.js';
import {
  createCreatorToolDefinitions,
  createCreatorToolHttpClient,
  type CreatorToolName
} from './creator-tools.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const AGENT_CREATOR_MCP_ROUTE = `${AGENT_TOOL_ROUTE_PREFIX}/mcp/creator`;

export async function registerCreatorMcpRoute(
  fastify: FastifyInstance,
  input: { capabilities: AgentCapabilityTokenStore; getBaseUrl(): string | undefined }
): Promise<void> {
  fastify.post<{ Body: unknown }>(AGENT_CREATOR_MCP_ROUTE, async (request, reply) => {
    const authorization = authorizeMcpRequest(request, reply, input.capabilities);
    if (authorization === undefined) return;
    const baseUrl = input.getBaseUrl();
    if (baseUrl === undefined) return reply.code(503).send(jsonRpcError('OpenCreator runtime is not listening'));
    const allowed = new Set(authorization.grant.scopes);
    const names: CreatorToolName[] = [
      ...(allowed.has('creator:context') ? ['creator_get_context' as const] : []),
      ...(allowed.has('creator:artifact:read') ? ['creator_get_artifact' as const] : []),
      ...(allowed.has('creator:action') ? ['creator_apply_action' as const] : [])
    ];
    const client = createCreatorToolHttpClient({ baseUrl, token: authorization.token });
    const definitions = createCreatorToolDefinitions({ request: client.request });
    const mcpServer = new McpServer({ name: 'opencreator-tools', version: '0.1.0' });
    for (const name of names) {
      const tool = definitions[name];
      mcpServer.registerTool(name, {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: name === 'creator_apply_action'
          ? { readOnlyHint: false }
          : {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false
            }
      } as never, (async (args: unknown) => {
        try {
          const result = await tool.execute(args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Creator tool failed' }]
          };
        }
      }) as never);
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let cleanupWork: Promise<void> | undefined;
    const cleanup = () => cleanupWork ??= Promise.allSettled([transport.close(), mcpServer.close()]).then(() => undefined);
    reply.raw.once('finish', () => void cleanup());
    reply.raw.once('close', () => void cleanup());
    reply.hijack();
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify(jsonRpcError('Internal Creator MCP server error')));
      } else if (!reply.raw.writableEnded) reply.raw.end();
      await cleanup();
    }
  });
  fastify.get(AGENT_CREATOR_MCP_ROUTE, async (_request, reply) => reply.code(405).send(jsonRpcError('Method not allowed')));
  fastify.delete(AGENT_CREATOR_MCP_ROUTE, async (_request, reply) => reply.code(405).send(jsonRpcError('Method not allowed')));
}

export async function registerAgentScheduleMcpRoute(
  fastify: FastifyInstance,
  input: {
    capabilities: AgentCapabilityTokenStore;
    getBaseUrl(): string | undefined;
  }
): Promise<void> {
  fastify.post<{ Body: unknown }>(
    AGENT_SCHEDULE_MCP_ROUTE,
    async (request, reply) => {
      const authorization = authorizeMcpRequest(request, reply, input.capabilities);
      if (authorization === undefined) return;
      const baseUrl = input.getBaseUrl();
      if (baseUrl === undefined) {
        return reply.code(503).send(jsonRpcError('OpenCreator runtime is not listening'));
      }

      const scheduleClient = createAgentScheduleHttpClient({
        baseUrl,
        token: authorization.token
      });
      const mcpServer = createAgentScheduleMcpServer({
        request: scheduleClient.request,
        enabledTools: toolNamesForScopes(authorization.grant.scopes)
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      let cleanupWork: Promise<void> | undefined;
      const cleanup = () => {
        cleanupWork ??= Promise.allSettled([
          transport.close(),
          mcpServer.close()
        ]).then(() => undefined);
        return cleanupWork;
      };
      reply.raw.once('finish', () => void cleanup());
      reply.raw.once('close', () => void cleanup());
      reply.hijack();

      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch {
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'content-type': 'application/json' });
          reply.raw.end(JSON.stringify(jsonRpcError('Internal MCP server error')));
        } else if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
        await cleanup();
      }
    }
  );

  fastify.get(AGENT_SCHEDULE_MCP_ROUTE, async (_request, reply) =>
    reply.code(405).send(jsonRpcError('Method not allowed')));
  fastify.delete(AGENT_SCHEDULE_MCP_ROUTE, async (_request, reply) =>
    reply.code(405).send(jsonRpcError('Method not allowed')));
}

export async function registerKnowledgeMcpRoute(
  fastify: FastifyInstance,
  input: {
    capabilities: AgentCapabilityTokenStore;
    manager: KnowledgeConversationManager;
  }
): Promise<void> {
  fastify.post<{ Body: unknown }>(AGENT_KNOWLEDGE_MCP_ROUTE, async (request, reply) => {
    const authorization = authorizeMcpRequest(request, reply, input.capabilities);
    if (authorization === undefined) return;
    try {
      input.capabilities.authorize(authorization.token, {
        scope: 'knowledge:search',
        runId: authorization.grant.runId,
        threadId: authorization.grant.threadId
      });
    } catch (error) {
      if (!(error instanceof AgentCapabilityTokenError)) throw error;
      return reply.code(error.statusCode).send(jsonRpcError('Capability does not allow knowledge search'));
    }
    const mcpServer = createKnowledgeMcpServer({
      threadId: authorization.grant.threadId,
      manager: input.manager
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let cleanupWork: Promise<void> | undefined;
    const cleanup = () => {
      cleanupWork ??= Promise.allSettled([transport.close(), mcpServer.close()])
        .then(() => undefined);
      return cleanupWork;
    };
    reply.raw.once('finish', () => void cleanup());
    reply.raw.once('close', () => void cleanup());
    reply.hijack();
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify(jsonRpcError('Internal MCP server error')));
      } else if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
      await cleanup();
    }
  });
  fastify.get(AGENT_KNOWLEDGE_MCP_ROUTE, async (_request, reply) =>
    reply.code(405).send(jsonRpcError('Method not allowed')));
  fastify.delete(AGENT_KNOWLEDGE_MCP_ROUTE, async (_request, reply) =>
    reply.code(405).send(jsonRpcError('Method not allowed')));
}

function authorizeMcpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  capabilities: AgentCapabilityTokenStore
): {
  token: string;
  grant: ReturnType<AgentCapabilityTokenStore['inspect']>;
} | undefined {
  const token = readBearerToken(request.headers.authorization);
  try {
    const grant = capabilities.inspect(token);
    return { token: token!, grant };
  } catch (error) {
    if (!(error instanceof AgentCapabilityTokenError)) throw error;
    reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.code === 'CAPABILITY_TOKEN_MISSING'
          ? 'Capability token required'
          : 'Capability token is invalid'
      }
    });
    return undefined;
  }
}

function jsonRpcError(message: string) {
  return {
    jsonrpc: '2.0',
    error: {
      code: -32603,
      message
    },
    id: null
  };
}
