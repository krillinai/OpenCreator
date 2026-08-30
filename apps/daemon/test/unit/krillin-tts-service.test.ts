import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatorServicesConfigStore } from '../../src/creator-services/config-store.js';
import {
  createKrillinTtsService,
  KrillinTtsServiceError
} from '../../src/creator/krillin/tts-service.js';

describe('KrillinTtsService', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it('lists the bundled Qwen3 voice catalog without calling an outdated Runtime', async () => {
    const root = await temporaryRoot();
    const config = createDefaultCreatorServicesConfig();
    config.tts.aliyun.apiKey = 'dashscope-key';
    const executeUtility = vi.fn();
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(config),
      executeUtility
    });

    const response = await service.listVoices('aliyun');

    expect(response).toMatchObject({
      provider: 'aliyun',
      model: 'qwen3-tts-flash'
    });
    expect(response.voices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'Cherry',
        name: '芊悦',
        provider: 'aliyun',
        language: 'zh-CN',
        kind: 'builtin',
        recommended: true
      }),
      expect.objectContaining({
        id: 'Kiki',
        name: '粤语-阿清',
        provider: 'aliyun',
        language: 'zh-yue',
        kind: 'builtin'
      })
    ]));
    expect(response.voices).toHaveLength(48);
    expect(executeUtility).not.toHaveBeenCalled();
  });

  it('limits the first Qwen3 snapshot to voices supported by that model version', async () => {
    const root = await temporaryRoot();
    const config = createDefaultCreatorServicesConfig();
    config.tts.aliyun.model = 'qwen3-tts-flash-2025-09-18';
    const executeUtility = vi.fn();
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(config),
      executeUtility
    });

    const response = await service.listVoices('aliyun');

    expect(response.voices.map(voice => voice.id)).toEqual([
      'Cherry',
      'Serena',
      'Ethan',
      'Chelsie',
      'Momo',
      'Vivian',
      'Moon',
      'Maia',
      'Kai',
      'Nofish',
      'Bella'
    ]);
    expect(executeUtility).not.toHaveBeenCalled();
  });

  it('uses the Runtime for other models and filters explicit model mismatches', async () => {
    const root = await temporaryRoot();
    const config = createDefaultCreatorServicesConfig();
    config.tts.aliyun.model = 'custom-tts-model';
    const executeUtility = vi.fn(async input => {
      expect(input.config.tts.aliyun.model).toBe('custom-tts-model');
      expect(input.args).toEqual(['voices', '--provider', 'aliyun']);
      return {
        ok: true,
        voices: [
          { code: 'legacy-voice', name: 'Legacy' },
          { code: 'matching-voice', supported_models: ['custom-tts-model'] },
          { code: 'other-voice', supported_models: ['another-model'] }
        ]
      };
    });
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(config),
      executeUtility
    });

    const response = await service.listVoices('aliyun');

    expect(response.voices.map(voice => voice.id)).toEqual([
      'legacy-voice',
      'matching-voice'
    ]);
    expect(executeUtility).toHaveBeenCalledOnce();
  });

  it('synthesizes through the Krillin speech command with provider controls', async () => {
    const root = await temporaryRoot();
    const config = createDefaultCreatorServicesConfig();
    config.tts.openai.apiKey = 'sk-test';
    const executeUtility = vi.fn(async input => {
      const outputIndex = input.args.indexOf('--output');
      const outputPath = input.args[outputIndex + 1];
      expect(outputPath).toBeTypeOf('string');
      await writeFile(outputPath!, Buffer.from('speech-audio'));
      return { ok: true, outputs: { tts_audio: outputPath } };
    });
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(config),
      executeUtility
    });

    const result = await service.synthesize({
      text: 'Speak this text.',
      provider: 'openai',
      voiceId: 'marin',
      format: 'mp3',
      speed: 1.1,
      instructions: 'Speak warmly.'
    });

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voiceId: 'marin',
      format: 'mp3',
      mime: 'audio/mpeg'
    });
    expect(result.content.toString()).toBe('speech-audio');
    expect(executeUtility).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        'speech',
        '--provider', 'openai',
        '--voice', 'marin',
        '--format', 'mp3',
        '--speed', '1.1',
        '--instructions', 'Speak warmly.'
      ])
    }));
  });

  it('requires the configured provider API key before synthesis', async () => {
    const root = await temporaryRoot();
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(createDefaultCreatorServicesConfig()),
      executeUtility: vi.fn()
    });

    await expect(service.synthesize({
      text: 'Missing configuration',
      provider: 'minimax',
      voiceId: 'English_Graceful_Lady'
    })).rejects.toMatchObject({
      code: 'creator_tts_config_missing',
      statusCode: 409
    } satisfies Partial<KrillinTtsServiceError>);
  });

  async function temporaryRoot() {
    const root = await mkdtemp(join(tmpdir(), 'opencreator-tts-service-'));
    roots.push(root);
    return root;
  }
});

function createConfigStore(
  config: ReturnType<typeof createDefaultCreatorServicesConfig>
): CreatorServicesConfigStore {
  return {
    read: vi.fn(async () => structuredClone(config)),
    write: vi.fn(async next => next),
    reset: vi.fn(async () => createDefaultCreatorServicesConfig())
  };
}
