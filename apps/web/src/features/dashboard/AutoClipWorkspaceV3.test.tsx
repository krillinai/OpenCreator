import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AutoClipWorkspaceV3 from './AutoClipWorkspaceV3.js';
import type { CreatorWebService } from '../../services/creator-service.js';

const sessionRef = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const createObjectUrl = vi.hoisted(() => vi.fn(async (_session: unknown, id: string) => `blob:${id}`));
const localize = vi.hoisted(() => (zh: string) => zh);

vi.mock('../../i18n/useLocalizedCopy.js', () => ({ useLocalizedCopy: () => localize }));
vi.mock('./creator-session-store.js', () => ({
  useOptionalCreatorSession: () => sessionRef.current,
  createCreatorArtifactObjectUrl: createObjectUrl
}));
vi.mock('./CreatorToolShell.js', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

beforeEach(() => {
  createObjectUrl.mockClear();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  sessionRef.current = {
    job: { id: 'job', templateId: 'auto-clip', templateVersion: 3, status: 'draft',
      stages: [], artifacts: [], state: { sourceType: 'url', sourceUrl: '', clipCount: 3, duration: '90-180' } },
    state: { sourceType: 'url', sourceUrl: '', clipCount: 3, duration: '90-180' },
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

  it('renders independent MP4 previews and downloads for a completed version', async () => {
    const artifacts = [1, 2].map(number => ({
      id: `clip-${number}`, jobId: 'job', kind: 'auto_clip_video', status: 'completed',
      version: number, sourceArtifactIds: [], metadata: {
        resultVersion: 1, start: (number - 1) * 30, end: number * 30,
        fileName: `clip-0${number}.mp4`
      }
    }));
    sessionRef.current = {
      ...sessionRef.current,
      job: { ...(sessionRef.current?.job as object), artifacts }
    };
    const { container } = render(<AutoClipWorkspaceV3 onBack={() => undefined} />);

    await waitFor(() => expect(container.querySelectorAll('video')).toHaveLength(2));
    expect(screen.getByRole('button', { name: '下载片段 1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下载片段 2' })).toBeEnabled();
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
  });

  it('pauses the previous clip when another preview starts playing', async () => {
    const artifacts = [1, 2].map(number => ({
      id: `clip-${number}`, jobId: 'job', kind: 'auto_clip_video', status: 'completed',
      version: number, sourceArtifactIds: [], metadata: {
        resultVersion: 1, start: (number - 1) * 30, end: number * 30,
        fileName: `clip-0${number}.mp4`
      }
    }));
    sessionRef.current = {
      ...sessionRef.current,
      job: { ...(sessionRef.current?.job as object), artifacts }
    };
    const { container } = render(<AutoClipWorkspaceV3 onBack={() => undefined} />);
    await waitFor(() => expect(container.querySelectorAll('video')).toHaveLength(2));
    const [first, second] = container.querySelectorAll('video');
    const pauseFirst = vi.spyOn(first!, 'pause').mockImplementation(() => undefined);
    const pauseSecond = vi.spyOn(second!, 'pause').mockImplementation(() => undefined);

    fireEvent.play(first!);
    fireEvent.play(second!);
    expect(pauseFirst).toHaveBeenCalledOnce();
    expect(pauseSecond).toHaveBeenCalledOnce();

    fireEvent.play(first!);
    expect(pauseSecond).toHaveBeenCalledTimes(2);
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
});
