import type { FastifyInstance } from 'fastify';
import { parseCodexCapabilityMatrix } from '../codex/capabilities.js';
import { resolveCodexHome } from '../codex/home.js';

export async function registerCodexRoutes(server: FastifyInstance): Promise<void> {
  server.get('/codex/status', async () => {
    const home = resolveCodexHome();
    const capabilities = parseCodexCapabilityMatrix({
      versionOutput: 'unknown',
      execHelp: '',
      resumeHelp: '',
      mcpAddHelp: ''
    });
    capabilities.warnings.push('Codex runtime help has not been collected yet.');

    return {
      codexBin: 'codex',
      codexVersion: 'unknown',
      codexHome: home.path,
      codexHomeMode: home.mode,
      capabilities,
      diagnostics: []
    };
  });
}
