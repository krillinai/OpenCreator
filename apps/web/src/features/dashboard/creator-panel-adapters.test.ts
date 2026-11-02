import type { CreatorActivity, CreatorStageRun } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import { createLocalizedCopy } from '../../i18n/localized-copy.js';
import {
  videoTranslationPanelAdapter,
  videoGenerationPanelAdapter,
  videoDownloadPanelAdapter,
  creatorPanelAdapterFor,
  stickmanVideoPanelAdapter,
  type CreatorPanelLocalize
} from './creator-panel-adapters.js';

const zh: CreatorPanelLocalize = value => value;
const en: CreatorPanelLocalize = (_zh, value) => value;

describe('video download controls', () => {
  it('describes live pause and process recovery without calling them active transfer', () => {
    const paused = { ...stage('download', '', 'running', null, 'download'),
      progress: { phase: 'downloading', percent: 42, downloadControl: 'paused' } };
    expect(videoDownloadPanelAdapter.runningProgressText?.(paused, videoDownloadPanelAdapter.readStageProgress(paused, zh), zh))
      .toBe('下载已暂停，可继续下载');
    const reconnecting = { ...paused, progress: { phase: 'preparing_download', percent: 42, resumedFromStageRunId: 'previous' } };
    expect(videoDownloadPanelAdapter.runningProgressText?.(reconnecting, videoDownloadPanelAdapter.readStageProgress(reconnecting, en), en))
      .toBe('Reconnecting to resume download');
  });
});

describe('Remotion preparation progress', () => {
  it('uses the shared stickman adapter without exposing transcription or internal dependency fields', () => {
    const running = { ...stage('render', 'render-clean', 'running', null, 'render-clean'), stageId: 'render-clean', progress: { phase: 'preparing_dependencies', percent: 3, message: 'internal', dependencyItem: 'private archive' } };
    const progress = stickmanVideoPanelAdapter.readStageProgress(running, en);
    expect(progress).toMatchObject({ phase: 'preparing_dependencies', percent: 3 });
    expect(stickmanVideoPanelAdapter.runningProgressText?.(running, progress, en)).toBe('Preparing Remotion rendering components');
    expect(stickmanVideoPanelAdapter.phaseLabel('dependencies_ready', zh)).toBe('渲染组件已就绪');
  });
});

describe('video generation progress', () => {
  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('explains unknown progress and retries in %s', language => {
    const localize = createLocalizedCopy(language);
    const running = { ...stage('generate', '', 'running', null, 'generate'), progress: {
      phase: 'generating', percent: null, message: 'The video provider is generating the video'
    } };
    const progress = videoGenerationPanelAdapter.readStageProgress(running, localize);
    expect(progress).toMatchObject({ percent: null, indeterminate: true, showMessage: true, showTiming: true });
    expect(progress.message).not.toContain('The video provider is generating the video');
    expect(progress.message).not.toContain('%');
    const retrying = videoGenerationPanelAdapter.readStageProgress({ ...running, progress: {
      ...running.progress, refreshRetry: 2, message: 'The provider status connection was interrupted and will be retried'
    } }, localize);
    expect(retrying.message).toContain('2');
    expect(retrying.message).not.toContain('interrupted and will be retried');
    if (language !== 'zh-CN') {
      expect(progress.message).not.toMatch(/\p{Script=Han}/u);
      expect(retrying.message).not.toMatch(/\p{Script=Han}/u);
    }
    const recovered = videoGenerationPanelAdapter.readStageProgress({ ...running, progress: {
      ...running.progress, refreshRetry: 2
    } }, localize);
    expect(recovered.message).toBe(progress.message);
    const downloading = videoGenerationPanelAdapter.readStageProgress({ ...running, progress: {
      phase: 'downloading', percent: 90, refreshRetry: 2,
      message: 'The provider status connection was interrupted and will be retried'
    } }, localize);
    expect(downloading).toMatchObject({ showMessage: false, percent: 90, indeterminate: false });
  });

  it('preserves a real percentage and leaves finished tasks compact', () => {
    const running = { ...stage('generate', '', 'running', null, 'generate'), progress: { phase: 'generating', percent: 54 } };
    expect(videoGenerationPanelAdapter.readStageProgress(running, en)).toMatchObject({
      percent: 54, indeterminate: false, showMessage: false, showTiming: true
    });
    expect(videoGenerationPanelAdapter.readStageProgress({ ...running, status: 'succeeded' }, en)).toMatchObject({
      showTiming: false, indeterminate: false, showMessage: false
    });
  });

  it('keeps queued tasks indeterminate without inventing a queue position', () => {
    const queued = { ...stage('generate', '', 'queued', null, 'generate'), progress: { phase: 'queued', percent: null } };
    expect(videoGenerationPanelAdapter.readStageProgress(queued, en)).toMatchObject({
      percent: null, indeterminate: true, showMessage: true, showTiming: true,
      message: expect.stringContaining('Queue position and exact progress are not available')
    });
  });
});

