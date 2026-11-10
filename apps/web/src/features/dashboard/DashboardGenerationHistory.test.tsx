import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
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
  if (createObjectURLDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectURLDescriptor);
  if (revokeObjectURLDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectURLDescriptor);
});

describe('DashboardGenerationHistory', () => {
  it('maps creator entries to their generation type and defaults to all', () => {
    expect(generationHistoryTypeForWorkspace('video-translation')).toBe('video');
    expect(generationHistoryTypeForWorkspace('image-generation')).toBe('image');
    expect(generationHistoryTypeForWorkspace('short-video-script')).toBe('text');
    expect(generationHistoryTypeForWorkspace('smart-dubbing')).toBe('audio');
    expect(generationHistoryTypeForWorkspace()).toBe('all');
  });

  it('filters all outputs by media type and downloads an artifact', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const onBackCreation = vi.fn();
    render(<LanguageProvider initialPreference="zh-CN"><DashboardGenerationHistory
      projectId="project_1"
      service={{ listJobs: vi.fn(async () => ({ jobs: generationJobs() })), openArtifact }}
      onBackCreation={onBackCreation}
      onOpenJob={vi.fn()}
    /></LanguageProvider>);

    expect(await screen.findByText(/product\.png/)).toBeInTheDocument();
    expect(screen.getByText(/city\.mp4/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '当前工具' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '全部历史' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('img', { name: 'product.png' })).toHaveAttribute('src', 'blob:generation-preview');

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
    expect(document.querySelector('.dashboard-generation-running .dashboard-generation-history-date > h2')).toHaveTextContent('2026年11月7日');
    expect(screen.queryByText('还没有生成记录')).not.toBeInTheDocument();
    const dates = [...document.querySelectorAll('.dashboard-generation-history-date > h2')].map(item => item.textContent);
    expect(dates).toEqual(['2026年11月7日', '2026年11月7日', '2026年11月6日']);
    fireEvent.click(screen.getByRole('button', { name: 'video' }));
    expect(document.querySelector('.dashboard-generation-running-card')).not.toBeInTheDocument();
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

  it('filters documents and subtitles as text and includes an audio filter', async () => {
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
    expect(screen.getByText(/subtitle\.srt/)).toBeInTheDocument();
    expect(screen.queryByText(/voice\.mp3/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'audio' }));
    expect(screen.queryByText(/script\.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/subtitle\.srt/)).not.toBeInTheDocument();
    expect(screen.getByText(/voice\.mp3/)).toBeInTheDocument();
  });

  it('opens workflow artifacts in their editor instead of only downloading them', async () => {
    const onOpenJob = vi.fn();
    const translationJob = job('job_translation', 'video-translation', [artifact('job_translation', 'artifact_translation', 'horizontal_video', 'translated.mp4', '2026-11-07T10:00:00.000Z')]);
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
    expect(screen.getByText(/视频翻译 · translated.mp4/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开 translated.mp4' })).not.toBeInTheDocument();
    const preview = await screen.findByLabelText('translated.mp4');
    expect(preview).not.toHaveAttribute('controls');
    fireEvent.mouseEnter(preview.closest('.dashboard-generation-result-media')!);
    expect(preview).toHaveAttribute('controls');
    fireEvent.click(screen.getByRole('button', { name: '打开项目编辑区 · Original talk' }));
    expect(onOpenJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job_translation', templateId: 'video-translation' }));
    fireEvent.mouseLeave(preview.closest('.dashboard-generation-result-media')!);
    expect(preview).not.toHaveAttribute('controls');
    onOpenJob.mockClear();
    fireEvent.click(screen.getByRole('link', { name: '打开 Original talk' }));
    expect(onOpenJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job_translation', templateId: 'video-translation' }));
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
