import type {
  CreatorActionRequest,
  CreatorActionResponse,
  CreatorArtifact,
  CreatorJob,
  CreatorJson,
  CreatorStageRun,
  CreatorYtDlpStatus
} from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import VideoDownloadWorkspace from './VideoDownloadWorkspace.js';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const mediaPlay = vi.fn(async () => undefined);
const originalMediaPlay = HTMLMediaElement.prototype.play;

beforeEach(() => {
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  mediaPlay.mockClear();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: mediaPlay
  });
});

afterEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: originalMediaPlay
  });
});

describe('VideoDownloadWorkspace', () => {
  it('shows labeled icons for every supported platform', () => {
    renderWorkspace(job(), { applyAction: vi.fn() });
    expect(screen.getByText('支持的视频来源（支持单个公开视频链接）')).toBeInTheDocument();
    expect(screen.getAllByText(/支持单个公开视频链接/)).toHaveLength(1);
    const platforms = screen.getByRole('list', { name: '支持的平台' });
    const items = within(platforms).getAllByRole('listitem');
    expect(items).toHaveLength(9);
    for (const [index, name] of ['YouTube', 'Bilibili', 'X', 'TikTok', 'Instagram', '抖音', 'Facebook', '小红书', 'Pinterest'].entries()) {
      const item = items[index]!;
      expect(item).toHaveTextContent(name);
      expect(item.querySelector('img')).toHaveAttribute('src', expect.stringMatching(/^\/platforms\//));
    }
  });

  it('pastes a Douyin share message as its short video URL', () => {
    const shortUrl = 'https://v.douyin.com/aN88tM5tjyE/';
    renderWorkspace(job(), { applyAction: vi.fn() });
    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: `2.53 jCu:/ AI复刻爆款短视频全流程！ ${shortUrl} 复制此链接，打开Dou音搜索，直接观看视频！` }
    });
    expect(screen.getByRole('textbox', { name: '待下载视频链接' })).toHaveValue(shortUrl);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows both videos in a multi-video X post as separate downloads', async () => {
    const url = 'https://x.com/creator/status/123';
    const artifact = probeArtifact();
    const current = job({
      state: { sourceUrl: url },
      artifacts: [{
        ...artifact,
        metadata: {
          ...artifact.metadata,
          id: 'post-123', requestedUrl: url, url, platform: 'x',
          options: [
            {
              id: 'item-1-video-720-1', mediaType: 'video', container: 'mp4',
              height: 720, videoFormatId: 'first-video', playlistIndex: 1
            },
            {
              id: 'item-2-video-1080-1', mediaType: 'video', container: 'mp4',
              height: 1080, videoFormatId: 'second-video', playlistIndex: 2
            }
          ]
        }
      }]
    });
    const applyAction = vi.fn();
    renderWorkspace(current, { applyAction });
    expect(await screen.findByRole('button', { name: '下载 视频 1 · 720p' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载 视频 2 · 1080p' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        action: 'run-stage',
        input: expect.objectContaining({ optionId: 'item-2-video-1080-1' })
      })
    ));
  });

  it('submits a real probe stage and does not announce success before an artifact exists', async () => {
    let current = job();
    const applyAction = vi.fn(async (
      _jobId: string,
      request: CreatorActionRequest
    ): Promise<CreatorActionResponse> => {
      current = {
        ...current,
        revision: current.revision + 1,
        status: request.action === 'run-stage' ? 'running' : current.status,
        state: request.action === 'update-settings'
          ? {
              ...current.state,
              ...(request.input.patch as Record<string, CreatorJson>)
            }
          : current.state
      };
      return {
        job: current,
        receipt: {
          actor: 'user',
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: current.revision,
          createdAt: current.updatedAt
        }
      };
    });
    renderWorkspace(current, { applyAction });

    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=demo' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'probe' }
      })
    ));
    expect(screen.getByText('解析任务已提交，真实规格返回后会自动显示')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '下载规格' })).not.toBeInTheDocument();
    expect(screen.queryByText('链接解析完成，请选择下载规格')).not.toBeInTheDocument();
  });

  it('marks downloaded formats complete and only offers saving project files locally', async () => {
    const current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [
        probeArtifact(),
        videoArtifact()
      ]
    });
    renderWorkspace(current, {
      applyAction: vi.fn()
    });

    expect(await screen.findByRole('tab', { name: '视频信息' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '视频信息' }));
    expect(screen.getByText('Creator Download')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '下载规格' }));
    expect(screen.getAllByText('1080p')).toHaveLength(2);
    expect(screen.getByText('MP4 · 1920 x 1080 · 30 FPS · 84 MB')).toBeInTheDocument();
    expect(screen.getByLabelText('已完成 1080p')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载 1080p' }))
      .not.toBeInTheDocument();
    expect(screen.queryByText('OpenCreator 视频示例')).not.toBeInTheDocument();
    expect(screen.queryByText(/Vimeo/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '作品' }));
    expect(screen.getByText('Creator Download.mp4')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: '保存到本机 Creator Download.mp4'
    })).toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: '发送到视频翻译 Creator Download.mp4'
    })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: '发送到视频切片 Creator Download.mp4'
    })).not.toBeInTheDocument();
  });

  it('selects the real audio track when the video language changes', async () => {
    const current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1-audio-en'
      },
      artifacts: [multilingualProbeArtifact()]
    });
    const applyAction = vi.fn();
    renderWorkspace(current, { applyAction });

    const language = await screen.findByRole('combobox', {
      name: '音频语言'
    });
    expect(language).toHaveValue('en');
    expect(screen.getByText(/音频: .*\(en\)/)).toBeInTheDocument();

    fireEvent.change(language, { target: { value: 'es' } });

    expect(language).toHaveValue('es');
    expect(screen.getByText(/音频: .*\(es\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载 1080p' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        action: 'run-stage',
        input: {
          stageId: 'download',
          optionId: 'video-1080-1-audio-es',
          mediaType: 'video',
          sourceUrl: 'https://www.youtube.com/watch?v=demo'
        }
      })
    ));
  });

  it('previews video and audio project files and releases object URLs', async () => {
    createObjectURL
      .mockReturnValueOnce('blob:video-preview')
      .mockReturnValueOnce('blob:audio-preview')
      .mockReturnValueOnce('blob:video-preview-reopened');
    const current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [
        probeArtifact(),
        videoArtifact(),
        audioArtifact()
      ]
    });
    const openArtifact = vi.fn(async (_jobId: string, artifactId: string) => (
      new Response(new Blob([artifactId], {
        type: artifactId === 'audio_artifact' ? 'audio/mpeg' : 'video/mp4'
      }))
    ));
    const { unmount } = renderWorkspace(current, {
      applyAction: vi.fn(),
      openArtifact
    });

    fireEvent.click(await screen.findByRole('tab', { name: '作品' }));
    fireEvent.click(screen.getByRole('button', {
      name: '预览视频 Creator Download.mp4'
    }));

    expect(await screen.findByLabelText('视频预览 Creator Download.mp4'))
      .toHaveAttribute('src', 'blob:video-preview');
    expect(openArtifact).toHaveBeenCalledWith(current.id, 'video_artifact');
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', {
      name: '播放音频 Creator Download.mp3'
    }));

    expect(await screen.findByLabelText('音频播放 Creator Download.mp3'))
      .toHaveAttribute('src', 'blob:audio-preview');
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('视频预览 Creator Download.mp4'))
      .not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-preview');
    expect(screen.getByRole('button', {
      name: '保存到本机 Creator Download.mp4'
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: '保存到本机 Creator Download.mp3'
    })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {
      name: '收起预览 Creator Download.mp3'
    }));

    expect(screen.queryByLabelText('音频播放 Creator Download.mp3'))
      .not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audio-preview');

    fireEvent.click(screen.getByRole('button', {
      name: '预览视频 Creator Download.mp4'
    }));
    expect(await screen.findByLabelText('视频预览 Creator Download.mp4'))
      .toHaveAttribute('src', 'blob:video-preview-reopened');
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(3));

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-preview-reopened');
  });

  it('shows a retry action when a project file request or playback fails', async () => {
    createObjectURL.mockReturnValue('blob:video-preview');
    const current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [probeArtifact(), videoArtifact()]
    });
    const openArtifact = vi.fn()
      .mockRejectedValueOnce(new Error('preview unavailable'))
      .mockResolvedValueOnce(new Response(new Blob(['video'], {
        type: 'video/mp4'
      })));
    renderWorkspace(current, {
      applyAction: vi.fn(),
      openArtifact
    });

    fireEvent.click(await screen.findByRole('tab', { name: '作品' }));
    fireEvent.click(screen.getByRole('button', {
      name: '预览视频 Creator Download.mp4'
    }));

    expect(await screen.findByText('可重新加载预览或保存到本机'))
      .toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'OpenCreator' }).querySelector('.creator-collaboration-issue')).toBeInTheDocument();
    expect(screen.queryByText(/诊断编号：OC-/)).not.toBeInTheDocument();
    expect(screen.queryByText('preview unavailable')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

    expect(await screen.findByLabelText('视频预览 Creator Download.mp4'))
      .toHaveAttribute('src', 'blob:video-preview');
    expect(openArtifact).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledOnce());

    fireEvent.error(screen.getByLabelText('视频预览 Creator Download.mp4'));
    expect(await screen.findByText('可重新加载预览或保存到本机'))
      .toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-preview');
  });

  it('keeps other formats downloadable and lists progress by queued option', async () => {
    let current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [probeArtifact()],
      stages: [downloadStage('stage_1080', 'video-1080-1', 'running', 42)]
    });
    const jobId = current.id;
    const applyAction = vi.fn(async (
      _jobId: string,
      request: CreatorActionRequest
    ): Promise<CreatorActionResponse> => {
      const revision = current.revision + 1;
      current = {
        ...current,
        revision,
        status: request.action === 'run-stage' ? 'running' : current.status,
        state: request.action === 'update-settings'
          ? {
              ...current.state,
              ...(request.input.patch as Record<string, CreatorJson>)
            }
          : current.state,
        stages: request.action === 'run-stage'
          ? [
              ...current.stages,
              downloadStage(
                `stage_${revision}`,
                String(request.input.optionId),
                'queued',
                0
              )
            ]
          : current.stages
      };
      return {
        job: current,
        receipt: {
          actor: 'user',
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: revision,
          createdAt: current.updatedAt
        }
      };
    });
    renderWorkspace(current, { applyAction });

    const runningButton = await screen.findByRole('button', { name: '下载 1080p' });
    const availableButton = screen.getByRole('button', { name: '下载 720p' });
    expect(runningButton).toBeDisabled();
    expect(runningButton).toHaveTextContent('下载中');
    expect(availableButton).toBeEnabled();

    fireEvent.click(availableButton);

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({
        action: 'run-stage',
        input: expect.objectContaining({
          stageId: 'download',
          optionId: 'video-720-2',
          mediaType: 'video'
        })
      })
    ));
    expect(await screen.findByText('Creator Download · 1080p')).toBeInTheDocument();
    expect(screen.getByText('Creator Download · 720p')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
  });

  it('shows download preparation as indeterminate instead of a fixed percent', async () => {
    const current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [probeArtifact()],
      stages: [
        downloadStage(
          'stage_preparing',
          'video-1080-1',
          'running',
          2,
          'preparing_download'
        )
      ]
    });
    renderWorkspace(current, { applyAction: vi.fn() });

    fireEvent.click(await screen.findByRole('tab', { name: '作品' }));

    expect(screen.getByText('准备中')).toBeInTheDocument();
    expect(screen.queryByText('2%')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '正在准备下载' }))
      .not.toHaveAttribute('aria-valuenow');
  });

  it('accepts X, Twitter, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, and Pinterest video URLs for analysis', async () => {
    for (const url of [
      'https://x.com/creator/status/123',
      'https://twitter.com/creator/status/123',
      'https://www.tiktok.com/@creator/video/123',
      'https://vm.tiktok.com/abc123/',
      'https://www.instagram.com/reel/abc123/',
      'https://instagram.com/p/abc123/',
      'https://www.douyin.com/video/123',
      'https://v.douyin.com/abc123/',
      'https://www.douyin.com/jingxuan?modal_id=7687030616353823355',
      'https://www.facebook.com/watch/?v=123',
      'https://www.facebook.com/reel/123',
      'https://fb.watch/abc123/',
      'https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D&xsec_source=pc_feed',
      'https://www.pinterest.com/pin/6544361954284154/'
    ]) {
      let current = job();
      const applyAction = vi.fn(async (
        _jobId: string,
        request: CreatorActionRequest
      ): Promise<CreatorActionResponse> => {
        current = {
          ...current,
          revision: current.revision + 1,
          state: request.action === 'update-settings'
            ? { ...current.state, ...(request.input.patch as Record<string, CreatorJson>) }
            : current.state
        };
        return {
          job: current,
          receipt: {
            actor: 'user', action: request.action, summary: request.action,
            affectedArtifacts: [], newRevision: current.revision, createdAt: current.updatedAt
          }
        };
      });
      const { unmount } = renderWorkspace(current, { applyAction });
      fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
        target: { value: url }
      });
      fireEvent.click(screen.getByRole('button', { name: '解析链接' }));
      await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: 'run-stage', input: { stageId: 'probe' } })
      ));
      unmount();
    }
  });

  it('rejects domains that only mimic a supported video host suffix', () => {
    const applyAction = vi.fn();
    renderWorkspace(job(), { applyAction });

    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://notyoutube.com/watch?v=demo' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入有效的 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书或 Pinterest 公开视频链接'
    );
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('rejects TikTok profile URLs without a video', () => {
    const applyAction = vi.fn();
    renderWorkspace(job(), { applyAction });
    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.tiktok.com/@creator' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入有效的 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书或 Pinterest 公开视频链接'
    );
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('rejects Instagram profile URLs without a video', () => {
    const applyAction = vi.fn();
    renderWorkspace(job(), { applyAction });
    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.instagram.com/creator/' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入有效的 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书或 Pinterest 公开视频链接'
    );
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('rejects Douyin profile URLs without a video', () => {
    const applyAction = vi.fn();
    renderWorkspace(job(), { applyAction });
    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.douyin.com/user/creator' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入有效的 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书或 Pinterest 公开视频链接'
    );
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('rejects Facebook profile URLs without a video', () => {
    const applyAction = vi.fn();
    renderWorkspace(job(), { applyAction });
    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.facebook.com/creator' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入有效的 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书或 Pinterest 公开视频链接'
    );
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('rejects Xiaohongshu profile URLs without a video note', () => {
    const applyAction = vi.fn();
    renderWorkspace(job(), { applyAction });
    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.xiaohongshu.com/user/profile/6a9149f3000000001f01d20a' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入有效的 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书或 Pinterest 公开视频链接'
    );
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('does not unlock formats from an older probe after a newer URL was analyzed', () => {
    const older = probeArtifact();
    const newer = {
      ...probeArtifact(),
      id: 'probe_artifact_newer',
      metadata: {
        ...probeArtifact().metadata,
        id: 'demo-newer',
        requestedUrl: 'https://www.youtube.com/watch?v=newer',
        url: 'https://www.youtube.com/watch?v=newer'
      },
      createdAt: '2026-08-30T00:00:02.000Z'
    };
    renderWorkspace(job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [older, newer]
    }), {
      applyAction: vi.fn()
    });

    expect(screen.queryByRole('tab', { name: '下载规格' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '待下载视频链接' }))
      .toHaveValue('https://www.youtube.com/watch?v=demo');
  });

  it('shows an actionable message for a failed network probe', () => {
    const createdAt = '2026-08-30T00:00:00.000Z';
    renderWorkspace(job({
      status: 'failed',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      },
      stages: [{
        id: 'probe_stage',
        jobId: 'download_job',
        stageId: 'probe',
        executor: 'download',
        status: 'failed',
        dispatchStatus: 'claimed',
        claimOwner: 'test',
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          phase: 'probing_source',
          percent: 20
        },
        errorCode: 'network_unavailable',
        errorMessage: 'Unable to connect to the video platform.',
        startedAt: createdAt,
        finishedAt: createdAt
      }]
    }), {
      applyAction: vi.fn()
    });

    expect(screen.getAllByText('无法连接视频平台，请检查网络或代理设置后重试'))
      .toHaveLength(2);
  });

  it('keeps routine yt-dlp version management out of the download workspace', () => {
    renderWorkspace(job(), {
      applyAction: vi.fn(),
      runtimeDependencies: {
        ytDlpStatus: ytDlpStatus({
          latestVersion: '2026.08.31.120000',
          updateAvailable: true
        })
      }
    });

    expect(screen.queryByText('yt-dlp nightly 有可用更新')).not.toBeInTheDocument();
    expect(screen.queryByText('yt-dlp 2026.08.29.232711')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查 yt-dlp 更新' }))
      .not.toBeInTheDocument();
  });

  it('updates yt-dlp and retries the failed download with the original stage input', async () => {
    const failedStage = {
      ...downloadStage('stage_failed', 'video-720-2', 'failed', 37),
      errorCode: 'yt_dlp_update_recommended',
      errorMessage: 'The video platform extractor may be outdated',
      finishedAt: '2026-08-30T00:00:03.000Z'
    } satisfies CreatorStageRun;
    const current = job({
      status: 'failed',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [probeArtifact()],
      stages: [failedStage]
    });
    const applyAction = vi.fn(async (
      _jobId: string,
      request: CreatorActionRequest
    ): Promise<CreatorActionResponse> => ({
      job: current,
      receipt: {
        actor: 'user',
        action: request.action,
        summary: request.action,
        affectedArtifacts: [],
        newRevision: current.revision,
        createdAt: current.updatedAt
      }
    }));
    const updateYtDlp = vi.fn(async () => ytDlpStatus({
      source: 'managed',
      currentVersion: '2026.08.31.120000',
      latestVersion: '2026.08.31.120000',
      installedAt: '2026-08-31T00:00:00.000Z'
    }));
    const onOpenRuntimeComponents = vi.fn();
    renderWorkspace(current, {
      applyAction,
      runtimeDependencies: {
        ytDlpStatus: ytDlpStatus(),
        updateYtDlp
      },
      onOpenRuntimeComponents
    });

    expect(await screen.findByRole('button', { name: '前往第三方组件' }))
      .toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '更新并重试' }));

    await waitFor(() => expect(updateYtDlp).toHaveBeenCalledOnce());
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        action: 'run-stage',
        input: {
          stageId: 'download',
          optionId: 'video-720-2',
          mediaType: 'video',
          sourceUrl: 'https://www.youtube.com/watch?v=demo'
        }
      })
    ));
    expect(screen.getByText(
      'yt-dlp 已更新到 2026.08.31.120000，任务已重新提交'
    )).toBeInTheDocument();
  });
});

