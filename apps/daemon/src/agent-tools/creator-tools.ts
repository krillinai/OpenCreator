import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type {
  AgentContextEnvelope,
  CreatorCommandRequest,
  CreatorArtifact,
  CreatorJob
} from '@opencreator/protocol';
import type { CreatorService } from '../creator/service.js';
import type { AgentContextBuilder } from '../creator/agent/context-builder.js';
import type {
  CreatorCommandDispatcher,
  CreatorCommandDispatchResult
} from '../creator/command-dispatcher.js';

export const CREATOR_TOOL_NAMES = [
  'creator_get_context',
  'creator_get_artifact',
  'creator_apply_action'
] as const;

export type CreatorToolName = typeof CREATOR_TOOL_NAMES[number];

export type CreatorToolOperations = {
  getJob(jobId: string): CreatorJob | undefined;
  getContext(jobId: string): AgentContextEnvelope;
  readArtifact(jobId: string, artifactId: string, range?: { start: number; end: number }): Promise<{
    artifact: CreatorArtifact;
    content: string;
    truncated: boolean;
  }>;
  applyAction(jobId: string, request: CreatorCommandRequest): CreatorCommandDispatchResult;
};

export function createCreatorToolOperations(input: {
  service: CreatorService;
  dispatcher: CreatorCommandDispatcher;
  contextBuilder: AgentContextBuilder;
  maxArtifactBytes?: number;
}): CreatorToolOperations {
  const maxArtifactBytes = input.maxArtifactBytes ?? 1024 * 1024;
  return {
    getJob: input.service.getJob,
    getContext(jobId) {
      const job = requireJob(input.service, jobId);
      return input.contextBuilder.build(job);
    },
    async readArtifact(jobId, artifactId, range) {
      const job = requireJob(input.service, jobId);
      const artifact = job.artifacts.find(candidate => candidate.id === artifactId);
      if (artifact === undefined || artifact.path === null) {
        throw new CreatorToolError('creator_artifact_not_found', 'Creator artifact was not found');
      }
      const filePath = resolve(artifact.path);
      const bytes = await readFile(filePath);
      const start = Math.max(0, range?.start ?? 0);
      const requestedEnd = range?.end ?? bytes.length;
      const end = Math.min(bytes.length, requestedEnd, start + maxArtifactBytes);
      return {
        artifact,
        content: bytes.subarray(start, end).toString('utf8'),
        truncated: end < bytes.length || requestedEnd > end
      };
    },
    applyAction(jobId, request) {
      requireJob(input.service, jobId);
      return input.dispatcher.dispatch(jobId, request, 'agent');
    }
  };
}

export class CreatorToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CreatorToolError';
  }
}

const artifactSchema = z.object({
  artifactId: z.string().min(1),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().positive().optional()
}).strict();

const actionSchema = z.object({
  action: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()).default({})
}).strict();

export function createCreatorToolDefinitions(input: {
  request(request: { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown> }): Promise<unknown>;
}) {
  return {
    creator_get_context: {
      description: '读取当前 OpenCreator 创作任务的最小上下文和最新 revision。修改前必须先调用。',
      inputSchema: z.object({}).strict(),
      execute: async () => input.request({ method: 'GET', path: '/internal/agent-tools/creator/context' })
    },
    creator_get_artifact: {
      description: '按需读取当前创作任务中已登记的文本产物，可指定字节范围。',
      inputSchema: artifactSchema,
      execute: async (value: unknown) => {
        const parsed = artifactSchema.parse(value);
        const query = new URLSearchParams();
        if (parsed.start !== undefined) query.set('start', String(parsed.start));
        if (parsed.end !== undefined) query.set('end', String(parsed.end));
        const suffix = query.size === 0 ? '' : `?${query.toString()}`;
        return input.request({
          method: 'GET',
          path: `/internal/agent-tools/creator/artifacts/${encodeURIComponent(parsed.artifactId)}${suffix}`
        });
      }
    },
    creator_apply_action: {
      description: [
        '以 Agent 身份向当前创作任务提交 Action，必须携带最近读取的 expectedRevision 和唯一 idempotencyKey。',
        'update-settings/undo-action 的参数结构必须是 input: { patch: { ... }, objectId?: string }，patch 不得为空。',
        'run-stage 的参数结构必须是 input: { stageId: "..." }，stageId 必须逐字使用 Creator Context.availableStageIds 中的原值，不接受 render 等别名。'
      ].join(' '),
      inputSchema: actionSchema,
      execute: async (value: unknown) => {
        const parsed = actionSchema.parse(value);
        return input.request({
          method: 'POST',
          path: '/internal/agent-tools/creator/actions',
          body: parsed
        });
      }
    }
  } as const;
}

export function createCreatorToolHttpClient(input: { baseUrl: string; token: string }) {
  return {
    async request(request: { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown> }) {
      const response = await fetch(new URL(request.path, input.baseUrl), {
        method: request.method,
        headers: {
          authorization: `Bearer ${input.token}`,
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
      });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const message = payload !== null && typeof payload === 'object'
          && 'error' in payload && payload.error !== null && typeof payload.error === 'object'
          && 'message' in payload.error && typeof payload.error.message === 'string'
          ? payload.error.message
          : `Creator tool HTTP ${response.status}`;
        throw new CreatorToolError('creator_tool_http_failed', message);
      }
      return payload;
    }
  };
}

function requireJob(service: CreatorService, jobId: string): CreatorJob {
  const job = service.getJob(jobId);
  if (job === undefined) throw new CreatorToolError('creator_job_not_found', 'Creator job was not found');
  return job;
}
