import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Fastify from 'fastify';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentCapabilityTokenStore } from '../../src/agent-tools/capability-token.js';
import { registerKnowledgeMcpRoute } from '../../src/agent-tools/mcp-routes.js';
import { KnowledgeConversationError } from '../../src/enterprise/knowledge-conversation-2026-08-05.js';

const servers: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

describe('knowledge MCP API', () => {
  it('binds search to the token thread, rejects arbitrary tools, and returns sanitized sources', async () => {
    const capabilities = createAgentCapabilityTokenStore();
    const search = vi.fn(async (threadId: string, query: string, limit: number) => [{
      title: 'Leave policy',
      knowledgeBaseName: 'HR',
      documentName: 'Handbook',
      excerpt: 'Annual leave is 12 days.',
      internalDocumentId: 'doc-secret',
      accessToken: 'must-not-leak'
    }]);
    const server = Fastify();
    servers.push(server);
    await registerKnowledgeMcpRoute(server, {
      capabilities,
      manager: { search } as never
    });
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address() as AddressInfo;
    const token = capabilities.issue({
      runId: 'run-a',
      threadId: 'thread-a',
      createdBy: 'api',
      scopes: ['knowledge:search']
    }).token;
    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/internal/agent-tools/mcp/knowledge`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    );
    await client.connect(transport);

    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['knowledge.search']);
    const result = await client.callTool({
      name: 'knowledge.search',
      arguments: { query: 'leave', limit: 5 }
    });
    expect(search).toHaveBeenCalledWith('thread-a', 'leave', 5);
    expect(result.structuredContent).toEqual({
      sources: [{
        title: 'Leave policy',
        knowledgeBaseName: 'HR',
        documentName: 'Handbook',
        excerpt: 'Annual leave is 12 days.'
      }]
    });
    expect(JSON.stringify(result)).not.toContain('doc-secret');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');

    const unknownTool = await client.callTool({
      name: 'knowledge.delete',
      arguments: {}
    });
    expect(unknownTool.isError).toBe(true);
    const forged = await client.callTool({
      name: 'knowledge.search',
      arguments: { query: 'leave', threadId: 'thread-b' }
    });
    expect(forged.isError).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);

    await client.close();
    capabilities.close();
  });

  it('rejects non-knowledge capability scopes and sanitizes upstream failures', async () => {
    const capabilities = createAgentCapabilityTokenStore();
    const server = Fastify();
    servers.push(server);
    await registerKnowledgeMcpRoute(server, {
      capabilities,
      manager: {
        search: vi.fn(async () => {
          throw new KnowledgeConversationError(503, 'ENTERPRISE_KNOWLEDGE_UNAVAILABLE');
        })
      } as never
    });
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/internal/agent-tools/mcp/knowledge`;
    const scheduleToken = capabilities.issue({
      runId: 'run-schedule',
      threadId: 'thread-schedule',
      createdBy: 'api',
      scopes: ['schedule:get']
    }).token;
    const forbidden = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${scheduleToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });
    expect(forbidden.status).toBe(403);

    const token = capabilities.issue({
      runId: 'run-a',
      threadId: 'thread-a',
      createdBy: 'api',
      scopes: ['knowledge:search']
    }).token;
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    }));
    const result = await client.callTool({
      name: 'knowledge.search',
      arguments: { query: 'leave' }
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Enterprise knowledge search failed');
    expect(JSON.stringify(result)).not.toContain('ENTERPRISE_KNOWLEDGE_UNAVAILABLE');
    await client.close();
    capabilities.close();
  });
});
