import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { mkdtemp } from 'node:fs/promises';
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
    vi.unstubAllGlobals();
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

  it('lists the static OpenAI voice catalog without scanning or launching the Runtime', async () => {
    const root = await temporaryRoot();
    const executeUtility = vi.fn();
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(createDefaultCreatorServicesConfig()),
      executeUtility
    });

    const response = await service.listVoices('openai');

    expect(response).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini-tts'
    });
    expect(response.voices).toHaveLength(13);
    expect(response.voices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'marin',
        name: 'Marin',
        provider: 'openai',
        kind: 'builtin',
        recommended: true
      }),
      expect.objectContaining({
        id: 'cedar',
        name: 'Cedar',
        provider: 'openai',
        kind: 'builtin',
        recommended: true
      })
    ]));
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

  it('synthesizes through the configured provider with voice controls', async () => {
    const root = await temporaryRoot();
    const config = createDefaultCreatorServicesConfig();
    config.tts.openai.apiKey = 'sk-test';
    const executeSynthesis = vi.fn(async () => ({
      content: Buffer.from('speech-audio'),
      format: 'mp3' as const
    }));
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(config),
      executeSynthesis
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
    expect(executeSynthesis).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voiceId: 'marin',
      format: 'mp3',
      speed: 1.1,
      instructions: 'Speak warmly.'
    }));
  });

  it('uses the Qwen multimodal endpoint and downloads the returned Aliyun audio', async () => {
    const root = await temporaryRoot();
    const config = createDefaultCreatorServicesConfig();
    config.tts.provider = 'aliyun';
    config.tts.aliyun.baseUrl = 'https://tts.example.com/api/v1';
    config.tts.aliyun.apiKey = 'dashscope-key';
    const wav = Buffer.from('RIFFfixture-wave');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: { audio: { url: 'http://audio.example.com/result.wav?signature=secret' } }
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(wav, {
        status: 200,
        headers: { 'content-type': 'audio/wav' }
      }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(config)
    });

    const result = await service.synthesize({
      text: '测试文本',
      provider: 'aliyun',
      model: 'qwen3-tts-flash',
      voiceId: 'Cherry',
      format: 'wav'
    });

    expect(result).toMatchObject({
      provider: 'aliyun',
      model: 'qwen3-tts-flash',
      voiceId: 'Cherry',
      format: 'wav',
      mime: 'audio/wav'
    });
    expect(result.content).toEqual(wav);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://tts.example.com/api/v1/services/aigc/multimodal-generation/generation'
    );
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(request).toEqual({
      model: 'qwen3-tts-flash',
      input: { text: '测试文本', voice: 'Cherry', language_type: 'Chinese' }
    });
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      'https://audio.example.com/result.wav?signature=secret'
    );
  });

  it('lists bundled Volcengine voices and synthesizes through the V1 HTTP API', async () => {
    const root = await temporaryRoot();
    const config = createDefaultCreatorServicesConfig();
    config.tts.provider = 'volcengine';
    config.tts.volcengine.appId = 'app-1';
    config.tts.volcengine.accessToken = 'token-1';
    const audio = Buffer.from('mp3-bytes');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 3000,
      message: 'Success',
      data: audio.toString('base64')
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const executeUtility = vi.fn();
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(config),
      executeUtility
    });

    await expect(service.listVoices('volcengine')).resolves.toMatchObject({
      provider: 'volcengine',
      model: 'volcano_tts',
      voices: expect.arrayContaining([
        expect.objectContaining({ id: 'BV001_streaming', recommended: true })
      ])
    });
    expect(executeUtility).not.toHaveBeenCalled();

    const result = await service.synthesize({
      text: '你好，火山。',
      provider: 'volcengine',
      voiceId: 'BV001_streaming',
      format: 'mp3'
    });
    expect(result.content).toEqual(audio);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://openspeech.bytedance.com/api/v1/tts');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      authorization: 'Bearer;token-1'
    });
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(request.app).toEqual({
      appid: 'app-1',
      token: 'token-1',
      cluster: 'volcano_tts'
    });
    expect(request.audio.voice_type).toBe('BV001_streaming');
    expect(request.request.operation).toBe('query');
  });

  it('synthesizes Doubao 2.0 and cloned voices through the V3 unidirectional API', async () => {
    const root = await temporaryRoot();
    const config = createDefaultCreatorServicesConfig();
    config.tts.provider = 'volcengine';
    config.tts.volcengine.appId = 'app-1';
    config.tts.volcengine.accessToken = 'token-1';
    const audio = Buffer.from('v3-bytes');
    const ndjson = [
      JSON.stringify({ code: 0, data: audio.toString('base64') }),
      JSON.stringify({ code: 20000000, message: 'OK' })
    ].join('\n');
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => (
      new Response(ndjson, { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const service = createKrillinTtsService({
      resourceRoot: join(root, 'runtime'),
      workRoot: join(root, 'work'),
      configStore: createConfigStore(config),
      executeUtility: vi.fn()
    });

    const twoOh = await service.listVoices('volcengine', 'seed-tts-2.0');
    expect(twoOh.voices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'zh_female_gaolengyujie_uranus_bigtts',
        name: '高冷御姐 2.0',
        gender: 'female'
      })
    ]));
    expect(twoOh.voices.some(voice => voice.id === 'BV019_streaming')).toBe(false);

    const result = await service.synthesize({
      text: '高冷御姐试听',
      provider: 'volcengine',
      voiceId: 'zh_female_gaolengyujie_uranus_bigtts',
      format: 'mp3'
    });
    expect(result.content).toEqual(audio);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
    );
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      'X-Api-App-Id': 'app-1',
      'X-Api-Access-Key': 'token-1',
      'X-Api-Resource-Id': 'seed-tts-2.0'
    });
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(request.req_params.speaker).toBe('zh_female_gaolengyujie_uranus_bigtts');

    await service.synthesize({
      text: '克隆音色',
      provider: 'volcengine',
      model: 'seed-icl-2.0',
      voiceId: 'S_cloned_speaker',
      format: 'mp3'
    });
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({
      'X-Api-Resource-Id': 'seed-icl-2.0'
    });
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
