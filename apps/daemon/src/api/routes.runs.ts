import type { RunRequest } from '@clawee/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RunManager } from '../runs/manager.js';
import { apiError } from './errors.js';
import { formatSseEvent } from './sse.js';

export async function registerRunRoutes(
  server: FastifyInstance,
  manager: RunManager,
  options: { sseHeartbeatMs?: number } = {}
): Promise<void> {
  const sseHeartbeatMs = options.sseHeartbeatMs ?? 15_000;
  server.post<{ Body: RunRequest }>('/runs', async (request, reply) => {
    const body = request.body ?? ({} as RunRequest);
    if (typeof body.prompt !== 'string' || body.prompt.length === 0) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'prompt is required'));
    }

    const run = manager.startRun({
      prompt: body.prompt,
      cwd: body.cwd ?? process.cwd(),
      profile: body.profile ?? 'default',
      sandbox: body.sandbox ?? 'read-only',
      threadId: body.threadId,
      resumeMode: body.resumeMode,
      model: body.model,
      reasoning: body.reasoning
    });

    return reply.code(202).send(run);
  });

  server.get('/runs', async request => {
    const query = request.query as { limit?: string } | undefined;
    const limit = query?.limit === undefined ? undefined : Number(query.limit);
    return { runs: manager.listRuns(Number.isFinite(limit) ? limit : undefined) };
  });

  server.get('/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = manager.getRun(id);
    if (run === undefined) return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    return run;
  });

  server.post('/runs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = manager.getRun(id);
    if (run === undefined) {
      return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    }
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
      return reply
        .code(409)
        .send(apiError('RUN_ALREADY_TERMINAL', 'Run is already terminal'));
    }
    const canceled = manager.cancelRun(id);
    return reply.code(canceled ? 202 : 409).send({ id, canceled });
  });

  server.get('/runs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (manager.getRun(id) === undefined) {
      return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    }

    const afterSeq = getReplayAfterSeq(request.headers['last-event-id'], request.query);
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });

    const writeEvent = (event: ReturnType<RunManager['listEvents']>[number]) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(formatSseEvent({ id: String(event.seq), event: event.type, data: event }));
      if (event.type === 'done') closeSse(reply);
    };

    for (const event of manager.listEvents(id, afterSeq)) writeEvent(event);
    if (reply.raw.destroyed || reply.raw.writableEnded) return reply;

    const unsubscribe = manager.subscribe(id, writeEvent);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
    }, sseHeartbeatMs);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    reply.raw.on('close', cleanup);

    return reply;
  });
}

function getReplayAfterSeq(lastEventId: string | string[] | undefined, query: unknown): number {
  const queryValue = typeof query === 'object' && query !== null
    ? Number((query as { afterSeq?: string; fromSeq?: string }).fromSeq ?? (query as { afterSeq?: string }).afterSeq)
    : undefined;
  if (typeof queryValue === 'number' && Number.isFinite(queryValue)) return queryValue;

  const header = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId;
  const parsedHeader = header === undefined ? undefined : Number(header);
  return typeof parsedHeader === 'number' && Number.isFinite(parsedHeader) ? parsedHeader : 0;
}

function closeSse(reply: FastifyReply): void {
  setImmediate(() => {
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
  });
}
