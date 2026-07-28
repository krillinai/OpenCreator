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
  readBearerToken
} from './internal-routes.js';
import {
  createAgentScheduleHttpClient
} from './schedule-tools.js';
import { createAgentScheduleMcpServer } from './stdio-server.js';
import { toolNamesForScopes } from './run-injection.js';

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
        return reply.code(503).send(jsonRpcError('Clawee runtime is not listening'));
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
