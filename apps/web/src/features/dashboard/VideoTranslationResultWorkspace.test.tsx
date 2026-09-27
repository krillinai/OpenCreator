import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VideoTranslationResultWorkspace from './VideoTranslationResultWorkspace.js';

const baseProps = {
  version: 1,
  versions: [{ value: 1, description: '初次生成' }],
  targetLanguage: '简体中文',
  outputLabel: '字幕文件',
  subtitleStyleLabel: '系统默认 · 中 · #FFFFFF',
  dubbing: false,
  hasVoiceArtifact: false,
  videoOutputs: [],
  subtitleVideoPreviews: {},
  subtitleOutputs: [{
    artifactId: 'subtitle-horizontal-v1',
    variant: 'horizontal' as const,
    artifactVersion: 1,
    fileName: 'horizontal.srt',
    cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '真实字幕' }],
    readOnly: false
  }],
  subtitleDirty: false,
  subtitleDirtyByVariant: {},
  nextVersion: 2,
  affectedArtifacts: [],
  hasPendingChanges: false,
  regenerationPending: false,
  onTabChange: vi.fn(),
  onVersionChange: vi.fn(),
  onSubtitleChange: vi.fn(),
  onSaveSubtitles: vi.fn(),
  onAdjustSettings: vi.fn(),
  onExport: vi.fn(),
  onReloadVoice: vi.fn(),
  onRequestRegenerate: vi.fn(),
  onCancelRegenerate: vi.fn(),
  onConfirmRegenerate: vi.fn()
};

