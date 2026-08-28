import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSmartDubbingRoutes } from '../../src/api/routes.smart-dubbing.js';
import { KrillinTtsServiceError } from '../../src/creator/krillin/tts-service.js';
import { createSmartDubbingService } from '../../src/smart-dubbing/service.js';

describe('smart dubbing API', () => {
  let server: FastifyInstance;
  let dataDir: string;

  beforeEach(async () => {
    server = Fastify({ logger: false });
    dataDir = await mkdtemp(join(tmpdir(), 'opencreator-smart-dubbing-'));
  });

  afterEach(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('generates, stores, and serves speech synthesized by KrillinAI', async () => {
    const synthesize = vi.fn(async () => ({
      content: Buffer.from('test-audio'),
      mime: 'audio/mpeg' as const,
      provider: 'aliyun' as const,
      model: 'qwen3-tts-flash',
      voiceId: 'Cherry',
      format: 'mp3' as const
    }));
    const service = createSmartDubbingService({
      dataDir,
      ttsService: { synthesize },
      createId: () => 'result_test_1234',
      now: () => new Date('2026-08-20T00:00:00.000Z')
    });
    await registerSmartDubbingRoutes(server, service);

    const generated = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/results',
      payload: {
        text: 'A short script for dubbing.',
        voice: 'Cherry',
        style: 'warm',
        speed: 1.05,
        format: 'mp3'
      }
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json().result).toMatchObject({
      id: 'result_test_1234',
      mime: 'audio/mpeg',
      provider: 'aliyun',
      model: 'qwen3-tts-flash',
      voice: 'Cherry',
      style: 'warm',
      speed: 1.05,
      format: 'mp3'
    });
    expect(synthesize).toHaveBeenCalledWith({
      text: 'A short script for dubbing.',
      voiceId: 'Cherry',
      format: 'mp3',
      speed: 1.05,
      instructions: expect.stringContaining('warm')
    });
    await expect(readFile(join(dataDir, 'smart-dubbing', 'result_test_1234.mp3'), 'utf8'))
      .resolves.toBe('test-audio');

    const content = await server.inject({
      method: 'GET',
      url: '/smart-dubbing/results/result_test_1234/content'
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('audio/mpeg');
    expect(content.rawPayload.toString()).toBe('test-audio');
  });

  it('previews speech audio without storing a result', async () => {
    const synthesize = vi.fn(async () => ({
      content: Buffer.from('preview-audio'),
      mime: 'audio/wav' as const,
      provider: 'minimax' as const,
      model: 'speech-2.8-hd',
      voiceId: 'English_Graceful_Lady',
      format: 'wav' as const
    }));
    await registerSmartDubbingRoutes(server, createSmartDubbingService({
      dataDir,
      ttsService: { synthesize }
    }));

    const preview = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/preview',
      payload: {
        text: 'Preview this voice.',
        voice: 'English_Graceful_Lady',
        style: 'professional',
        speed: 1,
        format: 'wav'
      }
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('audio/wav');
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.rawPayload.toString()).toBe('preview-audio');
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('maps Krillin configuration and provider failures to product errors', async () => {
    const synthesize = vi.fn()
      .mockRejectedValueOnce(new KrillinTtsServiceError(
        'creator_tts_config_missing',
        'Configure the selected provider API key',
        409
      ))
      .mockRejectedValueOnce(new KrillinTtsServiceError(
        'unsupported_capability',
        'The selected provider is unavailable',
        409
      ));
    await registerSmartDubbingRoutes(server, createSmartDubbingService({
      dataDir,
      ttsService: { synthesize }
    }));

    const invalid = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/results',
      payload: { text: '', voice: '', style: 'natural', speed: 1, format: 'mp3' }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');

    const missingConfig = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/results',
      payload: { text: 'Ready to speak', voice: 'marin', style: 'natural', speed: 1, format: 'mp3' }
    });
    expect(missingConfig.statusCode).toBe(409);
    expect(missingConfig.json().error.code).toBe('SMART_DUBBING_CONFIG_REQUIRED');

    const unsupported = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/results',
      payload: { text: 'Ready to speak', voice: 'marin', style: 'natural', speed: 1, format: 'mp3' }
    });
    expect(unsupported.statusCode).toBe(409);
    expect(unsupported.json().error.code).toBe('SMART_DUBBING_PROVIDER_UNSUPPORTED');
  });
});