describe('shared native image progress', () => {
  it.each(['image-generation', 'cover', 'stickman-video', 'wechat-article'])('shows native preparation and generation phases without fake percentages (%s)', template => {
    const adapter = creatorPanelAdapterFor(template);
    expect(adapter.phaseLabel('preparing_native_image', zh)).toContain('ChatGPT');
    expect(adapter.phaseLabel('generating_image', en)).toBe('Generating image');
    const running = { ...stage('native', '', 'running', null, 'generate'), progress: { phase: 'generating_image', message: '正在生成图片，请稍候', completed: 0, failed: 0, total: 1 } };
    expect(adapter.readStageProgress(running, zh)).toMatchObject({ phase: 'generating_image', message: '正在生成图片，请稍候', percent: null });
  });
});

describe('video translation component progress', () => {
  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('shows saved drafts and pending review without claiming final completion in %s', language => {
    const localize = createLocalizedCopy(language);
    const running = { ...stage('subtitle', '', 'running', null, 'subtitle'), progress: {
      phase: 'translating_subtitles', percent: 30, completed: 0, total: 56,
      message: '初译 30/56；字幕完成 0/56；正在审校、排版'
    } };
    const progress = videoTranslationPanelAdapter.readStageProgress(running, localize);
    expect(progress).toMatchObject({ percent: 30, completed: 0, total: 56, showMessage: true, showTiming: true });
    expect(progress.message).toContain('30/56');
    expect(progress.message).toContain('0/56');
    expect(progress.message).not.toContain('Waiting for the translation service');
    expect(videoTranslationPanelAdapter.runningProgressText?.(running, progress, localize)).toContain('0/56');
    if (language !== 'zh-CN') expect(progress.message).not.toMatch(/\p{Script=Han}/u);
    for (const message of ['正在整理原文翻译单元', '初译 0/56；字幕完成 0/56；正在整理字幕语境 1/2 段', '初译 30/56；字幕完成 0/56；翻译服务暂时失败，正在重试']) {
      const detail = videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { ...running.progress, message } }, localize);
      expect(detail.message).not.toContain('Waiting for the translation service');
      if (language !== 'zh-CN') expect(detail.message).not.toMatch(/\p{Script=Han}/u);
    }
  });

  it('does not display unrecognized translation service messages', () => {
    const running = { ...stage('subtitle', '', 'running', null, 'subtitle'), progress: {
      phase: 'translating_subtitles', percent: 15, message: '初译 1/56；字幕完成 0/56；private provider route'
    } };
    expect(videoTranslationPanelAdapter.readStageProgress(running, en).message).not.toContain('private provider route');
  });

  it('keeps saved sentence counts and timing visible during legacy translation recovery', () => {
    const running = { ...stage('subtitle', '', 'running', null, 'subtitle'), progress: {
      phase: 'recovering_translation', percent: 62, completed: 38, total: 56, message: 'private provider diagnostic'
    } };
    const progress = videoTranslationPanelAdapter.readStageProgress(running, zh);
    expect(progress).toMatchObject({ percent: 62, completed: 38, total: 56, showTiming: true, showMessage: true });
    expect(progress.message).toContain('已有结果已保留');
    expect(progress.message).not.toContain('private provider');
    expect(videoTranslationPanelAdapter.runningProgressText?.(running, progress, zh)).toContain('38/56');
  });

  it('shows actual completed sentence counts and elapsed time while translating', () => {
    const running = { ...stage('subtitle', '', 'running', null, 'subtitle'), progress: {
      phase: 'translating_subtitles', percent: 5, completed: 0, total: 52
    } };
    const initial = videoTranslationPanelAdapter.readStageProgress(running, zh);
    expect(initial).toMatchObject({ percent: 5, completed: 0, total: 52, showTiming: true, showMessage: true });
    expect(videoTranslationPanelAdapter.runningProgressText?.(running, initial, zh)).toBe('翻译字幕，已完成 0/52 句');
    const later = videoTranslationPanelAdapter.readStageProgress({ ...running, progress: {
      ...running.progress, percent: 50, completed: 26
    } }, en);
    expect(videoTranslationPanelAdapter.runningProgressText?.(running, later, en)).toBe('Translating subtitles, 26/52 sentences completed');
    expect(later.message).toContain('Waiting for the translation service');
    expect(videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { phase: 'collecting_outputs', percent: 98 } }, zh).showTiming).toBe(false);
  });

  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('shows overlapping audio work and current sentence progress in %s', language => {
    const localize = createLocalizedCopy(language);
    const running = { ...stage('subtitle', '', 'running', null, 'subtitle'), progress: {
      phase: 'processing_audio', percent: 46, completed: 1, total: 4,
      message: '音频分段 4/4；语音识别 3/4 段；字幕翻译 1/4 段；第 4 段识别 45%；第 2 段已翻译 5/12 句'
    } };
    const progress = videoTranslationPanelAdapter.readStageProgress(running, localize);
    expect(progress).toMatchObject({ showMessage: true, showTiming: true, percent: 46, completed: 1, total: 4 });
    expect(progress.message).toContain('3/4');
    expect(progress.message).toContain('5/12');
    expect(progress.message).toContain('45%');
    expect(videoTranslationPanelAdapter.runningProgressText?.(running, progress, localize)).toContain('1/4');
    if (language !== 'zh-CN') expect(progress.message).not.toMatch(/\p{Script=Han}/u);
  });

  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('explains that audio translation is waiting for the next provider result in %s', language => {
    const localize = createLocalizedCopy(language);
    const running = { ...stage('subtitle', '', 'running', null, 'subtitle'), progress: {
      phase: 'translating_audio', percent: 57, completed: 0, total: 1,
      message: '音频分段 1/1；语音识别 1/1 段；字幕翻译 0/1 段'
    } };
    const progress = videoTranslationPanelAdapter.readStageProgress(running, localize);
    expect(progress).toMatchObject({ showMessage: true, showTiming: true, percent: 57, completed: 0, total: 1 });
    expect(videoTranslationPanelAdapter.runningProgressText?.(running, progress, localize)).toContain('0/1');
    expect(progress.message).toContain(language === 'zh-CN' ? '等待翻译服务返回结果' : language === 'en-US' ? 'Waiting for the translation service' : 'Väntar på att översättningstjänsten');
    if (language !== 'zh-CN') expect(progress.message).not.toMatch(/\p{Script=Han}/u);
  });

  it.each([
    ['downloading_media', '正在下载视频：12.0 MiB / 24.0 MiB；2.0 MiB/s；预计剩余 6 秒', '12.0 MiB / 24.0 MiB'],
    ['extracting_audio', '正在提取音频；已处理 12 秒 / 60 秒', '12 s / 60 s'],
    ['preparing_render', '正在转换竖屏画面；已处理 12 秒 / 60 秒', '12 s / 60 s'],
    ['rendering_video', '正在编码并合成字幕视频；已处理 12 秒 / 60 秒', '12 s / 60 s'],
    ['assembling_voice', '正在拼接配音音频；已处理 12 秒', '12 s'],
    ['muxing_voice', '正在合并配音和视频；已处理 12 秒 / 60 秒', '12 s / 60 s']
  ])('shows real media details and timing for %s', (phase, message, expected) => {
    const running = { ...stage('render', '', 'running', null, 'render-horizontal'), progress: { phase, percent: 45, message } };
    const progress = videoTranslationPanelAdapter.readStageProgress(running, en);
    expect(progress).toMatchObject({ showMessage: true, showTiming: true, percent: 45 });
    expect(progress.message).toContain(expected);
    expect(progress.message).not.toMatch(/\p{Script=Han}/u);
  });

  it('reports actual generated voice segments from standard fields', () => {
    const running = { ...stage('tts', '', 'running', null, 'tts'), progress: { phase: 'generating_voice', percent: 45, completed: 7, total: 20, message: '已生成配音 7/20 段' } };
    const progress = videoTranslationPanelAdapter.readStageProgress(running, en);
    expect(progress).toMatchObject({ showTiming: true, showMessage: true, completed: 7, total: 20 });
    expect(videoTranslationPanelAdapter.runningProgressText?.(running, progress, en)).toBe('Generating dubbing, 7/20 segments completed');
    expect(progress.message).toContain('7/20');
  });

  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('keeps caption fallback visible during preparation, transcription and after success in %s', language => {
    const localize = createLocalizedCopy(language);
    const running = { ...stage('subtitle', '', 'running', null, 'subtitle'), progress: {
      phase: 'fallback_to_transcription', percent: 25, captionSource: 'whisper',
      captionFallbackCode: 'platform_caption_invalid', message: 'platform captions contained no usable text'
    } };
    for (const phase of ['fallback_to_transcription', 'downloading_dependencies', 'transcribing_audio']) {
      const progress = videoTranslationPanelAdapter.readStageProgress({
        ...running, progress: { ...running.progress, phase }
      }, localize);
      expect(progress.showMessage).toBe(true);
      expect(progress.message).toContain(language === 'zh-CN' ? '已自动切换' : language === 'en-US' ? 'Automatically switched' : 'Bytte automatiskt');
      expect(progress.message).not.toContain('contained no usable text');
      if (language !== 'zh-CN') expect(progress.message).not.toMatch(/\p{Script=Han}/u);
    }
    expect(videoTranslationPanelAdapter.succeededProgressText?.({ ...running, status: 'succeeded' }, localize))
      .toContain(language === 'zh-CN' ? '已使用语音转录' : language === 'en-US' ? 'audio transcription' : 'ljudtranskription');
  });

  it('distinguishes missing captions from unusable VTT in the fallback notice', () => {
    const running = { ...stage('subtitle', '', 'running', null, 'subtitle'), progress: {
      phase: 'fallback_to_transcription', captionFallbackCode: 'platform_caption_failed'
    } };
    expect(videoTranslationPanelAdapter.readStageProgress(running, zh).message).toContain('未找到可用的平台字幕');
    expect(videoTranslationPanelAdapter.readStageProgress({ ...running, progress: {} }, zh).showMessage).toBe(false);
  });

  it('labels draft preview activity and reports real progress without translation claims', () => {
    const running = { ...stage('draft-preview', '', 'running', null, 'preview-source-video'),
      progress: { phase: 'downloading', percent: 40, downloadedBytes: 4 * 1024 ** 2, totalBytes: 10 * 1024 ** 2 } };
    expect(videoTranslationPanelAdapter.stageLabel(running.stageId, zh)).toBe('原视频预览准备');
    expect(videoTranslationPanelAdapter.normalizeActivity(activity('run-stage', { stageId: running.stageId }), zh))
      .toEqual({ label: '开始下载原视频预览', fields: [] });
    expect(videoTranslationPanelAdapter.readStageProgress(running, en)).toMatchObject({ percent: 40, indeterminate: false, message: 'Downloading the source video: 4.0 MiB / 10.0 MiB' });
    expect(videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { phase: 'normalizing_media', percent: 98, phasePercent: 50 } }, zh)).toMatchObject({ percent: 98, phasePercent: 50, indeterminate: false, message: '正在转换原视频为本机兼容格式' });
    expect(videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { phase: 'normalizing_media', percent: 98.90059326924516 } }, zh)).toMatchObject({ percent: 99, phasePercent: 90, indeterminate: false });
    expect(videoTranslationPanelAdapter.failedProgressText?.(running, zh)).toContain('可重试');
    expect(videoTranslationPanelAdapter.succeededProgressText?.(running, zh)).toContain('已就绪');
  });
  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('localizes dependency and preview preparation with real progress in %s', language => {
    const localize = createLocalizedCopy(language);
    const raw = '后台原文：正在准备本地模型';
    const running = { ...stage('prepare', '', 'running', null, 'subtitle'), progress: {
      phase: 'downloading_dependencies', percent: 5, dependencyPercent: 50, message: raw,
      downloadedBytes: 1024 ** 3, totalBytes: 2 * 1024 ** 3
    } };
    const progress = videoTranslationPanelAdapter.readStageProgress(running, localize);
    expect(progress).toMatchObject({ percent: 50, indeterminate: false, message: expect.stringContaining('1.00 GiB / 2.00 GiB') });
    expect(progress.message).not.toContain(raw);
    expect(progress.detailsHref).toContain('tab=local-components');
    for (const phase of ['verifying_dependencies', 'extracting_dependencies', 'dependencies_ready']) {
      const waiting = videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { ...running.progress, phase } }, localize);
      expect(waiting).toMatchObject({ percent: null, indeterminate: true });
      expect(waiting.message).not.toContain(raw);
      if (language !== 'zh-CN') expect(waiting.message).not.toMatch(/\p{Script=Han}/u);
    }
    const preview = videoTranslationPanelAdapter.readStageProgress({ ...running, stageId: 'prepare-source-video',
      progress: { phase: 'downloading', percent: 40, downloadedBytes: 4 * 1024 ** 2, totalBytes: 10 * 1024 ** 2, message: raw }
    }, localize);
    expect(preview).toMatchObject({ percent: 40, indeterminate: false, message: expect.stringContaining('4.0 MiB / 10.0 MiB') });
    if (language !== 'zh-CN') {
      expect(progress.message).not.toMatch(/\p{Script=Han}/u);
      expect(preview.message).not.toMatch(/\p{Script=Han}/u);
    }
    const unknown = videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { phase: 'downloading_dependencies', downloadedBytes: 1024 ** 3 } }, localize);
    expect(unknown).toMatchObject({ percent: null, indeterminate: true });
    expect(unknown.message).toContain('1.00 GiB');
    expect(unknown.message).not.toContain('%');
  });
  it('normalizes preview stages, activities, and localized real download progress', () => {
    const running = { ...stage('preview', '', 'running', null, 'prepare-source-video'),
      progress: { phase: 'downloading', percent: 40, downloadedBytes: 4 * 1024 ** 2, totalBytes: 10 * 1024 ** 2 } };
    expect(videoTranslationPanelAdapter.stageLabel(running.stageId, zh)).toBe('原视频预览准备');
    expect(videoTranslationPanelAdapter.succeededProgressText?.({ ...running, status: 'succeeded' }, zh)).toContain('字幕保持不变');
    expect(videoTranslationPanelAdapter.failedProgressText?.({ ...running, status: 'failed' }, zh)).toContain('字幕未受影响');
    expect(videoTranslationPanelAdapter.readStageProgress(running, zh)).toMatchObject({ percent: 40, indeterminate: false, message: expect.stringContaining('4.0 MiB / 10.0 MiB') });
    expect(videoTranslationPanelAdapter.readStageProgress(running, en).message).toContain('subtitles will not be translated again');
    expect(videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { phase: 'downloading', percent: null } }, zh)).toMatchObject({ percent: null, indeterminate: true });
    expect(videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { phase: 'normalizing_media', percent: 98, phasePercent: 50 } }, zh)).toMatchObject({ percent: 98, phasePercent: 50, indeterminate: false, message: '正在转换原视频为本机兼容格式，已有字幕会保留。' });
    expect(videoTranslationPanelAdapter.normalizeActivity(activity('run-stage', { stageId: 'prepare-source-video' }), zh))
      .toEqual({ label: '开始准备原视频预览，保留已有字幕', fields: [] });
  });

  it('shows download progress separately from task progress, without inventing unknown percentages', () => {
    const running = { ...stage('download', '', 'running', null, 'subtitle', 2, 'downloading_dependencies'), progress: { phase: 'downloading_dependencies', percent: 2, dependencyPercent: 50, downloadedBytes: 1024 ** 3, totalBytes: 2 * 1024 ** 3, message: '模型文件较大，下载完成后自动继续' } };
    expect(videoTranslationPanelAdapter.readStageProgress(running, zh)).toMatchObject({ percent: 50, message: expect.stringContaining('1.00 GiB / 2.00 GiB'), detailsHref: expect.stringContaining('returnPath=') });
    expect(videoTranslationPanelAdapter.phaseLabel('downloading_dependencies', zh)).toContain('尚未开始转录');
    expect(videoTranslationPanelAdapter.readStageProgress({ ...running, progress: { phase: 'downloading_dependencies', percent: 2 } }, zh)).toMatchObject({ percent: null, indeterminate: true });
  });
});

