import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { RuntimeThread, ThreadManager } from '../threads/types.js';
import type { EnterpriseIdentityProvider } from './session-manager-2026-07-30.js';

export type KnowledgeConversationManager = {
  create(): Promise<RuntimeThread>;
  latest(): Promise<RuntimeThread | undefined>;
  requireOwnedThread(threadId: string): Promise<RuntimeThread>;
};

export class KnowledgeConversationError extends Error {
  constructor(readonly statusCode: 404) {
    super('Knowledge conversation not found');
    this.name = 'KnowledgeConversationError';
  }
}

export function createKnowledgeConversationManager(input: {
  dataDir: string;
  sessionManager: EnterpriseIdentityProvider;
  threadManager: ThreadManager;
}): KnowledgeConversationManager {
  return {
    async create() {
      const identity = await input.sessionManager.requireIdentity();
      return input.threadManager.createKnowledgeThread({
        enterpriseSubjectId: identity.subjectId,
        workspaceRoot: resolve(
          input.dataDir,
          'enterprise-knowledge',
          'workspaces',
          hashSubject(identity.subjectId)
        )
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
        || thread.purpose !== 'knowledge_conversation'
        || thread.enterpriseSubjectId !== identity.subjectId
      ) {
        throw new KnowledgeConversationError(404);
      }
      return thread;
    }
  };
}

function hashSubject(subjectId: string): string {
  return createHash('sha256').update(subjectId).digest('hex');
}
