import type {
  CreateCreatorJobRequest,
  CreatorActionRequest,
  CreatorAgentApprovalDecisionRequest,
  CreatorAgentEvent,
  CreatorAgentHistoryResponse,
  CreatorAgentItem,
  CreatorAgentTurnRequest,
  CreatorEventEnvelope,
  CreatorJob,
  CreatorJson,
  CreatorStageRun,
  RuntimeErrorCode
} from '@opencreator/protocol';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import type { CreatorEventHub } from '../creator/events.js';
import {
  creatorAgentEventKind,
  creatorStageEventId
} from '../creator/events.js';
import {
  CreatorServiceError,
  type CreatorService
} from '../creator/service.js';
import { formatSseEvent } from './sse.js';
import { apiError } from './errors.js';
import type { CreatorAgentService } from '../creator/agent/agent-service.js';
import {
  CreatorCommandError,
  type CreatorCommandDispatcher
} from '../creator/command-dispatcher.js';
import {
  CoverWorkflowError,
  type CoverWorkflow
} from '../creator/templates/cover-actions.js';
import {
  VideoTranslationWorkflowError,
  type VideoTranslationWorkflow
} from '../creator/templates/video-translation-actions.js';
import type { CreatorProjectCoverService } from '../creator/project-cover.js';
import type { CreatorStageRunner } from '../creator/stage-runner.js';
import {
  CREATOR_REFERENCE_IMAGE_CONTENT_TYPE,
  CreatorReferenceImageUploadError,
  type CreatorReferenceImageUploadService
} from '../creator/reference-image-upload.js';
import {
  CREATOR_SOURCE_UPLOAD_CONTENT_TYPE,
  CreatorSourceUploadError,
  type CreatorSourceUploadService
} from '../creator/source-upload.js';

