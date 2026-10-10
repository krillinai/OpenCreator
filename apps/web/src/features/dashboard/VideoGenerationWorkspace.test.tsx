import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { normalizePageIssue } from '../issues/page-issue-state.js';
import type {
  CreatorArtifact,
  CreatorJob,
  CreatorJson,
  CreatorServicesConfigResponse,
  CreatorStageRun,
  GatewayAccountState
} from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { LanguageSwitchControls } from '../../test/LanguageSwitchControls.js';
import VideoGenerationWorkspace from './VideoGenerationWorkspace.js';
import { CreatorSessionProvider, useCreatorSession } from './creator-session-store.js';
import { OfficialServicesContext } from './official-services.js';

describe('VideoGenerationWorkspace', () => {
  it('shows model-native video sizes and durations beyond the custom provider presets', () => {
    const gatewayState: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', models: [{ id: 'vendor/video', modality: 'video', capabilities: [], resolutions: ['1080p', '720p'], aspectRatios: ['16:9', '9:16'], durations: [3, 12] }], activationError: null };
    renderWorkspace(creatorJob({ state: { prompt: 'city', currentStep: 1, furthestStep: 1 } }), { gatewayState });
    const size = screen.getByRole('combobox', { name: '画幅' }) as HTMLSelectElement;
    expect([...size.options].map(option => option.value)).toEqual(['1080p@16:9', '1080p@9:16', '720p@16:9', '720p@9:16']);
    const duration = screen.getByRole('combobox', { name: '视频时长' }) as HTMLSelectElement;
    expect([...duration.options].map(option => option.value)).toEqual(['3', '12']);
  });
  it('shows only the official video model and supported parameters while signed in', async () => {
    const gatewayState: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', selectedModels: { video: 'bytedance/seedance-1-5-pro' }, models: [{ id: 'bytedance/seedance-1-5-pro', modality: 'video', capabilities: ['image_to_video'], sizes: ['1280x720', '720x1280'], durations: [4, 5] }], activationError: null };
    const getConfig = vi.fn();
    renderWorkspace(creatorJob({ state: { prompt: 'city skyline', provider: 'veo', model: 'veo-3.1-generate-preview', size: '1024x1024', duration: 10, currentStep: 1, furthestStep: 1 } }), { gatewayState, creatorServicesService: { getConfig } });
    expect(screen.getByLabelText('视频模型')).toHaveTextContent('seedance-1-5-pro');
    expect(screen.queryByRole('combobox', { name: '视频服务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '模型版本' })).not.toBeInTheDocument();
    const durations = screen.getByRole('combobox', { name: '视频时长' }) as HTMLSelectElement;
    expect([...durations.options].map(option => option.value)).toEqual(['4', '5']);
    expect(screen.queryByRole('option', { name: /1024/ })).not.toBeInTheDocument();
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('blocks official generation when account activation is unavailable', () => {
    renderWorkspace(creatorJob({ state: { prompt: 'city skyline', currentStep: 2, furthestStep: 2 } }), { gatewayState: null });
    expect(screen.getByRole('button', { name: '开始生成' })).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: '视频服务' })).not.toBeInTheDocument();
  });

  it('leaves the running screen and shows the true failure through read-only reconciliation without an SSE event', async () => {
    vi.useFakeTimers();
    const running = runningVideoJob({ phase: 'submitting', percent: 8 });
    const failed: CreatorJob = { ...running, revision: running.revision + 1, status: 'failed',
      stages: running.stages.map(stage => ({ ...stage, status: 'failed', errorCode: 'creator_video_upstream_error', errorMessage: 'Reference rejected' }))
    };
    failed.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('Failed'), 'Video generation failed'),
      scope: { kind: 'creator-job', jobId: failed.id }, stageRunId: failed.stages[0]!.id, code: 'creator_video_upstream_error',
      publicFacts: { kind: 'http-rejected', provider: 'seedance', httpStatus: 400,
        upstreamCode: 'InputImageSensitiveContentDetected.PrivacyInformation', upstreamMessage: 'Input image may contain real person', requestId: 'request-123' }
    }];
    const getJob = vi.fn().mockResolvedValueOnce({ job: running }).mockResolvedValue({ job: failed });
    const applyAction = vi.fn();
    const subscribeJobEvents = vi.fn(() => ({ close: vi.fn() }));
    const service = { getJob, applyAction, subscribeJobEvents, runAgentTurn: vi.fn() };
    const view = render(<LanguageProvider initialPreference="zh-CN"><CreatorSessionProvider initialJob={running} service={service as never}>
      <VideoGenerationWorkspace onBack={vi.fn()} />
    </CreatorSessionProvider></LanguageProvider>);
    try {
      await act(async () => { await Promise.resolve(); });
      expect(document.querySelector('.creator-collaboration-stage[data-status="running"]')).not.toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(document.querySelector('.creator-collaboration-stage[data-status="running"]')).toBeNull();
      expect(document.querySelector('.creator-collaboration-stage[data-status="failed"]')).not.toBeNull();
      const panel = screen.getByRole('complementary', { name: 'OpenCreator' });
      expect(panel).toHaveTextContent('InputImageSensitiveContentDetected.PrivacyInformation');
      expect(panel).toHaveTextContent('Input image may contain real person');
      expect(screen.queryByText('视频生成任务已提交，可以离开当前页面，完成后会保留在项目中')).not.toBeInTheDocument();
      expect(getJob).toHaveBeenCalledTimes(2);
      expect(applyAction).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(getJob).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('shows the persisted provider failure instead of generic network advice in %s', language => {
    const failed = creatorJob({ status: 'failed', state: {
      prompt: 'A cinematic reveal', provider: 'seedance', size: '1280x720', duration: 5,
      currentStep: 1, furthestStep: 1, currentStage: 'generate'
    }, stages: [{
      id: 'failed_stage', jobId: 'creator_video_workspace', stageId: 'generate', executor: 'video',
      status: 'failed', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null,
      attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'submitting', percent: 8 }, errorCode: 'creator_video_upstream_error',
      errorMessage: 'Provider rejected the request with status 400', startedAt: null, finishedAt: null
    }] });
    failed.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('private diagnostic'), 'Video generation failed'),
      scope: { kind: 'creator-job', jobId: failed.id }, stageRunId: 'failed_stage', code: 'creator_video_upstream_error',
      publicFacts: { kind: 'http-rejected', provider: 'seedance', httpStatus: 400,
        upstreamCode: 'InputImageSensitiveContentDetected.SensitiveContent',
        upstreamMessage: 'Reference image was rejected', requestId: 'provider-request-123' }
    }];
    renderWorkspace(failed, { language });
    const panel = screen.getByRole('complementary', { name: 'OpenCreator' });
    expect(panel).toHaveTextContent('HTTP 400');
    expect(panel).toHaveTextContent('InputImageSensitiveContentDetected.SensitiveContent');
    expect(panel).toHaveTextContent('Reference image was rejected');
    expect(panel).toHaveTextContent('provider-request-123');
    expect(panel).not.toHaveTextContent('检查模型服务配置和网络');
    expect(panel).not.toHaveTextContent('尚未确认更细的原因');
  });

  beforeEach(() => {
    let objectUrlCount = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:video-${++objectUrlCount}`)
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
  });

  it('keeps the same video and playback position when session callbacks change', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    const view = renderWorkspace(completedVideoJob(), { openArtifact, children: <TaskRefreshControl /> });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;
    video.currentTime = 2;

    for (let update = 0; update < 3; update += 1) {
      fireEvent.click(screen.getByRole('button', { name: '刷新任务' }));
      view.rerenderWorkspace();
      await act(async () => undefined);
      expect(screen.getByLabelText('生成视频预览')).toBe(video);
      expect(video.src).toBe(source);
      expect(video.currentTime).toBe(2);
    }

    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('updates preview labels without reloading the video when the language changes', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(completedVideoJob(), { openArtifact, children: <LanguageSwitchControls /> });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;
    video.currentTime = 2;

    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    await act(async () => undefined);

    expect(screen.getByLabelText('Generated video preview')).toBe(video);
    expect(video.src).toBe(source);
    expect(video.currentTime).toBe(2);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('uses the latest transport only when the selected result changes', async () => {
    const initialTransport = vi.fn(async () => new Response(new Blob(['initial'])));
    const latestTransport = vi.fn(async () => new Response(new Blob(['latest'])));
    const view = renderWorkspace(completedVideoJob([videoArtifact(1), videoArtifact(2)]), {
      openArtifact: initialTransport
    });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;

    view.rerenderWorkspace({ openArtifact: latestTransport });
    await act(async () => undefined);
    expect(latestTransport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('生成视频预览')).toBe(video);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    await waitFor(() => expect(latestTransport).toHaveBeenCalledWith(
      'creator_video_workspace', 'generated_video_v1'
    ));
    await waitFor(() => expect(screen.getByLabelText('生成视频预览')).not.toHaveAttribute('src', source));
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('discards and releases an outdated preview that completes after a version change', async () => {
    let resolveInitial!: (response: Response) => void;
    const initialRequest = new Promise<Response>(resolve => { resolveInitial = resolve; });
    const openArtifact = vi.fn(async (_jobId: string, artifactId: string) => (
      artifactId === 'generated_video_v2' ? initialRequest : new Response(new Blob(['current']))
    ));
    const view = renderWorkspace(completedVideoJob([videoArtifact(1), videoArtifact(2)]), { openArtifact });
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;

    await act(async () => { resolveInitial(new Response(new Blob(['outdated']))); });

    expect(screen.getByLabelText('生成视频预览')).toBe(video);
    expect(video.src).toBe(source);
    const outdatedSource = vi.mocked(URL.createObjectURL).mock.results.at(-1)!.value;
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(outdatedSource);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(source);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('releases a pending result preview after the workspace is unmounted', async () => {
    let resolvePreview!: (response: Response) => void;
    const pendingPreview = new Promise<Response>(resolve => { resolvePreview = resolve; });
    const view = renderWorkspace(completedVideoJob(), { openArtifact: () => pendingPreview });
    view.unmount();

    await act(async () => { resolvePreview(new Response(new Blob(['video']))); });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      vi.mocked(URL.createObjectURL).mock.results[0]!.value
    );
  });

  it('does not reload the reference image when session callbacks change', async () => {
    const reference = { ...videoArtifact(1), id: 'reference_image', kind: 'reference_image' };
    const job = creatorJob({ artifacts: [reference], state: { referenceImageArtifactId: reference.id } });
    const openArtifact = vi.fn(async () => new Response(new Blob(['reference'], { type: 'image/png' })));
    const view = renderWorkspace(job, { openArtifact });
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));

    view.rerenderWorkspace();
    await act(async () => undefined);

    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('releases a pending reference preview after the workspace is unmounted', async () => {
    const reference = { ...videoArtifact(1), id: 'reference_image', kind: 'reference_image' };
    let resolvePreview!: (response: Response) => void;
    const pendingPreview = new Promise<Response>(resolve => { resolvePreview = resolve; });
    const job = creatorJob({ artifacts: [reference], state: { referenceImageArtifactId: reference.id } });
    const view = renderWorkspace(job, { openArtifact: () => pendingPreview });
    view.unmount();

    await act(async () => { resolvePreview(new Response(new Blob(['reference']))); });

    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      vi.mocked(URL.createObjectURL).mock.results[0]!.value
    );
  });

  it('shows a localized preview failure without retrying on unrelated updates', async () => {
    const openArtifact = vi.fn(async () => new Response('', { status: 404 }));
    const view = renderWorkspace(completedVideoJob(), { openArtifact, children: <LanguageSwitchControls /> });
    const status = view.container.querySelector('.video-result-player-status');
    await waitFor(() => expect(status).toHaveTextContent('视频预览加载失败，可以稍后重试或直接下载'));
    expect(status?.querySelector('.smart-dubbing-spinner')).toBeNull();

    view.rerenderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    await act(async () => undefined);

    expect(status).toHaveTextContent('The video preview failed to load. Retry later or download the file.');
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('shows first-generation waiting feedback without a fake percentage', () => {
    renderWorkspace(runningVideoJob());
    const notice = screen.getByRole('status', { name: '任务进度' });
    expect(notice).toHaveTextContent('视频生成中');
    expect(notice).toHaveTextContent('服务商未提供精确进度');
    expect(notice).toHaveTextContent('已运行');
    expect(notice).toHaveTextContent('最近收到状态');
    expect(notice).not.toHaveTextContent('%');
    expect(screen.getByRole('progressbar', { name: '生成视频进度' })).not.toHaveAttribute('aria-valuenow');
  });

  it.each(['queued', 'running'] as const)('shows waiting feedback while the task is %s', status => {
    renderWorkspace(runningVideoJob({ status, phase: 'queued' }));
    const notice = screen.getByRole('status', { name: '任务进度' });
    expect(notice).toHaveTextContent('任务正在服务商队列中');
    expect(notice).not.toHaveTextContent('%');
    expect(screen.getByRole('progressbar', { name: '生成视频进度' })).toHaveAttribute('data-indeterminate', 'true');
  });

  it('shows the same real progress in the result area and the shared task panel', () => {
    renderWorkspace(runningVideoJob({ percent: 54 }));
    expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('视频生成中 · 54%');
    expect(screen.getByRole('progressbar', { name: '生成视频进度' })).toHaveAttribute('aria-valuenow', '54');
    expect(screen.queryByText(/服务商未提供精确进度/)).not.toBeInTheDocument();
  });

  it('keeps the current video playable during regeneration and switches only when the new version arrives', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(runningVideoJob({ hasResult: true }), { openArtifact, children: <GenerationUpdateControls /> });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;
    video.currentTime = 2;
    expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('服务商未提供精确进度');
    expect(screen.getByText('新版本正在后台生成，可以继续预览和下载当前版本')).toBeVisible();
    expect(screen.getByRole('button', { name: '下载视频' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '更新生成进度' }));
    expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('下载生成的视频 · 90%');
    expect(screen.getByLabelText('生成视频预览')).toBe(video);
    expect(video.src).toBe(source);
    expect(video.currentTime).toBe(2);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '生成完成' }));
    expect(screen.queryByRole('status', { name: '任务进度' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeVisible();
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith('creator_video_workspace', 'generated_video_v2'));
    await waitFor(() => expect(screen.getByLabelText('生成视频预览')).not.toHaveAttribute('src', source));
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('localizes retry feedback and preserves the existing preview across language switches', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(runningVideoJob({ hasResult: true, retrying: true }), { openArtifact, children: <LanguageSwitchControls /> });
    const video = await screen.findByLabelText('生成视频预览');
    expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('正在自动重试（第 2 次）');

    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    const notice = screen.getByRole('status', { name: 'Task progress' });
    expect(notice).toHaveTextContent('Retrying automatically (attempt 2)');
    expect(notice).toHaveTextContent('without submitting another generation task');
    expect(notice).not.toHaveTextContent('%');
    expect(screen.getByLabelText('Generated video preview')).toBe(video);

    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getByRole('status', { name: 'Uppgiftsförlopp' })).not.toHaveTextContent(/\p{Script=Han}/u);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('shows the actual video duration before browser metadata loads instead of the requested duration', async () => {
    const artifact = videoArtifact(1);
    artifact.metadata = { ...artifact.metadata, duration: 13.427, requestedDuration: 5 };
    renderWorkspace(completedVideoJob([artifact]), { openArtifact: async () => new Response(new Blob(['video'])) });

    const video = await screen.findByLabelText('生成视频预览');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:13');
    expect(screen.getByRole('complementary', { name: '任务摘要' })).toHaveTextContent('13.43 秒');
  });

  it('updates the playback clock from browser metadata, time updates, and seeks without reloading the video', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(completedVideoJob(), { openArtifact });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;
    Object.defineProperty(video, 'duration', { configurable: true, value: 8.33 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:08');

    video.currentTime = 3.7;
    fireEvent.timeUpdate(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:03 / 00:08');
    video.currentTime = 6;
    fireEvent.seeked(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:06 / 00:08');
    Object.defineProperty(video, 'duration', { configurable: true, value: 9.8 });
    fireEvent.durationChange(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:06 / 00:09');
    expect(screen.getByLabelText('生成视频预览')).toBe(video);
    expect(video.src).toBe(source);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('does not invent a zero duration for invalid metadata (%s)', async invalidDuration => {
    const artifact = videoArtifact(1);
    artifact.metadata = { ...artifact.metadata, duration: invalidDuration, requestedDuration: 10 };
    renderWorkspace(completedVideoJob([artifact]), { openArtifact: async () => new Response(new Blob(['video'])) });
    const video = await screen.findByLabelText('生成视频预览');
    Object.defineProperty(video, 'duration', { configurable: true, value: invalidDuration });
    fireEvent.loadedMetadata(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / --:--');

    Object.defineProperty(video, 'duration', { configurable: true, value: 7.5 });
    fireEvent.durationChange(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:07');
    Object.defineProperty(video, 'duration', { configurable: true, value: invalidDuration });
    fireEvent.durationChange(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:07');
  });

  it('resets playback timing when a different result version is selected', async () => {
    renderWorkspace(completedVideoJob([videoArtifact(1), videoArtifact(2)]), {
      openArtifact: async () => new Response(new Blob(['video']))
    });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    Object.defineProperty(video, 'duration', { configurable: true, value: 8 });
    video.currentTime = 6;
    fireEvent.timeUpdate(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:06 / 00:08');

    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    await waitFor(() => expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:05'));
  });

  it('keeps timing and the video node stable across language switches', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(completedVideoJob(), { openArtifact, children: <LanguageSwitchControls /> });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    video.currentTime = 2;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    expect(screen.getByText('Position / duration')).toBeVisible();
    expect(screen.getByLabelText('Playback time')).toHaveTextContent('00:02 / 00:05');
    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getByText('Position / längd')).toBeVisible();
    expect(screen.getByLabelText('Uppspelningstid')).toHaveTextContent('00:02 / 00:05');
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('opens an existing project on the latest generated video version', async () => {
    const versionOne = videoArtifact(1);
    const versionTwo = videoArtifact(2);
    const job = creatorJob({
      status: 'completed',
      artifacts: [versionOne, versionTwo],
      state: {
        prompt: '当前编辑中的视频描述',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 1,
        furthestStep: 2,
        currentStage: 'generate',
        resultVersion: 2,
        latestResultVersion: 2,
        resultSnapshots: [
          resultSnapshot(1, versionOne),
          resultSnapshot(2, versionTwo)
        ]
      }
    });
    const openArtifact = vi.fn(async () => new Response(
      new Blob(['video'], { type: 'video/mp4' })
    ));

    renderWorkspace(job, { openArtifact });

    expect(await screen.findByRole('heading', { name: '生成结果' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, versionTwo.id));
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, versionOne.id));
  });

  it('does not expose a failed generation as a completed result version', () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'veo',
        size: '720x1280',
        duration: 8,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          phase: 'provider_failed',
          percent: null
        },
        errorCode: 'creator_video_generation_failed',
        errorMessage: 'The provider rejected the prompt',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    renderWorkspace(job);

    expect(screen.getByRole('heading', { name: '生成视频' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /项目 V/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始生成' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent('视频生成未完成，请检查模型服务配置后重试');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('The provider rejected the prompt')).not.toBeInTheDocument();
  });

  it('shows an actionable message when the selected model is not enabled', () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_model_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          phase: 'submitting',
          percent: 8
        },
        errorCode: 'creator_video_model_unavailable',
        errorMessage: 'Your account has not activated the model doubao-seedance-2-5',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    renderWorkspace(job, {
      openArtifact: vi.fn(async () => new Response(
        new Blob(['reference'], { type: 'image/png' })
      ))
    });

    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent(
      '当前账号未开通 Seedance 2.5，请切换模型版本或前往方舟控制台开通'
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers to continue an existing upstream task after a refresh failure', () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '让猫开始打字',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_refresh_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          phase: 'generating',
          percent: null,
          videoGenerationResultId: 'video_result_1234'
        },
        errorCode: 'creator_video_upstream_error',
        errorMessage: 'The video generation status could not be refreshed',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    renderWorkspace(job);

    expect(screen.getByRole('button', { name: '继续任务' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始生成' })).not.toBeInTheDocument();
  });

  it('shows that Seedance reference-image generation follows the image ratio', async () => {
    const reference = videoArtifact(1);
    reference.id = 'reference_image_1';
    reference.kind = 'reference_image';
    reference.path = '/tmp/reference.png';
    reference.metadata = {
      fileName: 'reference.png',
      mimeType: 'image/png',
      size: 1024
    };
    const job = creatorJob({
      artifacts: [reference],
      state: {
        prompt: '让猫开始打字',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: reference.id,
        currentStep: 1,
        furthestStep: 1,
        currentStage: null
      }
    });

    const openArtifact = vi.fn(async () => new Response(
      new Blob(['reference'], { type: 'image/png' })
    ));
    renderWorkspace(job, { openArtifact });

    const format = screen.getByRole('combobox', { name: '画幅' });
    expect(format).toBeDisabled();
    expect(format).toHaveTextContent('跟随参考图');
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, reference.id));
  });

  it('uses distinct English labels for video format and output format', () => {
    const job = creatorJob({
      state: {
        prompt: 'A cinematic city reveal',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: null
      }
    });

    renderWorkspace(job, { language: 'en-US' });

    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByText('Output format')).toBeInTheDocument();
  });

  it('preserves user selections when service defaults arrive late', async () => {
    let resolveConfig!: (value: CreatorServicesConfigResponse) => void;
    const pendingConfig = new Promise<CreatorServicesConfigResponse>(resolve => { resolveConfig = resolve; });
    renderWorkspace(creatorJob({ state: {
      provider: 'seedance', model: 'doubao-seedance-2-0-260128',
      duration: 5, currentStep: 1, furthestStep: 1
    } }), { creatorServicesService: { getConfig: () => pendingConfig } });
    const provider = screen.getByRole('combobox', { name: '视频服务' });
    const model = screen.getByRole('combobox', { name: '模型版本' });
    const duration = screen.getByRole('combobox', { name: '视频时长' });
    fireEvent.change(provider, { target: { value: 'veo' } });
    fireEvent.change(duration, { target: { value: '8' } });
    await act(async () => { resolveConfig({ config: createVideoConfig(), configuredCredentials: [] }); });
    expect(provider).toHaveValue('veo');
    expect(model).toHaveValue('veo-3.1-generate-preview');
    expect(duration).toHaveValue('8');
  });

  it('uses the configured default model for a task and allows a task-level override', async () => {
    const job = creatorJob({
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 1,
        furthestStep: 1,
        currentStage: null
      }
    });
    const getConfig = vi.fn(async (): Promise<CreatorServicesConfigResponse> => ({
      config: {
        ...createVideoConfig(),
        video: {
          ...createVideoConfig().video,
          provider: 'seedance',
          seedance: {
            ...createVideoConfig().video.seedance,
            model: 'doubao-seedance-2-0-260128'
          }
        }
      },
      configuredCredentials: []
    }));

    renderWorkspace(job, {
      creatorServicesService: { getConfig } as never
    });

    const model = await screen.findByRole('combobox', { name: '模型版本' });
    await waitFor(() => expect(model).toHaveValue('doubao-seedance-2-0-260128'));
    fireEvent.change(model, { target: { value: 'doubao-seedance-2-5-260628' } });
    expect(model).toHaveValue('doubao-seedance-2-5-260628');
  });
});

function renderWorkspace(
  initialJob: CreatorJob,
  overrides: {
    openArtifact?: (jobId: string, artifactId: string) => Promise<Response>;
    creatorServicesService?: { getConfig(): Promise<CreatorServicesConfigResponse> };
    language?: 'zh-CN' | 'en-US' | 'sv-SE';
    children?: ReactNode;
    gatewayState?: GatewayAccountState | null;
  } = {}
) {
  const workspace = (options: typeof overrides) => (
    <LanguageProvider initialPreference={options.language ?? 'zh-CN'}>
      <CreatorSessionProvider
        initialJob={initialJob}
        onPreJobFailure={() => undefined}
        service={{
          applyAction: vi.fn(async (_id, request) => ({
            job: { ...initialJob, revision: initialJob.revision + 1, state: { ...initialJob.state, ...(request.action === 'select-result-version' ? { resultVersion: request.input.version } : request.input.patch) } },
            receipt: {}
          })),
          openArtifact: options.openArtifact ?? vi.fn(),
          runAgentTurn: vi.fn()
        } as never}
      >
        <OfficialServicesContext.Provider value={options.gatewayState}>
        <VideoGenerationWorkspace
          creatorServicesService={options.creatorServicesService as never}
          onBack={vi.fn()}
        />
        {options.children}
        </OfficialServicesContext.Provider>
      </CreatorSessionProvider>
    </LanguageProvider>
  );
  const view = render(workspace(overrides));
  return {
    ...view,
    rerenderWorkspace(patch: typeof overrides = {}) {
      view.rerender(workspace({ ...overrides, ...patch }));
    }
  };
}

function completedVideoJob(artifacts = [videoArtifact(1)]): CreatorJob {
  return creatorJob({
    status: 'completed',
    artifacts,
    state: {
      currentStep: 2,
      furthestStep: 2,
      resultVersion: artifacts.at(-1)!.version,
      resultSnapshots: artifacts.map(artifact => resultSnapshot(artifact.version, artifact))
    }
  });
}

function TaskRefreshControl() {
  const session = useCreatorSession();
  return <button type="button" onClick={() => session.applyRemoteSnapshot({
    ...session.job,
    revision: session.job.revision + 1,
    artifacts: session.job.artifacts.map(artifact => ({ ...artifact })),
    state: { ...session.state }
  })}>刷新任务</button>;
}

function runningVideoJob(options: {
  hasResult?: boolean;
  phase?: string;
  percent?: number;
  status?: CreatorStageRun['status'];
  retrying?: boolean;
} = {}): CreatorJob {
  const job = options.hasResult ? completedVideoJob() : creatorJob({ state: { currentStep: 2, furthestStep: 2 } });
  return {
    ...job,
    status: 'running',
    stages: [{
      id: 'running_video_stage', jobId: job.id, stageId: 'generate', executor: 'video',
      status: options.status ?? 'running', dispatchStatus: 'claimed', claimOwner: null,
      claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: {
        phase: options.phase ?? 'generating', percent: options.percent ?? null,
        ...(options.retrying ? { refreshRetry: 2, message: 'The provider status connection was interrupted and will be retried' } : {})
      },
      errorCode: null, errorMessage: null,
      startedAt: options.status === 'queued' ? null : new Date().toISOString(), finishedAt: null
    }]
  };
}

function GenerationUpdateControls() {
  const session = useCreatorSession();
  function update(completed: boolean) {
    const artifact = videoArtifact(2);
    session.applyRemoteSnapshot({
      ...session.job,
      revision: session.job.revision + 1,
      status: completed ? 'completed' : 'running',
      artifacts: completed ? [...session.job.artifacts, artifact] : session.job.artifacts,
      state: completed ? { ...session.state, resultVersion: 2, resultSnapshots: [
        ...(session.state.resultSnapshots as CreatorJson[]), resultSnapshot(2, artifact)
      ] } : session.state,
      stages: session.job.stages.map(stage => ({ ...stage, status: completed ? 'succeeded' : 'running', progress: {
        phase: completed ? 'completed' : 'downloading', percent: completed ? 100 : 90
      } }))
    });
  }
  return <>
    <button type="button" onClick={() => update(false)}>更新生成进度</button>
    <button type="button" onClick={() => update(true)}>生成完成</button>
  </>;
}

function createVideoConfig() {
  return {
    proxy: '',
    llm: {
      baseUrl: '',
      apiKey: '',
      model: 'gpt-4o-mini',
      jsonMode: false,
      source: 'codex' as const
    },
    transcription: {
      provider: 'openai' as const,
      enableGpuAcceleration: false,
      openai: { baseUrl: '', apiKey: '', model: 'whisper-1' },
      fasterWhisper: { model: 'medium' as const },
      whisperKit: { model: 'large-v2' as const },
      whisperCpp: { model: 'tiny' as const },
      aliyun: {
        oss: { accessKeyId: '', accessKeySecret: '', bucket: '', region: 'cn-shanghai', endpoint: '' },
        speech: { accessKeyId: '', accessKeySecret: '', appKey: '' }
      },
      volcengine: {
        appId: '',
        accessToken: '',
        resourceId: 'volc.seedasr.auc',
        baseUrl: 'https://openspeech.bytedance.com'
      },
      funasr: { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '', model: 'sensevoice', timeoutMs: 120000 }
    },
    tts: {
      provider: 'openai' as const,
      openai: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' },
      minimax: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' },
      aliyun: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' },
      volcengine: {
        baseUrl: 'https://openspeech.bytedance.com',
        accessToken: '',
        model: 'volcano_tts',
        defaultVoiceId: 'BV001_streaming',
        appId: ''
      }
    },
    image: {
      provider: 'openai' as const,
      openai: { baseUrl: '', apiKey: '', model: '' },
      jimeng: { baseUrl: '', apiKey: '', model: '' },
      kling: { baseUrl: '', accessKey: '', secretKey: '', model: '' },
      gemini: { baseUrl: '', apiKey: '', model: '' },
      codexNative: {}
    },
    video: {
      provider: 'seedance' as const,
      seedance: { baseUrl: '', apiKey: '', model: 'doubao-seedance-2-5-260628' },
      kling: { baseUrl: '', accessKey: '', secretKey: '', model: 'kling-v2-1-master' },
      veo: { baseUrl: '', apiKey: '', model: 'veo-3.1-generate-preview' }
    }
  };
}

function creatorJob(patch: Partial<CreatorJob>): CreatorJob {
  const createdAt = '2026-09-07T08:00:00.000Z';
  return {
    id: 'creator_video_workspace',
    projectId: 'project_1',
    templateId: 'video-generation',
    templateVersion: 1,
    status: 'draft',
    revision: 1,
    presetOrigin: null,
    state: {
      prompt: '',
      provider: 'seedance',
      size: '1280x720',
      duration: 5,
      referenceImageArtifactId: null,
      currentStep: 0,
      furthestStep: 0,
      currentStage: null
    },
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

function videoArtifact(version: number): CreatorArtifact {
  return {
    id: `generated_video_v${version}`,
    jobId: 'creator_video_workspace',
    kind: 'generated_video',
    version,
    status: 'completed',
    path: `/tmp/generated-video-v${version}.mp4`,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      provider: version === 1 ? 'seedance' : 'veo',
      model: version === 1 ? 'seedance-model' : 'veo-model',
      videoSize: version === 1 ? '1280x720' : '720x1280',
      requestedDuration: version === 1 ? 5 : 8,
      duration: version === 1 ? 5 : 8,
      fileName: `OpenCreator-video-V${version}.mp4`,
      mimeType: 'video/mp4',
      bytes: version * 1024,
      resultVersion: version
    },
    createdAt: `2026-09-07T08:0${version}:00.000Z`
  };
}

function resultSnapshot(
  version: number,
  artifact: CreatorArtifact
): CreatorJson {
  return {
    version,
    createdAt: artifact.createdAt,
    action: 'stage-succeeded',
    stageId: 'generate',
    description: version === 1 ? '初次生成' : `第 ${version} 次生成`,
    artifactRefs: { generated_video: [artifact.id] },
    changedArtifactIds: [artifact.id],
    staleArtifactIds: [],
    state: {
      prompt: version === 1 ? '海岸公路' : '雨夜城市',
      provider: version === 1 ? 'seedance' : 'veo',
      size: version === 1 ? '1280x720' : '720x1280',
      duration: version === 1 ? 5 : 8,
      referenceImageArtifactId: null
    }
  };
}