describe('VideoTranslationResultWorkspace', () => {
  it('shows subtitle-only output in an always-visible outputs tab', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="video"
        onExport={onExport}
      />
    );

    expect(screen.getByRole('tab', { name: '作品' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '作品' })).toBeInTheDocument();
    expect(screen.getByText('项目 V1 · 1 个文件')).toBeInTheDocument();
    expect(screen.getByText('horizontal.srt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载横屏字幕' }));
    expect(onExport).toHaveBeenCalledWith('subtitles', 'subtitle-horizontal-v1');
  });

  it('shows a registered video artifact instead of previewing the source URL', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="video"
        videoOutputs={[{
          artifactId: 'horizontal-video-v1',
          variant: 'horizontal',
          artifactVersion: 1,
          fileName: 'translated-horizontal.mp4',
          src: 'blob:http://localhost/translated-video'
        }]}
        outputLabel="横屏视频 16:9"
        onExport={onExport}
      />
    );

    expect(screen.getByText('translated-horizontal.mp4')).toBeInTheDocument();
    expect(screen.getByText('子项 V1 · 项目 V1')).toBeInTheDocument();
    expect(screen.getByLabelText('横屏成片预览')).toHaveAttribute(
      'src',
      'blob:http://localhost/translated-video'
    );
    expect(screen.queryByTitle('YouTube 视频预览')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载横屏成片' }));
    expect(onExport).toHaveBeenCalledWith('video', 'horizontal-video-v1');
  });

  it('shows horizontal and vertical videos together in one project version', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="video"
        version={5}
        videoOutputs={[
          {
            artifactId: 'horizontal-video-v2',
            variant: 'horizontal',
            artifactVersion: 2,
            fileName: 'translated-horizontal.mp4',
            src: 'blob:http://localhost/translated-horizontal-video'
          },
          {
            artifactId: 'vertical-video-v2',
            variant: 'vertical',
            artifactVersion: 2,
            fileName: 'translated-vertical.mp4',
            src: 'blob:http://localhost/translated-vertical-video'
          }
        ]}
        onExport={onExport}
      />
    );

    expect(screen.getByRole('heading', { name: '横屏成片' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '竖屏成片' })).toBeInTheDocument();
    expect(screen.getByLabelText('横屏成片预览').parentElement).toHaveAttribute('data-ratio', '16:9');
    expect(screen.getByLabelText('竖屏成片预览').parentElement).toHaveAttribute('data-ratio', '9:16');
    expect(screen.queryByRole('radiogroup', { name: '成片画幅' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下载横屏成片' }));
    fireEvent.click(screen.getByRole('button', { name: '下载竖屏成片' }));
    expect(onExport).toHaveBeenNthCalledWith(1, 'video', 'horizontal-video-v2');
    expect(onExport).toHaveBeenNthCalledWith(2, 'video', 'vertical-video-v2');
  });

  it('switches between horizontal and vertical subtitles with horizontal selected by default', () => {
    const onExport = vi.fn();
    const onSubtitleChange = vi.fn();
    const onSaveSubtitles = vi.fn();
    const { container } = render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        version={5}
        subtitleDirtyByVariant={{ horizontal: true, vertical: true }}
        subtitleVideoPreviews={{
          vertical: {
            artifactId: 'source-video-v1',
            src: 'blob:http://localhost/horizontal-source-video',
            source: true
          }
        }}
        subtitleOutputs={[
          {
            artifactId: 'horizontal-subtitle-v1',
            variant: 'horizontal',
            artifactVersion: 1,
            fileName: 'target_language_srt.srt',
            cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '横屏字幕内容' }],
            readOnly: false
          },
          {
            artifactId: 'vertical-subtitle-v1',
            variant: 'vertical',
            artifactVersion: 1,
            fileName: 'short_origin_mixed_srt.srt',
            cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '竖屏短字幕' }],
            readOnly: false
          }
        ]}
        onExport={onExport}
        onSubtitleChange={onSubtitleChange}
        onSaveSubtitles={onSaveSubtitles}
      />
    );

    expect(screen.getByRole('radio', { name: '横屏' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '竖屏' })).toHaveAttribute('aria-checked', 'false');
    const horizontal = screen.getByRole('textbox', { name: '横屏字幕 1' });
    expect(horizontal).not.toHaveAttribute('readonly');
    expect(screen.queryByRole('heading', { name: '横屏字幕' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: '横屏字幕内容' }).querySelectorAll('[data-subtitle-cue]'))
      .toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: '竖屏字幕 1' })).not.toBeInTheDocument();
    expect(screen.getByText('00:00–00:01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '跳转到 00:00:00,000' })).toHaveTextContent('00:00–00:01');
    expect(horizontal).toHaveAttribute('rows', '1');
    fireEvent.change(horizontal, { target: { value: '修改后的横屏字幕' } });
    expect(onSubtitleChange).toHaveBeenCalledWith('horizontal', 1, '修改后的横屏字幕');
    fireEvent.click(screen.getByRole('button', { name: '保存横屏字幕' }));
    expect(onSaveSubtitles).toHaveBeenCalledWith('horizontal');

    fireEvent.click(screen.getByRole('radio', { name: '竖屏' }));
    const vertical = screen.getByRole('textbox', { name: '竖屏字幕 1' });
    expect(vertical).not.toHaveAttribute('readonly');
    expect(vertical).toHaveValue('竖屏短字幕');
    fireEvent.change(vertical, { target: { value: '修改后的竖屏字幕' } });
    expect(onSubtitleChange).toHaveBeenCalledWith('vertical', 1, '修改后的竖屏字幕');
    fireEvent.click(screen.getByRole('button', { name: '保存竖屏字幕' }));
    expect(onSaveSubtitles).toHaveBeenCalledWith('vertical');
    expect(screen.queryByRole('textbox', { name: '横屏字幕 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '竖屏' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('list', { name: '竖屏字幕内容' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '竖屏字幕' })).not.toBeInTheDocument();
    const verticalVideo = screen.getByLabelText('竖屏字幕视频预览');
    expect(verticalVideo).toHaveAttribute('src', 'blob:http://localhost/horizontal-source-video');
    expect(verticalVideo.parentElement).toHaveAttribute('data-ratio', '9:16');
    Object.defineProperties(verticalVideo, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 }
    });
    fireEvent.loadedMetadata(verticalVideo);
    expect(verticalVideo.parentElement).toHaveAttribute('data-ratio', '9:16');
    fireEvent.click(screen.getByRole('radio', { name: '横屏' }));
    expect(screen.getByRole('radio', { name: '横屏' })).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelector('.video-result-player-frame')).toHaveAttribute('data-ratio', '16:9');
    expect(screen.queryByText('target_language_srt.srt')).not.toBeInTheDocument();
    expect(screen.queryByText('short_origin_mixed_srt.srt')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载横屏字幕' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载竖屏字幕' })).not.toBeInTheDocument();
  });

  it('keeps the read-only status in the page heading without repeating a list heading', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleOutputs={[{ ...baseProps.subtitleOutputs[0]!, readOnly: true }]}
      />
    );

    expect(screen.getByText('项目 V1 · 1 条字幕 · 已保存 · 只读')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '横屏字幕内容' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '横屏字幕' })).not.toBeInTheDocument();
  });

  it('shows bilingual subtitle lines in the requested order while keeping the translation editable', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleOutputs={[{
          ...baseProps.subtitleOutputs[0]!,
          fileName: 'bilingual_srt.srt',
          translationPosition: 'top',
          cues: [{
            id: 1,
            start: '00:00:00,000',
            end: '00:00:01,000',
            text: '译文在上',
            sourceText: 'Source below'
          }]
        }]}
      />
    );

    const cue = screen.getByRole('textbox', { name: '横屏字幕 1' }).closest('[data-subtitle-cue]')!;
    const translation = screen.getByRole('textbox', { name: '横屏字幕 1' });
    const source = screen.getByLabelText('横屏字幕原文 1');
    expect(translation).toHaveValue('译文在上');
    expect(translation).not.toHaveAttribute('readonly');
    expect(source).toHaveValue('Source below');
    expect(source).not.toHaveAttribute('readonly');
    expect(source).toHaveAttribute('rows', '1');
    expect(translation).toHaveAttribute('rows', '1');
    fireEvent.change(source, { target: { value: 'Corrected source' } });
    expect(baseProps.onSubtitleChange).toHaveBeenCalledWith('horizontal', 1, 'Corrected source', 'sourceText');
    expect(translation.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cue).toContainElement(source);
  });

  it('groups vertical cues within the longer timestamp while preserving editing and playback by cue ID', () => {
    const onSubtitleChange = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleVideoPreviews={{ vertical: {
          artifactId: 'vertical-video-v1',
          src: 'blob:http://localhost/vertical-video',
          source: false
        } }}
        subtitleOutputs={[{
          artifactId: 'vertical-subtitle-v1',
          variant: 'vertical',
          artifactVersion: 1,
          cues: [
            { id: 4, start: '00:00:01,000', end: '00:00:02,000', text: '我很乐意。' },
            { id: 5, start: '00:00:01,000', end: '00:00:02,000', text: "I'm happy to do it." },
            { id: 6, start: '00:00:02,000', end: '00:00:03,000', text: '另一句译文' },
            { id: 7, start: '00:00:02,250', end: '00:00:03,000', text: 'Other source' }
          ],
          readOnly: false
        }]}
        onSubtitleChange={onSubtitleChange}
      />
    );

    const list = screen.getByRole('list', { name: '竖屏字幕内容' });
    expect(list.querySelectorAll('[data-subtitle-cue]')).toHaveLength(2);
    const translation = screen.getByRole('textbox', { name: '竖屏字幕 1' });
    const source = screen.getByRole('textbox', { name: '竖屏字幕 2' });
    expect(translation.closest('[data-subtitle-cue]')).toBe(source.closest('[data-subtitle-cue]'));
    expect(translation.closest('[data-subtitle-cue]')).toHaveTextContent('00:01–00:02');
    expect(screen.getAllByText('00:02–00:03')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '竖屏字幕 3' }).closest('[data-subtitle-cue]'))
      .toBe(screen.getByRole('textbox', { name: '竖屏字幕 4' }).closest('[data-subtitle-cue]'));

    fireEvent.change(translation, { target: { value: '很高兴。' } });
    fireEvent.change(source, { target: { value: 'Happy to help.' } });
    expect(onSubtitleChange).toHaveBeenNthCalledWith(1, 'vertical', 4, '很高兴。');
    expect(onSubtitleChange).toHaveBeenNthCalledWith(2, 'vertical', 5, 'Happy to help.');

    const video = screen.getByLabelText('竖屏字幕视频预览') as HTMLVideoElement;
    fireEvent.timeUpdate(video, { target: { currentTime: 1.5 } });
    expect(translation.closest('[data-subtitle-cue]')).toHaveAttribute('data-active', 'true');
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:02,000' }));
    expect(video.currentTime).toBe(2);
    expect(screen.getByRole('textbox', { name: '竖屏字幕 4' }).closest('[data-subtitle-cue]'))
      .toHaveAttribute('data-active', 'true');
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:01,000' }));
    expect(video.currentTime).toBe(1);
    expect(list.querySelectorAll('[data-subtitle-cue][data-active="true"]')).toHaveLength(1);
  });

  it('keeps consecutive split source lines under a longer vertical subtitle without swallowing overlapping cues', () => {
    const onSubtitleChange = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleVideoPreviews={{ vertical: {
          artifactId: 'vertical-video-v1',
          src: 'blob:http://localhost/vertical-video',
          source: false
        } }}
        subtitleOutputs={[{
          artifactId: 'vertical-subtitle-v1',
          variant: 'vertical',
          artifactVersion: 1,
          cues: [
            { id: 1, start: '00:00:00,000', end: '00:00:02,000', text: 'Jensen, 谢谢你今天这么做。' },
            { id: 2, start: '00:00:00,000', end: '00:00:01,000', text: 'Jensen, thank you' },
            { id: 3, start: '00:00:01,000', end: '00:00:02,000', text: 'for doing this today.' },
            { id: 4, start: '00:00:01,500', end: '00:00:03,000', text: '跨过边界的字幕' },
            { id: 5, start: '00:00:03,000', end: '00:00:04,000', text: '下一句译文' },
            { id: 6, start: '00:00:03,000', end: '00:00:04,000', text: 'Next source' }
          ],
          readOnly: false
        }]}
        onSubtitleChange={onSubtitleChange}
      />
    );

    const list = screen.getByRole('list', { name: '竖屏字幕内容' });
    expect(list.querySelectorAll('[data-subtitle-cue]')).toHaveLength(3);
    const first = screen.getByRole('textbox', { name: '竖屏字幕 1' }).closest('[data-subtitle-cue]');
    expect(first).toHaveTextContent('00:00–00:02');
    expect(first).toContainElement(screen.getByRole('textbox', { name: '竖屏字幕 2' }));
    expect(first).toContainElement(screen.getByRole('textbox', { name: '竖屏字幕 3' }));
    expect(screen.queryByRole('button', { name: '跳转到 00:00:01,000' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '竖屏字幕 4' }).closest('[data-subtitle-cue]'))
      .not.toBe(first);
    expect(screen.getByRole('textbox', { name: '竖屏字幕 5' }).closest('[data-subtitle-cue]'))
      .toContainElement(screen.getByRole('textbox', { name: '竖屏字幕 6' }));

    fireEvent.change(screen.getByRole('textbox', { name: '竖屏字幕 3' }), { target: { value: 'for helping today.' } });
    expect(onSubtitleChange).toHaveBeenCalledWith('vertical', 3, 'for helping today.');
    const video = screen.getByLabelText('竖屏字幕视频预览') as HTMLVideoElement;
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:00,000' }));
    expect(video.currentTime).toBe(0);
    fireEvent.timeUpdate(video, { target: { currentTime: 1.25 } });
    expect(first).toHaveAttribute('data-active', 'true');
    fireEvent.timeUpdate(video, { target: { currentTime: 2.5 } });
    expect(first).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('textbox', { name: '竖屏字幕 4' }).closest('[data-subtitle-cue]'))
      .toHaveAttribute('data-active', 'true');
  });

  it('does not combine horizontal cues even when they have matching timestamps', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleOutputs={[{
          ...baseProps.subtitleOutputs[0]!,
          cues: [
            { id: 1, start: '00:00:01,000', end: '00:00:02,000', text: '第一条' },
            { id: 2, start: '00:00:01,000', end: '00:00:02,000', text: '第二条' }
          ]
        }]}
      />
    );

    expect(screen.getByRole('list', { name: '横屏字幕内容' }).querySelectorAll('[data-subtitle-cue]'))
      .toHaveLength(2);
  });

  it('keeps video playback and subtitle cues synchronized', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleVideoPreviews={{
          horizontal: {
            artifactId: 'source-video-v1',
            src: 'blob:http://localhost/source-video',
            source: true
          }
        }}
        subtitleOutputs={[{
          ...baseProps.subtitleOutputs[0]!,
          cues: [
            { id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '第一条字幕' },
            { id: 2, start: '00:00:01,000', end: '00:00:03,000', text: '第二条字幕' }
          ]
        }]}
      />
    );

    const video = screen.getByLabelText('横屏字幕视频预览') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', 'blob:http://localhost/source-video');
    expect(screen.getByText('当前使用原视频同步预览')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '横屏字幕内容' }).querySelectorAll('[data-subtitle-cue]')).toHaveLength(2);

    fireEvent.timeUpdate(video, { target: { currentTime: 1.5 } });
    expect(screen.getByRole('textbox', { name: '横屏字幕 2' }).closest('[data-subtitle-cue]'))
      .toHaveAttribute('data-active', 'true');
    expect(screen.getByText('第二条字幕', { selector: '.video-result-subtitle-overlay > span' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:00,000' }));
    expect(video.currentTime).toBe(0);
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' }).closest('[data-subtitle-cue]'))
      .toHaveAttribute('data-active', 'true');
  });

  it('previews and downloads a generated dubbing artifact', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="voice"
        hasVoiceArtifact
        voiceOutput={{
          artifactId: 'dubbed-audio-v2',
          artifactVersion: 2,
          fileName: 'target-dubbing-v2.wav',
          src: 'blob:http://localhost/dubbed-audio'
        }}
        onExport={onExport}
      />
    );

    expect(screen.getByLabelText('目标语言配音试听')).toHaveAttribute(
      'src',
      'blob:http://localhost/dubbed-audio'
    );
    expect(screen.getByLabelText('目标语言配音试听')).toHaveAttribute('preload', 'metadata');
    expect(screen.getByText('target-dubbing-v2.wav')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载配音文件' }));
    expect(onExport).toHaveBeenCalledWith('voice', 'dubbed-audio-v2');
  });

  it('shows voice preview loading failure and supports retrying', () => {
    const onReloadVoice = vi.fn();
    const { rerender } = render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="voice"
        hasVoiceArtifact
        voiceOutput={{
          artifactId: 'dubbed-audio-v2',
          artifactVersion: 2,
          previewLoading: true
        }}
        onReloadVoice={onReloadVoice}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('正在加载配音...');
    rerender(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="voice"
        hasVoiceArtifact
        voiceOutput={{
          artifactId: 'dubbed-audio-v2',
          artifactVersion: 2,
          previewError: '配音文件读取失败'
        }}
        onReloadVoice={onReloadVoice}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('配音文件读取失败');
    fireEvent.click(screen.getByRole('button', { name: '重新加载配音' }));
    expect(onReloadVoice).toHaveBeenCalledOnce();
  });

  it('switches result tabs and selects a project version from history', () => {
    const onTabChange = vi.fn();
    const onVersionChange = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        versions={[
          { value: 1, description: '初次生成' },
          { value: 2, description: '更新字幕' }
        ]}
        onTabChange={onTabChange}
        onVersionChange={onVersionChange}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    expect(onTabChange).toHaveBeenCalledWith('settings');

    fireEvent.click(screen.getByRole('button', { name: /项目 V1/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V2/ }));
    expect(onVersionChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