export async function registerCreatorRoutes(
  server: FastifyInstance,
  service: CreatorService,
  events: CreatorEventHub,
  options: {
    sseHeartbeatMs?: number;
    agentService?: CreatorAgentService;
    coverWorkflow?: CoverWorkflow;
    videoTranslationWorkflow?: VideoTranslationWorkflow;
    projectCoverService?: CreatorProjectCoverService;
    referenceImageUploadService?: CreatorReferenceImageUploadService;
    sourceUploadService?: CreatorSourceUploadService;
    dispatcher: CreatorCommandDispatcher;
    stageRunner?: Pick<CreatorStageRunner, 'cancel'>;
  }
): Promise<void> {
  if (options.sourceUploadService !== undefined) {
    server.addContentTypeParser(
      CREATOR_SOURCE_UPLOAD_CONTENT_TYPE,
      (_request, payload, done) => done(null, payload)
    );
    server.post<{ Body: Readable }>('/creator/jobs/:id/source-video', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const query = readObject(request.query);
        if (!isReadable(request.body)) {
          throw new TypeError('body must be a media stream');
        }
        const response = await options.sourceUploadService!.upload({
          jobId: id,
          expectedRevision: readQueryInteger(query.expectedRevision, 'expectedRevision'),
          fileName: readString(query.fileName, 'fileName'),
          mimeType: readString(query.mime, 'mime'),
          lastModified: query.lastModified === undefined
            ? null
            : readQueryInteger(query.lastModified, 'lastModified'),
          source: request.body
        });
        events.publish({
          id: `snapshot:${response.job.revision}`,
          jobId: response.job.id,
          revision: response.job.revision,
          kind: 'snapshot_changed',
          payload: { revision: response.job.revision }
        });
        return reply.code(response.deduplicated ? 200 : 201).send(response);
      } catch (error) {
        return sendCreatorError(reply, error);
      }
    });
  }

  if (options.referenceImageUploadService !== undefined) {
    server.addContentTypeParser(
      CREATOR_REFERENCE_IMAGE_CONTENT_TYPE,
      (_request, payload, done) => done(null, payload)
    );
    server.post<{ Body: Readable }>(
      '/creator/jobs/:id/reference-image',
      async (request, reply) => {
        const { id } = request.params as { id: string };
        try {
          const query = readObject(request.query);
          if (!isReadable(request.body)) {
            throw new TypeError('body must be an image stream');
          }
          const response = await options.referenceImageUploadService!.upload({
            jobId: id,
            expectedRevision: readQueryInteger(query.expectedRevision, 'expectedRevision'),
            fileName: readString(query.fileName, 'fileName'),
            mimeType: readString(query.mime, 'mime'),
            lastModified: query.lastModified === undefined
              ? null
              : readQueryInteger(query.lastModified, 'lastModified'),
            source: request.body
          });
          events.publish({
            id: `snapshot:${response.job.revision}`,
            jobId: response.job.id,
            revision: response.job.revision,
            kind: 'snapshot_changed',
            payload: { revision: response.job.revision }
          });
          return reply.code(response.deduplicated ? 200 : 201).send(response);
        } catch (error) {
          return sendCreatorError(reply, error);
        }
      }
    );
  }

  server.get('/creator/templates', async () => ({
    templates: service.templates.list().map(template => ({
      id: template.id,
      version: template.version,
      renderer: template.renderer,
      outputs: template.outputs
    }))
  }));

  server.post<{ Body: unknown }>('/creator/jobs', async (request, reply) => {
    try {
      const body = readObject(request.body);
      const job = service.createJob({
        projectId: readString(body.projectId, 'projectId'),
        templateId: readString(body.templateId, 'templateId'),
        ...(body.templateVersion === undefined
          ? {}
          : { templateVersion: readInteger(body.templateVersion, 'templateVersion') }),
        ...(body.state === undefined ? {} : { state: readObject(body.state) as CreateCreatorJobRequest['state'] }),
        ...(body.creationKey === undefined
          ? {}
          : { creationKey: readString(body.creationKey, 'creationKey') })
      });
      events.publish({
        id: `snapshot:${job.revision}`,
        jobId: job.id,
        revision: job.revision,
        kind: 'snapshot_changed',
        payload: { revision: job.revision }
      });
      return reply.code(201).send({ job });
    } catch (error) {
      return sendCreatorError(reply, error);
    }
  });

  server.get('/creator/jobs', async (request, reply) => {
    try {
      const query = readObject(request.query);
      return {
        jobs: service.listJobs(
          query.projectId === undefined ? undefined : readString(query.projectId, 'projectId')
        )
      };
    } catch (error) {
      return sendCreatorError(reply, error);
    }
  });

  server.get('/creator/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = service.getJob(id);
    if (job === undefined) {
      return reply.code(404).send(apiError('creator_job_not_found', 'Creator job not found'));
    }
    return { job };
  });

  server.post('/creator/jobs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      if (options.stageRunner === undefined) {
        throw new CreatorServiceError(
          'creator_job_control_unavailable',
          'Creator job control is unavailable'
        );
      }
      const job = requireCreatorJob(service, id);
      const activeStage = latestStageMatching(job, stage => (
        stage.status === 'queued' || stage.status === 'running'
      ));
      if (activeStage === undefined) {
        const latest = job.stages.at(-1);
        if (latest?.status === 'canceled') {
          return {
            job,
            stage: latest,
            control: 'canceled'
          };
        }
        throw new CreatorServiceError(
          'creator_job_not_running',
          'Creator job has no active stage'
        );
      }
      const stage = options.stageRunner.cancel(activeStage.id);
      if (stage === undefined) {
        throw new CreatorServiceError(
          'creator_job_not_running',
          'Creator job has no active stage'
        );
      }
      const latestJob = requireCreatorJob(service, id);
      const canceling = stage.status === 'queued' || stage.status === 'running';
      return reply.code(canceling ? 202 : 200).send({
        job: latestJob,
        stage,
        control: canceling ? 'canceling' : 'canceled'
      });
    } catch (error) {
      return sendCreatorError(reply, error);
    }
  });

  server.post('/creator/jobs/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      if (options.stageRunner === undefined) {
        throw new CreatorServiceError(
          'creator_job_control_unavailable',
          'Creator job control is unavailable'
        );
      }
      let job = requireCreatorJob(service, id);
      const latest = job.stages.at(-1);
      if (latest !== undefined && isAlreadyResumed(job, latest)) {
        return {
          job,
          stage: latest,
          control: 'resumed'
        };
      }
      if (latest === undefined || (latest.status !== 'canceled' && latest.status !== 'interrupted')) {
        throw new CreatorServiceError(
          'creator_job_not_resumable',
          'Creator job has no canceled or interrupted stage to resume'
        );
      }
      if (job.templateId === 'video-translation' && options.videoTranslationWorkflow !== undefined) {
        try {
          await options.videoTranslationWorkflow.validateStage(job, latest.stageId);
        } catch (error) {
          publishSnapshotIfChanged(events, service, job);
          throw error;
        }
        job = requireCreatorJob(service, id);
      }
      if (job.templateId === 'cover' && options.coverWorkflow !== undefined) {
        try {
          await options.coverWorkflow.validateStage(job, latest.stageId);
        } catch (error) {
          publishSnapshotIfChanged(events, service, job);
          throw error;
        }
        job = requireCreatorJob(service, id);
      }
      const target = job.stages.at(-1);
      if (target?.id !== latest.id || (target.status !== 'canceled' && target.status !== 'interrupted')) {
        throw new CreatorServiceError(
          'creator_job_not_resumable',
          'Creator job state changed before it could be resumed'
        );
      }
      const result = options.dispatcher.dispatch(id, {
        action: 'run-stage',
        expectedRevision: job.revision,
        idempotencyKey: `resume:${target.id}`,
        input: {
          stageId: target.stageId,
          ...(target.progress.workflow === true ? { workflow: true } : {}),
          ...(typeof target.progress.workflowParentStageRunId === 'string'
            ? { workflowParentStageRunId: target.progress.workflowParentStageRunId }
            : {}),
          ...(typeof target.progress.baseResultVersion === 'number'
            ? { baseResultVersion: target.progress.baseResultVersion }
            : {}),
          ...(typeof target.progress.inputResultVersion === 'number'
            ? { inputResultVersion: target.progress.inputResultVersion }
            : {}),
          ...(typeof target.progress.targetResultVersion === 'number'
            ? { targetResultVersion: target.progress.targetResultVersion }
            : {}),
          resumedFromStageRunId: target.id
        }
      }, 'user');
      const resumedJob = requireCreatorJob(service, id);
      const resumedStage = result.commandReceipt.stageRunId === null
        ? undefined
        : resumedJob.stages.find(stage => stage.id === result.commandReceipt.stageRunId);
      if (resumedStage === undefined) {
        throw new CreatorServiceError(
          'creator_job_not_resumable',
          'Creator job resume did not create a stage run'
        );
      }
      return reply.code(202).send({
        job: resumedJob,
        stage: resumedStage,
        control: 'resumed'
      });
    } catch (error) {
      return sendCreatorError(reply, error);
    }
  });

  server.get('/creator/jobs/:id/cover', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = service.getJob(id);
    if (job === undefined) {
      return reply.code(404).send(apiError('creator_job_not_found', 'Creator job not found'));
    }
    const cover = await options.projectCoverService?.resolve(job);
    if (cover === undefined) {
      return reply.code(404).send(apiError('creator_artifact_not_found', 'Creator project cover not found'));
    }
    return reply
      .type(creatorArtifactContentType(cover.fileName))
      .header('Cache-Control', 'private, max-age=86400')
      .header('Content-Disposition', 'inline')
      .send(createReadStream(cover.path));
  });

  server.get('/creator/jobs/:id/artifacts/:artifactId/content', async (request, reply) => {
    const { id, artifactId } = request.params as { id: string; artifactId: string };
    const job = service.getJob(id);
    if (job === undefined) {
      return reply.code(404).send(apiError('creator_job_not_found', 'Creator job not found'));
    }
    const artifact = job.artifacts.find(candidate => candidate.id === artifactId);
    if (artifact?.path === null || artifact === undefined || artifact.status === 'stale') {
      return reply.code(404).send(apiError('creator_artifact_not_found', 'Creator artifact not found'));
    }
    try {
      const info = await stat(artifact.path);
      if (!info.isFile()) {
        return reply.code(404).send(apiError('creator_artifact_not_found', 'Creator artifact file not found'));
      }
    } catch {
      return reply.code(404).send(apiError('creator_artifact_not_found', 'Creator artifact file not found'));
    }
    const fileName = typeof artifact.metadata.fileName === 'string'
      ? artifact.metadata.fileName
      : basename(artifact.path);
    return reply
      .type(creatorArtifactContentType(fileName))
      .header('Content-Disposition', creatorArtifactContentDisposition(fileName))
      .send(createReadStream(artifact.path));
  });

  server.post<{ Body: unknown }>('/creator/jobs/:id/actions', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const body = readObject(request.body);
      const action = readString(body.action, 'action');
      const actionInput = readObject(body.input) as CreatorActionRequest['input'];
      const jobBeforeAction = service.getJob(id);
      if (jobBeforeAction === undefined) {
        throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
      }
      if (
        action === 'run-stage'
        && jobBeforeAction.templateId === 'video-translation'
        && options.videoTranslationWorkflow !== undefined
      ) {
        const stageId = readString(actionInput.stageId, 'stageId');
        try {
          await options.videoTranslationWorkflow.validateStage(jobBeforeAction, stageId);
        } catch (error) {
          const latest = service.getJob(id);
          if (latest !== undefined && latest.revision !== jobBeforeAction.revision) {
            events.publish({
              id: `snapshot:${latest.revision}`,
              jobId: id,
              revision: latest.revision,
              kind: 'snapshot_changed',
              payload: { revision: latest.revision }
            });
          }
          throw error;
        }
      }
      if (
        action === 'run-stage'
        && jobBeforeAction.templateId === 'cover'
        && options.coverWorkflow !== undefined
      ) {
        const stageId = readString(actionInput.stageId, 'stageId');
        try {
          await options.coverWorkflow.validateStage(jobBeforeAction, stageId);
        } catch (error) {
          const latest = service.getJob(id);
          if (latest !== undefined && latest.revision !== jobBeforeAction.revision) {
            events.publish({
              id: `snapshot:${latest.revision}`,
              jobId: id,
              revision: latest.revision,
              kind: 'snapshot_changed',
              payload: { revision: latest.revision }
            });
          }
          throw error;
        }
      }
      const expectedRevision = readInteger(body.expectedRevision, 'expectedRevision');
      const result = options.dispatcher.dispatch(id, {
        idempotencyKey: typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : fallbackIdempotencyKey(id, action, expectedRevision, actionInput),
        action,
        expectedRevision,
        input: actionInput
      }, 'user');
      if (
        options.videoTranslationWorkflow !== undefined
        && shouldReconcileVideoTranslation(jobBeforeAction, result.job)
      ) {
        await options.videoTranslationWorkflow.reconcile(result.job);
        return {
          ...result,
          job: service.getJob(id) ?? result.job
        };
      }
      return result;
    } catch (error) {
      return sendCreatorError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/creator/jobs/:id/agent-turns', async (request, reply) => {
    if (options.agentService === undefined) {
      return reply.code(503).send(apiError('creator_agent_unavailable', 'Creator Agent is not ready'));
    }
    try {
      const { id } = request.params as { id: string };
      const body = readObject(request.body);
      const sandbox = readCreatorAgentSandbox(body.sandbox);
      const result = await options.agentService.runTurn(id, {
        message: readString(body.message, 'message'),
        ...(typeof body.clientMessageId === 'string'
          ? { clientMessageId: body.clientMessageId }
          : {}),
        ...(sandbox === undefined ? {} : { sandbox }),
        selection: body.selection as never
      });
      return result;
    } catch (error) {
      return sendCreatorError(reply, error);
    }
  });

  const readAgentTimeline = async (request: { params: unknown }): Promise<CreatorAgentHistoryResponse> => {
    const { id } = request.params as { id: string };
    return publicAgentTimeline(
      options.agentService?.getTimeline(id) ?? emptyAgentTimeline()
    );
  };
  server.get('/creator/jobs/:id/agent-history', readAgentTimeline);
  server.get('/creator/jobs/:id/agent-timeline', readAgentTimeline);

  server.post('/creator/jobs/:id/agent-interrupt', async (request, reply) => {
    if (options.agentService === undefined) {
      return reply.code(503).send(apiError('creator_agent_unavailable', 'Creator Agent is not ready'));
    }
    const { id } = request.params as { id: string };
    const interrupted = options.agentService.interrupt(id);
    return interrupted
      ? reply.code(202).send({ interrupted: true })
      : reply.code(409).send(apiError('creator_agent_not_running', 'Creator Agent has no active turn'));
  });

  server.post<{ Body: unknown }>('/creator/jobs/:id/agent-steer', async (request, reply) => {
    if (options.agentService === undefined) {
      return reply.code(503).send(apiError('creator_agent_unavailable', 'Creator Agent is not ready'));
    }
    try {
      const { id } = request.params as { id: string };
      const body = readObject(request.body);
      const turn = await options.agentService.steer(id, {
        message: readString(body.message, 'message'),
        ...(typeof body.clientMessageId === 'string'
          ? { clientMessageId: body.clientMessageId }
          : {})
      });
      return { turn };
    } catch (error) {
      return sendCreatorError(reply, error);
    }
  });

  server.post<{ Body: unknown }>(
    '/creator/jobs/:id/agent-approvals/:approvalId',
    async (request, reply) => {
      if (options.agentService === undefined) {
        return reply.code(503).send(apiError('creator_agent_unavailable', 'Creator Agent is not ready'));
      }
      try {
        const { approvalId } = request.params as { id: string; approvalId: string };
        const body = readObject(request.body);
        const decision = readApprovalDecision(body.decision);
        const approval = options.agentService.respondApproval(
          approvalId,
          decision,
          readInteger(body.processGeneration, 'processGeneration')
        );
        if (approval.status === 'expired') {
          return reply.code(409).send(apiError(
            'creator_approval_expired',
            'Creator Agent approval is no longer active',
            { approvalId: approval.id, processGeneration: approval.processGeneration }
          ));
        }
        return { approval };
      } catch (error) {
        return sendCreatorError(reply, error);
      }
    }
  );

  server.get('/creator/jobs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = service.getJob(id);
    if (job === undefined) {
      return reply.code(404).send(apiError('creator_job_not_found', 'Creator job not found'));
    }
    for (const [header, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(header, value);
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });
    const query = readObject(request.query);
    const cursor = typeof query.cursor === 'string'
      ? query.cursor
      : readLastEventId(request.headers['last-event-id']);
    const sent = new Set<string>();
    const pending: CreatorEventEnvelope[] = [];
    let replaying = true;
    const writeEvent = (event: CreatorEventEnvelope) => {
      if (sent.has(event.id) || reply.raw.destroyed || reply.raw.writableEnded) return;
      sent.add(event.id);
      reply.raw.write(formatSseEvent({ id: event.id, event: event.kind, data: event }));
    };
    const unsubscribe = events.subscribe(id, event => {
      if (replaying) pending.push(event);
      else writeEvent(event);
    });
    const persistent = persistentCreatorEvents(
      job,
      options.agentService?.listEvents(id) ?? []
    );
    if (cursor === undefined) {
      writeEvent(snapshotEvent(job));
    } else {
      const cursorIndex = persistent.findIndex(event => event.id === cursor);
      if (cursorIndex < 0) {
        writeEvent({
          ...snapshotEvent(job),
          id: `reset:${job.revision}`,
          payload: { revision: job.revision, reset: true }
        });
      } else {
        for (const event of persistent.slice(cursorIndex + 1)) writeEvent(event);
      }
    }
    replaying = false;
    for (const event of pending) writeEvent(event);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
    }, options.sseHeartbeatMs ?? 15_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    reply.raw.on('close', cleanup);
    return reply;
  });
}

