import type {
  ReasoningEffort,
  ResumeMode,
  RunResponse,
  RunSubmissionMode
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'post' | 'get'>;

export function createRunService(client: ClientLike) {
  return {
    startThreadRun(input: {
      threadId: string;
      prompt: string;
      resumeMode?: ResumeMode;
      model?: string;
      reasoning?: ReasoningEffort;
      draftId?: string;
      attachmentIds?: string[];
      submissionMode?: RunSubmissionMode;
    }): Promise<RunResponse> {
      const body: {
        threadId: string;
        prompt: string;
        resumeMode: ResumeMode;
        model?: string;
        reasoning?: ReasoningEffort;
        draftId?: string;
        attachmentIds?: string[];
        submissionMode?: RunSubmissionMode;
      } = {
        threadId: input.threadId,
        prompt: input.prompt,
        resumeMode: input.resumeMode ?? 'auto'
      };
      if (input.model !== undefined) body.model = input.model;
      if (input.reasoning !== undefined) body.reasoning = input.reasoning;
      if (input.draftId !== undefined) body.draftId = input.draftId;
      if (input.attachmentIds !== undefined) body.attachmentIds = input.attachmentIds;
      if (input.submissionMode !== undefined) body.submissionMode = input.submissionMode;
      return client.post('/runs', body);
    },
    startKnowledgeRun(input: { threadId: string; prompt: string }): Promise<RunResponse> {
      return client.post(
        `/enterprise/knowledge-conversations/${encodeURIComponent(input.threadId)}/runs`,
        { prompt: input.prompt }
      );
    },
    startStandaloneRun(input: { prompt: string; cwd?: string; profile?: string }): Promise<RunResponse> {
      return client.post('/runs', input);
    },
    cancelRun(id: string): Promise<{ id: string; canceled: boolean }> {
      return client.post(`/runs/${encodeURIComponent(id)}/cancel`);
    },
    steerRun(id: string): Promise<{ id: string; steered: boolean }> {
      return client.post(`/runs/${encodeURIComponent(id)}/steer`);
    },
    getRun(id: string): Promise<RunResponse> {
      return client.get(`/runs/${encodeURIComponent(id)}`);
    }
  };
}
