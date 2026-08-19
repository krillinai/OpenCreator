import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import {
  AGENT_TOOL_BASE_URL_ENV,
  AGENT_TOOL_CAPABILITY_TOKEN_ENV
} from './run-injection.js';
import {
  createAgentScheduleHttpClient,
  createAgentScheduleToolDefinitions,
  type AgentScheduleToolName
} from './schedule-tools.js';

export async function startAgentScheduleStdioServer(
  env: NodeJS.ProcessEnv = process.env
): Promise<McpServer> {
  const baseUrl = requireEnvironment(env, AGENT_TOOL_BASE_URL_ENV);
  const token = requireEnvironment(env, AGENT_TOOL_CAPABILITY_TOKEN_ENV);
  const client = createAgentScheduleHttpClient({ baseUrl, token });
  const server = createAgentScheduleMcpServer({
    request: request => client.request(request)
  });
  await server.connect(new StdioServerTransport());
  return server;
}

export function createAgentScheduleMcpServer(input: {
  request: ReturnType<typeof createAgentScheduleHttpClient>['request'];
  defaultTimezone?: string;
  enabledTools?: AgentScheduleToolName[];
}): McpServer {
  const tools = createAgentScheduleToolDefinitions({
    request: input.request,
    defaultTimezone: input.defaultTimezone
  });
  const server = new McpServer({
    name: 'opencreator-schedule-tools',
    version: '0.1.0'
  });

  const enabledTools = input.enabledTools === undefined
    ? undefined
    : new Set(input.enabledTools);
  for (const [name, tool] of Object.entries(tools)) {
    if (
      enabledTools !== undefined
      && !enabledTools.has(name as AgentScheduleToolName)
    ) {
      continue;
    }
    server.registerTool(name, {
      description: tool.description,
      inputSchema: tool.inputSchema
    }, async args => {
      try {
        const result = await tool.execute(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result)
          }],
          structuredContent: result
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: error instanceof Error
              ? error.message
              : 'OpenCreator schedule tool failed'
          }]
        };
      }
    });
  }
  return server;
}

function requireEnvironment(
  env: NodeJS.ProcessEnv,
  name: string
): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error('OpenCreator schedule tool environment is incomplete');
  }
  return value;
}

if (
  process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void startAgentScheduleStdioServer().catch(() => {
    console.error('OpenCreator schedule MCP server failed to start');
    process.exitCode = 1;
  });
}