function emptyAgentTimeline(): CreatorAgentHistoryResponse {
  return {
    session: null,
    turns: [],
    items: [],
    approvals: [],
    lastEventSequence: 0
  };
}

function publicAgentTimeline(
  timeline: CreatorAgentHistoryResponse
): CreatorAgentHistoryResponse {
  return {
    ...timeline,
    items: timeline.items
      .filter(item => ['assistant_message', 'tool_call', 'tool_result', 'error'].includes(item.kind))
      .map(publicAgentItem)
  };
}

function publicAgentItem(item: CreatorAgentItem): CreatorAgentItem {
  const { text: _text, toolName, data, ...rest } = item;
  const visibleToolName = toolName ?? toolNameFromData(data);
  const visibleData: Record<string, CreatorJson> = {};
  for (const key of [
    'type',
    'server',
    'tool',
    'name',
    'status',
    'readOnlyHint',
    'durationMs'
  ]) {
    const value = data[key];
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) visibleData[key] = value;
  }
  return {
    ...rest,
    ...(visibleToolName === undefined ? {} : { toolName: visibleToolName }),
    ...((item.kind === 'assistant_message' || item.kind === 'error') && item.text !== undefined
      ? { text: item.text.slice(0, item.kind === 'assistant_message' ? 100_000 : 1_000) }
      : {}),
    data: visibleData
  };
}

