import type { CodexStatusResponse, RunDiagnosticsResponse } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import {
  collectRunDiagnostics,
  DiagnosticsError,
  type CollectRunDiagnosticsResult as CollectedRunDiagnostics
} from '../diagnostics/collector.js';
import type { RunRepository } from '../storage/repositories.js';
import type { ScheduleRepository } from '../scheduler/repository.js';
import { apiError } from './errors.js';

export type DiagnosticsRouteInput = {
  dataDir: string;
  runs: Pick<RunRepository, 'getRun'>;
  schedules: Pick<ScheduleRepository, 'getRunTrace'>;
  getCodexStatusSnapshot: () => CodexStatusResponse;
};

export async function registerDiagnosticsRoutes(
  server: FastifyInstance,
  input: DiagnosticsRouteInput
): Promise<void> {
  server.get('/runs/:id/diagnostics', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { includeRawRedacted } = request.query as { includeRawRedacted?: string };

    try {
      const diagnostics: CollectedRunDiagnostics = collectRunDiagnostics({
        dataDir: input.dataDir,
        runs: input.runs,
        schedules: input.schedules,
        runId: id,
        includeRawRedacted: includeRawRedacted === 'true'
      });
      const response: RunDiagnosticsResponse = {
        ...diagnostics,
        codexStatusSnapshot: input.getCodexStatusSnapshot()
      };
      return response;
    } catch (error) {
      if (error instanceof DiagnosticsError) {
        if (error.code === 'VALIDATION_FAILED') {
          return reply.code(400).send(apiError('VALIDATION_FAILED', error.message));
        }
        if (error.code === 'RUN_NOT_FOUND') {
          return reply.code(404).send(apiError('RUN_NOT_FOUND', error.message));
        }
      }
      return reply.code(500).send(apiError('INTERNAL_ERROR', 'Internal error'));
    }
  });
}
