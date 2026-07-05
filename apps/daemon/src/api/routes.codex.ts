import type { FastifyInstance } from 'fastify';
import type { RuntimeCapabilityMatrix } from '../codex/capabilities.js';
import type { ResolvedCodexHome } from '../codex/home.js';

export async function registerCodexRoutes(
  server: FastifyInstance,
  input: { codexBin: string; codexHome: ResolvedCodexHome; capabilities: RuntimeCapabilityMatrix }
): Promise<void> {
  server.get('/codex/status', async () => {
    return {
      codexBin: input.codexBin,
      codexVersion: input.capabilities.codexVersion,
      codexHome: input.codexHome.path,
      codexHomeMode: input.codexHome.mode,
      codexHomeSource: input.codexHome.source,
      codexHomeWritable: input.codexHome.writable,
      capabilities: input.capabilities,
      diagnostics: []
    };
  });
}
