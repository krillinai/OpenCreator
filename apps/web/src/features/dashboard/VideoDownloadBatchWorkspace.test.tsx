import type { CreateCreatorJobRequest, CreatorActionRequest, CreatorArtifact, CreatorEventEnvelope, CreatorJob, CreatorJson, CreatorStageRun } from '@opencreator/protocol';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import VideoDownloadBatchWorkspace from './VideoDownloadBatchWorkspace.js';
import { DOWNLOAD_BATCH_HIDDEN, DOWNLOAD_BATCH_PARENT, parseDownloadLink } from './video-download-batch.js';

const firstUrl = 'https://www.youtube.com/watch?v=first';
type CreateDownloadJobRequest = Extract<CreateCreatorJobRequest, { templateId: string }>;
const secondUrl = 'https://www.youtube.com/watch?v=second';
const thirdUrl = 'https://www.youtube.com/watch?v=third';
const createObjectURL = vi.fn(() => 'blob:batch-test');
const revokeObjectURL = vi.fn();
beforeEach(() => {
  createObjectURL.mockClear(); revokeObjectURL.mockClear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
});

describe('video download link batches', () => {
  it('accepts one URL or Douyin share text and rejects multiple or unsupported URLs', () => {
    expect(parseDownloadLink(` ${firstUrl} `)).toEqual({ url: firstUrl });
    expect(parseDownloadLink('https://www.reddit.com/r/claude/s/R5I7tDfJ0h')).toEqual({ url: 'https://www.reddit.com/r/claude/s/R5I7tDfJ0h' });
    expect(parseDownloadLink('分享\nhttps://v.douyin.com/example/\n复制链接')).toEqual({ url: 'https://v.douyin.com/example/' });
    for (const separator of ['\n', ' ', '']) {
      expect(parseDownloadLink(`${firstUrl}${separator}${secondUrl}`)).toEqual({ error: 'multiple' });
    }
    expect(parseDownloadLink(`${firstUrl}\n${firstUrl}`)).toEqual({ error: 'multiple' });
    expect(parseDownloadLink('分享 https://v.douyin.com/example/ 和 https://example.com')).toEqual({ error: 'multiple' });
    for (const value of ['', 'ftp://example.com/video', 'https://example.com']) {
      expect(parseDownloadLink(value)).toEqual({ error: 'invalid' });
    }
  });

  it('rejects multiple pasted links before the single-line input strips newlines', async () => {
    const harness = setup(makeJob('pending:project:video-download'));
    const input = screen.getByRole('textbox', { name: '视频链接' });
    expect(input.tagName).toBe('INPUT');
    for (const separator of ['\n', ' ']) {
      expect(fireEvent.paste(input, { clipboardData: { getData: () => `${firstUrl}${separator}${secondUrl}` } })).toBe(false);
      expect(screen.getByRole('alert')).toHaveTextContent('每次只能添加一个链接');
      expect(input).toHaveValue('');
    }
    expect(harness.ensureJob).not.toHaveBeenCalled();
    expect(harness.service.createJob).not.toHaveBeenCalled();
    fireEvent.paste(input, { clipboardData: { getData: () => '分享\nhttps://v.douyin.com/example/\n复制链接' } });
    expect(input).toHaveValue('https://v.douyin.com/example/');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('adds independent jobs and selects existing duplicates without starting another analysis', async () => {
    const harness = setup(readyJob('root', firstUrl));
    await addLinks(secondUrl);
    await addLinks(thirdUrl);
    await waitFor(() => expect(harness.service.createJob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(harness.probes()).toHaveLength(2));
    const created = harness.service.createJob.mock.calls.map(([request]) => request);
    expect(created.every(request => request.state?.[DOWNLOAD_BATCH_PARENT] === 'root')).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Video third' })).toBeInTheDocument();
    expect(screen.getAllByRole('complementary', { name: 'OpenCreator' })).toHaveLength(1);
    await addLinks('https://youtu.be/first?t=20');
    expect(harness.service.createJob).toHaveBeenCalledTimes(2);
    expect(harness.probes()).toHaveLength(2);
    expect(await screen.findByRole('heading', { name: 'Video first' })).toBeInTheDocument();
  });

  it('persists the first pending job before linking more jobs to it', async () => {
    const harness = setup(makeJob('pending:project:video-download'));
    await addLinks(firstUrl);
    await addLinks(secondUrl);
    await addLinks(thirdUrl);
    await waitFor(() => expect(harness.service.createJob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(harness.probes()).toHaveLength(3));
    expect(harness.ensureJob).toHaveBeenCalledTimes(1);
    expect(harness.service.createJob.mock.calls.every(([request]) => request.state?.[DOWNLOAD_BATCH_PARENT] === 'persisted-root')).toBe(true);
    expect(within(screen.getByRole('list', { name: '视频链接列表' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps the blank-page input visible while typing and analyzes an existing pending URL', async () => {
    const harness = setup(makeJob('pending:project:video-download'));
    const input = screen.getByRole('textbox', { name: '视频链接' });
    expect(within(screen.getByRole('list', { name: '支持的平台' })).getAllByRole('listitem')).toHaveLength(10);
    fireEvent.change(input, { target: { value: 'h' } });
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveValue('h');
    await addLinks(firstUrl);
    await screen.findByRole('heading', { name: 'Video first' });
    expect(harness.probes()).toHaveLength(1);
    expect(harness.service.createJob).not.toHaveBeenCalled();
    harness.view.unmount();
    const pending = makeJob('pending:project:video-download');
    pending.state.sourceUrl = firstUrl;
    const existing = setup(pending);
    await addLinks(firstUrl);
    await addLinks(secondUrl);
    await waitFor(() => expect(existing.probes()).toHaveLength(2));
    expect(existing.service.createJob.mock.calls[0]![0].state?.[DOWNLOAD_BATCH_PARENT]).toBe('persisted-root');
  });

  it('offers Add link and Cancel only after the first video has been analyzed', async () => {
    setup(makeJob('pending:project:video-download'));
    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '添加链接' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();

    await addLinks(firstUrl);
    await screen.findByRole('heading', { name: 'Video first' });
    fireEvent.click(screen.getByRole('button', { name: '添加链接' }));
    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('textbox', { name: '视频链接' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加链接' })).toBeEnabled();
  });

  it('clears the entered link and its validation error and returns focus to the input', async () => {
    const harness = setup(makeJob('pending:project:video-download'));
    const input = screen.getByRole('textbox', { name: '视频链接' });
    expect(screen.queryByRole('button', { name: '清空链接' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入支持的公开视频链接');

    fireEvent.click(screen.getByRole('button', { name: '清空链接' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('button', { name: '清空链接' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '获取' })).toBeDisabled();
    expect(harness.service.createJob).not.toHaveBeenCalled();
    expect(harness.ensureJob).not.toHaveBeenCalled();
  });

  it.each([
    firstUrl,
    'https://www.douyin.com/jingxuan?modal_id=7667962912690031907',
    '分享 https://v.douyin.com/example/ 复制链接'
  ])('validates %s locally while keeping the clear action available', value => {
    const harness = setup(makeJob('pending:project:video-download'));
    const input = screen.getByRole('textbox', { name: '视频链接' });
    expect(screen.queryByRole('status', { name: '链接格式有效' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value } });
    expect(screen.getByRole('status', { name: '链接格式有效' })).toBeVisible();
    expect(screen.getByRole('button', { name: '获取' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '清空链接' }));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('status', { name: '链接格式有效' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '获取' })).toBeDisabled();
    expect(harness.ensureJob).not.toHaveBeenCalled();
    expect(harness.service.createJob).not.toHaveBeenCalled();
  });

  it('disables analysis for invalid or multiple links and waits for blur to show validation errors', () => {
    const harness = setup(makeJob('pending:project:video-download'));
    const input = screen.getByRole('textbox', { name: '视频链接' });
    for (const value of ['https://', 'https://example.com', 'https://youtube.com.example.com/watch?v=test', `${firstUrl} ${secondUrl}`]) {
      fireEvent.change(input, { target: { value } });
      expect(screen.queryByRole('status', { name: '链接格式有效' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '获取' })).toBeDisabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.blur(input);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent(value.includes(secondUrl) ? '每次只能添加一个链接' : '请输入支持的公开视频链接');
    }
    fireEvent.change(input, { target: { value: firstUrl } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: '获取' })).toBeEnabled();
    expect(harness.ensureJob).not.toHaveBeenCalled();
    expect(harness.service.createJob).not.toHaveBeenCalled();
  });

  it('continues adding other links when one analysis fails and retries only that source', async () => {
    const harness = setup(readyJob('root', firstUrl));
    const apply = harness.service.applyAction.getMockImplementation()!;
    let failed = false;
    harness.service.applyAction.mockImplementation(async (id, request) => {
      if (id === 'child-1' && request.input.stageId === 'probe' && !failed) {
        failed = true;
        throw new Error('network_unavailable: proxy connection refused');
      }
      return apply(id, request);
    });
    await addLinks(secondUrl);
    await addLinks(thirdUrl);
    const list = await screen.findByRole('list', { name: '视频链接列表' });
    const issue = within(list).getByRole('alert');
    expect(issue).toHaveTextContent('视频解析失败');
    expect(issue).toHaveTextContent('无法连接视频平台，请检查网络或代理设置后重试');
    expect(within(issue).queryByRole('button')).not.toBeInTheDocument();
    const retry = within(list).getByRole('button', { name: `重试 ${secondUrl}` });
    expect(retry).toHaveClass('video-download-source-action');
    expect(screen.getByRole('button', { name: /^Video third/ })).toBeInTheDocument();
    fireEvent.click(retry);
    await screen.findByRole('button', { name: /^Video second/ });
    expect(harness.probes().filter(([id]) => id === 'child-2')).toHaveLength(1);
    expect(harness.service.createJob).toHaveBeenCalledTimes(2);
  });

  it('restores only members of this project and batch, preserves subscriptions while switching, and opens files through the owner', async () => {
    const child = readyJob('child', secondUrl, 'root');
    child.artifacts.push(fileArtifact(child));
    const harness = setup(readyJob('root', firstUrl), [child,
      readyJob('other-batch', thirdUrl, 'another-root'),
      { ...readyJob('other-project', thirdUrl, 'root'), projectId: 'other-project' }]);
    const list = await screen.findByRole('list', { name: '视频链接列表' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '下载 1080p' }));
    await waitFor(() => expect(harness.jobs.get('root')?.stages.at(-1)?.status).toBe('running'));
    fireEvent.click(screen.getByRole('tab', { name: '下载规格' }));
    fireEvent.click(within(screen.getByRole('list', { name: '视频链接列表' })).getByRole('button', { name: /^Video second/ }));
    expect(await screen.findByRole('heading', { name: 'Video second' })).toBeInTheDocument();
    expect(harness.unsubscribe).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('list', { name: '视频链接列表' })).getByRole('button', { name: /^Video first/ }));
    fireEvent.click(screen.getByRole('tab', { name: '作品' }));
    expect(screen.queryByRole('list', { name: '视频链接列表' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Video first' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Video second' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '下载进度 30%' })).toBeInTheDocument();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: '保存到本机 child.mp4' }));
    await waitFor(() => expect(harness.service.openArtifact).toHaveBeenCalledWith('child', 'child-file'));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    fireEvent.click(screen.getByRole('tab', { name: '下载规格' }));
    expect(within(screen.getByRole('list', { name: '视频链接列表' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('retries a failed link independently and soft removes it without deleting its files', async () => {
    const child = readyJob('child', secondUrl, 'root');
    child.stages.push(stage(child, 'download', 'failed'));
    const harness = setup(readyJob('root', firstUrl), [child]);
    await screen.findByRole('button', { name: '重试 Video second' });
    fireEvent.click(screen.getByRole('button', { name: '重试 Video second' }));
    await waitFor(() => expect(harness.service.applyAction).toHaveBeenCalledWith('child', expect.objectContaining({
      action: 'run-stage', input: { stageId: 'download', optionId: 'video-1080', mediaType: 'video', sourceUrl: secondUrl }
    })));
    expect(harness.probes()).toHaveLength(0);
    expect(screen.getByRole('button', { name: '移除链接 Video second' })).toBeDisabled();
    const completed = { ...harness.jobs.get('child')!, revision: 5, stages: [stage(child, 'download', 'succeeded')], artifacts: [...child.artifacts, fileArtifact(child)] };
    await act(async () => harness.publish(completed));
    await waitFor(() => expect(screen.getByRole('button', { name: '移除链接 Video second' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '移除链接 Video second' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '移除链接 Video second' })).not.toBeInTheDocument());
    expect(harness.jobs.get('root')?.state[DOWNLOAD_BATCH_HIDDEN]).toEqual(['child']);
    fireEvent.click(screen.getByRole('tab', { name: '作品' }));
    expect(screen.getByText('child.mp4')).toBeInTheDocument();
    await addLinks(secondUrl);
    await screen.findByRole('button', { name: '移除链接 Video second' });
    expect(harness.service.createJob).not.toHaveBeenCalled();
    expect(harness.jobs.get('root')?.state[DOWNLOAD_BATCH_HIDDEN]).toEqual([]);
  });

  it('routes download controls to the owning link while another link is selected', async () => {
    const root = readyJob('root', firstUrl);
    root.stages.push(stage(root, 'download', 'running'));
    const child = readyJob('child', secondUrl, 'root');
    child.stages.push(stage(child, 'download', 'running'));
    const harness = setup(root, [child]);
    await screen.findByRole('button', { name: /^Video second/ });
    fireEvent.click(screen.getByRole('tab', { name: '作品' }));
    fireEvent.click(screen.getByRole('button', { name: '暂停下载 Video second · 1080p' }));
    await screen.findByRole('button', { name: '继续下载 Video second · 1080p' });
    expect(harness.service.controlDownload).toHaveBeenLastCalledWith('child', child.stages[0]!.id, 'pause');
    expect(harness.jobs.get('root')?.stages[0]?.status).toBe('running');
    fireEvent.click(screen.getByRole('button', { name: '取消下载 Video second · 1080p' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '继续下载 Video second · 1080p' })).not.toBeInTheDocument());
    expect(harness.service.controlDownload).toHaveBeenLastCalledWith('child', child.stages[0]!.id, 'cancel');
    expect(harness.jobs.get('root')?.stages[0]?.status).toBe('running');
  });

  it('keeps successfully added jobs when a later creation fails and retries with the same creation key', async () => {
    const harness = setup(readyJob('root', firstUrl));
    const realCreate = harness.service.createJob.getMockImplementation()!;
    let failedKey = '';
    harness.service.createJob.mockImplementation(async request => {
      if (request.state?.sourceUrl === thirdUrl && !failedKey) {
        failedKey = request.creationKey!;
        await realCreate(request);
        throw new Error('connection lost');
      }
      return realCreate(request);
    });
    await addLinks(secondUrl);
    await addLinks(thirdUrl);
    expect(await screen.findByRole('alert')).toHaveTextContent('connection lost');
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveValue(thirdUrl);
    fireEvent.click(screen.getByRole('button', { name: '获取' }));
    await waitFor(() => expect(harness.probes()).toHaveLength(2));
    expect(harness.service.createJob.mock.calls[2]![0].creationKey).toBe(failedKey);
    expect(harness.jobs.size).toBe(3);
  });

  it('restores hidden sources without showing their old formats, while keeping Works available', async () => {
    const root = readyJob('root', firstUrl);
    root.state[DOWNLOAD_BATCH_HIDDEN] = ['root'];
    root.artifacts.push(fileArtifact(root));
    setup(root);
    await waitFor(() => expect(screen.queryByText('正在加载链接列表')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Video first' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载 1080p' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '作品' }));
    expect(screen.getByText('root.mp4')).toBeInTheDocument();
  });
});

async function addLinks(value: string) {
  await waitFor(() => expect(screen.queryByText('正在加载链接列表')).not.toBeInTheDocument());
  if (screen.queryByRole('textbox', { name: '视频链接' }) === null) fireEvent.click(screen.getByRole('button', { name: '添加链接' }));
  fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), { target: { value } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '获取' })); });
}

function setup(root: CreatorJob, members: CreatorJob[] = []) {
  const jobs = new Map([root, ...members].map(job => [job.id, job]));
  const subscriptions = new Map<string, (event: CreatorEventEnvelope) => void>();
  const creationKeys = new Map<string, CreatorJob>();
  const unsubscribe = vi.fn();
  const service = {
    getJob: vi.fn(async (id: string) => ({ job: jobs.get(id)! })),
    subscribeJobEvents: vi.fn((id: string, onEvent: (event: CreatorEventEnvelope) => void) => {
      subscriptions.set(id, onEvent);
      return { close: () => { unsubscribe(id); subscriptions.delete(id); } };
    }),
    listJobs: vi.fn(async () => ({ jobs: [...jobs.values()] })),
    createJob: vi.fn(async (request: CreateDownloadJobRequest) => {
      const existing = creationKeys.get(request.creationKey!);
      if (existing) return { job: jobs.get(existing.id)! };
      const job = { ...makeJob(`child-${creationKeys.size + 1}`), state: request.state ?? {} };
      jobs.set(job.id, job); creationKeys.set(request.creationKey!, job);
      return { job };
    }),
    applyAction: vi.fn(async (id: string, request: CreatorActionRequest) => {
      let next = jobs.get(id)!;
      if (request.action === 'update-settings') next = { ...next, state: { ...next.state, ...(request.input.patch as Record<string, CreatorJson>) } };
      if (request.action === 'run-stage') {
        if (request.input.stageId === 'probe') next = { ...next, artifacts: [...next.artifacts, probeArtifact(next)], stages: [...next.stages, stage(next, 'probe', 'succeeded')] };
        else next = { ...next, stages: [...next.stages, stage(next, 'download', 'running')] };
      }
      next = { ...next, revision: next.revision + 1 };
      jobs.set(id, next);
      return { job: next, receipt: { actor: 'user' as const, action: request.action, summary: request.action, affectedArtifacts: [], newRevision: next.revision, createdAt: next.updatedAt } };
    }),
    openArtifact: vi.fn(async () => new Response(new Blob(['file'], { type: 'video/mp4' }))),
    controlDownload: vi.fn(async (id: string, stageRunId: string, action: 'pause' | 'resume' | 'cancel') => {
      const current = jobs.get(id)!;
      const previous = current.stages.find(stage => stage.id === stageRunId)!;
      const nextStage: CreatorStageRun = { ...previous, status: action === 'pause' ? 'interrupted' : action === 'cancel' ? 'canceled' : 'running',
        progress: { ...previous.progress, downloadControl: action === 'pause' ? 'paused' : action === 'cancel' ? 'canceled' : null } };
      const next = { ...current, revision: current.revision + 1, stages: current.stages.map(stage => stage.id === stageRunId ? nextStage : stage) };
      jobs.set(id, next);
      const control: 'paused' | 'canceled' | 'resumed' = action === 'pause' ? 'paused' : action === 'cancel' ? 'canceled' : 'resumed';
      return { job: next, stage: nextStage, control };
    }),
    runAgentTurn: vi.fn()
  };
  const ensureJob = vi.fn(async (state: Record<string, CreatorJson>) => {
    const next = { ...makeJob('persisted-root'), state };
    jobs.delete(root.id); jobs.set(next.id, next);
    return next;
  });
  const view = render(<LanguageProvider initialPreference="zh-CN">
    <CreatorSessionProvider initialJob={root} service={service} ensureJob={ensureJob}>
      <VideoDownloadBatchWorkspace service={service as unknown as CreatorWebService} onBack={vi.fn()} />
    </CreatorSessionProvider>
  </LanguageProvider>);
  return { service, ensureJob, jobs, unsubscribe, view,
    probes: () => service.applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage' && request.input.stageId === 'probe'),
    publish: (job: CreatorJob) => { jobs.set(job.id, job); subscriptions.get(job.id)?.({ id: `${job.id}-${job.revision}`, jobId: job.id, revision: job.revision, kind: 'snapshot_changed', payload: {}, createdAt: job.updatedAt }); }
  };
}

function makeJob(id: string): CreatorJob {
  return { id, projectId: 'project', templateId: 'video-download', templateVersion: 2,
    status: 'draft', revision: 0, presetOrigin: null, state: {}, agentThreadId: null,
    stages: [], artifacts: [], providerRequests: [], activities: [], createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' };
}

function readyJob(id: string, url: string, parent?: string): CreatorJob {
  const job = makeJob(id);
  job.state = { sourceUrl: url, ...(parent ? { [DOWNLOAD_BATCH_PARENT]: parent } : {}) };
  job.artifacts = [probeArtifact(job)];
  return job;
}

function probeArtifact(job: CreatorJob): CreatorArtifact {
  const url = String(job.state.sourceUrl);
  return { id: `${job.id}-probe`, jobId: job.id, kind: 'download_probe', version: 1,
    status: 'completed', path: '/tmp/probe.json', scopeKey: null, inputFingerprint: null, sha256: null, sourceArtifactIds: [], createdAt: job.createdAt,
    metadata: { id: job.id, title: `Video ${url.split('v=')[1]}`, url, requestedUrl: url, platform: 'youtube', duration: 120, formats: [],
      options: [{ id: 'video-1080', mediaType: 'video', container: 'mp4', height: 1080, videoFormatId: '399', audioFormatId: '140' }] } };
}

function fileArtifact(job: CreatorJob): CreatorArtifact {
  return { ...probeArtifact(job), id: `${job.id}-file`, kind: 'source_video', path: `/tmp/${job.id}.mp4`, sourceArtifactIds: [`${job.id}-probe`],
    metadata: { fileName: `${job.id}.mp4`, optionId: 'video-1080', mediaType: 'video', requestedUrl: job.state.sourceUrl!, mimeType: 'video/mp4' } };
}

function stage(job: CreatorJob, stageId: string, status: CreatorStageRun['status']): CreatorStageRun {
  return { id: `${job.id}-${stageId}-${job.revision}`, jobId: job.id, stageId, executor: 'download', status,
    dispatchStatus: 'claimed', claimOwner: 'test', claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
    progress: stageId === 'probe' ? {} : { optionId: 'video-1080', mediaType: 'video', sourceUrl: job.state.sourceUrl!, probeArtifactId: `${job.id}-probe`, percent: 30 },
    errorCode: null, errorMessage: null, startedAt: job.createdAt, finishedAt: null };
}