function renderWorkspace(
  initialJob: CreatorJob,
  input: {
    applyAction: ReturnType<typeof vi.fn>;
    openArtifact?: ReturnType<typeof vi.fn>;
    runtimeDependencies?: Partial<RuntimeDependenciesController>;
    onOpenRuntimeComponents?: () => void;
  }
) {
  const runtimeDependencies = input.runtimeDependencies === undefined
    ? undefined
    : {
        phase: 'idle',
        checkYtDlpUpdate: vi.fn(async () => ytDlpStatus()),
        updateYtDlp: vi.fn(async () => ytDlpStatus()),
        ...input.runtimeDependencies
      } as RuntimeDependenciesController;
  return render(
    <LanguageProvider initialPreference="zh-CN">
      <CreatorSessionProvider
        initialJob={initialJob}
        service={{
          applyAction: input.applyAction,
          openArtifact: input.openArtifact,
          runAgentTurn: vi.fn()
        } as never}
      >
        <VideoDownloadWorkspace
          onBack={vi.fn()}
          runtimeDependencies={runtimeDependencies}
          onOpenRuntimeComponents={input.onOpenRuntimeComponents}
        />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
}

function ytDlpStatus(
  patch: Partial<CreatorYtDlpStatus> = {}
): CreatorYtDlpStatus {
  return {
    channel: 'nightly',
    source: 'bundled',
    currentVersion: '2026.08.29.232711',
    bundledVersion: '2026.08.29.232711',
    latestVersion: null,
    updateAvailable: false,
    checkDue: false,
    lastCheckedAt: null,
    lastCheckAttemptAt: null,
    installedAt: null,
    ...patch
  };
}

function job(patch: Partial<CreatorJob> = {}): CreatorJob {
  const createdAt = '2026-08-30T00:00:00.000Z';
  return {
    id: 'download_job',
    projectId: 'project_1',
    templateId: 'video-download',
    templateVersion: 2,
    status: 'draft',
    revision: 0,
    presetOrigin: null,
    state: {},
    agentThreadId: null,
    stages: [],
    artifacts: [],
    providerRequests: [],
    activities: [],
    createdAt,
    updatedAt: createdAt,
    ...patch
  };
}

function probeArtifact(): CreatorArtifact {
  return {
    id: 'probe_artifact',
    jobId: 'download_job',
    kind: 'download_probe',
    version: 1,
    status: 'completed',
    path: '/tmp/probe.json',
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      id: 'demo',
      title: 'Creator Download',
      requestedUrl: 'https://www.youtube.com/watch?v=demo',
      url: 'https://www.youtube.com/watch?v=demo',
      platform: 'youtube',
      uploader: 'OpenCreator',
      thumbnailUrl: 'https://i.ytimg.com/vi/demo/hqdefault.jpg',
      duration: 120,
      width: 1920,
      height: 1080,
      formats: [],
      options: [{
        id: 'video-1080-1',
        mediaType: 'video',
        container: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        estimatedBytes: 88_080_384,
        videoFormatId: '399',
        audioFormatId: '140'
      }, {
        id: 'video-720-2',
        mediaType: 'video',
        container: 'mp4',
        width: 1280,
        height: 720,
        fps: 30,
        estimatedBytes: 52_428_800,
        videoFormatId: '398',
        audioFormatId: '140'
      }, {
        id: 'audio-mp3-192',
        mediaType: 'audio',
        container: 'mp3',
        bitrateKbps: 192,
        estimatedBytes: 2_880_000,
        audioFormatId: '140',
        transcode: 'mp3'
      }]
    },
    createdAt: '2026-08-30T00:00:01.000Z'
  };
}

