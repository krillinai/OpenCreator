import type { BuiltInToolPolicy, CodexMcpServerConfig } from '../codex/argv.js';
import type { RuntimeThread } from '../threads/types.js';
import { isEnterpriseKnowledgeThread } from '../threads/types.js';
import {
  type AgentCapabilityScope,
  type AgentCapabilityTokenStore
} from './capability-token.js';
import {
  AGENT_SCHEDULE_TOOL_NAMES,
  type AgentScheduleToolName
} from './schedule-tools.js';
import { AGENT_SCHEDULE_MCP_ROUTE } from './internal-routes.js';
import { KNOWLEDGE_SEARCH_TOOL_NAME } from './knowledge-tools-2026-08-05.js';

export const AGENT_SCHEDULE_MCP_SERVER_NAME = 'opencreator_schedule';
export const AGENT_KNOWLEDGE_MCP_SERVER_NAME = 'opencreator_knowledge';
export const AGENT_CREATOR_MCP_SERVER_NAME = 'opencreator_tools';
export const AGENT_CREATOR_MCP_ROUTE = '/internal/agent-tools/mcp/creator';
export const AGENT_KNOWLEDGE_MCP_ROUTE = '/internal/agent-tools/mcp/knowledge';
export const AGENT_TOOL_BASE_URL_ENV = 'OPENCREATOR_AGENT_TOOL_URL';
export const AGENT_TOOL_CAPABILITY_TOKEN_ENV = 'OPENCREATOR_AGENT_CAPABILITY_TOKEN';

export type AgentToolRunInjection = {
  mcpServers: CodexMcpServerConfig[];
  env: Record<string, string>;
  builtInTools?: BuiltInToolPolicy;
  configurationFingerprint?: string;
};

export type RunMcpInjector = {
  prepare(input: {
    runId: string;
    thread: RuntimeThread;
    createdBy: 'api' | 'schedule';
  }):
    | AgentToolRunInjection
    | undefined
    | Promise<AgentToolRunInjection | undefined>;
};

export type AgentScheduleRunInjector = {
  prepare(input: {
    runId: string;
    thread: RuntimeThread;
    createdBy: 'api' | 'schedule';
  }): AgentToolRunInjection | undefined;
};

export type AgentToolProcessInjection = {
  mcpServers: CodexMcpServerConfig[];
  env: Record<string, string>;
  activate(input: {
    runId: string;
    thread: RuntimeThread;
    createdBy: 'api';
    processGeneration?: number;
    jobId?: string;
    projectId?: string;
    scopes?: AgentCapabilityScope[];
  }): {
    manifestKey: string;
  };
  deactivate(runId: string): void;
  close(): void;
};

export type AgentScheduleProcessInjector = {
  create(): AgentToolProcessInjection | undefined;
};

const TOOL_SCOPES: Array<{
  name: AgentScheduleToolName;
  scope: AgentCapabilityScope;
}> = [
  { name: 'opencreator_schedule_create', scope: 'schedule:create' },
  { name: 'opencreator_schedule_update', scope: 'schedule:update' },
  { name: 'opencreator_schedule_pause', scope: 'schedule:pause' },
  { name: 'opencreator_schedule_resume', scope: 'schedule:resume' },
  { name: 'opencreator_schedule_run_now', scope: 'schedule:run_now' },
  { name: 'opencreator_schedule_get', scope: 'schedule:get' }
];

export function createAgentScheduleRunInjector(input: {
  capabilities: AgentCapabilityTokenStore;
  getBaseUrl(): string | undefined;
  env?: NodeJS.ProcessEnv;
  knowledgeToolIsolationSupported?: boolean;
  scheduleToolsEnabled?: boolean;
}): AgentScheduleRunInjector {
  return {
    prepare(run) {
      const baseUrl = input.getBaseUrl();

      if (isEnterpriseKnowledgeThread(run.thread)) {
        if (
          input.knowledgeToolIsolationSupported !== true
          || baseUrl === undefined
        ) {
          throw new AgentToolPolicyError(
            'KNOWLEDGE_TOOL_POLICY_UNAVAILABLE',
            'Codex knowledge tool isolation is unavailable'
          );
        }
        const issued = input.capabilities.issue({
          runId: run.runId,
          threadId: run.thread.id,
          createdBy: run.createdBy,
          scopes: ['knowledge:search']
        });
        const noProxy = loopbackNoProxy(input.env ?? process.env);
        return {
          builtInTools: {
            shell: false,
            fileRead: false,
            fileWrite: false,
            applyPatch: false,
            webSearch: false
          },
          mcpServers: [{
            name: AGENT_KNOWLEDGE_MCP_SERVER_NAME,
            url: `${baseUrl}${AGENT_KNOWLEDGE_MCP_ROUTE}`,
            bearerTokenEnvVar: AGENT_TOOL_CAPABILITY_TOKEN_ENV,
            enabledTools: [KNOWLEDGE_SEARCH_TOOL_NAME],
            required: true,
            startupTimeoutSec: 10,
            toolTimeoutSec: 30
          }],
          env: {
            [AGENT_TOOL_CAPABILITY_TOKEN_ENV]: issued.token,
            NO_PROXY: noProxy,
            no_proxy: noProxy
          }
        };
      }

      if (baseUrl === undefined) return undefined;
      if (input.scheduleToolsEnabled === false) return undefined;

      const allowed = allowedTools(run.createdBy, run.thread);
      const scopes = allowed.map(tool => tool.scope);
      const issued = input.capabilities.issue({
        runId: run.runId,
        threadId: run.thread.id,
        createdBy: run.createdBy,
        scopes
      });
      const noProxy = loopbackNoProxy(input.env ?? process.env);
      return {
        mcpServers: [{
          name: AGENT_SCHEDULE_MCP_SERVER_NAME,
          url: `${baseUrl}${AGENT_SCHEDULE_MCP_ROUTE}`,
          bearerTokenEnvVar: AGENT_TOOL_CAPABILITY_TOKEN_ENV,
          enabledTools: allowed.map(tool => tool.name),
          required: true,
          startupTimeoutSec: 10,
          toolTimeoutSec: 30
        }],
        env: {
          [AGENT_TOOL_CAPABILITY_TOKEN_ENV]: issued.token,
          NO_PROXY: noProxy,
          no_proxy: noProxy
        }
      };
    }
  };
}