function toolNameFromData(data: Record<string, CreatorJson>): string | undefined {
  const tool = typeof data.tool === 'string' ? data.tool : undefined;
  if (tool !== undefined) {
    return typeof data.server === 'string' && data.server.length > 0
      ? `${data.server}.${tool}`
      : tool;
  }
  return typeof data.name === 'string' && data.name.length > 0
    ? data.name
    : undefined;
}

function persistentCreatorEvents(
  job: CreatorJob,
  agentEvents: CreatorAgentEvent[]
): CreatorEventEnvelope[] {
  const events: CreatorEventEnvelope[] = [
    ...job.activities.map(activity => ({
      id: `activity:${activity.id}`,
      jobId: job.id,
      revision: activity.revision,
      kind: 'activity_changed' as const,
      payload: creatorPayload({ activity }),
      createdAt: activity.createdAt
    })),
    ...job.stages.map(stage => ({
      id: creatorStageEventId(stage),
      jobId: job.id,
      revision: job.revision,
      kind: 'stage_progress' as const,
      payload: creatorPayload({ stage }),
      createdAt: stage.finishedAt ?? stage.startedAt ?? job.updatedAt
    })),
    ...agentEvents.map(event => ({
      id: `agent:${event.sequence}`,
      jobId: job.id,
      revision: job.revision,
      kind: creatorAgentEventKind(event),
      payload: creatorPayload({ event }),
      createdAt: event.createdAt
    })),
    snapshotEvent(job)
  ];
  return events.sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt)
    || left.revision - right.revision
    || left.id.localeCompare(right.id)
  ));
}

