import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { translationResumeStage } from '../../src/creator/krillin/translation-resume.js';
import { krillinTranslationReport } from '../../src/creator/krillin/cli-runner.js';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';

function fixture(id: string): CreatorExecutorInput {
  return { job: { id: 'job', templateId: 'video-translation', templateVersion: 1, state: { sourceType: 'url' }, stages: [] },
    stageRun: { id, stageId: 'subtitle', status: 'running', progress: {} }, inputArtifacts: [],
    workdir: `/jobs/job/${id}`, reportProgress: vi.fn(), signal: new AbortController().signal } as unknown as CreatorExecutorInput;
}

describe('translation recovery and result report', () => {
  it('reuses an interrupted task directory through repeated stage retries', () => {
    const config = createDefaultCreatorServicesConfig();
    const options = { sourceUrl: 'https://youtu.be/video', originLanguage: 'en', targetLanguage: 'zh_cn' };
    const original = fixture('original');
    original.reportProgress = progress => Object.assign(original.stageRun.progress, progress);
    translationResumeStage(original, options, config);
    original.stageRun.status = 'interrupted';
    const retry = fixture('retry');
    retry.job.stages = [original.stageRun];
    retry.reportProgress = progress => Object.assign(retry.stageRun.progress, progress);
    expect(translationResumeStage(retry, options, config).workdir).toBe(original.workdir);
    retry.stageRun.status = 'failed';
    const third = fixture('third');
    third.job.stages = [original.stageRun, retry.stageRun];
    expect(translationResumeStage(third, options, config).workdir).toBe(original.workdir);
    config.llm.apiKey = 'rotated';
    expect(translationResumeStage(third, options, config).workdir).toBe(original.workdir);
    config.llm.model += '-changed';
    expect(translationResumeStage(third, options, config).workdir).toBe(third.workdir);
  });

  it('does not reuse a different source, language, completed run, or original SRT task', () => {
    const config = createDefaultCreatorServicesConfig();
    const options = { sourceUrl: 'https://youtu.be/video', originLanguage: 'en', targetLanguage: 'zh_cn' };
    const original = fixture('original');
    original.reportProgress = progress => Object.assign(original.stageRun.progress, progress);
    translationResumeStage(original, options, config);
    original.stageRun.status = 'failed';
    const current = fixture('current');
    current.job.stages = [original.stageRun];
    for (const changed of [{ ...options, sourceUrl: 'https://youtu.be/other' }, { ...options, targetLanguage: 'ja' }]) {
      expect(translationResumeStage(current, changed, config).workdir).toBe(current.workdir);
    }
    original.stageRun.status = 'succeeded';
    expect(translationResumeStage(current, options, config).workdir).toBe(current.workdir);
    current.job.state.sourceType = 'subtitle';
    expect(translationResumeStage(current, options, config)).toBe(current);
  });

  it('retains untranslated items and layout notices as persistent artifact metadata', () => {
    expect(krillinTranslationReport({ translation_failures: [{ sentence_id: '2', source_text: 'Second.', reason: 'missing' }] }))
      .toMatchObject({ translationStatus: 'partial', translationFailedCount: 1,
        translationFailures: [{ sentenceId: '2', sourceText: 'Second.', reason: 'missing' }] });
    expect(krillinTranslationReport({ warnings: ['字幕排版待调整：1条已保留完整译文与时间区间'] }))
      .toMatchObject({ translationStatus: 'layout_pending', translationFailedCount: 0 });
    expect(krillinTranslationReport({ subtitle_quality: { status: 'degraded', approximate_layouts: 1, degraded_segmentation_units: 0, semantic_pending: 0 } }))
      .toMatchObject({ translationStatus: 'degraded', subtitleQuality: { status: 'degraded', approximate_layouts: 1 } });
    const issue = { sentence_id: 'unit', type: 'negation', severity: 'error', reason: '否定反转', output_cue: 2, timestamp: '00:00:01,000 --> 00:00:03,000' };
    expect(krillinTranslationReport({ subtitle_quality: { status: 'degraded', approximate_layouts: 0,
      degraded_segmentation_units: 0, semantic_pending: 0, unresolved_errors: 1, overflow_cues: 2, issues: [issue] } }))
      .toMatchObject({ translationStatus: 'degraded', subtitleQuality: { unresolved_errors: 1, overflow_cues: 2, issues: [issue] } });
    expect(krillinTranslationReport({})).toMatchObject({ translationStatus: 'complete', translationWarnings: [] });
  });
});