function multilingualProbeArtifact(): CreatorArtifact {
  const base = probeArtifact();
  return {
    ...base,
    metadata: {
      ...base.metadata,
      options: [{
        id: 'video-1080-1-audio-en',
        mediaType: 'video',
        container: 'mp4',
        audioLanguage: 'en',
        width: 1920,
        height: 1080,
        fps: 30,
        estimatedBytes: 88_080_384,
        videoFormatId: '399',
        audioFormatId: 'audio-en'
      }, {
        id: 'video-1080-1-audio-es',
        mediaType: 'video',
        container: 'mp4',
        audioLanguage: 'es',
        width: 1920,
        height: 1080,
        fps: 30,
        estimatedBytes: 88_080_384,
        videoFormatId: '399',
        audioFormatId: 'audio-es'
      }]
    }
  };
}

function downloadStage(
  id: string,
  optionId: string,
  status: CreatorStageRun['status'],
  percent: number,
  phase = status === 'running' ? 'downloading' : 'preparing_download'
): CreatorStageRun {
  const createdAt = '2026-08-30T00:00:02.000Z';
  return {
    id,
    jobId: 'download_job',
    stageId: 'download',
    executor: 'download',
    status,
    dispatchStatus: status === 'queued' ? 'queued' : 'claimed',
    claimOwner: status === 'queued' ? null : 'test',
    claimExpiresAt: null,
    attempt: status === 'queued' ? 0 : 1,
    idempotencyKey: null,
    scopeKey: null,
    inputFingerprint: null,
    progress: {
      optionId,
      mediaType: 'video',
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      probeArtifactId: 'probe_artifact',
      phase,
      percent
    },
    errorCode: null,
    errorMessage: null,
    startedAt: status === 'queued' ? null : createdAt,
    finishedAt: null
  };
}