const stages = [
  'ingest-text', 'source-transcript', 'source-brief', 'content-plan', 'script',
  'narration', 'audio-timing', 'storyboard', 'style-assets', 'prompt-pack',
  'images', 'visual-validation', 'timeline', 'render-clean', 'media-validation', 'package-validation'
];

describe('stickmanVideoPanelAdapter', () => {
  it('selects the stickman adapter and labels every production stage in both locales', () => {
    expect(creatorPanelAdapterFor('stickman-video')).toBe(stickmanVideoPanelAdapter);
    for (const stageId of stages) {
      expect(stickmanVideoPanelAdapter.stageLabel(stageId, zh)).not.toBe('火柴人视频任务');
      expect(stickmanVideoPanelAdapter.stageLabel(stageId, en)).not.toBe('Stickman video task');
    }
    for (const phase of ['validating', 'preparing_source', 'reading_platform_captions', 'processing_platform_captions', 'translating_subtitles', 'preparing_audio', 'transcribing_audio', 'collecting_outputs', 'transcribing', 'analyzing', 'planning', 'writing', 'reviewing', 'materializing', 'submitting', 'retrying_candidate', 'generating', 'synthesizing', 'measuring', 'validating_media', 'rendering', 'packaging', 'failed', 'completed']) {
      expect(stickmanVideoPanelAdapter.phaseLabel(phase, zh)).not.toBeNull();
      expect(stickmanVideoPanelAdapter.phaseLabel(phase, en)).not.toBeNull();
    }
  });

  it('labels production actions and filters draft setting noise', () => {
    for (const action of ['approve-script', 'continue-after-audio', 'continue-after-visuals', 'edit-script', 'edit-shot', 'regenerate-shot', 'generate-missing-shots', 'retry-stage', 'commit-version']) {
      const normalized = stickmanVideoPanelAdapter.normalizeActivity(activity(action), zh);
      expect(normalized?.label).toBeTruthy();
    }
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('create-job'), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('approve-visuals'), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('run-stage', {
      stageId: 'source-brief'
    }), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('update-settings'), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('update-settings', {
      objectId: 'sourceType,sourceText,styleAsset'
    }), zh)).toMatchObject({ fields: ['内容来源', '文本来源', '视觉风格'] });
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('resolve-provider-request', {
      decision: 'confirm-resubmit'
    }), zh)?.label).toContain('重复计费');
  });

  it('collapses script preparation into one continuous progress card', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('ingest', '', 'succeeded', null, 'ingest-text', 100, 'completed'),
      stage('brief', '', 'succeeded', null, 'source-brief', 100, 'completed'),
      stage('plan', '', 'succeeded', null, 'content-plan', 100, 'completed'),
      stage('script', '', 'running', null, 'script', 15, 'writing')
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      id: 'script',
      stageId: 'script',
      status: 'running',
      progress: {
        phase: 'writing',
        percent: 79,
        completed: 3,
        failed: 0,
        total: 4
      }
    });
    const progress = stickmanVideoPanelAdapter.readStageProgress(aggregated![0]!, zh);
    expect(stickmanVideoPanelAdapter.runningProgressText?.(aggregated![0]!, progress, zh))
      .toBe('生成创作内容');
  });

  it('keeps one completed script card after the validated script is generated', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('ingest', '', 'succeeded', null, 'ingest-text', 100, 'completed'),
      stage('brief', '', 'succeeded', null, 'source-brief', 100, 'completed'),
      stage('plan', '', 'succeeded', null, 'content-plan', 100, 'completed'),
      stage('script', '', 'succeeded', null, 'script', 100, 'completed')
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      stageId: 'script',
      status: 'succeeded',
      progress: { percent: 100, completed: 4, failed: 0, total: 4 }
    });
  });

  it('starts the aggregated URL workflow at the KrillinAI transcript stage', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('transcript', '', 'running', null, 'source-transcript', 20, 'reading_platform_captions')
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      stageId: 'script',
      status: 'running',
      progress: {
        phase: 'reading_platform_captions',
        percent: 5,
        completed: 0,
        failed: 0,
        total: 4
      }
    });
    expect(stickmanVideoPanelAdapter.phaseLabel('reading_platform_captions', zh))
      .toBe('获取平台字幕');
    const progress = stickmanVideoPanelAdapter.readStageProgress(aggregated![0]!, zh);
    expect(stickmanVideoPanelAdapter.runningProgressText?.(aggregated![0]!, progress, zh))
      .toBe('获取平台字幕');
  });

  it('keeps only the current shot run instead of rendering repeated completion cards', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('shot-1-old', 'shot-1', 'failed', '1'.repeat(64)),
      stage('shot-1-new', 'shot-1', 'succeeded', '2'.repeat(64)),
      stage('shot-2', 'shot-2', 'succeeded', '3'.repeat(64)),
      stage('shot-3', 'shot-3', 'failed', '4'.repeat(64))
    ]);
    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      id: 'shot-3',
      stageId: 'images',
      status: 'failed'
    });
  });
});

function activity(action: string, details: CreatorActivity['details'] = {}): CreatorActivity {
  return {
    id: `activity-${action}`,
    jobId: 'job-1',
    revision: 1,
    actor: 'user',
    action,
    summary: action,
    details,
    createdAt: '2026-08-31T00:00:00.000Z'
  };
}

function stage(
  id: string,
  scopeKey: string,
  status: CreatorStageRun['status'],
  inputFingerprint: string | null,
  stageId = 'images',
  percent?: number,
  phase?: string
): CreatorStageRun {
  return {
    id,
    jobId: 'job-1',
    stageId,
    executor: 'stickman-image',
    status,
    dispatchStatus: 'finished',
    claimOwner: null,
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: id,
    scopeKey,
    inputFingerprint,
    progress: {
      ...(percent === undefined ? {} : { percent }),
      ...(phase === undefined ? {} : { phase })
    },
    errorCode: status === 'failed' ? 'image_failed' : null,
    errorMessage: status === 'failed' ? 'failed' : null,
    startedAt: `2026-08-31T00:00:0${id.includes('old') ? 1 : 2}.000Z`,
    finishedAt: '2026-08-31T00:00:03.000Z'
  };
}
