import { describe, expect, it } from 'vitest';
import { createDefaultCreatorTemplateRegistry, createTranscriptionTemplate } from '../../src/creator/templates/registry.js';
import { buildKrillinStageOptions, resolveKrillinStageContract } from '../../src/creator/krillin/adapter.js';
import { buildKrillinCliCommandArguments, outputMappings } from '../../src/creator/krillin/cli-runner.js';

describe('standalone video transcription', () => {
  it('registers a source-only workflow with source video preview output', () => {
    const template = createTranscriptionTemplate();

    expect(template).toMatchObject({
      id: 'transcription',
      version: 1,
      renderer: 'transcription',
      stages: [{
        id: 'transcription',
        executor: 'krillinai',
        outputArtifacts: [
          { kind: 'source_video', status: 'completed' },
          { kind: 'source_subtitle', status: 'completed' }
        ]
      }],
      outputs: [{ kind: 'source_subtitle', required: true }]
    });
    expect(template.inputSchema.parse({})).toMatchObject({
      sourceType: 'file',
      sourceUrl: '',
      sourceLanguage: 'zh_cn',
      targetLanguage: 'zh_cn',
      preferPlatformCaptions: false
    });
    expect(createDefaultCreatorTemplateRegistry().get('transcription')).toMatchObject({ version: 1 });
  });

  it('maps the task to the subtitle CLI with source-only subtitles and video preparation', () => {
    const stage = {
      workdir: 'job/transcription',
      job: {
        id: 'job-1',
        templateId: 'transcription',
        state: {
          sourceType: 'url',
          sourceUrl: 'https://www.youtube.com/watch?v=abc',
          sourceLanguage: 'en',
          targetLanguage: 'en',
          preferPlatformCaptions: false
        }
      },
      stageRun: { id: 'stage-1', stageId: 'transcription', progress: {} },
      inputArtifacts: [],
      signal: new AbortController().signal,
      reportProgress() {}
    };
    const options = buildKrillinStageOptions(stage as never);
    const args = buildKrillinCliCommandArguments(stage as never, [], options, undefined);

    expect(options).toMatchObject({ sourceOnly: true, prepareVideo: true, captionSource: 'whisper' });
    expect(args[0]).toBe('subtitle');
    expect(args).toContain('--source-only');
    expect(args).toContain('--prepare-video');
    expect(outputMappings('transcription')).toEqual([['origin_video', 'source_video'], ['origin_srt', 'source_subtitle']]);
    expect(resolveKrillinStageContract(stage as never)).toMatchObject({
      stageType: 'subtitle',
      outputAliases: { source_video: 'source_video', source_subtitle: 'source_subtitle' },
      requiredOutputKinds: ['source_subtitle']
    });
  });
});
