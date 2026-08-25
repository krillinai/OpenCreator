import type {
  CreateCreatorJobRequest,
  CreatorActionRequest,
  CreatorActionResponse,
  CreatorAgentApproval,
  CreatorAgentApprovalDecisionRequest,
  CreatorAgentHistoryResponse,
  CreatorAgentSteerRequest,
  CreatorAgentTimelineResponse,
  CreatorAgentTurn,
  CreatorAgentTurnRequest,
  CreatorEventEnvelope,
  CreatorJob,
  CreatorJobListResponse,
  CreatorTemplateListResponse
} from '@opencreator/protocol';

type ClientLike = {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  rawGet?(path: string): Promise<Response>;
};

export function createCreatorService(client: ClientLike) {
  const lastEventIdByJob = new Map<string, string>();
  const consumedEventIds = new Map<string, Set<string>>();
  return {
    listTemplates(): Promise<CreatorTemplateListResponse> {
      return client.get('/creator/templates') as Promise<CreatorTemplateListResponse>;
    },
    createJob(request: CreateCreatorJobRequest): Promise<{ job: CreatorJob }> {
      return client.post('/creator/jobs', request) as Promise<{ job: CreatorJob }>;
    },
    listJobs(projectId?: string): Promise<CreatorJobListResponse> {
      return client.get(projectId === undefined
        ? '/creator/jobs'
        : `/creator/jobs?projectId=${encodeURIComponent(projectId)}`) as Promise<CreatorJobListResponse>;
    },
    getJob(jobId: string): Promise<{ job: CreatorJob }> {
      return client.get(`/creator/jobs/${encodeURIComponent(jobId)}`) as Promise<{ job: CreatorJob }>;
    },
    openProjectCover(jobId: string): Promise<Response> {
      if (client.rawGet === undefined) throw new Error('Creator project cover transport is unavailable');
      return client.rawGet(`/creator/jobs/${encodeURIComponent(jobId)}/cover`);
    },
    openArtifact(jobId: string, artifactId: string): Promise<Response> {
      if (client.rawGet === undefined) throw new Error('Creator artifact transport is unavailable');
      return client.rawGet(
        `/creator/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}/content`
      );
    },
    applyAction(jobId: string, request: CreatorActionRequest): Promise<CreatorActionResponse> {
      return client.post(`/creator/jobs/${encodeURIComponent(jobId)}/actions`, request) as Promise<CreatorActionResponse>;
    },
    runAgentTurn(jobId: string, request: CreatorAgentTurnRequest): Promise<{ turn: CreatorAgentTurn; action?: CreatorActionResponse }> {
      return client.post(`/creator/jobs/${encodeURIComponent(jobId)}/agent-turns`, request) as Promise<{ turn: CreatorAgentTurn; action?: CreatorActionResponse }>;
    },
    startAgentTurn(jobId: string, request: CreatorAgentTurnRequest): Promise<{ turn: CreatorAgentTurn; action?: CreatorActionResponse }> {
      return client.post(`/creator/jobs/${encodeURIComponent(jobId)}/agent-turns`, request) as Promise<{ turn: CreatorAgentTurn; action?: CreatorActionResponse }>;
    },
    steerAgentTurn(jobId: string, request: CreatorAgentSteerRequest): Promise<{ turn: CreatorAgentTurn }> {
      return client.post(`/creator/jobs/${encodeURIComponent(jobId)}/agent-steer`, request) as Promise<{ turn: CreatorAgentTurn }>;
    },
    interruptAgentTurn(jobId: string): Promise<{ interrupted: true }> {
      return client.post(`/creator/jobs/${encodeURIComponent(jobId)}/agent-interrupt`) as Promise<{ interrupted: true }>;
    },
    respondAgentApproval(
      jobId: string,
      approvalId: string,
      request: CreatorAgentApprovalDecisionRequest
    ): Promise<{ approval: CreatorAgentApproval }> {
      return client.post(
        `/creator/jobs/${encodeURIComponent(jobId)}/agent-approvals/${encodeURIComponent(approvalId)}`,
        request
      ) as Promise<{ approval: CreatorAgentApproval }>;
    },
    getAgentHistory(jobId: string): Promise<CreatorAgentHistoryResponse> {
      return client.get(`/creator/jobs/${encodeURIComponent(jobId)}/agent-history`) as Promise<CreatorAgentHistoryResponse>;
    },
    getAgentTimeline(jobId: string): Promise<CreatorAgentTimelineResponse> {
      return client.get(`/creator/jobs/${encodeURIComponent(jobId)}/agent-timeline`) as Promise<CreatorAgentTimelineResponse>;
    },
    subscribeJobEvents(
      jobId: string,
      onEvent: (event: CreatorEventEnvelope) => void,
      onDisconnect: () => void
    ): { close(): void } {
      const controller = new AbortController();
      void (async () => {
        if (client.rawGet === undefined) return;
        const cursor = lastEventIdByJob.get(jobId);
        const response = await client.rawGet(
          `/creator/jobs/${encodeURIComponent(jobId)}/events${cursor === undefined
            ? ''
            : `?cursor=${encodeURIComponent(cursor)}`}`
        );
        const reader = response.body?.getReader();
        if (reader === undefined) return;
        const decoder = new TextDecoder();
        let buffered = '';
        while (!controller.signal.aborted) {
          const item = await reader.read();
          if (item.done) break;
          buffered += decoder.decode(item.value, { stream: true });
          let boundary = buffered.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffered.slice(0, boundary);
            buffered = buffered.slice(boundary + 2);
            const event = parseCreatorSseFrame(frame);
            if (event !== undefined) {
              const consumed = consumedEventIds.get(jobId) ?? new Set<string>();
              consumedEventIds.set(jobId, consumed);
              lastEventIdByJob.set(jobId, event.id);
              if (!consumed.has(event.id)) {
                consumed.add(event.id);
                onEvent(event);
              }
            }
            boundary = buffered.indexOf('\n\n');
          }
        }
        if (!controller.signal.aborted) onDisconnect();
      })().catch(() => {
        if (!controller.signal.aborted) onDisconnect();
      });
      return { close: () => controller.abort() };
    }
  };
}

export type CreatorWebService = ReturnType<typeof createCreatorService>;

function parseCreatorSseFrame(frame: string): CreatorEventEnvelope | undefined {
  const lines = frame.split('\n');
  const id = lines.find(line => line.startsWith('id: '))?.slice(4).trim();
  const data = lines.find(line => line.startsWith('data: '))?.slice(6);
  if (id === undefined || data === undefined) return undefined;
  const parsed = JSON.parse(data) as CreatorEventEnvelope;
  return parsed.id === id ? parsed : undefined;
}
