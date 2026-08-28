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
  subtitleOutputs: [{
    artifactId: 'subtitle-horizontal-v1',
    variant: 'horizontal' as const,
    artifactVersion: 1,
    fileName: 'horizontal.srt',
    cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '真实字幕' }],
    readOnly: false
  }],
  subtitleDirty: false,
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
  it('shows subtitle-only output without a final-video tab', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        hasVideoArtifact={false}
      />
    );

    expect(screen.queryByRole('tab', { name: '成片' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '字幕' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('真实字幕');
  });

  it('shows a registered video artifact instead of previewing the source URL', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="video"
        hasVideoArtifact
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
        hasVideoArtifact
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

  it('shows editable horizontal and read-only vertical subtitles together', () => {
    const onExport = vi.fn();
    const onSubtitleChange = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        version={5}
        hasVideoArtifact={false}
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
            readOnly: true
          }
        ]}
        onExport={onExport}
        onSubtitleChange={onSubtitleChange}
      />
    );

    const horizontal = screen.getByRole('textbox', { name: '横屏字幕 1' });
    const vertical = screen.getByRole('textbox', { name: '竖屏字幕 1' });
    expect(horizontal).not.toHaveAttribute('readonly');
    expect(vertical).toHaveAttribute('readonly');
    expect(vertical).toHaveValue('竖屏短字幕');
    fireEvent.change(horizontal, { target: { value: '修改后的横屏字幕' } });
    expect(onSubtitleChange).toHaveBeenCalledWith(1, '修改后的横屏字幕');

    fireEvent.click(screen.getByRole('button', { name: '下载横屏字幕' }));
    fireEvent.click(screen.getByRole('button', { name: '下载竖屏字幕' }));
    expect(onExport).toHaveBeenNthCalledWith(1, 'subtitles', 'horizontal-subtitle-v1');
    expect(onExport).toHaveBeenNthCalledWith(2, 'subtitles', 'vertical-subtitle-v1');
  });

  it('previews and downloads a generated dubbing artifact', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="voice"
        hasVideoArtifact={false}
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
        hasVideoArtifact={false}
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
        hasVideoArtifact={false}
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
        hasVideoArtifact={false}
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
