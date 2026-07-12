import type { ReasoningEffort, ResumeMode, RunResponse } from '@clawee/protocol';
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
    }): Promise<RunResponse> {
      const body: {
        threadId: string;
        prompt: string;
        resumeMode: ResumeMode;
        model?: string;
        reasoning?: ReasoningEffort;
      } = {
        threadId: input.threadId,
        prompt: input.prompt,
        resumeMode: input.resumeMode ?? 'auto'
      };
      if (input.model !== undefined) body.model = input.model;
      if (input.reasoning !== undefined) body.reasoning = input.reasoning;
      return client.post('/runs', body);
    },
    startStandaloneRun(input: { prompt: string; cwd?: string; profile?: string }): Promise<RunResponse> {
      return client.post('/runs', input);
    },
    cancelRun(id: string): Promise<{ id: string; canceled: boolean }> {
      return client.post(`/runs/${encodeURIComponent(id)}/cancel`);
    },
    getRun(id: string): Promise<RunResponse> {
      return client.get(`/runs/${encodeURIComponent(id)}`);
    }
  };
}
