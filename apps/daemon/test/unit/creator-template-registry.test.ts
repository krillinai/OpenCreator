import { describe, expect, it } from 'vitest';
import {
  createCoverTemplate,
  createImageGenerationTemplate,
  createCreatorTemplateRegistry,
  createSmartDubbingTemplate,
  createShortVideoScriptTemplate,
  createXiaohongshuPostTemplate,
  createVideoDownloadTemplate,
  createVideoGenerationTemplate,
  createDefaultCreatorTemplateRegistry,
  createStickmanVideoTemplate,
  createVideoTranslationTemplate,
  createAutoClipTemplate
} from '../../src/creator/templates/registry.js';

describe('creator template registry', () => {
  it('defaults video clips to three source-format outputs', () => {
    const template = createAutoClipTemplate();

    expect(template.inputSchema.parse({})).toMatchObject({
      clipCount: 3,
      aspectRatio: 'source'
    });
  });

  it('exposes only stickman-video version 2 and rejects v2 in an old registry fixture', () => {
    const production = createDefaultCreatorTemplateRegistry();
    const stickman = production.list().filter(template => template.id === 'stickman-video');

    expect(stickman).toHaveLength(1);
    expect(stickman[0]).toMatchObject({
      version: 2,
      stages: expect.arrayContaining([
        expect.objectContaining({
          id: 'images',
          jobCompletionPolicy: 'continue',
          invalidateDependentArtifacts: false
        }),
        expect.objectContaining({ id: 'package-validation', jobCompletionPolicy: 'complete' })
      ])
    });
    expect(stickman[0]!.actions.map(action => action.id)).toContain('generate-missing-shots');
    const v2 = createStickmanVideoTemplate();
    const oldRegistry = createCreatorTemplateRegistry([{
      ...v2,
      version: 1,
      stages: [],
      actions: []
    }]);
    expect(() => oldRegistry.get('stickman-video', 2)).toThrow(/unknown creator template/i);
  });

  it('registers the current cover workflow with real source and artifact stages', () => {
    const template = createCoverTemplate();

    expect(template.version).toBe(2);
    expect(template.inputSchema.parse({})).toMatchObject({
      sourceType: 'prompt',
      ratio: '16:9',
      candidateCount: 2,
      quality: 'medium',
      referenceImageArtifactId: null
    });
    expect(template.stages).toMatchObject([
      {
        id: 'analyze-source',
        executor: 'cover-analysis',
        resultVersionPolicy: 'none'
      },
      {
        id: 'generate',
        executor: 'image',
        inputArtifacts: expect.arrayContaining([{
          kind: 'reference_image',
          selector: 'state-artifact-id',
          stateKey: 'referenceImageArtifactId',
          optional: true
        }])
      }
    ]);
    expect(template.actions.map(action => action.id)).not.toContain('select-cover');
    expect(template.inputSchema.parse({})).not.toHaveProperty('selectedCoverArtifactId');
  });

  it('registers image generation as a persisted Creator Runtime template', () => {
    const template = createImageGenerationTemplate();

    expect(template).toMatchObject({
      id: 'image-generation',
      version: 2,
      renderer: 'image-generation',
      stages: [{
        id: 'generate',
        executor: 'image',
        inputArtifacts: [{
          kind: 'reference_image',
          selector: 'state-artifact-id',
          stateKey: 'referenceImageArtifactId',
          optional: true
        }],
        outputArtifacts: [{ kind: 'generated_image', status: 'completed' }]
      }],
      outputs: [{ kind: 'generated_image', required: true }]
    });
    const defaultState = template.inputSchema.parse({});
    expect(defaultState).toMatchObject({
      size: '1024x1024',
      quality: 'medium',
      referenceImageArtifactId: null
    });
    expect(defaultState).not.toHaveProperty('provider');
    expect(defaultState).not.toHaveProperty('candidateCount');
    expect(template.inputSchema.parse({ provider: 'openai', candidateCount: 4 }))
      .toMatchObject({ provider: 'openai', candidateCount: 4 });
  });

  it('registers smart dubbing as a persisted TTS workflow', () => {
    const template = createSmartDubbingTemplate();

    expect(template).toMatchObject({
      id: 'smart-dubbing',
      version: 1,
      renderer: 'smart-dubbing',
      stages: [{
        id: 'tts',
        executor: 'smart-dubbing',
        outputArtifacts: [{ kind: 'dubbed_audio', status: 'completed' }]
      }],
      outputs: [{ kind: 'dubbed_audio', required: true }]
    });
    expect(template.inputSchema.parse({})).toMatchObject({
      text: '',
      style: 'natural',
      speed: 1,
      format: 'mp3',
      currentStep: 0,
      furthestStep: 0
    });
    expect(template.inputSchema.parse({})).not.toHaveProperty('ttsProvider');
  });

  it('registers Xiaohongshu post generation as a persisted text workflow', () => {
    const template = createXiaohongshuPostTemplate();

    expect(template).toMatchObject({
      id: 'xiaohongshu-post',
      version: 1,
      renderer: 'xiaohongshu-post',
      stages: [{
        id: 'generate',
        executor: 'xiaohongshu-post',
        outputArtifacts: [{ kind: 'xiaohongshu_post', status: 'completed' }]
      }],
      outputs: [{ kind: 'xiaohongshu_post', required: true }]
    });
    expect(template.inputSchema.parse({})).toMatchObject({
      topic: '',
      audience: '',
      style: 'experience',
      length: 'medium',
      extraRequirements: '',
      currentStage: null
    });
  });

  it('registers short video script generation as a persisted text workflow', () => {
    const template = createShortVideoScriptTemplate();

    expect(template).toMatchObject({
      id: 'short-video-script',
      version: 1,
      renderer: 'short-video-script',
      stages: [{
        id: 'generate',
        executor: 'short-video-script',
        outputArtifacts: [{ kind: 'short_video_script', status: 'completed' }]
      }],
      outputs: [{ kind: 'short_video_script', required: true }]
    });
    expect(template.inputSchema.parse({})).toMatchObject({
      topic: '',
      audience: '',
      platform: 'douyin',
      targetDurationSeconds: 60,
      tone: 'natural',
      extraRequirements: '',
      currentStage: null
    });
  });

  it('registers video download v2 with a non-final probe and controlled choices', () => {
    const template = createVideoDownloadTemplate();

    expect(template.version).toBe(2);
    expect(template.inputSchema.parse({})).toMatchObject({
      sourceUrl: '',
      mediaType: 'video',
      selectedOptionId: null
    });
    expect(template.stages).toMatchObject([
      {
        id: 'probe',
        completesJob: false,
        resultVersionPolicy: 'none',
        invalidateDependentArtifacts: false
      },
      {
        id: 'download',
        outputArtifacts: [
          { kind: 'source_video', status: 'completed' },
          { kind: 'source_audio', status: 'completed' }
        ]
      }
    ]);
    expect(template.inputSchema.parse({})).not.toHaveProperty('formatId');
  });

  it('registers video generation as a persisted Creator Runtime template', () => {
    const template = createVideoGenerationTemplate();

    expect(template).toMatchObject({
      id: 'video-generation',
      version: 1,
      renderer: 'video-generation',
      stages: [{
        id: 'generate',
        executor: 'video',
        inputArtifacts: [{
          kind: 'reference_image',
          selector: 'state-artifact-id',
          stateKey: 'referenceImageArtifactId',
          optional: true
        }],
        outputArtifacts: [{ kind: 'generated_video', status: 'completed' }]
      }],
      outputs: [{ kind: 'generated_video', required: true }]
    });
    expect(template.inputSchema.parse({})).toMatchObject({
      prompt: '',
      provider: 'seedance',
      size: '1280x720',
      duration: 5,
      referenceImageArtifactId: null
    });
    expect(template.inputSchema.parse({
      model: 'doubao-seedance-2-5-260628'
    })).toMatchObject({
      model: 'doubao-seedance-2-5-260628'
    });
  });

  it('resolves the video translation stale graph from target subtitles only', () => {
    const registry = createCreatorTemplateRegistry([
      createVideoTranslationTemplate()
    ]);

    expect(registry.resolveInvalidatedArtifactKinds(
      'video-translation',
      2,
      'edit-subtitle'
    )).toEqual([
      'dubbed_audio',
      'dubbed_video',
      'horizontal_video',
      'vertical_video'
    ]);
  });

  it('passes bilingual subtitles into both video render stages when available', () => {
    const template = createVideoTranslationTemplate();
    for (const stageId of ['render-horizontal', 'render-vertical']) {
      expect(template.stages.find(stage => stage.id === stageId)?.inputArtifacts).toContainEqual({
        kind: 'bilingual_subtitle',
        selector: 'latest-completed',
        optional: true
      });
    }
  });

  it('leaves new video translation TTS settings unset for the UI to inherit global defaults', () => {
    const state = createVideoTranslationTemplate().inputSchema.parse({});

    expect(state).not.toHaveProperty('ttsProvider');
    expect(state).not.toHaveProperty('ttsModel');
    expect(state).not.toHaveProperty('voiceCode');
    expect(state).not.toHaveProperty('voiceName');
  });

  it('uses the shared TTS settings contract for the single stickman template version', () => {
    const template = createStickmanVideoTemplate();
    const state = template.inputSchema.parse({});

    expect(state).not.toHaveProperty('voice');
    expect(state).not.toHaveProperty('ttsProvider');
    expect(state).not.toHaveProperty('ttsModel');
    expect(state).not.toHaveProperty('voiceCode');
    expect(state).not.toHaveProperty('voiceName');
    expect(createDefaultCreatorTemplateRegistry().list().filter(template => (
      template.id === 'stickman-video'
    ))).toHaveLength(1);
    expect(template.stages.some(stage => stage.id === 'acquire-source')).toBe(false);
    expect(template.stages.find(stage => stage.id === 'source-transcript')).toMatchObject({
      executor: 'krillinai',
      inputArtifacts: []
    });
  });

  it('creates video translation v2 with only structured subtitleStyle', () => {
    const template = createVideoTranslationTemplate();
    const state = template.inputSchema.parse({});

    expect(template.version).toBe(2);
    expect(state).toMatchObject({
      subtitleStyle: {
        fontPreset: 'sans',
        fontWeight: 'bold',
        fontSize: 'medium',
        primaryColor: '#FFFFFF',
        secondaryColor: '#D1D5DB',
        outlineColor: '#000000',
        outlineWidth: 2.5,
        shadow: {
          enabled: true,
          color: '#000000',
          opacity: 0.6,
          offsetX: 1.5,
          offsetY: 1.5,
          blur: 0.5
        }
      }
    });
    expect(state).not.toHaveProperty('subtitleFont');
    expect(state).not.toHaveProperty('subtitleSize');
    expect(state).not.toHaveProperty('subtitleColor');
  });

  it('passes the dedicated short subtitle into vertical rendering when available', () => {
    const template = createVideoTranslationTemplate();
    expect(template.stages.find(stage => stage.id === 'subtitle')?.outputArtifacts).toContainEqual({
      kind: 'vertical_subtitle',
      status: 'completed'
    });
    expect(template.stages.find(stage => stage.id === 'render-vertical')?.inputArtifacts).toContainEqual({
      kind: 'vertical_subtitle',
      selector: 'latest-completed',
      optional: true
    });
  });

  it('keeps the source video through TTS and passes the dubbed video into render stages', () => {
    const template = createVideoTranslationTemplate();
    expect(template.stages.find(stage => stage.id === 'tts')?.inputArtifacts).toContainEqual({
      kind: 'source_video',
      selector: 'latest-completed',
      optional: true
    });
    for (const stageId of ['render-horizontal', 'render-vertical']) {
      expect(template.stages.find(stage => stage.id === stageId)?.inputArtifacts).toContainEqual({
        kind: 'dubbed_video',
        selector: 'latest-completed',
        optional: true
      });
    }
  });

  it('rejects duplicate template versions and cyclic stage graphs', () => {
    const template = createVideoTranslationTemplate();
    expect(() => createCreatorTemplateRegistry([template, template])).toThrow(
      /duplicate template/i
    );

    expect(() => createCreatorTemplateRegistry([{
      ...template,
      id: 'cyclic',
      stages: [
        {
          id: 'a',
          executor: 'fake',
          dependsOn: ['b'],
          allowedJobStatuses: ['draft'],
          inputArtifacts: [],
          outputArtifacts: [{ kind: 'a_output', status: 'completed' }]
        },
        {
          id: 'b',
          executor: 'fake',
          dependsOn: ['a'],
          allowedJobStatuses: ['draft'],
          inputArtifacts: [],
          outputArtifacts: [{ kind: 'b_output', status: 'completed' }]
        }
      ]
    }])).toThrow(/cycle/i);
  });
});
