import type { CreatorJob, CreatorStageRun } from '@opencreator/protocol';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorTaskProgressBar, useCreatorTaskProgress } from './CreatorCollaborationPanel.js';
import { videoTranslationPanelAdapter } from './creator-panel-adapters.js';
import { CreatorSessionProvider, useCreatorSession } from './creator-session-store.js';

afterEach(() => vi.useRealTimers());

function stage(stageId = 'tts', patch: Partial<CreatorStageRun> = {}): CreatorStageRun {
  return { id: 'tts_1', jobId: 'job_1', stageId, executor: 'test', status: 'running', dispatchStatus: 'claimed',
    claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
    progress: { workflow: true, baseResultVersion: 1, inputResultVersion: 1, phase: 'generating_voice', percent: 45, completed: 7, total: 20 },
    errorCode: null, errorMessage: null, startedAt: '2026-10-21T00:00:00Z', finishedAt: null, ...patch };
}

function job(stages = [stage()]): CreatorJob {
  return { id: 'job_1', projectId: 'project_1', templateId: 'video-translation', templateVersion: 2,
    status: 'running', revision: 1, presetOrigin: null, agentThreadId: null,
    state: { dubbing: true, composeVideo: true, videoFormat: 'horizontal' }, stages, artifacts: [], activities: [], providerRequests: [],
    createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' };
}

function mount(initial = job(), overrides: Record<string, unknown> = {}) {
  let push!: (value: CreatorJob) => void;
  const onCompleted = vi.fn();
  const onDetails = vi.fn();
  const onCancel = vi.fn();
  const onResume = vi.fn();
  const onPreview = vi.fn();
  const onDownload = vi.fn();
  const applyAction = vi.fn(async () => ({ job: initial }));
  function Harness() {
    push = useCreatorSession().applyRemoteSnapshot;
    const task = useCreatorTaskProgress({ onCompleted });
    return task ? <CreatorTaskProgressBar task={task} onDetails={onDetails} onCancel={onCancel} onResume={onResume}
      onPreview={onPreview} onDownload={onDownload} /> : null;
  }
  const view = render(<LanguageProvider initialPreference="zh-CN"><CreatorSessionProvider initialJob={initial}
    service={{ applyAction, runAgentTurn: vi.fn(), ...overrides } as never}><Harness /></CreatorSessionProvider></LanguageProvider>);
  let revision = initial.revision;
  return { ...view, applyAction, onCompleted, onDetails, onCancel, onResume, onPreview, onDownload,
    push: (value: CreatorJob) => act(() => push({ ...value, revision: ++revision })) };
}

describe('shared persistent task progress', () => {
  it('recovers real dubbing progress without starting a task and opens details or cancellation', () => {
    const view = mount();
    const bar = screen.getByRole('region', { name: '当前任务进度' });
    expect(bar).toHaveTextContent('生成配音');
    expect(bar).toHaveTextContent('已完成 7 / 20 段');
    expect(within(bar).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
    expect(bar).not.toHaveTextContent('界面预览');
    expect(view.applyAction).not.toHaveBeenCalled();
    fireEvent.click(within(bar).getByRole('button', { name: '查看详情' }));
    expect(view.onDetails).toHaveBeenCalledOnce();
    fireEvent.click(within(bar).getByLabelText('更多任务操作'));
    fireEvent.click(within(bar).getByRole('button', { name: '终止当前任务' }));
    expect(view.onCancel).toHaveBeenCalledOnce();
  });

  it('keeps the task progress monotonic between stages and completes only after the final render', () => {
    const initial = job();
    initial.state.videoFormat = 'all';
    const view = mount(initial);
    const tts = stage('tts', { status: 'succeeded', progress: { workflow: true, resultVersion: 2, percent: 100 } });
    view.push({ ...initial, status: 'completed', stages: [tts] });
    expect(screen.getByRole('region', { name: '当前任务进度' })).toHaveTextContent('正在准备合成横屏视频');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
    expect(view.onCompleted).not.toHaveBeenCalled();
    const horizontal = stage('render-horizontal', { id: 'render_1', progress: { workflow: true, workflowParentStageRunId: tts.id, targetResultVersion: 2, phase: 'rendering_video', percent: 12 } });
    const background = stage('preview-source-video', { id: 'download_1', progress: { backgroundSourceDownload: true, percent: 90, phase: 'downloading' } });
    view.push({ ...initial, stages: [tts, horizontal, background] });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '37');
    expect(screen.getByRole('region', { name: '当前任务进度' })).not.toHaveTextContent('下载原视频');
    const doneHorizontal = { ...horizontal, status: 'succeeded' as const };
    // Ignore the completed parallel download when following the render chain.
    view.push({ ...initial, status: 'completed', stages: [tts, doneHorizontal, { ...background, status: 'succeeded' }] });
    expect(screen.getByRole('region', { name: '当前任务进度' })).toHaveTextContent('正在准备合成竖屏视频');
    const vertical = stage('render-vertical', { id: 'render_2', progress: { workflow: true, workflowParentStageRunId: horizontal.id, targetResultVersion: 2 } });
    view.push({ ...initial, stages: [tts, doneHorizontal, vertical] });
    view.push({ ...initial, status: 'completed', stages: [tts, doneHorizontal, { ...vertical, status: 'succeeded' }] });
    expect(screen.getByRole('region', { name: '当前任务进度' })).toHaveTextContent('视频合成完成');
    expect(view.onCompleted).toHaveBeenCalledExactlyOnceWith(2, 'tts_1', 'render-vertical');
    fireEvent.click(screen.getByRole('button', { name: '查看成片' }));
    fireEvent.click(screen.getByRole('button', { name: '下载视频' }));
    expect(view.onPreview).toHaveBeenCalledOnce();
    expect(view.onDownload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '关闭完成提示' }));
    expect(screen.queryByRole('region', { name: '当前任务进度' })).toBeNull();
  });

  it('does not move the workflow bar backward when a later stage starts at five percent', () => {
    const subtitle = stage('subtitle', { id: 'subtitle_1', progress: { workflow: true, percent: 25 } });
    const initial = job([subtitle]);
    initial.state.dubbing = false;
    initial.state.composeVideo = true;
    initial.state.videoFormat = 'horizontal';
    const first = videoTranslationPanelAdapter.taskProgress?.(initial, (zh: string) => zh);
    const render = stage('render-horizontal', { id: 'render_1', progress: {
      workflow: true, workflowParentStageRunId: subtitle.id, percent: 5
    } });
    const next = videoTranslationPanelAdapter.taskProgress?.({ ...initial, stages: [
      { ...subtitle, status: 'succeeded', progress: { workflow: true, percent: 100 } }, render
    ] }, (zh: string) => zh);
    expect(first?.taskPercent).toBe(25);
    expect(next?.taskPercent).toBeGreaterThan(first?.taskPercent ?? 0);
    expect(next?.taskPercent).toBe(53);
  });

  it('keeps the overall progress and labels the conversion phase separately', () => {
    const source = stage('prepare-source-video', {
      executor: 'download',
      progress: { phase: 'normalizing_media', percent: 98.90059326924516, phasePercent: 50 }
    });
    const view = mount(job([source]));
    const bar = screen.getByRole('region', { name: '当前任务进度' });
    expect(within(bar).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99');
    expect(within(bar).getByText('当前转换阶段 50%')).toBeVisible();
    expect(bar).not.toHaveTextContent('98.90059326924516');
    view.unmount();
  });

  it('uses elapsed time and reconnect feedback without fabricating a percentage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T00:00:05Z'));
    const view = mount(job([stage('tts', { progress: { workflow: true, phase: 'planning_voice' } })]), {
      getJob: vi.fn(() => new Promise(() => undefined)), subscribeJobEvents: vi.fn(() => ({ close: vi.fn() }))
    });
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('连接中断，正在重连')).toBeVisible();
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries only the failed stage with the same version and guards repeated clicks', async () => {
    const failed = stage('render-horizontal', { id: 'failed_render', status: 'failed', errorMessage: '编码失败',
      progress: { workflow: true, inputResultVersion: 2, targetResultVersion: 2, baseResultVersion: 2, workflowParentStageRunId: 'tts_done' } });
    let resolve!: (value: { job: CreatorJob }) => void;
    const applyAction = vi.fn(() => new Promise<{ job: CreatorJob }>(done => { resolve = done; }));
    const view = mount({ ...job([failed]), status: 'failed' }, { applyAction });
    expect(screen.getByText('编码失败')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试当前阶段' }));
    fireEvent.click(screen.getByRole('button', { name: '正在重试…' }));
    await act(async () => { await Promise.resolve(); });
    expect(applyAction).toHaveBeenCalledOnce();
    expect(applyAction.mock.calls[0]).toEqual(['job_1', expect.objectContaining({ action: 'run-stage', input: {
      stageId: 'render-horizontal', resumedFromStageRunId: 'failed_render', workflow: true,
      inputResultVersion: 2, targetResultVersion: 2, baseResultVersion: 2, workflowParentStageRunId: 'tts_done'
    } })]);
    await act(async () => resolve({ job: { ...job([stage('render-horizontal', { id: 'retry_render' })]), revision: 3 } }));
    expect(screen.queryByRole('button', { name: '重试当前阶段' })).toBeNull();
    expect(view.onCompleted).not.toHaveBeenCalled();
  });

  it('retains failed retry feedback and offers resume after cancellation', async () => {
    const failed = stage('tts', { status: 'failed' });
    const view = mount({ ...job([failed]), status: 'failed' }, { applyAction: vi.fn().mockRejectedValue(new Error('offline')) });
    fireEvent.click(screen.getByRole('button', { name: '重试当前阶段' }));
    expect(await screen.findByText('重试未能启动，请查看详情后再试')).toBeVisible();
    view.push({ ...job([{ ...failed, status: 'canceled' }]), status: 'canceled' });
    fireEvent.click(screen.getByRole('button', { name: '继续任务' }));
    expect(view.onResume).toHaveBeenCalledOnce();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('does not resume or fire completion callbacks when reopening a finished task', () => {
    const view = mount({ ...job([stage('render-horizontal', { status: 'succeeded', progress: { workflow: true, resultVersion: 2 } })]), status: 'completed' });
    expect(screen.getByText('视频合成完成')).toBeVisible();
    expect(view.onCompleted).not.toHaveBeenCalled();
    expect(view.applyAction).not.toHaveBeenCalled();
  });

  it('uses saved workflow settings when editing a new draft after translation', () => {
    const current = job([stage('subtitle', { status: 'succeeded', progress: { workflow: true, resultVersion: 1 } })]);
    current.state.resultSnapshots = [{ version: 1, state: { dubbing: false, composeVideo: false } }];
    expect(videoTranslationPanelAdapter.taskProgress?.(current, (zh: string) => zh)).toBeNull();
  });

  it('labels a new version from the latest history even when generating from an older base', () => {
    const current = job();
    current.state.resultVersion = 1;
    current.state.resultSnapshots = [{ version: 1 }, { version: 4 }];
    expect(videoTranslationPanelAdapter.taskProgress?.(current, (zh: string) => zh)?.resultVersion).toBe(5);
  });

  it('keeps both render steps from the workflow snapshot while another version is being reviewed', () => {
    const tts = stage('tts', { status: 'succeeded', progress: { workflow: true, resultVersion: 2 } });
    const render = stage('render-horizontal', { id: 'render_1', progress: { workflow: true, workflowParentStageRunId: tts.id, targetResultVersion: 2 } });
    const current = job([tts, render]);
    current.state.resultSnapshots = [{ version: 2, state: { composeVideo: true, dubbing: true, videoFormat: 'all' } }];
    expect(videoTranslationPanelAdapter.taskProgress?.(current, (zh: string) => zh)?.steps.map(step => step.id))
      .toEqual(['tts', 'render-horizontal', 'render-vertical']);
  });
});