export class AgentToolPolicyError extends Error {
  constructor(readonly code: 'KNOWLEDGE_TOOL_POLICY_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'AgentToolPolicyError';
  }
}

export function createAgentScheduleProcessInjector(input: {
  capabilities: AgentCapabilityTokenStore;
  getBaseUrl(): string | undefined;
  env?: NodeJS.ProcessEnv;
  includeSchedule?: boolean;
  includeCreator?: boolean;
}): AgentScheduleProcessInjector {
  return {
    create() {
      const baseUrl = input.getBaseUrl();
      if (baseUrl === undefined) return undefined;
      const includeSchedule = input.includeSchedule ?? true;
      const includeCreator = input.includeCreator ?? true;
      const maxScopes: AgentCapabilityScope[] = [
        ...(includeSchedule ? TOOL_SCOPES.map(tool => tool.scope) : []),
        ...(includeCreator
          ? ['creator:context', 'creator:artifact:read', 'creator:action'] as AgentCapabilityScope[]
          : [])
      ];
      if (maxScopes.length === 0) return undefined;
      const lease = input.capabilities.issueProcess({
        createdBy: 'api',
        maxScopes
      });
      const noProxy = loopbackNoProxy(input.env ?? process.env);
      return {
        mcpServers: [
          ...(includeSchedule ? [{
            name: AGENT_SCHEDULE_MCP_SERVER_NAME,
            url: `${baseUrl}${AGENT_SCHEDULE_MCP_ROUTE}`,
            bearerTokenEnvVar: AGENT_TOOL_CAPABILITY_TOKEN_ENV,
            required: true,
            startupTimeoutSec: 10,
            toolTimeoutSec: 30
          }] : []),
          ...(includeCreator ? [{
            name: AGENT_CREATOR_MCP_SERVER_NAME,
            url: `${baseUrl}${AGENT_CREATOR_MCP_ROUTE}`,
            bearerTokenEnvVar: AGENT_TOOL_CAPABILITY_TOKEN_ENV,
            required: true,
            startupTimeoutSec: 10,
            toolTimeoutSec: 30
          }] : [])
        ],
        env: {
          [AGENT_TOOL_CAPABILITY_TOKEN_ENV]: lease.token,
          NO_PROXY: noProxy,
          no_proxy: noProxy
        },
        activate(run) {
          const allowed = allowedTools(run.createdBy, run.thread);
          const scopes = run.scopes ?? allowed.map(tool => tool.scope);
          lease.activate({
            runId: run.runId,
            threadId: run.thread.id,
            createdBy: run.createdBy,
            scopes,
            processGeneration: run.processGeneration,
            jobId: run.jobId,
            projectId: run.projectId
          });
          return {
            manifestKey: JSON.stringify(
              scopes.slice().sort()
            )
          };
        },
        deactivate(runId) {
          lease.deactivate(runId);
        },
        close() {
          lease.revoke();
        }
      };
    }
  };
}

export function toolNamesForScopes(
  scopes: AgentCapabilityScope[]
): AgentScheduleToolName[] {
  const allowed = new Set(scopes);
  return TOOL_SCOPES
    .filter(tool => allowed.has(tool.scope))
    .map(tool => tool.name);
}

function loopbackNoProxy(env: NodeJS.ProcessEnv): string {
  const entries = [
    ...(env.NO_PROXY ?? '').split(','),
    ...(env.no_proxy ?? '').split(','),
    '127.0.0.1',
    'localhost'
  ]
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
  return [...new Set(entries)].join(',');
}

export function allowedTools(
  createdBy: 'api' | 'schedule',
  thread: RuntimeThread
): Array<(typeof TOOL_SCOPES)[number]> {
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

export function isAuthorizedKnowledgeToolApproval(
  thread: RuntimeThread,
  request: { method: string; params: unknown }
): boolean {
  if (
    !isEnterpriseKnowledgeThread(thread)
    || request.method !== 'mcpServer/elicitation/request'
    || typeof request.params !== 'object'
    || request.params === null
  ) {
    return false;
  }
  return (request.params as Record<string, unknown>).serverName
    === AGENT_KNOWLEDGE_MCP_SERVER_NAME;
}
