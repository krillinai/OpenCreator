import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { loadLanguageCatalog } from '../../i18n/translated-copy.js';
import DashboardGenerationHistory from './DashboardGenerationHistory.js';
import { generationHistoryTypeForWorkspace } from './generation-history-type.js';

const createObjectURL = vi.fn(() => 'blob:generation-preview');
const revokeObjectURL = vi.fn();
let createObjectURLDescriptor: PropertyDescriptor | undefined;
let revokeObjectURLDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
});

afterEach(() => {
  vi.useRealTimers();
  if (createObjectURLDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectURLDescriptor);
  if (revokeObjectURLDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectURLDescriptor);
});

describe('DashboardGenerationHistory', () => {
  it.each([
    ['zh-CN', '生成记录加载失败，请稍后重试。', '重试'],
    ['en-US', 'Could not load generation history. Try again later.', 'Retry']
  ] as const)('times out a stalled history request and allows retry in %s', async (language, error, retry) => {
    vi.useFakeTimers();
    const listJobs = vi.fn((_projectId?: string, options?: { signal?: AbortSignal }) =>
      new Promise<{ jobs: CreatorJob[] }>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      }));
    const view = render(<LanguageProvider initialPreference={language}><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs, openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    /></LanguageProvider>);

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(listJobs).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(listJobs.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    listJobs.mockResolvedValueOnce({ jobs: [] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: retry })); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.unmount();
  });

  it('cancels the previous project request and ignores its late response', async () => {
    let finishPrevious!: (response: { jobs: CreatorJob[] }) => void;
    const listJobs = vi.fn((_projectId?: string, _options?: { signal?: AbortSignal }) =>
      Promise.resolve({ jobs: [generationJobs()[1]!] }))
      .mockImplementationOnce(() => new Promise(resolve => { finishPrevious = resolve; }));
    const service = { listJobs, openArtifact: vi.fn(async () => new Response(new Blob(['video']))) };
    const view = render(<DashboardGenerationHistory
      projectId="project_1" service={service} onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    />);

    view.rerender(<DashboardGenerationHistory
      projectId="project_2" service={service} onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    />);
    expect(await screen.findByText(/city\.mp4/)).toBeInTheDocument();
    await act(async () => { finishPrevious({ jobs: [generationJobs()[0]!] }); });

    expect(listJobs.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(screen.getByText(/city\.mp4/)).toBeInTheDocument();
    expect(screen.queryByText(/product\.png/)).not.toBeInTheDocument();
    const currentSignal = listJobs.mock.calls[1]?.[1]?.signal;
    expect(currentSignal?.aborted).toBe(false);
    view.unmount();
    expect(currentSignal?.aborted).toBe(false);
  });

  it('aborts an in-flight history request on unmount', () => {
    const listJobs = vi.fn((_projectId?: string, options?: { signal?: AbortSignal }) =>
      new Promise<{ jobs: CreatorJob[] }>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      }));
    const view = render(<DashboardGenerationHistory
      projectId="project_1" service={{ listJobs, openArtifact: vi.fn() }}
      onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    />);

    view.unmount();

    expect(listJobs.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('keeps loaded history visible when a background refresh fails', async () => {
    vi.useFakeTimers();
    const listJobs = vi.fn(async () => ({ jobs: generationJobs() }))
      .mockResolvedValueOnce({ jobs: generationJobs() }).mockRejectedValue(new Error('offline'));
    const view = render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs, openArtifact: vi.fn(async () => new Response(new Blob(['media']))) }}
      onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText(/product\.png/)).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(screen.getByRole('alert')).toHaveTextContent('生成记录加载失败，请稍后重试。');
    expect(screen.getByText(/product\.png/)).toBeInTheDocument();
    expect(screen.getByText(/city\.mp4/)).toBeInTheDocument();
    view.unmount();
  });

  it('maps creator entries to their generation type and defaults to all', () => {
    expect(generationHistoryTypeForWorkspace('video-translation')).toBe('video');
    expect(generationHistoryTypeForWorkspace('transcription')).toBe('video');
    expect(generationHistoryTypeForWorkspace('image-generation')).toBe('image');
    expect(generationHistoryTypeForWorkspace('short-video-script')).toBe('text');
    expect(generationHistoryTypeForWorkspace('smart-dubbing')).toBe('audio');
    expect(generationHistoryTypeForWorkspace()).toBe('all');
  });

  it('shows only the load error when history cannot be fetched', async () => {
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => { throw new Error('runtime unavailable'); }), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    />);

    expect(await screen.findByRole('alert')).toHaveTextContent('生成记录加载失败，请稍后重试。');
    expect(screen.queryByText('还没有生成记录')).not.toBeInTheDocument();
  });

  it('filters image and video jobs by task type and downloads an artifact', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const onBackCreation = vi.fn();
    const onOpenJob = vi.fn();
    render(<LanguageProvider initialPreference="zh-CN"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: generationJobs() })), openArtifact }}
      onBackCreation={onBackCreation}
      onOpenJob={onOpenJob}
    /></LanguageProvider>);

    expect(await screen.findByText(/product\.png/)).toBeInTheDocument();
    expect(screen.getByText(/city\.mp4/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '当前工具' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '全部历史' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('img', { name: 'product.png' })).toHaveAttribute('src', 'blob:generation-preview');
    fireEvent.click(screen.getByRole('button', { name: '打开项目编辑区 · 图像生成' }));
    expect(onOpenJob).toHaveBeenCalledWith(generationJobs()[0]);

    fireEvent.click(screen.getByRole('button', { name: 'image' }));
    expect(screen.getByText(/product\.png/)).toBeInTheDocument();
    expect(screen.queryByText(/city\.mp4/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'video' }));
    expect(screen.queryByText(/product\.png/)).not.toBeInTheDocument();
    expect(screen.getByText(/city\.mp4/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: '下载 product.png' }));
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith('job_image', 'artifact_image'));
    expect(click).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('tab', { name: '创作' }));
    expect(onBackCreation).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('groups outputs by newest date and shows running progress', async () => {
    const jobs = generationJobs();
    jobs[0]!.stages = [{
      id: 'stage_running', jobId: 'job_image', stageId: 'generate', executor: 'image', status: 'running', dispatchStatus: 'claimed',
      claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'generating', percent: 45, message: 'Generating image' }, errorCode: null, errorMessage: null,
      startedAt: '2026-11-07T10:00:00.000Z', finishedAt: null
    }];
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs })), openArtifact: vi.fn(async () => new Response(new Blob(['image']))) }}
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    />);

    expect(await screen.findByText('45%')).toBeInTheDocument();
    expect(document.querySelector('.dashboard-generation-running-card.dashboard-generation-result-card')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '正在生成 图像生成' })).toHaveTextContent('Generating image');
    expect(document.querySelector('.dashboard-generation-history-date > h2')).toHaveTextContent('2026年11月7日');
    expect(document.querySelector('.dashboard-generation-history-date .dashboard-generation-running-card')).toBeInTheDocument();
    expect(screen.queryByText('还没有生成记录')).not.toBeInTheDocument();
    const dates = [...document.querySelectorAll('.dashboard-generation-history-date > h2')].map(item => item.textContent);
    expect(dates).toEqual(['2026年11月7日', '2026年11月6日']);
    fireEvent.click(screen.getByRole('button', { name: 'video' }));
    expect(document.querySelector('.dashboard-generation-running-card')).not.toBeInTheDocument();
  });

  it.each([
    ['zh-CN', '视频翻译已完成，正在等待原视频'],
    ['en-US', 'Translation complete; waiting for the source video'],
    ['sv-SE', 'Översättningen är klar; väntar på originalvideon']
  ] as const)('shows translation progress instead of parallel source download progress in %s', async (language, waitingMessage) => {
    const translation = job('job_parallel_translation', 'video-translation', []);
    translation.status = 'running';
    translation.state = { sourceType: 'url', sourceUrl: 'https://youtu.be/parallel', dubbing: false, composeVideo: false };
    const subtitle: CreatorJob['stages'][number] = {
      id: 'subtitle_parallel', jobId: translation.id, stageId: 'subtitle', executor: 'krillinai',
      status: 'running', dispatchStatus: 'claimed', claimOwner: null, claimExpiresAt: null,
      attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { workflow: true, phase: 'translating_subtitles', percent: 72 },
      errorCode: null, errorMessage: null, startedAt: '2026-11-15T11:00:00.000Z', finishedAt: null
    };
    const source: CreatorJob['stages'][number] = {
      ...subtitle, id: 'source_parallel', stageId: 'preview-source-video', executor: 'download',
      progress: { backgroundSourceDownload: true, workflowParentStageRunId: subtitle.id,
        phase: 'normalizing_media', percent: 99 }
    };
    translation.stages = [subtitle, source];
    const service = { listJobs: vi.fn(async () => ({ jobs: [translation] })), openArtifact: vi.fn() };
    const view = render(<LanguageProvider initialPreference={language}><DashboardGenerationHistory
      projectId="project_1" service={service} initialType="video"
      onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    /></LanguageProvider>);

    const card = (await screen.findByText('72%')).closest('.dashboard-generation-running-card');
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent('72%');
    expect(card).not.toHaveTextContent('99%');

    const completedTranslation = { ...translation, status: 'completed' as const, stages: [
      { ...subtitle, status: 'succeeded' as const, progress: { ...subtitle.progress, percent: 100 } }, source
    ] };
    view.rerender(<LanguageProvider initialPreference={language}><DashboardGenerationHistory
      projectId="project_1" service={{ ...service, listJobs: vi.fn(async () => ({ jobs: [completedTranslation] })) }}
      initialType="video" onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    /></LanguageProvider>);
    await waitFor(() => expect(card).toHaveTextContent('99%'));
    expect(card).toHaveTextContent(waitingMessage);
  });

  it('continues to show translation progress when the source video finishes first', async () => {
    const translation = job('job_source_finished_first', 'video-translation', []);
    translation.status = 'running';
    translation.state = { sourceType: 'url', dubbing: false, composeVideo: false };
    const subtitle: CreatorJob['stages'][number] = {
      id: 'subtitle_running', jobId: translation.id, stageId: 'subtitle', executor: 'krillinai',
      status: 'running', dispatchStatus: 'claimed', claimOwner: null, claimExpiresAt: null,
      attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { workflow: true, phase: 'translating_subtitles', percent: 72 },
      errorCode: null, errorMessage: null, startedAt: '2026-11-15T11:00:00.000Z', finishedAt: null
    };
    translation.stages = [subtitle, {
      ...subtitle, id: 'source_done', stageId: 'preview-source-video', executor: 'download',
      status: 'succeeded', dispatchStatus: 'finished', finishedAt: '2026-11-15T11:04:00.000Z',
      progress: { backgroundSourceDownload: true, workflowParentStageRunId: subtitle.id,
        phase: 'completed', percent: 100 }
    }];
    render(<LanguageProvider initialPreference="en-US"><DashboardGenerationHistory
      projectId="project_1" initialType="video"
      service={{ listJobs: vi.fn(async () => ({ jobs: [translation] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    /></LanguageProvider>);

    const card = await screen.findByRole('status', { name: 'Generating Video Translation' });
    expect(card).toHaveTextContent('72%');
    expect(card).not.toHaveTextContent('100%');
  });

  it('keeps the workflow percentage while later translation stages wait for the source video', async () => {
    const translation = job('job_translation_waiting_for_source', 'video-translation', []);
    translation.status = 'running';
    translation.state = { sourceType: 'url', dubbing: true, composeVideo: true, videoFormat: 'horizontal' };
    const subtitle: CreatorJob['stages'][number] = {
      id: 'subtitle_done', jobId: translation.id, stageId: 'subtitle', executor: 'krillinai',
      status: 'succeeded', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null,
      attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { workflow: true, phase: 'completed', percent: 100 },
      errorCode: null, errorMessage: null, startedAt: '2026-11-15T11:00:00.000Z',
      finishedAt: '2026-11-15T11:05:00.000Z'
    };
    translation.stages = [subtitle, {
      ...subtitle, id: 'source_running', stageId: 'preview-source-video', executor: 'download',
      status: 'running', dispatchStatus: 'claimed', finishedAt: null,
      progress: { backgroundSourceDownload: true, workflowParentStageRunId: subtitle.id,
        phase: 'normalizing_media', percent: 99 }
    }];
    render(<LanguageProvider initialPreference="en-US"><DashboardGenerationHistory
      projectId="project_1" initialType="video"
      service={{ listJobs: vi.fn(async () => ({ jobs: [translation] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    /></LanguageProvider>);

    const card = await screen.findByRole('status', { name: 'Generating Video Translation' });
    expect(card).toHaveTextContent('33%');
    expect(card).not.toHaveTextContent('Translation complete; waiting for the source video');
  });

  it.each([
    ['zh-CN', '正在生成', '正在生成图片'],
    ['en-US', 'Generating', 'Generating image'],
    ['sv-SE', 'Genererar', 'Skapar bild']
  ] as const)('does not show the image submission milestone as generation progress in %s', async (language, status, message) => {
    const image = job('job_image_waiting', 'image-generation', []);
    image.status = 'running';
    image.state = { prompt: 'Moon' };
    image.stages = [{
      id: 'stage_image_waiting', jobId: image.id, stageId: 'generate', executor: 'image', status: 'running',
      dispatchStatus: 'claimed', claimOwner: null, claimExpiresAt: null, attempt: 1,
      idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'generating_candidates', percent: 10, completed: 0, failed: 0, total: 1 },
      errorCode: null, errorMessage: null, startedAt: '2026-11-15T11:02:13.456Z', finishedAt: null
    }];

    render(<LanguageProvider initialPreference={language}><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [image] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    /></LanguageProvider>);

    const card = await screen.findByRole('status', { name: `${status} Moon` });
    expect(card).toHaveTextContent(message);
    expect(card).not.toHaveTextContent('10%');
  });

  it('shows a newly completed video before an older pending project', async () => {
    const completed = job('job_completed_video', 'video-generation', [
      artifact('job_completed_video', 'artifact_completed_video', 'generated_video', 'today.mp4', '2026-11-11T06:19:25.489Z')
    ]);
    completed.state = { prompt: 'Moon video' };
    const pending = job('job_pending_video', 'video-generation', []);
    pending.status = 'draft';
    pending.state = { prompt: 'Older draft' };
    pending.createdAt = '2026-11-10T08:16:36.619Z';
    render(<LanguageProvider initialPreference="en-US"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [completed, pending] })), openArtifact: vi.fn(async () => new Response(new Blob(['video']))) }}
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    /></LanguageProvider>);

    expect(await screen.findByText(/today\.mp4/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pending setup Older draft' })).toBeInTheDocument();
    const dates = [...document.querySelectorAll('.dashboard-generation-history-date > h2')].map(item => item.textContent);
    expect(dates).toEqual(['November 11, 2026', 'November 10, 2026']);
  });

  it('excludes a persisted empty video draft with an old edit flag from generation history', async () => {
    const empty = job('job_empty_video_with_old_flag', 'video-generation', []);
    empty.status = 'draft';
    empty.state = {
      prompt: '', provider: 'seedance', size: '1280x720', duration: 5,
      referenceImageArtifactId: null, currentStage: null,
      videoServiceSource: 'gateway', officialModels: { video: 'veo-3.1' },
      __creatorUserEdited: true
    };
    const completed = job('job_completed_video', 'video-generation', [
      artifact('job_completed_video', 'artifact_completed_video', 'generated_video', 'completed.mp4', '2026-11-15T01:00:00.000Z')
    ]);

    render(<LanguageProvider initialPreference="en-US"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [empty, completed] })), openArtifact: vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' }))) }}
      initialType="video"
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    /></LanguageProvider>);

    expect(await screen.findByText(/completed\.mp4/)).toBeInTheDocument();
    expect(document.querySelectorAll('.dashboard-generation-result-card')).toHaveLength(1);
  });

  it('does not show an old failure beside the output of a completed translation', async () => {
    const completed = job('job_retried_translation', 'video-translation', [
      artifact('job_retried_translation', 'artifact_source', 'source_video', 'source.mp4', '2026-11-14T10:00:00.000Z')
    ]);
    completed.state.sourceUrl = 'https://www.youtube.com/watch?v=example';
    const failedStage = {
      id: 'subtitle_failed', jobId: completed.id, stageId: 'subtitle', executor: 'krillinai',
      status: 'failed' as const, dispatchStatus: 'finished' as const,
      claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null,
      scopeKey: null, inputFingerprint: null, progress: { phase: 'failed' },
      errorCode: 'platform_caption_access_failed', errorMessage: 'Connection timed out',
      startedAt: '2026-11-14T09:00:00.000Z', finishedAt: '2026-11-14T09:01:00.000Z'
    };
    completed.stages = [failedStage, {
      ...failedStage, id: 'subtitle_retry', status: 'succeeded', attempt: 2,
      errorCode: null, errorMessage: null, progress: { phase: 'completed' },
      startedAt: '2026-11-14T09:02:00.000Z', finishedAt: '2026-11-14T09:03:00.000Z'
    }];
    const onOpenJob = vi.fn();
    render(<LanguageProvider initialPreference="en-US"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [completed] })), openArtifact: vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' }))) }}
      initialType="video"
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    /></LanguageProvider>);

    const output = await screen.findByRole('link', { name: 'Open youtube.com' });
    expect(output).toHaveTextContent('source.mp4');
    expect(screen.queryByRole('link', { name: 'Generation failed youtube.com' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.dashboard-generation-result-card')).toHaveLength(1);
    fireEvent.click(output);
    expect(onOpenJob).toHaveBeenCalledOnce();
    expect(onOpenJob).toHaveBeenCalledWith(completed);
  });

  it('shows one task card when a translation fails after its source video is saved', async () => {
    const translation = job('job_translation_with_source', 'video-translation', [
      artifact('job_translation_with_source', 'artifact_source', 'source_video', 'source.mp4', '2026-11-15T11:14:42.000Z')
    ]);
    translation.status = 'needs_input';
    translation.state.sourceUrl = 'https://www.youtube.com/watch?v=example';
    translation.stages = [{
      id: 'subtitle_failed', jobId: translation.id, stageId: 'subtitle', executor: 'krillinai',
      status: 'failed', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null,
      attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'failed' }, errorCode: 'translation_failed', errorMessage: 'Translation failed',
      startedAt: '2026-11-15T11:14:43.000Z', finishedAt: '2026-11-15T11:15:00.000Z'
    }];
    const onOpenJob = vi.fn();
    render(<LanguageProvider initialPreference="en-US"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [translation] })), openArtifact: vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' }))) }}
      initialType="video"
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    /></LanguageProvider>);

    const card = await screen.findByRole('link', { name: 'Generation failed youtube.com' });
    expect(document.querySelectorAll('.dashboard-generation-result-card')).toHaveLength(1);
    fireEvent.click(card);
    expect(onOpenJob).toHaveBeenCalledWith(translation);
  });

  it('uses an uploaded reference image as a pending video generation cover', async () => {
    const videoJob = job('job_reference_video', 'video-generation', [
      artifact('job_reference_video', 'reference_photo', 'reference_image', 'reference.png', '2026-11-11T06:19:25.489Z')
    ]);
    videoJob.status = 'draft';
    videoJob.state = { prompt: 'A coast at dusk', referenceImageArtifactId: 'reference_photo' };
    const openArtifact = vi.fn(async () => new Response(new Blob(['reference'], { type: 'image/png' })));
    const rendered = render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [videoJob] })), openArtifact }}
      initialType="video"
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    />);

    const card = await screen.findByRole('link', { name: '待配置 A coast at dusk' });
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(videoJob.id, 'reference_photo'));
    await waitFor(() => expect(card.querySelector('img')).toHaveAttribute('src', 'blob:generation-preview'));
    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:generation-preview');
  });

  it('shows failed jobs without artifacts and opens the job details', async () => {
    const failedJob = job('job_failed', 'auto-clip', []);
    failedJob.status = 'failed';
    failedJob.state.sourceUrl = 'https://www.youtube.com/watch?v=failed';
    failedJob.stages = [{
      id: 'stage_failed', jobId: failedJob.id, stageId: 'clip', executor: 'krillinai', status: 'failed', dispatchStatus: 'finished',
      claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'collecting_outputs', percent: 44, message: '正在整理字幕和视频产物' },
      errorCode: 'usage', errorMessage: 'video is shorter than the minimum clip duration',
      startedAt: '2026-11-07T10:00:00.000Z', finishedAt: '2026-11-07T10:01:00.000Z'
    }];
    const onOpenJob = vi.fn();
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [failedJob] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    const card = await screen.findByRole('link', { name: '生成失败 youtube.com' });
    expect(card).toHaveTextContent('video is shorter than the minimum clip duration');
    expect(screen.queryByText('还没有生成记录')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开 youtube.com' }));
    expect(onOpenJob).toHaveBeenCalledWith(failedJob);
  });

  it('summarizes simultaneous video translation connection failures without raw yt-dlp output', async () => {
    const failedJob = job('job_translation_timeout', 'video-translation', []);
    failedJob.status = 'failed';
    failedJob.state.sourceUrl = 'https://www.youtube.com/watch?v=timeout';
    const stage = {
      id: 'subtitle_failed', jobId: failedJob.id, stageId: 'subtitle', executor: 'krillinai', status: 'failed' as const,
      dispatchStatus: 'finished' as const, claimOwner: null, claimExpiresAt: null, attempt: 1,
      idempotencyKey: null, scopeKey: null, inputFingerprint: null, progress: { phase: 'failed', percent: 1 },
      errorCode: 'platform_caption_access_failed',
      errorMessage: 'downloadYouTubeSubtitle: yt-dlp subtitle metadata error: [Errno 60] Operation timed out',
      startedAt: '2026-11-14T01:00:00.000Z', finishedAt: '2026-11-14T01:01:00.000Z'
    };
    failedJob.stages = [stage, { ...stage, id: 'preview_failed', stageId: 'preview-source-video', executor: 'download',
      errorCode: 'network_unavailable', errorMessage: 'yt-dlp connection to the video platform timed out.' }];
    render(<LanguageProvider initialPreference="zh-CN"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [failedJob] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    /></LanguageProvider>);

    const card = await screen.findByRole('link', { name: '生成失败 youtube.com' });
    expect(card).toHaveTextContent('视频平台连接超时，字幕读取和原视频预览未完成');
    expect(card).not.toHaveTextContent(/yt-dlp|network_unavailable|Operation timed out/);
  });

  it('summarizes refused caption and preview connections without raw yt-dlp output', async () => {
    const failedJob = job('job_translation_refused', 'video-translation', []);
    failedJob.status = 'failed';
    failedJob.state.sourceUrl = 'https://www.youtube.com/watch?v=refused';
    const stage = {
      id: 'subtitle_refused', jobId: failedJob.id, stageId: 'subtitle', executor: 'krillinai', status: 'failed' as const,
      dispatchStatus: 'finished' as const, claimOwner: null, claimExpiresAt: null, attempt: 1,
      idempotencyKey: null, scopeKey: null, inputFingerprint: null, progress: { phase: 'failed', percent: 1 },
      errorCode: 'platform_caption_access_failed',
      errorMessage: 'downloadYouTubeSubtitle: yt-dlp subtitle metadata error: [Errno 61] Connection refused',
      startedAt: '2026-11-14T01:00:00.000Z', finishedAt: '2026-11-14T01:01:00.000Z'
    };
    failedJob.stages = [stage, { ...stage, id: 'preview_refused', stageId: 'preview-source-video', executor: 'download',
      errorCode: 'network_unavailable', errorMessage: 'yt-dlp could not connect: the connection was refused.' }];
    render(<LanguageProvider initialPreference="zh-CN"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [failedJob] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()} onOpenJob={vi.fn()}
    /></LanguageProvider>);

    const card = await screen.findByRole('link', { name: '生成失败 youtube.com' });
    expect(card).toHaveTextContent('视频平台连接被拒绝，字幕读取和原视频预览未完成');
    expect(card).not.toHaveTextContent(/yt-dlp|Errno 61|network_unavailable/);
  });

  it('shows failure instead of stale submission progress for a rejected video', async () => {
    const failedJob = job('job_rejected_video', 'video-generation', []);
    failedJob.status = 'failed';
    failedJob.state = { prompt: 'Sunset over the sea' };
    failedJob.stages = [{
      id: 'stage_rejected', jobId: failedJob.id, stageId: 'generate', executor: 'video', status: 'failed', dispatchStatus: 'finished',
      claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'provider_failed', percent: 8, message: 'The official video service could not complete this task' },
      errorCode: 'creator_video_generation_failed', errorMessage: 'The official video service could not complete this task',
      startedAt: '2026-11-12T04:21:48.000Z', finishedAt: '2026-11-12T04:21:52.000Z'
    }];
    render(<LanguageProvider initialPreference="zh-CN"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [failedJob] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    /></LanguageProvider>);

    const card = await screen.findByRole('link', { name: '生成失败 Sunset over the sea' });
    expect(within(card).getByText('生成失败')).toBeInTheDocument();
    expect(within(card).queryByText('8%')).not.toBeInTheDocument();
  });

  it('omits untouched video drafts but keeps drafts with a prompt', async () => {
    const empty = job('job_empty_video', 'video-generation', []);
    empty.status = 'draft';
    empty.state = {
      prompt: '', provider: 'seedance', size: '1280x720', duration: 5,
      referenceImageArtifactId: null, currentStage: null
    };
    const edited = job('job_edited_video', 'video-generation', []);
    edited.status = 'draft';
    edited.state = { ...empty.state, prompt: 'A coastal tracking shot' };
    const onOpenJob = vi.fn();
    render(<LanguageProvider initialPreference="en-US"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [empty, edited] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    /></LanguageProvider>);

    expect(await screen.findByRole('link', { name: 'Pending setup A coastal tracking shot' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pending setup Video Generation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Pending setup A coastal tracking shot' }));
    expect(onOpenJob).toHaveBeenCalledWith(edited);
  });

  it('shows a video download waiting for format selection and opens its project', async () => {
    const downloadJob = job('job_download', 'video-download', [artifact('job_download', 'artifact_probe', 'download_probe', 'probe.json', '2026-11-10T04:52:40.505Z')]);
    downloadJob.status = 'draft';
    downloadJob.state.sourceUrl = 'https://www.youtube.com/watch?v=download';
    downloadJob.createdAt = '2026-11-10T04:52:17.092Z';
    downloadJob.stages = [{
      id: 'stage_probe', jobId: downloadJob.id, stageId: 'probe', executor: 'download', status: 'succeeded', dispatchStatus: 'finished',
      claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'completed', percent: 100, message: 'Video information is ready' }, errorCode: null, errorMessage: null,
      startedAt: '2026-11-10T04:52:17.092Z', finishedAt: '2026-11-10T04:52:40.505Z'
    }];
    downloadJob.artifacts[0]!.metadata.title = 'Download project title';
    downloadJob.artifacts[0]!.metadata.thumbnailUrl = 'https://i.ytimg.com/vi/download/maxresdefault.jpg';
    const onOpenJob = vi.fn();
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [downloadJob] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    const card = await screen.findByRole('link', { name: '待配置 Download project title' });
    expect(card).toHaveTextContent('视频下载 · 请选择下载格式并继续创作');
    expect(card).toHaveTextContent('待配置');
    expect(card.querySelector('img')).toHaveAttribute('src', 'https://i.ytimg.com/vi/download/maxresdefault.jpg');
    expect(screen.queryByText(/probe\.json/)).not.toBeInTheDocument();
    expect(document.querySelector('.dashboard-generation-history-date > h2')).toHaveTextContent('2026年11月10日');
    fireEvent.click(screen.getByRole('button', { name: '打开 Download project title' }));
    expect(onOpenJob).toHaveBeenCalledWith(downloadJob);
    fireEvent.click(screen.getByRole('button', { name: 'image' }));
    expect(screen.queryByRole('link', { name: '待配置 Download project title' })).not.toBeInTheDocument();
  });

  it('reopens a running video download without making other running jobs clickable', async () => {
    const downloadJob = job('job_download', 'video-download', []);
    downloadJob.status = 'running';
    downloadJob.state.title = 'Download project';
    downloadJob.stages = [{
      id: 'stage_download', jobId: downloadJob.id, stageId: 'download', executor: 'download', status: 'running', dispatchStatus: 'claimed',
      claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'downloading', percent: 15, message: 'Downloading video' }, errorCode: null, errorMessage: null,
      startedAt: '2026-11-10T04:52:40.505Z', finishedAt: null
    }];
    const videoJob = job('job_video', 'video-generation', []);
    videoJob.status = 'running';
    videoJob.stages = [{ ...downloadJob.stages[0]!, id: 'stage_video', jobId: videoJob.id, stageId: 'generate' }];
    const onOpenJob = vi.fn();
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [downloadJob, videoJob] })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    const downloadCard = await screen.findByRole('link', { name: '正在生成 Download project' });
    expect(downloadCard).toHaveTextContent('15%');
    const videoCard = screen.getByRole('status', { name: '正在生成 视频生成' });
    fireEvent.click(videoCard);
    expect(onOpenJob).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: '打开 Download project' }), { key: 'Enter' });
    expect(onOpenJob).not.toHaveBeenCalled();
    fireEvent.click(downloadCard);
    fireEvent.keyDown(downloadCard, { key: 'Enter' });
    expect(onOpenJob).toHaveBeenCalledTimes(2);
    expect(onOpenJob).toHaveBeenCalledWith(downloadJob);
  });

  it('downloads a project artifact and deletes its project after confirmation', async () => {
    const downloadJob = job('job_download', 'video-download', [artifact('job_download', 'artifact_video', 'source_video', 'source.mp4', '2026-11-10T04:52:40.505Z')]);
    downloadJob.status = 'draft';
    downloadJob.state.sourceUrl = 'https://www.youtube.com/watch?v=download';
    downloadJob.state.title = 'Download project';
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' })));
    const deleteJob = vi.fn(async () => undefined);
    const onOpenJob = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [downloadJob] })), openArtifact, deleteJob }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    const card = await screen.findByRole('link', { name: '待配置 Download project' });
    expect(card.querySelector('img')).toHaveAttribute('src', 'https://i.ytimg.com/vi/download/maxresdefault.jpg');
    fireEvent.click(screen.getAllByRole('button', { name: '下载 source.mp4' })[0]!);
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith('job_download', 'artifact_video'));
    expect(click).toHaveBeenCalled();
    expect(onOpenJob).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: '删除项目 Download project' })[0]!);
    const dialog = screen.getByRole('alertdialog', { name: '删除项目' });
    expect(dialog).toHaveTextContent('确认永久删除“Download project”');
    fireEvent.click(screen.getByRole('checkbox', { name: '同时删除项目文件' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(deleteJob).toHaveBeenCalledWith('job_download', { deleteFiles: true }));
    expect(screen.queryByRole('link', { name: '待配置 Download project' })).not.toBeInTheDocument();
    expect(onOpenJob).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('filters transcription with video jobs, not text or audio jobs', async () => {
    const jobs = [
      job('job_script', 'short-video-script', [artifact('job_script', 'artifact_script', 'short_video_script', 'script.md', '2026-11-07T10:00:00.000Z')]),
      job('job_subtitle', 'transcription', [artifact('job_subtitle', 'artifact_subtitle', 'target_subtitle', 'subtitle.srt', '2026-11-07T09:00:00.000Z')]),
      job('job_audio', 'smart-dubbing', [artifact('job_audio', 'artifact_audio', 'dubbed_audio', 'voice.mp3', '2026-11-07T08:00:00.000Z')])
    ];
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs })), openArtifact: vi.fn() }}
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    />);

    fireEvent.click(await screen.findByRole('button', { name: 'text' }));
    expect(screen.getByText(/script\.md/)).toBeInTheDocument();
    expect(screen.queryByText(/subtitle\.srt/)).not.toBeInTheDocument();
    expect(screen.queryByText(/voice\.mp3/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'video' }));
    expect(screen.getByText(/subtitle\.srt/)).toBeInTheDocument();
    expect(screen.queryByText(/script\.md/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'audio' }));
    expect(screen.queryByText(/script\.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/subtitle\.srt/)).not.toBeInTheDocument();
    expect(screen.getByText(/voice\.mp3/)).toBeInTheDocument();
  });

  it('shows one video translation task after retry while retaining its result download', async () => {
    const translation = job('job_translation', 'video-translation', [
      artifact('job_translation', 'artifact_old_source', 'source_video', 'source.mp4', '2026-11-15T10:00:00.000Z'),
      { ...artifact('job_translation', 'artifact_new_source', 'source_video', 'source-new.mp4', '2026-11-16T10:00:00.000Z'), version: 2 },
      artifact('job_translation', 'artifact_origin', 'source_subtitle', 'origin_language_srt.srt', '2026-11-16T10:01:00.000Z'),
      artifact('job_translation', 'artifact_target', 'target_subtitle', 'target_language_srt.srt', '2026-11-16T10:02:00.000Z'),
      artifact('job_translation', 'artifact_bilingual', 'bilingual_subtitle', 'bilingual_srt.srt', '2026-11-16T10:03:00.000Z')
    ]);
    translation.state.sourceFileName = 'source.mp4';
    translation.updatedAt = '2026-11-16T10:03:00.000Z';
    const openArtifact = vi.fn(async () => new Response(new Blob(['subtitle'], { type: 'text/plain' })));
    const onOpenJob = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [translation] })), openArtifact, deleteJob: vi.fn() }}
      initialType="video"
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    const card = await screen.findByRole('link', { name: '打开 source.mp4' });
    expect(document.querySelectorAll('.dashboard-generation-result-card')).toHaveLength(1);
    expect(card).toHaveTextContent('target_language_srt.srt');
    expect(screen.getAllByRole('button', { name: '删除项目 source.mp4' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '下载 target_language_srt.srt' }));
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith('job_translation', 'artifact_target'));
    fireEvent.click(card);
    expect(onOpenJob).toHaveBeenCalledOnce();
    expect(onOpenJob).toHaveBeenCalledWith(translation);
    fireEvent.click(screen.getByRole('button', { name: 'text' }));
    expect(document.querySelectorAll('.dashboard-generation-result-card')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(document.querySelectorAll('.dashboard-generation-result-card')).toHaveLength(1);
    click.mockRestore();
  });

  it('uses the newest translation result when an older version has a rendered video', async () => {
    const translation = job('job_translation_versions', 'video-translation', [
      artifact('job_translation_versions', 'artifact_old_video', 'horizontal_video', 'old-video.mp4', '2026-11-15T10:00:00.000Z'),
      { ...artifact('job_translation_versions', 'artifact_new_subtitle', 'target_subtitle', 'new-subtitle.srt', '2026-11-16T10:00:00.000Z'), version: 2 }
    ]);
    const onOpenJob = vi.fn();
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [translation] })), openArtifact: vi.fn() }}
      initialType="video"
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    const card = await screen.findByRole('link', { name: '打开 视频翻译' });
    expect(document.querySelectorAll('.dashboard-generation-result-card')).toHaveLength(1);
    expect(card).toHaveTextContent('new-subtitle.srt · V2');
    expect(screen.getByRole('button', { name: '下载 new-subtitle.srt' })).toBeInTheDocument();
    fireEvent.click(card);
    expect(onOpenJob).toHaveBeenCalledWith(translation);
  });

  it('shows the source video cover for a subtitle result while keeping the result openable', async () => {
    const translation = job('job_translation', 'video-translation', [
      artifact('job_translation', 'artifact_source', 'source_video', 'source.mp4', '2026-11-07T09:00:00.000Z'),
      artifact('job_translation', 'artifact_subtitle', 'bilingual_subtitle', 'translated.srt', '2026-11-07T10:00:00.000Z')
    ]);
    translation.state.topic = 'Moon translation';
    const openProjectCover = vi.fn(async () => new Response(new Blob(['cover'], { type: 'image/jpeg' })));
    const onOpenJob = vi.fn();
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [translation] })), openArtifact: vi.fn(async () => new Response(new Blob(['video']))), openProjectCover }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    const card = (await screen.findAllByRole('link', { name: '打开 Moon translation' }))
      .find(element => element.querySelector('[data-kind="subtitle"]'))!;
    const media = card.querySelector('[data-kind="subtitle"]');
    expect(media).not.toBeNull();
    await waitFor(() => expect(openProjectCover).toHaveBeenCalledWith(translation.id));
    await waitFor(() => expect(media?.querySelector('img')).toHaveAttribute('src', 'blob:generation-preview'));
    fireEvent.click(card);
    expect(onOpenJob).toHaveBeenCalledWith(translation);
  });

  it('previews a generated video instead of opening its workbench', async () => {
    const onOpenJob = vi.fn();
    const videoJob = job('job_moon', 'video-generation', [artifact('job_moon', 'artifact_moon', 'generated_video', 'moon.mp4', '2026-11-11T06:19:25.489Z')]);
    videoJob.state.prompt = 'Moon video';
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [videoJob] })), openArtifact: vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' }))) }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    const card = await screen.findByRole('button', { name: '预览 Moon video' });
    card.focus();
    fireEvent.click(await screen.findByLabelText('moon.mp4'));
    const dialog = await screen.findByRole('dialog', { name: '预览 Moon video' });
    expect(within(dialog).getByLabelText('moon.mp4')).toHaveAttribute('controls');
    expect(onOpenJob).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '预览 Moon video' })).not.toBeInTheDocument();
    await waitFor(() => expect(card).toHaveFocus());
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: '预览 Moon video' })).toBeInTheDocument();
  });

  it('previews a generated image instead of opening its workbench', async () => {
    const onOpenJob = vi.fn();
    const imageJob = job('job_image', 'image-generation', [artifact('job_image', 'artifact_image', 'generated_image', 'product.png', '2026-11-11T06:19:25.489Z')]);
    imageJob.state.prompt = 'Product image';
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [imageJob] })), openArtifact: vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }))) }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    await screen.findByRole('button', { name: '预览 Product image' });
    fireEvent.click(await screen.findByRole('img', { name: 'product.png' }));
    const dialog = await screen.findByRole('dialog', { name: '预览 Product image' });
    expect(within(dialog).getByRole('img', { name: 'product.png' })).toHaveAttribute('src', 'blob:generation-preview');
    expect(onOpenJob).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByRole('dialog', { name: '预览 Product image' })).not.toBeInTheDocument();
  });

  it('localizes preview loading and failure in Swedish', async () => {
    await loadLanguageCatalog('sv-SE');
    const imageJob = job('job_image', 'image-generation', [artifact('job_image', 'artifact_image', 'generated_image', 'product.png', '2026-11-11T06:19:25.489Z')]);
    imageJob.state.prompt = 'Product image';
    let failPreview: (reason: Error) => void = () => undefined;
    const openArtifact = vi.fn()
      .mockResolvedValueOnce(new Response(new Blob(['image'], { type: 'image/png' })))
      .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { failPreview = reject; }));
    render(<LanguageProvider initialPreference="sv-SE"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: [imageJob] })), openArtifact }}
      onBackCreation={vi.fn()}
      onOpenJob={vi.fn()}
    /></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Förhandsvisning Product image' }));
    expect(screen.getByRole('status')).toHaveTextContent('Läser in förhandsvisning');
    failPreview(new Error('Preview unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Filförhandsgranskningen kunde inte läsas in. Försök igen senare.');
    expect(screen.getByRole('button', { name: 'Försök igen' })).toBeInTheDocument();
  });

  it('opens a video translation workbench from both All and video history', async () => {
    const onOpenJob = vi.fn();
    const translationJob = job('job_translation', 'video-translation', [artifact('job_translation', 'artifact_translation', 'source_video', 'source.mp4', '2026-11-07T10:00:00.000Z')]);
    translationJob.state.topic = 'Original talk';
    render(<DashboardGenerationHistory
      projectId="project_1"
      service={{
        listJobs: vi.fn(async () => ({ jobs: [translationJob] })),
        openArtifact: vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' })))
      }}
      onBackCreation={vi.fn()}
      onOpenJob={onOpenJob}
    />);

    expect(await screen.findByText('Original talk')).toBeInTheDocument();
    expect(screen.getByText(/视频翻译 · source.mp4/)).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText('source.mp4'));
    expect(onOpenJob).toHaveBeenCalledWith(translationJob);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'video' }));
    const card = screen.getByRole('link', { name: '打开 Original talk' });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onOpenJob).toHaveBeenCalledTimes(2);
    expect(onOpenJob).toHaveBeenLastCalledWith(translationJob);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

function generationJobs(): CreatorJob[] {
  return [job('job_image', 'image-generation', [artifact('job_image', 'artifact_image', 'generated_image', 'product.png', '2026-11-07T10:00:00.000Z')]),
    job('job_video', 'video-generation', [artifact('job_video', 'artifact_video', 'generated_video', 'city.mp4', '2026-11-06T10:00:00.000Z')])];
}

function job(id: string, templateId: string, artifacts: CreatorArtifact[]): CreatorJob {
  return {
    id, projectId: 'project_1', templateId, templateVersion: 1, status: 'completed', revision: 1,
    presetOrigin: null, agentThreadId: null, state: {}, stages: [], artifacts, providerRequests: [], activities: [],
    createdAt: '2026-11-06T09:00:00.000Z', updatedAt: '2026-11-07T10:00:00.000Z'
  };
}

function artifact(jobId: string, id: string, kind: string, fileName: string, createdAt: string): CreatorArtifact {
  return {
    id, jobId, kind, version: 1, status: 'completed', path: `/outputs/${fileName}`, scopeKey: null,
    inputFingerprint: null, sha256: null, sourceArtifactIds: [], metadata: { fileName }, createdAt
  };
}
