import type { FastifyInstance } from 'fastify';
import type {
  CodexAvailabilityProbe,
  CodexLoginStartRequest,
  CodexProviderConfigUpdateRequest
} from '@opencreator/protocol';
import type { RuntimeCapabilityMatrix } from '../codex/capabilities.js';
import type { ResolvedCodexHome } from '../codex/home.js';
import type { CodexModelCatalog } from '../codex/model-catalog-2026-08-05.js';
import { buildCodexStatusResponse } from '../codex/status.js';
import { apiError } from './errors.js';
import type { CodexRuntimeReadinessService } from '../codex/runtime-readiness.js';
import {
  CodexProviderConfigValidationError,
  type CodexProviderConfigService
} from '../codex/provider-config.js';

export async function registerCodexRoutes(
  server: FastifyInstance,
  input: {
    codexBin: string;
    codexHome: ResolvedCodexHome;
    capabilities: RuntimeCapabilityMatrix;
    modelCatalog: CodexModelCatalog;
    readiness?: CodexRuntimeReadinessService;
    providerConfig?: CodexProviderConfigService;
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

  server.get('/codex/readiness', async () => (
    input.readiness === undefined
      ? { state: 'blocked', diagnostics: ['Codex Runtime Readiness is unavailable'] }
      : await input.readiness.refresh()
  ));

  server.get('/codex/provider', async (_request, reply) => {
    if (input.providerConfig === undefined) {
      return reply.code(503).send(apiError(
        'creator_agent_unavailable',
        'Codex provider configuration is unavailable'
      ));
    }
    try {
      return await input.providerConfig.read();
    } catch (error) {
      return reply.code(502).send(apiError(
        'creator_agent_unavailable',
        error instanceof Error ? error.message : 'Failed to read Codex provider configuration'
      ));
    }
  });

  server.patch<{ Body: unknown }>('/codex/provider', async (request, reply) => {
    if (input.providerConfig === undefined) {
      return reply.code(503).send(apiError(
        'creator_agent_unavailable',
        'Codex provider configuration is unavailable'
      ));
    }
    const body = readObject(request.body);
    if (
      typeof body.baseUrl !== 'string'
      || typeof body.model !== 'string'
      || (body.apiKey !== undefined && typeof body.apiKey !== 'string')
    ) {
      return reply.code(400).send(apiError(
        'VALIDATION_FAILED',
        'baseUrl and model must be strings; apiKey must be a string when provided'
      ));
    }
    const update: CodexProviderConfigUpdateRequest = {
      baseUrl: body.baseUrl,
      model: body.model,
      ...(body.apiKey === undefined ? {} : { apiKey: body.apiKey })
    };
    try {
      return await input.providerConfig.update(update);
    } catch (error) {
      if (error instanceof CodexProviderConfigValidationError) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', error.message));
      }
      return reply.code(502).send(apiError(
        'creator_agent_unavailable',
        error instanceof Error ? error.message : 'Failed to update Codex provider configuration'
      ));
    }
  });

  server.get('/codex/account', async (_request, reply) => {
    if (input.readiness === undefined) {
      return reply.code(503).send(apiError('creator_agent_unavailable', 'Codex account service is unavailable'));
    }
    return await input.readiness.readAccount(false);
  });

  server.post<{ Body: unknown }>('/codex/account/login/start', async (request, reply) => {
    if (input.readiness === undefined) {
      return reply.code(503).send(apiError('creator_agent_unavailable', 'Codex account service is unavailable'));
    }
    const body = readObject(request.body);
    const loginType = body.loginType === 'device_code' || body.loginType === 'api_key'
      ? body.loginType
      : 'chatgpt';
    if (loginType === 'api_key' && (typeof body.apiKey !== 'string' || body.apiKey.length === 0)) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'apiKey is required'));
    }
    const loginRequest: CodexLoginStartRequest = loginType === 'api_key'
      ? { loginType, apiKey: body.apiKey as string }
      : { loginType };
    return await input.readiness.startLogin(loginRequest);
  });

  server.post<{ Body: unknown }>('/codex/account/login/cancel', async (request, reply) => {
    if (input.readiness === undefined) {
      return reply.code(503).send(apiError('creator_agent_unavailable', 'Codex account service is unavailable'));
    }
    const body = readObject(request.body);
    if (typeof body.loginId !== 'string' || body.loginId.length === 0) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'loginId is required'));
    }
    return await input.readiness.cancelLogin({ loginId: body.loginId });
  });

  server.post('/codex/account/logout', async (_request, reply) => {
    if (input.readiness === undefined) {
      return reply.code(503).send(apiError('creator_agent_unavailable', 'Codex account service is unavailable'));
    }
    return await input.readiness.logout();
  });
}

function readObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
