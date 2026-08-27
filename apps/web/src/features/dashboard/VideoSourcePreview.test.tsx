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

  it('restores an uploaded local source after the browser file is no longer available', () => {
    const onChooseFile = vi.fn();
    render(
      <LanguageProvider initialPreference="en-US">
        <VideoSourcePreview
          file={null}
          registeredFile={{
            name: 'restored.webm',
            size: 2 * 1024 * 1024,
            mime: 'video/webm'
          }}
          sourceType="file"
          url=""
          onChooseFile={onChooseFile}
          onClear={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(screen.getByText('Local video uploaded')).toBeInTheDocument();
    expect(screen.getByText('restored.webm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onChooseFile).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('shows YouTube title information before loading the embedded player', async () => {
    const getVideoMetadata = vi.fn(async (url: string) => ({
      platform: 'youtube' as const,
      title: url.includes('preview-two') ? 'Second video title' : 'First video title',
      authorName: 'Example creator',
      thumbnailUrl: 'https://i.ytimg.com/vi/preview-one/hqdefault.jpg'
    }));
    const { rerender } = render(
      <VideoSourcePreview
        file={null}
        sourceType="url"
        url="https://www.youtube.com/watch?v=preview-one"
        onChooseFile={vi.fn()}
        onClear={vi.fn()}
        metadataService={{ getVideoMetadata }}
      />
    );

    expect(screen.getByRole('img', { name: 'YouTube 视频缩略图' })).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/preview-one/hqdefault.jpg'
    );
    expect(screen.queryByTitle('YouTube 视频预览')).not.toBeInTheDocument();
    expect(await screen.findByText('First video title')).toBeInTheDocument();
    expect(screen.getByText('YouTube 视频 · Example creator')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '播放 YouTube 视频预览' }));
    expect(screen.getByTitle('YouTube 视频预览')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/preview-one'
    );

    rerender(
      <VideoSourcePreview
        file={null}
        sourceType="url"
        url="https://youtu.be/preview-two"
        onChooseFile={vi.fn()}
        onClear={vi.fn()}
        metadataService={{ getVideoMetadata }}
      />
    );
    expect(screen.getByRole('img', { name: 'YouTube 视频缩略图' })).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/preview-two/hqdefault.jpg'
    );
    expect(await screen.findByText('Second video title')).toBeInTheDocument();
    expect(screen.queryByTitle('YouTube 视频预览')).not.toBeInTheDocument();
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

  it('keeps the original platform link available when embedded playback fails', () => {
    render(
      <VideoSourcePreview
        file={null}
        sourceType="url"
        url="https://www.youtube.com/watch?v=preview-test"
        onChooseFile={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByRole('link', { name: '在浏览器中打开原视频' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=preview-test'
    );
  });

  it('uses uploaded portrait video dimensions for the preview frame', () => {
    const onDimensions = vi.fn();
    render(
      <VideoSourcePreview
        file={new File(['video'], 'portrait.mp4', { type: 'video/mp4' })}
        sourceType="file"
        url=""
        onChooseFile={vi.fn()}
        onClear={vi.fn()}
        onDimensions={onDimensions}
      />
    );

    const video = screen.getByLabelText('本地视频预览');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 }
    });
    fireEvent.loadedMetadata(video);

    expect(video).toHaveStyle({ aspectRatio: '1080 / 1920' });
    expect(video.closest('.video-source-preview-media')).toHaveStyle({ aspectRatio: '1080 / 1920' });
    expect(video.closest('.video-source-preview')).toHaveAttribute('data-orientation', 'portrait');
    expect(onDimensions).toHaveBeenCalledWith(1080, 1920);
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
