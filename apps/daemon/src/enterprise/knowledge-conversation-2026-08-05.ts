import type { RuntimeThread, ThreadManager } from '../threads/types.js';
import { isEnterpriseKnowledgeThread } from '../threads/types.js';
import type { EnterpriseIdentityProvider } from './session-manager-2026-07-30.js';
import type {
  EnterpriseHttpClient,
  EnterpriseKnowledgeSearchSource
} from './http-client-2026-07-30.js';
import { EnterpriseHttpError } from './http-client-2026-07-30.js';

export type KnowledgeConversationManager = {
  create(projectId: string): Promise<RuntimeThread>;
  latest(): Promise<RuntimeThread | undefined>;
  requireOwnedThread(threadId: string): Promise<RuntimeThread>;
  prepareSearch(threadId: string): Promise<void>;
  search(threadId: string, query: string, limit: number): Promise<EnterpriseKnowledgeSearchSource[]>;
};

export class KnowledgeConversationError extends Error {
  constructor(
    readonly statusCode: 403 | 404 | 503,
    readonly code: 'THREAD_NOT_FOUND' | 'KNOWLEDGE_SEARCH_NOT_GRANTED' | 'ENTERPRISE_KNOWLEDGE_UNAVAILABLE'
  ) {
    super(code);
    this.name = 'KnowledgeConversationError';
  }
}

export function createKnowledgeConversationManager(input: {
  dataDir: string;
  sessionManager: EnterpriseIdentityProvider;
  threadManager: ThreadManager;
  httpClient: Pick<EnterpriseHttpClient, 'hasKnowledgeSearchGrant' | 'searchKnowledge'>;
}): KnowledgeConversationManager {
  return {
    async create(projectId) {
      const identity = await input.sessionManager.requireIdentity();
      return input.threadManager.createKnowledgeThread({
        enterpriseSubjectId: identity.subjectId,
        projectId,
        title: '知识库对话'
      });
    },

    async latest() {
      const identity = await input.sessionManager.requireIdentity();
      return input.threadManager.listKnowledgeThreads(identity.subjectId, {
        status: 'active',
        limit: 1
      })[0];
    },

    async requireOwnedThread(threadId) {
      const identity = await input.sessionManager.requireIdentity();
      const thread = input.threadManager.getThread(threadId);
      if (
        thread === undefined
        || !isEnterpriseKnowledgeThread(thread)
        || thread.enterpriseSubjectId !== identity.subjectId
      ) {
        throw new KnowledgeConversationError(404, 'THREAD_NOT_FOUND');
      }
      return thread;
    },

    async prepareSearch(threadId) {
      const identity = await requireOwnedIdentity(threadId);
      if (!await hasSearchGrant(identity.accessToken)) {
        throw new KnowledgeConversationError(403, 'KNOWLEDGE_SEARCH_NOT_GRANTED');
      }
    },

    async search(threadId, query, limit) {
      const identity = await requireOwnedIdentity(threadId);
      if (!await hasSearchGrant(identity.accessToken)) {
        throw new KnowledgeConversationError(403, 'KNOWLEDGE_SEARCH_NOT_GRANTED');
      }
      try {
        return await input.httpClient.searchKnowledge({
          accessToken: identity.accessToken,
          query,
          limit
        });
      } catch (error) {
        if (error instanceof EnterpriseHttpError) {
          throw new KnowledgeConversationError(503, 'ENTERPRISE_KNOWLEDGE_UNAVAILABLE');
        }
        throw error;
      }
    }
  };

  async function requireOwnedIdentity(threadId: string) {
    const identity = await input.sessionManager.requireIdentity();
    const thread = input.threadManager.getThread(threadId);
    if (
      thread === undefined
      || !isEnterpriseKnowledgeThread(thread)
      || thread.enterpriseSubjectId !== identity.subjectId
    ) {
      throw new KnowledgeConversationError(404, 'THREAD_NOT_FOUND');
    }
    return identity;
  }

  async function hasSearchGrant(accessToken: string): Promise<boolean> {
    try {
      return await input.httpClient.hasKnowledgeSearchGrant(accessToken);
    } catch (error) {
      if (error instanceof EnterpriseHttpError) {
        throw new KnowledgeConversationError(503, 'ENTERPRISE_KNOWLEDGE_UNAVAILABLE');
      }
      throw error;
    }
  }
}
