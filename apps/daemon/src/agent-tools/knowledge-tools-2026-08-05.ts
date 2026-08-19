import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  KnowledgeConversationManager
} from '../enterprise/knowledge-conversation-2026-08-05.js';

export const KNOWLEDGE_SEARCH_TOOL_NAME = 'knowledge.search';

const searchSchema = z.object({
  query: z.string().trim().min(1).max(4_000),
  limit: z.number().int().min(1).max(20).optional()
}).strict();

export function createKnowledgeMcpServer(input: {
  threadId: string;
  manager: Pick<KnowledgeConversationManager, 'search'>;
}): McpServer {
  const server = new McpServer({
    name: 'opencreator-knowledge-tools',
    version: '0.1.0'
  });
  server.registerTool(KNOWLEDGE_SEARCH_TOOL_NAME, {
    description: 'Search the enterprise knowledge sources authorized for the current account.',
    inputSchema: searchSchema
  }, async value => {
    try {
      const request = searchSchema.parse(value);
      const sources = await input.manager.search(
        input.threadId,
        request.query,
        request.limit ?? 8
      );
      const result = {
        sources: sources.map(source => ({
          title: source.title,
          knowledgeBaseName: source.knowledgeBaseName,
          documentName: source.documentName,
          excerpt: source.excerpt
        }))
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: knowledgeErrorMessage(error)
        }]
      };
    }
  });
  return server;
}

function knowledgeErrorMessage(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'KNOWLEDGE_SEARCH_NOT_GRANTED'
  ) {
    return 'Knowledge search is not granted';
  }
  return 'Enterprise knowledge search failed';
}