function videoArtifact(): CreatorArtifact {
  return {
    id: 'video_artifact',
    jobId: 'download_job',
    kind: 'source_video',
    version: 1,
    status: 'completed',
    path: '/tmp/Creator Download.mp4',
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: ['probe_artifact'],
    metadata: {
      fileName: 'Creator Download.mp4',
      mimeType: 'video/mp4',
      size: 88_080_384,
      width: 1920,
      height: 1080,
      hasVideo: true,
      hasAudio: true,
      optionId: 'video-1080-1',
      mediaType: 'video',
      requestedUrl: 'https://www.youtube.com/watch?v=demo'
    },
    createdAt: '2026-08-30T00:00:02.000Z'
  };
}

function audioArtifact(): CreatorArtifact {
  return {
    id: 'audio_artifact',
    jobId: 'download_job',
    kind: 'source_audio',
    version: 1,
    status: 'completed',
    path: '/tmp/Creator Download.mp3',
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: ['probe_artifact'],
    metadata: {
      fileName: 'Creator Download.mp3',
      mimeType: 'audio/mpeg',
      size: 2_880_000,
      hasVideo: false,
      hasAudio: true,
      optionId: 'audio-mp3-192',
      mediaType: 'audio',
      requestedUrl: 'https://www.youtube.com/watch?v=demo'
    },
    createdAt: '2026-08-30T00:00:03.000Z'
  };
}
