import { describe, expect, it, vi } from 'vitest';
import { createAgentCapabilityTokenStore } from '../../src/agent-tools/capability-token.js';
import {
  AgentToolPolicyError,
  createAgentScheduleRunInjector
} from '../../src/agent-tools/run-injection.js';
import {
  createKnowledgeConversationManager,
  KnowledgeConversationError
} from '../../src/enterprise/knowledge-conversation-2026-08-05.js';
import { EnterpriseHttpError } from '../../src/enterprise/http-client-2026-07-30.js';
import type { RuntimeThread } from '../../src/threads/types.js';

describe('knowledge run policy', () => {
  it('injects only knowledge.search and an explicit all-disabled built-in policy', () => {
    const capabilities = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleRunInjector({
      capabilities,
      getBaseUrl: () => 'http://127.0.0.1:43123',
      knowledgeToolIsolationSupported: true
    });

    const injection = injector.prepare({
      runId: 'run-a',
      thread: knowledgeThread(),
      createdBy: 'api'
    });

    expect(injection).toMatchObject({
      builtInTools: {
        shell: false,
        fileRead: false,
        fileWrite: false,
        applyPatch: false,
        webSearch: false
      },
      mcpServers: [{
        name: 'clawee_knowledge',
        enabledTools: ['knowledge.search'],
        required: true
      }]
    });
    expect(capabilities.inspect(
      injection!.env.CLAWEE_AGENT_CAPABILITY_TOKEN
    )).toMatchObject({
      runId: 'run-a',
      threadId: 'thread-a',
      scopes: ['knowledge:search']
    });
    capabilities.close();
  });

  it('fails closed when Codex cannot disable every built-in tool', () => {
    const capabilities = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleRunInjector({
      capabilities,
      getBaseUrl: () => 'http://127.0.0.1:43123',
      knowledgeToolIsolationSupported: false
    });

    expect(() => injector.prepare({
      runId: 'run-a',
      thread: knowledgeThread(),
      createdBy: 'api'
    })).toThrowError(AgentToolPolicyError);
    try {
      injector.prepare({ runId: 'run-a', thread: knowledgeThread(), createdBy: 'api' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'KNOWLEDGE_TOOL_POLICY_UNAVAILABLE' });
    }
    capabilities.close();
  });

  it('fails closed before the internal knowledge MCP endpoint is available', () => {
    const capabilities = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleRunInjector({
      capabilities,
      getBaseUrl: () => undefined,
      knowledgeToolIsolationSupported: true
    });

    expect(() => injector.prepare({
      runId: 'run-a',
      thread: knowledgeThread(),
      createdBy: 'api'
    })).toThrowError(expect.objectContaining({
      code: 'KNOWLEDGE_TOOL_POLICY_UNAVAILABLE'
    }));
    capabilities.close();
  });

  it('keeps knowledge isolation enabled when schedule agent tools are disabled', () => {
    const capabilities = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleRunInjector({
      capabilities,
      getBaseUrl: () => 'http://127.0.0.1:43123',
      knowledgeToolIsolationSupported: true,
      scheduleToolsEnabled: false
    });

    expect(injector.prepare({
      runId: 'run-a',
      thread: knowledgeThread(),
      createdBy: 'api'
    })?.mcpServers[0]?.enabledTools).toEqual(['knowledge.search']);
    expect(injector.prepare({
      runId: 'run-b',
      thread: { ...knowledgeThread(), purpose: 'conversation' },
      createdBy: 'api'
    })).toBeUndefined();
    capabilities.close();
  });

  it('rejects missing grants and maps upstream search failures', async () => {
    const hasKnowledgeSearchGrant = vi.fn(async () => false);
    const searchKnowledge = vi.fn(async () => {
      throw new EnterpriseHttpError('ENTERPRISE_SERVICE_UNAVAILABLE', 'request', 503);
    });
    const manager = createKnowledgeConversationManager({
      dataDir: '/tmp/clawee-test',
      sessionManager: {
        requireIdentity: vi.fn(async () => ({
          subjectId: 'acct-a',
          agentId: 'agent-a',
          accessToken: 'access-a'
        }))
      },
      threadManager: {
        getThread: vi.fn(() => knowledgeThread())
      } as never,
      httpClient: { hasKnowledgeSearchGrant, searchKnowledge }
    });

    await expect(manager.prepareSearch('thread-a')).rejects.toMatchObject({
      code: 'KNOWLEDGE_SEARCH_NOT_GRANTED'
    });
    hasKnowledgeSearchGrant.mockResolvedValue(true);
    await expect(manager.search('thread-a', 'policy', 8)).rejects.toEqual(
      expect.objectContaining<Partial<KnowledgeConversationError>>({
        code: 'ENTERPRISE_KNOWLEDGE_UNAVAILABLE',
        statusCode: 503
      })
    );
  });
});

function knowledgeThread(): RuntimeThread {
  return {
    id: 'thread-a',
    title: null,
    projectId: null,
    enterpriseSubjectId: 'acct-a',
    origin: 'clawee_created',
    cwd: '/managed/thread-a',
    canonicalCwd: '/managed/thread-a',
    workspaceMode: 'managed',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'read-only',
    status: 'active',
    purpose: 'knowledge_conversation',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z'
  };
}
