import { describe, expect, it } from 'vitest';
import {
  createCreatorTemplateRegistry,
  createVideoTranslationTemplate
} from '../../src/creator/templates/registry.js';

describe('creator template registry', () => {
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