function snapshotEvent(job: CreatorJob): CreatorEventEnvelope {
  return {
    id: `snapshot:${job.revision}`,
    jobId: job.id,
    revision: job.revision,
    kind: 'snapshot_changed',
    payload: { revision: job.revision },
    createdAt: job.updatedAt
  };
}

function creatorPayload(value: unknown): Record<string, CreatorJson> {
  return JSON.parse(JSON.stringify(value)) as Record<string, CreatorJson>;
}

function readLastEventId(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readApprovalDecision(value: unknown): CreatorAgentApprovalDecisionRequest['decision'] {
  if (value === 'approved' || value === 'rejected' || value === 'canceled') return value;
  throw new TypeError('decision must be approved, rejected or canceled');
}

function readCreatorAgentSandbox(
  value: unknown
): CreatorAgentTurnRequest['sandbox'] | undefined {
  if (value === undefined) return undefined;
  if (value === 'workspace-write' || value === 'danger-full-access') return value;
  throw new TypeError('sandbox must be workspace-write or danger-full-access');
}

function sendCreatorError(reply: FastifyReply, error: unknown) {
  if (error instanceof CreatorReferenceImageUploadError) {
    return reply.code(error.statusCode)
      .send(apiError(error.code as RuntimeErrorCode, error.message));
  }
  if (error instanceof CreatorSourceUploadError) {
    return reply.code(error.statusCode)
      .send(apiError(error.code as RuntimeErrorCode, error.message));
  }
  if (error instanceof CreatorCommandError) {
    const status = error.code === 'creator_job_not_found'
      ? 404
      : error.code === 'creator_revision_conflict'
        || error.code === 'creator_idempotency_key_reused'
        ? 409
        : 400;
    return reply.code(status).send(apiError(error.code as RuntimeErrorCode, error.message, {
      ...(error.latestRevision === undefined ? {} : { latestRevision: error.latestRevision })
    }));
  }
  if (error instanceof CreatorServiceError) {
    const status = error.code === 'creator_job_not_found'
      ? 404
      : error.code === 'creator_job_control_unavailable'
        ? 503
      : error.code === 'creator_agent_unavailable'
        ? 503
      : error.code === 'creator_agent_steer_unavailable'
        || error.code === 'creator_agent_not_running'
        || error.code === 'creator_job_not_running'
        || error.code === 'creator_job_not_resumable'
        ? 409
      : error.code === 'creator_approval_not_found'
        ? 404
      : error.code === 'creator_revision_conflict'
        || error.code === 'creator_idempotency_key_reused'
        ? 409
        : 400;
    return reply.code(status).send(apiError(error.code as RuntimeErrorCode, error.message, {
      ...(error.latestRevision === undefined ? {} : { latestRevision: error.latestRevision })
    }));
  }
  if (error instanceof ZodError || error instanceof TypeError) {
    return reply.code(400).send(apiError('VALIDATION_FAILED', error.message));
  }
  if (error instanceof VideoTranslationWorkflowError) {
    return reply.code(error.code === 'unsupported_source' ? 422 : 400)
      .send(apiError(error.code as RuntimeErrorCode, error.message));
  }
  if (error instanceof CoverWorkflowError) {
    const status = error.code === 'unsupported_source'
      ? 422
      : error.code === 'unsupported_capability'
        ? 409
        : 400;
    return reply.code(status)
      .send(apiError(error.code as RuntimeErrorCode, error.message));
  }
  throw error;
}

function requireCreatorJob(service: CreatorService, jobId: string): CreatorJob {
  const job = service.getJob(jobId);
  if (job === undefined) {
    throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
  }
  return job;
}

function shouldReconcileVideoTranslation(before: CreatorJob, after: CreatorJob): boolean {
  if (before.templateId !== 'video-translation' || after.templateId !== 'video-translation') {
    return false;
  }
  const previousNeedsInput = before.state.needsInput;
  return (
    previousNeedsInput !== null
    && typeof previousNeedsInput === 'object'
    && !Array.isArray(previousNeedsInput)
    && previousNeedsInput.code === 'creator_tts_config_missing'
    && after.state.dubbing !== true
    && after.state.needsInput === undefined
  );
}

function latestStageMatching(
  job: CreatorJob,
  predicate: (stage: CreatorStageRun) => boolean
): CreatorStageRun | undefined {
  return [...job.stages].reverse().find(predicate);
}

function isAlreadyResumed(job: CreatorJob, latest: CreatorStageRun): boolean {
  if (
    latest.status === 'canceled'
    || latest.status === 'interrupted'
    || latest.status === 'failed'
  ) return false;
  return typeof latest.progress.resumedFromStageRunId === 'string'
    && job.stages.some(stage => stage.id === latest.progress.resumedFromStageRunId);
}

function publishSnapshotIfChanged(
  events: CreatorEventHub,
  service: CreatorService,
  before: CreatorJob
): void {
  const latest = service.getJob(before.id);
  if (latest === undefined || latest.revision === before.revision) return;
  events.publish({
    id: `snapshot:${latest.revision}`,
    jobId: latest.id,
    revision: latest.revision,
    kind: 'snapshot_changed',
    payload: { revision: latest.revision }
  });
}

function fallbackIdempotencyKey(
  jobId: string,
  action: string,
  expectedRevision: number,
  input: CreatorActionRequest['input']
): string {
  return `legacy_${createHash('sha256')
    .update(JSON.stringify({ jobId, action, expectedRevision, input }))
    .digest('hex')}`;
}

function readObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('value must be an object');
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function readInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function readQueryInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
  return readInteger(parsed, field);
}

function isReadable(value: unknown): value is Readable {
  return typeof (value as { pipe?: unknown } | null)?.pipe === 'function';
}

function creatorArtifactContentType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.srt') return 'application/x-subrip; charset=utf-8';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.m4a') return 'audio/mp4';
  return 'application/octet-stream';
}

function creatorArtifactContentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="artifact"; filename*=UTF-8''${encoded}`;
}
