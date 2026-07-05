import type { FastifyInstance } from 'fastify';
import type { ResolvedCodexHome } from '../codex/home.js';
import type { ProfileManager } from '../codex/profiles/manager.js';
import { apiError } from './errors.js';

export async function registerProfileRoutes(
  server: FastifyInstance,
  input: { codexHome: ResolvedCodexHome; profileManager: ProfileManager }
): Promise<void> {
  server.get('/codex/profiles', async () => {
    const result = input.profileManager.listProfiles();
    return {
      codexHome: input.codexHome.path,
      codexHomeMode: input.codexHome.mode,
      writable: input.codexHome.writable,
      profiles: result.profiles,
      diagnostics: result.diagnostics
    };
  });

  server.get<{ Params: { name: string } }>('/codex/profiles/:name', async (request, reply) => {
    const result = input.profileManager.listProfiles();
    if (!result.baseConfigValid) {
      return reply
        .code(422)
        .send(apiError('CODEX_CONFIG_INVALID', 'Codex base config is invalid'));
    }

    const profile = result.profiles.find((candidate) => candidate.name === request.params.name);
    if (profile === undefined) {
      return reply.code(404).send(apiError('CODEX_PROFILE_NOT_FOUND', 'Profile not found'));
    }

    return { profile };
  });
}
