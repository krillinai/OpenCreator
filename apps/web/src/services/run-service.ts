import type { ResumeMode, RunResponse } from '@clawee/protocol';

type ClientLike = {
  post(path: string, body?: unknown): Promise<unknown>;
  get?(path: string): Promise<unknown>;
};

export function createRunService(client: ClientLike) {
  return {
    startThreadRun(input: { threadId: string; prompt: string; resumeMode?: ResumeMode }): Promise<RunResponse> {
      return client.post('/runs', {
        threadId: input.threadId,
        prompt: input.prompt,
        resumeMode: input.resumeMode ?? 'auto'
      }) as Promise<RunResponse>;
    },
    startStandaloneRun(input: { prompt: string; cwd?: string; profile?: string }): Promise<RunResponse> {
      return client.post('/runs', input) as Promise<RunResponse>;
    },
    cancelRun(id: string): Promise<{ id: string; canceled: boolean }> {
      return client.post(`/runs/${encodeURIComponent(id)}/cancel`) as Promise<{ id: string; canceled: boolean }>;
    },
    getRun(id: string): Promise<unknown> {
      if (client.get === undefined) {
        return Promise.reject(new TypeError('Runtime client get is required'));
      }
      return client.get(`/runs/${encodeURIComponent(id)}`);
    }
  };
}
