import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ResolvedCodexHome } from '../codex/home.js';
import type { ProfileManager } from '../codex/profiles/manager.js';
import { isValidProfileName, validateProfileConfig } from '../codex/profiles/config.js';
import type { TomlProfileConfig } from '../codex/profiles/types.js';
import type { CodexProfile } from '../codex/profiles/types.js';
import { apiError } from './errors.js';

export async function registerProfileRoutes(
  server: FastifyInstance,
  input: {
    codexHome: ResolvedCodexHome;
    profileManager: ProfileManager;
    getProfileUsage?(name: string): {
      threads: Array<{ id: string; title: string | null }>;
      schedules: Array<{ id: string; name: string }>;
    };
  }
): Promise<void> {
  server.get('/codex/profiles', async () => {
    const result = input.profileManager.listProfiles();
    return {
      codexHome: input.codexHome.path,
      codexHomeMode: input.codexHome.mode,
      writable: input.codexHome.writable,
      baseConfigValid: result.baseConfigValid,
      profiles: result.profiles.map(toProfileResponse),
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

    return { profile: toProfileResponse(profile) };
  });

  server.post<{ Body: unknown }>('/codex/profiles', async (request, reply) => {
    const body = parseCreateProfileRequest(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

    try {
      await input.profileManager.createProfile(body.value.name, body.value.config);
      const profile = input.profileManager.getProfile(body.value.name);
      if (profile === undefined) return sendProfileWriteFailed(reply);
      return reply.code(201).send({ profile: toProfileResponse(profile) });
    } catch (error) {
      return sendProfileWriteError(error, reply);
    }
  });

  server.patch<{ Params: { name: string }; Body: unknown }>(
    '/codex/profiles/:name',
    async (request, reply) => {
      const body = parseUpdateProfileRequest(request.params.name, request.body);
      if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

      try {
        await input.profileManager.updateProfile(body.value.name, body.value.config);
        const profile = input.profileManager.getProfile(body.value.name);
        if (profile === undefined) return sendProfileWriteFailed(reply);
        return { profile: toProfileResponse(profile) };
      } catch (error) {
        return sendProfileWriteError(error, reply);
      }
    }
  );

  server.delete<{ Params: { name: string } }>('/codex/profiles/:name', async (request, reply) => {
    if (!isValidProfileName(request.params.name)) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'name must be a valid profile name'));
    }

    try {
      const profile = input.profileManager.getProfile(request.params.name);
      const usage = profile === undefined ? undefined : input.getProfileUsage?.(request.params.name);
      if (usage !== undefined && (usage.threads.length > 0 || usage.schedules.length > 0)) {
        return reply.code(409).send(apiError(
          'CODEX_PROFILE_IN_USE',
          'Profile is still referenced',
          usage
        ));
      }
      await input.profileManager.deleteProfile(request.params.name);
      return { deleted: true };
    } catch (error) {
      return sendProfileWriteError(error, reply);
    }
  });
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseCreateProfileRequest(
  body: unknown
): ParseResult<{ name: string; config: TomlProfileConfig }> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };

  const name = body.name;
  if (typeof name !== 'string' || !isValidProfileName(name)) {
    return { ok: false, message: 'name must be a valid profile name' };
  }

  return parseProfileConfig(body.config, name);
}

function parseUpdateProfileRequest(
  name: string,
  body: unknown
): ParseResult<{ name: string; config: TomlProfileConfig }> {
  if (!isValidProfileName(name)) {
    return { ok: false, message: 'name must be a valid profile name' };
  }
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };

  return parseProfileConfig(body.config, name);
}

function parseProfileConfig(
  config: unknown,
  name: string
): ParseResult<{ name: string; config: TomlProfileConfig }> {
  if (!isPlainObject(config)) return { ok: false, message: 'config must be an object' };

  const validation = validateProfileConfig(config);
  if (!validation.ok) return { ok: false, message: validation.message };

  return { ok: true, value: { name, config: config as TomlProfileConfig } };
}

function sendProfileWriteError(error: unknown, reply: FastifyReply) {
  const code = getCodexErrorCode(error);
  if (code === 'CODEX_HOME_READ_ONLY') {
    return reply.code(409).send(apiError(code, 'Codex home is read-only'));
  }
  if (code === 'CODEX_PROFILE_EXISTS') {
    return reply.code(409).send(apiError(code, 'Profile already exists'));
  }
  if (code === 'CODEX_PROFILE_NOT_FOUND') {
    return reply.code(404).send(apiError(code, 'Profile not found'));
  }
  if (code === 'CODEX_CONFIG_INVALID') {
    return reply.code(422).send(apiError(code, getErrorMessage(error, 'Codex base config is invalid')));
  }
  if (code === 'CODEX_PROFILE_INVALID') {
    return reply.code(422).send(apiError(code, getErrorMessage(error, 'Profile is invalid')));
  }

  return sendProfileWriteFailed(reply);
}

function sendProfileWriteFailed(reply: FastifyReply) {
  return reply
    .code(500)
    .send(apiError('CODEX_CONFIG_WRITE_FAILED', 'Failed to write Codex profile config'));
}

function getCodexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.split(':', 1)[0];
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toProfileResponse(profile: CodexProfile): CodexProfile {
  return {
    ...profile,
    config: Object.fromEntries(
      Object.entries(profile.config).map(([key, value]) => [
        key,
        isSensitiveProfileKey(key) ? '[REDACTED]' : value
      ])
    )
  };
}

function isSensitiveProfileKey(key: string): boolean {
  return /(?:secret|token|password|api[_-]?key|bearer|credential)/i.test(key);
}
