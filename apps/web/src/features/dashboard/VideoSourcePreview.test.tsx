import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import VideoSourcePreview from './VideoSourcePreview.js';

const createObjectURL = vi.fn(() => 'blob:local-preview');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VideoSourcePreview', () => {
  it('previews a local file and releases its object URL', () => {
    const file = new File(['video'], 'local.mp4', { type: 'video/mp4' });
    const { unmount } = render(
      <VideoSourcePreview
        file={file}
        sourceType="file"
        url=""
        onChooseFile={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByLabelText('本地视频预览')).toHaveAttribute('src', 'blob:local-preview');
    expect(createObjectURL).toHaveBeenCalledWith(file);
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
  });

  it('labels the English replacement action as Change', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <VideoSourcePreview
          file={new File(['video'], 'local.mp4', { type: 'video/mp4' })}
          sourceType="file"
          url=""
          onChooseFile={vi.fn()}
          onClear={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.queryByText('Choose another')).not.toBeInTheDocument();
  });

  it('recognizes Bilibili and direct video links', () => {
    const { rerender } = render(
      <VideoSourcePreview
        file={null}
        sourceType="url"
        url="https://www.bilibili.com/video/BV1xx411c7mD"
        onChooseFile={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByTitle('Bilibili 视频预览')).toHaveAttribute(
      'src',
      expect.stringContaining('bvid=BV1xx411c7mD')
    );

    rerender(
      <VideoSourcePreview
        file={null}
        sourceType="url"
        url="https://cdn.example.com/demo.mp4?token=preview"
        onChooseFile={vi.fn()}
        onClear={vi.fn()}
      />
    );
    expect(screen.getByLabelText('视频链接预览')).toHaveAttribute(
      'src',
      'https://cdn.example.com/demo.mp4?token=preview'
    );
  });

  it('uses the source video dimensions as the preview aspect ratio', () => {
    render(
      <VideoSourcePreview
        file={null}
        sourceType="url"
        url="https://cdn.example.com/portrait.mp4"
        onChooseFile={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const video = screen.getByLabelText('视频链接预览');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 }
    });
    fireEvent.loadedMetadata(video);

    expect(video).toHaveStyle({ aspectRatio: '1080 / 1920' });
  });

  it('shows a useful fallback without offering another source type', () => {
    const onChooseFile = vi.fn();
    const onClear = vi.fn();
    render(
      <VideoSourcePreview
        file={null}
        sourceType="url"
        url="https://video.example.com/watch/123"
        onChooseFile={onChooseFile}
        onClear={onClear}
      />
    );

    expect(screen.getByText('此平台暂不支持内嵌预览')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开原始链接' })).toHaveAttribute(
      'href',
      'https://video.example.com/watch/123'
    );
    expect(screen.queryByRole('button', { name: '改用本地视频' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    expect(onChooseFile).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledOnce();
  });
});
