import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AutoClipWorkspaceV3 from './AutoClipWorkspaceV3.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import { createLocalizedCopy, type LocalizeCopy } from '../../i18n/localized-copy.js';

const sessionRef = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const createObjectUrl = vi.hoisted(() => vi.fn(async (_session: unknown, id: string) => `blob:${id}`));
const localize = vi.hoisted(() => vi.fn<LocalizeCopy>());

vi.mock('../../i18n/useLocalizedCopy.js', () => ({ useLocalizedCopy: () => localize }));
vi.mock('./creator-session-store.js', () => ({
  useOptionalCreatorSession: () => sessionRef.current,
  createCreatorArtifactObjectUrl: createObjectUrl
}));
vi.mock('./CreatorToolShell.js', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

beforeEach(() => {
  localize.mockImplementation(createLocalizedCopy('zh-CN'));
  createObjectUrl.mockReset().mockImplementation(async (_session, id) => `blob:${id}`);
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  sessionRef.current = {
    job: { id: 'job', templateId: 'auto-clip', templateVersion: 3, status: 'draft',
      stages: [], artifacts: [], state: { sourceType: 'url', sourceUrl: '', clipCount: 3, duration: '90-180' } },
    state: { sourceType: 'url', sourceUrl: '', clipCount: 3, duration: '90-180' },
    issues: [],
    error: null,
    updateDraft: vi.fn(),
    flush: vi.fn(async () => undefined),
    uploadSourceVideo: vi.fn(async () => undefined),
    applyAction: vi.fn(async () => undefined),
    captureCreatorFailure: vi.fn(),
    openArtifact: vi.fn()
  };
});

describe('KrillinAI auto clip workspace', () => {
  it('uses the embedded composer and preserves the clip stage callback', async () => {
    const onGenerated = vi.fn();
    const { container } = render(<AutoClipWorkspaceV3 embedded embeddedTabs={<span>视频</span>} onGenerated={onGenerated} onBack={() => undefined} />);

    expect(container.querySelector('.creator-tool-embedded .dashboard-clips-composer')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '视频切片' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切片设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始切片' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=embedded' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始切片' }));

    await waitFor(() => expect(sessionRef.current?.applyAction).toHaveBeenCalledWith({
      actor: 'user', action: 'run-stage', input: { stageId: 'clip' }
    }));
    expect(onGenerated).toHaveBeenCalledOnce();
  });

  it('only opens completed jobs in the result editor', async () => {
    sessionRef.current = {
      ...sessionRef.current,
      job: {
        ...(sessionRef.current?.job as object),
        status: 'failed',
        stages: [{
          id: 'stage_failed', jobId: 'job', stageId: 'clip', executor: 'krillinai', status: 'failed', dispatchStatus: 'finished',
          claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
          progress: { phase: 'collecting_outputs', percent: 44, message: 'Failed' }, errorCode: 'usage', errorMessage: 'Failed',
          startedAt: '2026-11-07T10:00:00.000Z', finishedAt: '2026-11-07T10:01:00.000Z'
        }]
      }
    };
    const failedView = render(<AutoClipWorkspaceV3 embedded startInResults onBack={() => undefined} />);
    expect(failedView.container.querySelector('.creator-tool-embedded .dashboard-clips-composer')).toBeInTheDocument();
    failedView.unmount();

    const artifact = {
      id: 'clip-1', jobId: 'job', kind: 'auto_clip_video', status: 'completed',
      version: 1, sourceArtifactIds: [], metadata: { resultVersion: 1, start: 0, end: 30, fileName: 'clip-01.mp4' }
    };
    sessionRef.current = {
      ...sessionRef.current,
      job: { ...(sessionRef.current?.job as object), status: 'completed', stages: [], artifacts: [artifact] }
    };
    const completedView = render(<AutoClipWorkspaceV3 embedded startInResults onBack={() => undefined} />);
    expect(completedView.container.querySelector('.auto-clip-v3-results')).toBeInTheDocument();
    expect(completedView.container.querySelector('.creator-tool-embedded')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '视频来源' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始切片' })).not.toBeInTheDocument();
    await waitFor(() => expect(completedView.container.querySelector('video')).toHaveAttribute('src', 'blob:clip-1'));
  });

  it('keeps the form editable and creates a new job while another clip is running', async () => {
    sessionRef.current = {
      ...sessionRef.current,
      job: {
        ...(sessionRef.current?.job as object),
        projectId: 'project_1',
        stages: [{
          id: 'stage_running', jobId: 'job', stageId: 'clip', executor: 'krillinai', status: 'running', dispatchStatus: 'claimed',
          claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
          progress: { phase: 'generating', percent: 44, message: 'Creating clips' }, errorCode: null, errorMessage: null,
          startedAt: '2026-11-07T10:00:00.000Z', finishedAt: null
        }]
      }
    };
    const createJob = vi.fn(async () => ({ job: { id: 'new-job', revision: 0 } }));
    const applyAction = vi.fn(async () => undefined);
    const onGenerated = vi.fn();
    render(<AutoClipWorkspaceV3
      embedded
      service={{ createJob, applyAction } as unknown as CreatorWebService}
      onGenerated={onGenerated}
      onBack={() => undefined}
    />);

    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '切片设置' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=next-task' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始切片' }));

    await waitFor(() => expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project_1', templateId: 'auto-clip', templateVersion: 3,
      state: expect.objectContaining({ sourceUrl: 'https://www.youtube.com/watch?v=next-task' })
    })));
    expect(applyAction).toHaveBeenCalledWith('new-job', { actor: 'user', action: 'run-stage', input: { stageId: 'clip' }, expectedRevision: 0 });
    expect(onGenerated).toHaveBeenCalledWith('new-job');
    expect(sessionRef.current?.applyAction).not.toHaveBeenCalled();
  });

  it('submits one clip stage with source, count and duration', async () => {
    render(<AutoClipWorkspaceV3 embedded onBack={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=fixture' }
    });
    fireEvent.click(screen.getByRole('button', { name: '切片设置' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '切片数量' }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('combobox', { name: '切片时长' }));
    fireEvent.click(screen.getByRole('option', { name: '30-60 秒' }));
    fireEvent.click(screen.getByRole('button', { name: '开始切片' }));

    await waitFor(() => expect(sessionRef.current?.applyAction).toHaveBeenCalledWith({
      actor: 'user', action: 'run-stage', input: { stageId: 'clip' }
    }));
    expect(sessionRef.current?.updateDraft).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'url', sourceUrl: 'https://www.youtube.com/watch?v=fixture', clipCount: 4, duration: '30-60'
    }), { semantic: true });
  });

  it('shows one preview and downloads the selected clip', async () => {
    const artifacts = [1, 2].map(number => ({
      id: `clip-${number}`, jobId: 'job', kind: 'auto_clip_video', status: 'completed',
      version: number, sourceArtifactIds: [], metadata: {
        resultVersion: 1, start: (number - 1) * 30, end: number * 30,
        fileName: `clip-0${number}.mp4`
      }
    }));
    sessionRef.current = {
      ...sessionRef.current,
      job: { ...(sessionRef.current?.job as object), status: 'completed', artifacts }
    };
    const { container } = render(<AutoClipWorkspaceV3 onBack={() => undefined} />);

    await waitFor(() => expect(container.querySelectorAll('video')).toHaveLength(1));
    const first = container.querySelector('video');
    expect(first).toHaveAttribute('src', 'blob:clip-1');
    expect(first).not.toHaveAttribute('autoplay');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^片段 1/ })).toHaveAttribute('aria-pressed', 'true');

    const second = screen.getByRole('button', { name: /^片段 2/ });
    fireEvent.click(second);
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:clip-2'));
    expect(first).not.toBeInTheDocument();
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip-1');
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('clip-02.mp4');
      expect(this.href).toBe('blob:clip-2');
    });
    fireEvent.click(screen.getByRole('button', { name: '下载片段' }));
    expect(download).toHaveBeenCalledOnce();
    download.mockRestore();
  });

  it('keeps the playing preview URL when a job snapshot contains the same clips', async () => {
    const artifact = {
      id: 'clip-1', jobId: 'job', kind: 'auto_clip_video', status: 'completed',
      version: 1, sourceArtifactIds: [], metadata: {
        resultVersion: 1, start: 97, end: 203, fileName: 'clip-01.mp4'
      }
    };
    let request = 0;
    createObjectUrl.mockImplementation(async () => `blob:preview-${++request}`);
    sessionRef.current = {
      ...sessionRef.current,
      job: { ...(sessionRef.current?.job as object), artifacts: [artifact] }
    };
    const { container, rerender } = render(<AutoClipWorkspaceV3 onBack={() => undefined} />);
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:preview-1'));
    const preview = container.querySelector('video');

    sessionRef.current = {
      ...sessionRef.current,
      job: { ...(sessionRef.current?.job as object), artifacts: [{ ...artifact, metadata: { ...artifact.metadata } }] },
      openArtifact: vi.fn()
    };
    rerender(<AutoClipWorkspaceV3 onBack={() => undefined} />);

    expect(container.querySelector('video')).toBe(preview);
    expect(preview).toHaveAttribute('src', 'blob:preview-1');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('ranks scored clips without changing the active player and seeks to the evidence cue', async () => {
    const artifacts = [
      { score: 0.72, selectionReason: { text: '这里给出具体例子。', offsetMs: 12345, locale: 'zh-CN' } },
      { score: 0.86 },
      { score: 0, selectionReason: { text: '时间越界。', offsetMs: 30000, locale: 'zh-CN' } },
      {}
    ].map((metadata, index) => ({
      id: `clip-${index + 1}`, jobId: 'job', kind: 'auto_clip_video', status: 'completed', version: index + 1,
      sourceArtifactIds: [], metadata: { resultVersion: 1, start: 120 + index * 30, end: 150 + index * 30, ...metadata }
    }));
    const legacy = { ...artifacts[3]!, id: 'legacy-clip', metadata: { start: 55, end: 95, resultVersion: 1 } };
    const snapshot = (version: number, ids: string[]) => ({
      version, createdAt: '2026-11-20T00:00:00Z', action: 'stage-succeeded', stageId: 'clip',
      description: `V${version}`, artifactRefs: { auto_clip_video: ids }, changedArtifactIds: ids, staleArtifactIds: [], state: {}
    });
    const state = { resultSnapshots: [snapshot(1, [legacy.id]), snapshot(2, artifacts.map(artifact => artifact.id))] };
    sessionRef.current = {
      ...sessionRef.current,
      job: { ...(sessionRef.current?.job as object), status: 'completed', artifacts: [legacy, ...artifacts], state },
      state
    };
    const { container } = render(<AutoClipWorkspaceV3 onBack={() => undefined} />);
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:clip-1'));
    const player = container.querySelector('video')!;
    const score = screen.getByText('72', { exact: true });
    expect(score).toHaveAttribute('title', 'AI 选段评分');
    expect(screen.getByText('这里给出具体例子。')).toHaveAttribute('lang', 'zh-CN');
    const anchor = screen.getByRole('button', { name: '跳转到 00:12' });
    expect(anchor).toBeDisabled();
    Object.defineProperty(player, 'duration', { configurable: true, value: 30 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(anchor);
    expect(player.currentTime).toBeCloseTo(12.345);
    fireEvent.click(screen.getByRole('combobox', { name: '排序' }));
    fireEvent.click(screen.getByRole('option', { name: '按评分排序' }));
    expect(screen.getAllByRole('button', { name: /^片段 \d/ }).map(button => button.querySelector('strong')?.textContent))
      .toEqual(['片段 2', '片段 1', '片段 3', '片段 4']);
    expect(container.querySelector('video')).toBe(player);
    expect(player.currentTime).toBeCloseTo(12.345);
    fireEvent.click(screen.getByRole('button', { name: /^片段 2/ }));
    expect(screen.getByText('此片段暂无选段理由。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^片段 3/ }));
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:clip-3'));
    expect(screen.queryByRole('button', { name: '跳转到 00:12' })).not.toBeInTheDocument();
    expect(screen.queryByText('时间越界。')).not.toBeInTheDocument();
    expect(screen.getByText('此片段暂无选段理由。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^项目 V1/ }));
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:legacy-clip'));
    expect(screen.queryByTitle('AI 选段评分')).not.toBeInTheDocument();
    expect(screen.getByText('选段理由', { exact: true })).toBeVisible();
    expect(screen.getByText('此片段暂无选段理由。')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: '排序' })).not.toBeInTheDocument();
  });

  it.each([
    ['en-US', 'No selection reason is available for this clip.'],
    ['sv-SE', 'Ingen motivering finns för det här klippet.'],
    ['ja-JP', 'このクリップには選定理由がありません。']
  ] as const)('explains missing selection reasons in %s without a broken cue button', async (language, message) => {
    localize.mockImplementation(createLocalizedCopy(language));
    const artifact = {
      id: 'clip-1', jobId: 'job', kind: 'auto_clip_video', status: 'completed',
      version: 1, sourceArtifactIds: [], metadata: { resultVersion: 1, start: 0, end: 30, score: 0.94 }
    };
    sessionRef.current = {
      ...sessionRef.current,
      job: { ...(sessionRef.current?.job as object), status: 'completed', artifacts: [artifact] }
    };
    const { container } = render(<AutoClipWorkspaceV3 onBack={() => undefined} />);
    expect(screen.getByText(message)).toBeVisible();
    expect(container.querySelector('.auto-clip-v3-reason button')).not.toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:clip-1'));
  });
});
