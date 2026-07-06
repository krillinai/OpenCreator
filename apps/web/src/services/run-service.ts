import type { ResumeMode, RunResponse } from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'post' | 'get'>;

export function createRunService(client: ClientLike) {
  return {
    startThreadRun(input: { threadId: string; prompt: string; resumeMode?: ResumeMode }): Promise<RunResponse> {
      return client.post('/runs', {
        threadId: input.threadId,
        prompt: input.prompt,
        resumeMode: input.resumeMode ?? 'auto'
      });
    },
    startStandaloneRun(input: { prompt: string; cwd?: string; profile?: string }): Promise<RunResponse> {
      return client.post('/runs', input);
    },
    cancelRun(id: string): Promise<{ id: string; canceled: boolean }> {
      return client.post(`/runs/${encodeURIComponent(id)}/cancel`);
    },
    getRun(id: string): Promise<unknown> {
      return client.get(`/runs/${encodeURIComponent(id)}`);
    }
  };
}
