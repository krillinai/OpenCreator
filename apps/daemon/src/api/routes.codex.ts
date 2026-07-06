import type { FastifyInstance } from 'fastify';
import type { RuntimeCapabilityMatrix } from '../codex/capabilities.js';
import type { ResolvedCodexHome } from '../codex/home.js';
import { buildCodexStatusResponse } from '../codex/status.js';

export async function registerCodexRoutes(
  server: FastifyInstance,
  input: { codexBin: string; codexHome: ResolvedCodexHome; capabilities: RuntimeCapabilityMatrix }
): Promise<void> {
  server.get('/codex/status', async () => buildCodexStatusResponse(input));
}
