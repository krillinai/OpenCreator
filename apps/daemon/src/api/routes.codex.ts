import type { FastifyInstance } from 'fastify';
import type { CodexAvailabilityProbe } from '@clawee/protocol';
import type { RuntimeCapabilityMatrix } from '../codex/capabilities.js';
import type { ResolvedCodexHome } from '../codex/home.js';
import type { CodexModelCatalog } from '../codex/model-catalog-2026-08-05.js';
import { buildCodexStatusResponse } from '../codex/status.js';
import { apiError } from './errors.js';

export async function registerCodexRoutes(
  server: FastifyInstance,
  input: {
    codexBin: string;
    codexHome: ResolvedCodexHome;
    capabilities: RuntimeCapabilityMatrix;
    modelCatalog: CodexModelCatalog;
    getAvailabilityProbe?(): CodexAvailabilityProbe | undefined;
  }
): Promise<void> {
  server.get('/codex/status', async () => buildCodexStatusResponse({
    ...input,
    availabilityProbe: input.getAvailabilityProbe?.()
  }));

  server.get('/codex/models', async (_request, reply) => {
    try {
      return await input.modelCatalog.listModels();
    } catch {
      return reply
        .code(502)
        .send(apiError('CODEX_MODEL_LIST_FAILED', 'Failed to load Codex models'));
    }
  });
}
