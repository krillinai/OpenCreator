import type {
  CreatorServicesCapabilitiesResponse,
  CreatorServicesConfig,
  CreatorTtsPreviewRequest,
  CreatorTtsProvider
} from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  CreatorServicesConfigStoreError,
  parseCreatorServicesConfig,
  presentCreatorServicesConfig,
  retainCreatorServicesCredentials,
  type CreatorServicesConfigStore
} from '../creator-services/config-store.js';
import { createKrillinCreatorServicesCapabilities } from '../creator/krillin/capabilities.js';
import {
  KrillinTtsServiceError,
  type KrillinTtsService
} from '../creator/krillin/tts-service.js';
import { apiError } from './errors.js';

export async function registerCreatorServicesRoutes(
  server: FastifyInstance,
  store: CreatorServicesConfigStore,
  readCapabilities: () => CreatorServicesCapabilitiesResponse =
    createKrillinCreatorServicesCapabilities,
  ttsService?: Pick<KrillinTtsService, 'listVoices' | 'preview'>,
  onConfigurationChanged?: () => Promise<void> | void
): Promise<void> {
  server.get('/creator-services/capabilities', async () => readCapabilities());

  server.get('/creator-services/config', async (_request, reply) => {
    try {
      return presentCreatorServicesConfig(await store.read());
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  server.post<{ Body: { baseUrl?: string; model?: string; apiKey?: string; timeoutSeconds?: number } }>(
    '/creator-services/llm/test', async (request, reply) => {
      const { baseUrl, model, apiKey, timeoutSeconds } = request.body ?? {};
      if (typeof baseUrl !== 'string' || typeof model !== 'string' || !/^https?:$/.test(safeProtocol(baseUrl))
        || !model.trim() || typeof apiKey !== 'string'
        || !Number.isInteger(timeoutSeconds) || timeoutSeconds! < 1 || timeoutSeconds! > 600) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'Invalid LLM connection settings'));
      }
      try {
        const saved = await store.read();
        const credential = apiKey || (saved.llm.source === 'custom' && saved.llm.baseUrl === baseUrl
          && saved.llm.model === model ? saved.llm.apiKey : '');
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
          headers: credential ? { Authorization: `Bearer ${credential}` } : {},
          signal: AbortSignal.timeout(timeoutSeconds! * 1000)
        });
        if (!response.ok) return reply.code(502).send(apiError('LLM_CONNECTION_FAILED', `LLM endpoint returned HTTP ${response.status}`));
        const result: unknown = await response.json();
        const models = typeof result === 'object' && result !== null && 'data' in result && Array.isArray(result.data)
          ? result.data : [];
        if (!models.some(item => typeof item === 'object' && item !== null && 'id' in item && item.id === model)) {
          return reply.code(502).send(apiError('LLM_CONNECTION_FAILED', `Model ${model} is not served by this endpoint`));
        }
        return { connected: true, model };
      } catch (error) {
        return reply.code(502).send(apiError('LLM_CONNECTION_FAILED', error instanceof Error ? error.message : 'LLM endpoint unavailable'));
      }
    }
  );

  server.patch<{ Body: unknown }>('/creator-services/config', async (request, reply) => {
    try {
      const config = parseCreatorServicesConfig(request.body);
      const unsupportedProvider = unsupportedTranscriptionProvider(
        config,
        readCapabilities()
      );
      if (unsupportedProvider !== undefined) {
        return reply.code(400).send(apiError(
          'unsupported_capability',
          `Transcription provider is unavailable on this Runtime: ${unsupportedProvider}`
        ));
      }
      const current = await store.read();
      const saved = await store.write(retainCreatorServicesCredentials(config, current));
      try {
        await onConfigurationChanged?.();
      } catch (error) {
        server.log.warn({ error }, 'Creator workflow configuration reconciliation failed');
      }
      return presentCreatorServicesConfig(saved);
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }));
        const firstIssue = issues[0];
        return reply.code(400).send(apiError(
          'VALIDATION_FAILED',
          firstIssue === undefined
            ? 'Creator services configuration is invalid'
            : `字段 ${firstIssue.field || 'config'} 无效：${firstIssue.message}`,
          { fields: issues }
        ));
      }
      return sendStoreError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/creator-services/transcription/test', async (request, reply) => {
    try {
      const body = request.body as { baseUrl?: string; apiKey?: string; model?: string; timeoutMs?: number };
      const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.replace(/\/+$/, '') : '';
      const model = typeof body.model === 'string' ? body.model.trim() : '';
      if (!/^https?:\/\//i.test(baseUrl) || !model) return reply.code(400).send(apiError('VALIDATION_FAILED', 'FunASR Base URL and model are required'));
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.min(Math.max(body.timeoutMs ?? 10000, 1000), 60000));
      try {
        const saved = await store.read();
        const configured = saved.transcription.funasr;
        const apiKey = typeof body.apiKey === 'string' && body.apiKey
          ? body.apiKey
          : configured.baseUrl.replace(/\/+$/, '') === baseUrl ? configured.apiKey : '';
        const response = await fetch(`${baseUrl}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: controller.signal });
        const payload = await response.json().catch(() => undefined) as { data?: Array<{ id?: string }> } | undefined;
        if (!response.ok) return reply.code(502).send(apiError('SMART_DUBBING_UPSTREAM_ERROR', `FunASR connection failed (HTTP ${response.status})`));
        const models = Array.isArray(payload?.data)
          ? payload.data.map(item => item.id).filter((id): id is string => typeof id === 'string')
          : [];
        if (!models.includes(model)) return reply.code(502).send(apiError('SMART_DUBBING_UPSTREAM_ERROR', `FunASR model ${model} is not available`));
        return { connected: true, model, models, capabilities: ['audio.transcriptions'] };
      } finally { clearTimeout(timer); }
    } catch (error) { return reply.code(502).send(apiError('SMART_DUBBING_UPSTREAM_ERROR', error instanceof Error && error.name === 'AbortError' ? 'FunASR connection timed out' : 'FunASR connection failed')); }
  });

  server.delete('/creator-services/config', async (_request, reply) => {
    try {
      return presentCreatorServicesConfig(await store.reset());
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  if (ttsService !== undefined) {
    server.get<{
      Querystring: { provider?: string; model?: string };
    }>('/creator-services/tts/voices', async (request, reply) => {
      const provider = parseTtsProvider(request.query.provider);
      if (provider === undefined) {
        return reply.code(400).send(apiError(
          'VALIDATION_FAILED',
          'A valid TTS provider is required'
        ));
      }
      try {
        return await ttsService.listVoices(provider, request.query.model);
      } catch (error) {
        return sendTtsError(reply, error);
      }
    });

    server.post<{ Body: CreatorTtsPreviewRequest }>(
      '/creator-services/tts/preview',
      async (request, reply) => {
        const provider = parseTtsProvider(request.body?.provider);
        if (
          provider === undefined
          || typeof request.body?.voiceId !== 'string'
          || request.body.voiceId.trim().length === 0
        ) {
          return reply.code(400).send(apiError(
            'VALIDATION_FAILED',
            'A valid TTS provider and voice are required'
          ));
        }
        try {
          const result = await ttsService.preview({
            provider,
            voiceId: request.body.voiceId,
            ...(typeof request.body.model === 'string' ? { model: request.body.model } : {}),
            ...(typeof request.body.text === 'string' ? { text: request.body.text } : {})
          });
          return reply
            .header('Content-Type', result.mime)
            .header('Content-Length', String(result.content.length))
            .header('Cache-Control', 'no-store')
            .header('X-Content-Type-Options', 'nosniff')
            .send(result.content);
        } catch (error) {
          return sendTtsError(reply, error);
        }
      }
    );
  }
}

function safeProtocol(baseUrl: string): string {
  try { return new URL(baseUrl).protocol; } catch { return ''; }
}

function sendStoreError(reply: FastifyReply, error: unknown) {
  if (error instanceof CreatorServicesConfigStoreError) {
    return reply.code(503).send(apiError(error.code, 'Local configuration file is unavailable'));
  }
  throw error;
}

function sendTtsError(reply: FastifyReply, error: unknown) {
  if (error instanceof KrillinTtsServiceError) {
    return reply.code(error.statusCode).send(apiError(error.code, error.message, undefined, undefined, error.publicFacts));
  }
  throw error;
}

function parseTtsProvider(value: unknown): CreatorTtsProvider | undefined {
  if (value === 'openai' || value === 'aliyun' || value === 'minimax' || value === 'edge-tts' || value === 'volcengine') {
    return value;
  }
  return undefined;
}

function unsupportedTranscriptionProvider(
  config: CreatorServicesConfig,
  capabilities: CreatorServicesCapabilitiesResponse
): CreatorServicesConfig['transcription']['provider'] | undefined {
  const selected = capabilities.transcription.providers.find(
    candidate => candidate.provider === config.transcription.provider
  );
  return selected?.available === true ? undefined : config.transcription.provider;
}
