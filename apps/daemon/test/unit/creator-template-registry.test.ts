import { describe, expect, it } from 'vitest';
import {
  createCoverTemplate,
  createImageGenerationTemplate,
  createCreatorTemplateRegistry,
  createVideoDownloadTemplate,
  createDefaultCreatorTemplateRegistry,
  createStickmanVideoTemplate,
  createVideoTranslationTemplate
} from '../../src/creator/templates/registry.js';

describe('creator template registry', () => {
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
      renderer: 'image-generation',
      stages: [{
        id: 'generate',
        executor: 'image',
        outputArtifacts: [{ kind: 'generated_image', status: 'completed' }]
      }],
      outputs: [{ kind: 'generated_image', required: true }]
    });
    expect(template.inputSchema.parse({})).toMatchObject({
      provider: 'openai',
      size: '1024x1024',
      quality: 'medium',
      candidateCount: 2
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

  it('resolves the video translation stale graph from target subtitles only', () => {
    const registry = createCreatorTemplateRegistry([
      createVideoTranslationTemplate()
    ]);

    expect(registry.resolveInvalidatedArtifactKinds(
      'video-translation',
      1,
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
