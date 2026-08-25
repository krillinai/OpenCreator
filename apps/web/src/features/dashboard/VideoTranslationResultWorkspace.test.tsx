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
  subtitleCues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '真实字幕' }],
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
    expect(screen.getByRole('textbox', { name: '字幕 1' })).toHaveValue('真实字幕');
  });

  it('shows a registered video artifact instead of previewing the source URL', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="video"
        hasVideoArtifact
        videoSrc="blob:http://localhost/translated-video"
        videoFileName="translated-horizontal.mp4"
        outputLabel="横屏视频 16:9"
        onExport={onExport}
      />
    );

    expect(screen.getByText('translated-horizontal.mp4')).toBeInTheDocument();
    expect(screen.getByText('成片 V1 · 项目 V1')).toBeInTheDocument();
    expect(screen.getByLabelText('翻译成片预览')).toHaveAttribute(
      'src',
      'blob:http://localhost/translated-video'
    );
    expect(screen.queryByTitle('YouTube 视频预览')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载成片' }));
    expect(onExport).toHaveBeenCalledWith('video');
  });
});
