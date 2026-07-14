import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { CodexMcpServerConfig } from '../codex/argv.js';
import type { RuntimeThread } from '../threads/types.js';
import {
  type AgentCapabilityScope,
  type AgentCapabilityTokenStore
} from './capability-token.js';
import {
  AGENT_SCHEDULE_TOOL_NAMES,
  type AgentScheduleToolName
} from './schedule-tools.js';

export const AGENT_SCHEDULE_MCP_SERVER_NAME = 'clawee_schedule';
export const AGENT_TOOL_BASE_URL_ENV = 'CLAWEE_AGENT_TOOL_URL';
export const AGENT_TOOL_CAPABILITY_TOKEN_ENV = 'CLAWEE_AGENT_CAPABILITY_TOKEN';

export type AgentToolRunInjection = {
  mcpServers: CodexMcpServerConfig[];
  env: Record<string, string>;
};

export type AgentScheduleRunInjector = {
  prepare(input: {
    runId: string;
    thread: RuntimeThread;
    createdBy: 'api' | 'schedule';
  }): AgentToolRunInjection | undefined;
};

const TOOL_SCOPES: Array<{
  name: AgentScheduleToolName;
  scope: AgentCapabilityScope;
}> = [
  { name: 'clawee_schedule_create', scope: 'schedule:create' },
  { name: 'clawee_schedule_update', scope: 'schedule:update' },
  { name: 'clawee_schedule_pause', scope: 'schedule:pause' },
  { name: 'clawee_schedule_resume', scope: 'schedule:resume' },
  { name: 'clawee_schedule_run_now', scope: 'schedule:run_now' },
  { name: 'clawee_schedule_get', scope: 'schedule:get' }
];

export function createAgentScheduleRunInjector(input: {
  capabilities: AgentCapabilityTokenStore;
  getBaseUrl(): string | undefined;
  command: string;
  args: string[];
}): AgentScheduleRunInjector {
  return {
    prepare(run) {
      const baseUrl = input.getBaseUrl();
      if (baseUrl === undefined) return undefined;

      const allowed = allowedTools(run.createdBy, run.thread);
      const scopes = allowed.map(tool => tool.scope);
      const issued = input.capabilities.issue({
        runId: run.runId,
        threadId: run.thread.id,
        createdBy: run.createdBy,
        scopes
      });
      return {
        mcpServers: [{
          name: AGENT_SCHEDULE_MCP_SERVER_NAME,
          command: input.command,
          args: input.args,
          envVars: [
            AGENT_TOOL_BASE_URL_ENV,
            AGENT_TOOL_CAPABILITY_TOKEN_ENV
          ],
          enabledTools: allowed.map(tool => tool.name),
          required: true,
          startupTimeoutSec: 10,
          toolTimeoutSec: 30
        }],
        env: {
          [AGENT_TOOL_BASE_URL_ENV]: baseUrl,
          [AGENT_TOOL_CAPABILITY_TOKEN_ENV]: issued.token
        }
      };
    }
  };
}

export function resolveAgentScheduleStdioCommand(): {
  command: string;
  args: string[];
} {
  const sourcePath = fileURLToPath(new URL('./stdio-server.ts', import.meta.url));
  if (existsSync(sourcePath)) {
    return {
      command: process.execPath,
      args: [
        '--import',
        createRequire(import.meta.url).resolve('tsx'),
        sourcePath
      ]
    };
  }
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('./stdio-server.js', import.meta.url))]
  };
}

function allowedTools(
  createdBy: 'api' | 'schedule',
  thread: RuntimeThread
): typeof TOOL_SCOPES {
  if (createdBy === 'schedule') {
    return TOOL_SCOPES.filter(tool => tool.scope === 'schedule:get');
  }
  if (thread.purpose === 'schedule_task') {
    return TOOL_SCOPES.filter(tool => tool.scope !== 'schedule:create');
  }
  return TOOL_SCOPES.filter(tool =>
    AGENT_SCHEDULE_TOOL_NAMES.includes(tool.name)
  );
}
