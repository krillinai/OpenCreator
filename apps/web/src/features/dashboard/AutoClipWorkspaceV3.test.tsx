import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AutoClipWorkspaceV3 from './AutoClipWorkspaceV3.js';

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
  it('submits one clip stage with source, count and duration', async () => {
    render(<AutoClipWorkspaceV3 onBack={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=fixture' }
    });
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
