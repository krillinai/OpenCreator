import {
  createDefaultCreatorServicesConfig,
  creatorRuntimeWorkspaces,
  videoGenerationModelIds
} from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import {
  creatorPresetModuleDefinitions,
  getCreatorPresetModuleDefinition
} from '../../src/creator/presets/module-schemas.js';
import {
  mergeCreatorPresetState
} from '../../src/creator/presets/requirements.js';
import {
  creatorPresetSourceManifestSchema
} from '../../src/creator/presets/schema.js';

const validDefaults = {
  'video-translation': {
    sourceLanguage: 'en',
    targetLanguage: 'zh_cn',
    subtitleStyle: {
      fontPreset: 'serif',
      fontWeight: 'medium',
      fontSize: 'large',
      primaryColor: '#FFFFFF',
      secondaryColor: '#FFD45C',
      outlineColor: '#000000',
      outlineWidth: 3,
      shadow: {
        enabled: true,
        color: '#000000',
        opacity: 0.5,
        offsetX: 2,
        offsetY: 3,
        blur: 2
      }
    }
  },
  'video-download': { mediaType: 'audio' },
  'image-generation': {
    prompt: 'Product image',
    size: '1536x1024',
    quality: 'high',
    candidateCount: 4
  },
  'video-generation': {
    prompt: 'Product ad',
    size: '1280x720',
    duration: 5
  },
  'cover-generator': {
    prompt: 'Growth cover',
    ratio: '9:16',
    candidateCount: 2,
    quality: 'medium'
  },
  'smart-dubbing': {
    text: 'A calm narration',
    style: 'calm',
    speed: 1,
    format: 'mp3'
  }
} as const;

describe('creator preset module schemas', () => {
  it('accepts only published fields for each creator module', () => {
    for (const module of creatorRuntimeWorkspaces) {
      const definition = getCreatorPresetModuleDefinition(module);
      expect(definition.defaultsSchema.safeParse(validDefaults[module]).success).toBe(true);
      expect(definition.defaultsSchema.safeParse({
        ...validDefaults[module],
        fieldFromAnotherModule: true
      }).success).toBe(false);
    }

    expect(getCreatorPresetModuleDefinition('video-translation')
      .defaultsSchema.safeParse({
        sourceLanguage: 'en',
        targetLanguage: 'en'
      }).success).toBe(false);
    expect(getCreatorPresetModuleDefinition('cover-generator')
      .defaultsSchema.safeParse({ ratio: '3:4' }).success).toBe(false);
  });

  it('merges locale defaults without leaking credentials or UI state', () => {
    const services = createDefaultCreatorServicesConfig();
    services.video.seedance.apiKey = 'secret-video-key';
    services.video.seedance.model = videoGenerationModelIds.seedance[1];
    const definition = getCreatorPresetModuleDefinition('video-generation');
    const state = mergeCreatorPresetState({
      definition,
      defaults: {
        prompt: '中文广告',
        size: '1280x720',
        duration: 5
      },
      defaultsByLocale: {
        'en-US': { prompt: 'English advertisement' }
      },
      locale: 'en-US',
      services
    });

    expect(state).toMatchObject({
      prompt: 'English advertisement',
      provider: 'seedance',
      model: videoGenerationModelIds.seedance[1]
    });
    expect(JSON.stringify(state)).not.toContain('secret-video-key');
    expect(state).not.toHaveProperty('currentStage');

    const translation = mergeCreatorPresetState({
      definition: getCreatorPresetModuleDefinition('video-translation'),
      defaults: {
        sourceLanguage: 'en',
        targetLanguage: 'zh_cn',
        subtitleStyle: {
          shadow: { offsetX: 7 }
        }
      },
      locale: 'zh-CN',
      services
    });
    expect(translation.subtitleStyle).toMatchObject({
      shadow: {
        offsetX: 7,
        offsetY: 1.5,
        blur: 0.5
      }
    });
  });

  it('resolves the configured or required TTS model without exposing credentials', () => {
    const services = createDefaultCreatorServicesConfig();
    services.tts.provider = 'aliyun';
    services.tts.aliyun.apiKey = 'secret-tts-key';
    services.tts.aliyun.model = 'configured-tts-model';
    services.tts.aliyun.defaultVoiceId = 'ConfiguredVoice';

    const configured = mergeCreatorPresetState({
      definition: getCreatorPresetModuleDefinition('smart-dubbing'),
      defaults: { text: 'Configured model' },
      locale: 'en-US',
      services
    });
    expect(configured).toMatchObject({
      ttsProvider: 'aliyun',
      ttsModel: 'configured-tts-model',
      voiceCode: 'ConfiguredVoice',
      voiceName: 'ConfiguredVoice'
    });
    expect(JSON.stringify(configured)).not.toContain('secret-tts-key');

    const required = mergeCreatorPresetState({
      definition: getCreatorPresetModuleDefinition('video-translation'),
      defaults: {
        sourceLanguage: 'en',
        targetLanguage: 'zh_cn'
      },
      locale: 'zh-CN',
      requirement: {
        service: 'tts',
        provider: 'minimax',
        model: 'required-tts-model'
      },
      services
    });
    expect(required).toMatchObject({
      ttsProvider: 'minimax',
      ttsModel: 'required-tts-model'
    });
  });

  it('applies documented manifest and module defaults when optional fields are omitted', () => {
    const manifest = creatorPresetSourceManifestSchema.parse({
      schemaVersion: 1,
      id: 'minimal-preset',
      version: 1,
      module: 'image-generation',
      runtimeTemplate: { id: 'image-generation', version: 2 },
      status: 'published',
      title: {
        'zh-CN': '最小模板',
        'en-US': 'Minimal preset'
      },
      description: {
        'zh-CN': '验证清单默认值。',
        'en-US': 'Validate manifest defaults.'
      },
      cover: 'cover.webp',
      defaults: {}
    });
    expect(manifest).toMatchObject({
      featured: false,
      sortOrder: 0,
      tags: []
    });

    expect(getCreatorPresetModuleDefinition('image-generation')
      .defaultsSchema.parse({})).toMatchObject({
        size: '1024x1024',
        quality: 'medium',
        candidateCount: 2
      });
    expect(getCreatorPresetModuleDefinition('cover-generator')
      .defaultsSchema.parse({})).toMatchObject({
        coverStyle: 'bilibili-red-blue-white',
        ratio: '16:9'
      });
    expect(getCreatorPresetModuleDefinition('smart-dubbing')
      .defaultsSchema.parse({})).toMatchObject({
        style: 'natural',
        speed: 1
      });
    expect(getCreatorPresetModuleDefinition('video-translation')
      .defaultsSchema.parse({})).toMatchObject({
        subtitleStyle: {
          secondaryColor: '#D1D5DB',
          outlineWidth: 2.5,
          shadow: {
            opacity: 0.6,
            offsetX: 1.5,
            offsetY: 1.5,
            blur: 0.5
          }
        }
      });
  });

  it('binds every public module and validates provider requirements', () => {
    expect(creatorPresetModuleDefinitions.map(definition => ({
      module: definition.module,
      runtime: `${definition.runtimeTemplate.id}@${definition.runtimeTemplate.version}`
    }))).toEqual([
      { module: 'video-translation', runtime: 'video-translation@2' },
      { module: 'video-download', runtime: 'video-download@2' },
      { module: 'image-generation', runtime: 'image-generation@2' },
      { module: 'video-generation', runtime: 'video-generation@1' },
      { module: 'cover-generator', runtime: 'cover@2' },
      { module: 'smart-dubbing', runtime: 'smart-dubbing@1' }
    ]);

    expect(() => getCreatorPresetModuleDefinition('video-generation')
      .validateRequirement({
        service: 'video',
        provider: 'seedance',
        model: videoGenerationModelIds.seedance[0]
      })).not.toThrow();
    expect(() => getCreatorPresetModuleDefinition('video-generation')
      .validateRequirement({
        service: 'video',
        provider: 'seedance',
        model: 'unavailable-model'
      })).toThrow('unsupported video provider or model');
    expect(() => getCreatorPresetModuleDefinition('image-generation')
      .validateRequirement({
        service: 'image',
        provider: 'openai',
        model: 'gpt-image-1'
      })).toThrow('cannot select a model');
  });
});
