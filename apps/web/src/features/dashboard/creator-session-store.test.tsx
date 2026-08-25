import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CreatorEventEnvelope, CreatorJob } from '@opencreator/protocol';
import {
  CreatorSessionProvider,
  useCreatorSession
} from './creator-session-store.js';

function job(revision: number, state: Record<string, any>): CreatorJob {
  return {
    id: 'job_1',
    projectId: 'project_1',
    templateId: 'video-translation',
    templateVersion: 1,
    status: 'draft',
    revision,
    state,
    agentThreadId: null,
    stages: [],
    artifacts: [],
    activities: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z'
  };
}

function Harness() {
  const session = useCreatorSession();
  return (
    <div>
      <output aria-label="language">{String(session.state.targetLanguage)}</output>
      <output aria-label="dubbing">{String(session.state.dubbing)}</output>
      <output aria-label="conflicts">{session.conflictedFields.join(',')}</output>
      <output aria-label="error">{session.error?.code ?? ''}</output>
      <output aria-label="turns">{session.turns.map(turn => turn.content).join('|')}</output>
      <output aria-label="busy">{String(session.agentBusy)}</output>
      <output aria-label="stages">{session.job.stages.map(stage => `${stage.stageId}:${stage.status}`).join('|')}</output>
      <button type="button" onClick={() => session.updateDraft({ targetLanguage: 'ja' })}>
        change
      </button>
      <button type="button" onClick={() => void session.runAgentTurn('检查当前设置')}>
        run-agent
      </button>
      <button type="button" onClick={() => {
        const action = session.agentBusy ? session.steerAgentTurn : session.runAgentTurn;
        void action('补充要求');
      }}>
        send-agent
      </button>
      <button type="button" onClick={() => void session.respondAgentApproval('approval_1', 'approved', 7)}>
        approve
      </button>
    </div>
  );
}

describe('CreatorSessionStore', () => {
  it('updates shared draft immediately without creating an agent turn', async () => {
    vi.useFakeTimers();
    const applyAction = vi.fn(async () => ({
      job: job(1, { targetLanguage: 'ja', dubbing: false }),
      receipt: {
        actor: 'user' as const,
        action: 'update-settings',
        summary: 'updated',
        affectedArtifacts: [],
        newRevision: 1,
        createdAt: '2026-08-20T00:00:01.000Z'
      }
    }));
    const runAgentTurn = vi.fn();
    render(
      <CreatorSessionProvider
        initialJob={job(0, { targetLanguage: 'en', dubbing: false })}
        service={{ applyAction, runAgentTurn } as never}
      >
        <Harness />
      </CreatorSessionProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    expect(screen.getByLabelText('language')).toHaveTextContent('ja');
    expect(applyAction).not.toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(applyAction).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('preserves dirty fields when a newer confirmed snapshot arrives', () => {
    let applySnapshot: ((next: CreatorJob) => void) | undefined;
    function SnapshotHarness() {
      const session = useCreatorSession();
      applySnapshot = session.applyRemoteSnapshot;
      return <Harness />;
    }
    render(
      <CreatorSessionProvider
        initialJob={job(0, { targetLanguage: 'en', dubbing: false })}
        service={{} as never}
      >
        <SnapshotHarness />
      </CreatorSessionProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    act(() => applySnapshot!(job(1, { targetLanguage: 'fr', dubbing: true })));

    expect(screen.getByLabelText('language')).toHaveTextContent('ja');
    expect(screen.getByLabelText('dubbing')).toHaveTextContent('true');
    expect(screen.getByLabelText('conflicts')).toHaveTextContent('targetLanguage');
  });

  it('clears a stale request error when a newer Runtime snapshot arrives', async () => {
    let session: ReturnType<typeof useCreatorSession> | undefined;
    function SnapshotHarness() {
      session = useCreatorSession();
      return <Harness />;
    }
    const failure = Object.assign(new Error('missing config'), {
      code: 'creator_llm_config_missing'
    });
    render(
      <CreatorSessionProvider
        initialJob={job(0, { targetLanguage: 'en', dubbing: false })}
        service={{
          applyAction: vi.fn(async () => { throw failure; }),
          runAgentTurn: vi.fn()
        } as never}
      >
        <SnapshotHarness />
      </CreatorSessionProvider>
    );

    await act(async () => {
      await session!.applyAction({ action: 'run-stage', input: { stageId: 'subtitle' } })
        .catch(() => undefined);
    });
    expect(screen.getByLabelText('error')).toHaveTextContent('creator_llm_config_missing');

    act(() => session!.applyRemoteSnapshot(job(1, { targetLanguage: 'en', dubbing: false })));
    expect(screen.getByLabelText('error')).toBeEmptyDOMElement();
  });

  it('uses the revision returned by a draft flush for the next action', async () => {
    const revisions: number[] = [];
    const applyAction = vi.fn(async (_jobId: string, request: { action: string; expectedRevision: number }) => {
      revisions.push(request.expectedRevision);
      const revision = request.action === 'update-settings' ? 1 : 2;
      return {
        job: job(revision, { targetLanguage: 'ja', dubbing: false }),
        receipt: {
          actor: 'user' as const,
          action: request.action,
          summary: 'updated',
          affectedArtifacts: [],
          newRevision: revision,
          createdAt: '2026-08-20T00:00:01.000Z'
        }
      };
    });
    let session: ReturnType<typeof useCreatorSession> | undefined;
    function ActionHarness() {
      session = useCreatorSession();
      return <Harness />;
    }
    render(
      <CreatorSessionProvider
        initialJob={job(0, { targetLanguage: 'en', dubbing: false })}
        service={{ applyAction, runAgentTurn: vi.fn() } as never}
      >
        <ActionHarness />
      </CreatorSessionProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    await act(async () => {
      await session!.applyAction({ action: 'run-stage', input: { stageId: 'subtitle' } });
    });

    expect(revisions).toEqual([0, 1]);
    expect(screen.getByLabelText('error')).toBeEmptyDOMElement();
  });

  it('applies live stage events immediately and reloads only the affected state surface', async () => {
    let emit!: (event: CreatorEventEnvelope) => void;
    const getJob = vi.fn(async () => ({ job: job(0, {}) }));
    const getAgentTimeline = vi.fn(async () => timeline({ status: 'running', content: '' }));
    const subscribeJobEvents = vi.fn((
      _jobId: string,
      onEvent: (event: CreatorEventEnvelope) => void
    ) => {
      emit = onEvent;
      return { close: vi.fn() };
    });
    render(
      <CreatorSessionProvider
        initialJob={job(0, {})}
        service={{
          applyAction: vi.fn(),
          runAgentTurn: vi.fn(),
          getJob,
          getAgentTimeline,
          subscribeJobEvents
        } as never}
      >
        <Harness />
      </CreatorSessionProvider>
    );

    await waitFor(() => expect(subscribeJobEvents).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getAgentTimeline).toHaveBeenCalledTimes(1));
    act(() => emit({
      id: 'stage:1',
      jobId: 'job_1',
      revision: 0,
      kind: 'stage_progress',
      payload: {
        stage: {
          id: 'stage_1',
          jobId: 'job_1',
          stageId: 'render-horizontal',
          executor: 'krillinai',
          status: 'running',
          dispatchStatus: 'claimed',
          claimOwner: 'scheduler_1',
          claimExpiresAt: null,
          attempt: 1,
          idempotencyKey: 'stage_1',
          progress: { percent: 35 },
          errorCode: null,
          errorMessage: null,
          startedAt: '2026-08-21T00:00:02.000Z',
          finishedAt: null
        }
      },
      createdAt: '2026-08-21T00:00:02.000Z'
    }));

    expect(screen.getByLabelText('stages')).toHaveTextContent('render-horizontal:running');
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(getAgentTimeline).toHaveBeenCalledTimes(1);

    act(() => emit({
      id: 'agent:2',
      jobId: 'job_1',
      revision: 0,
      kind: 'agent_item_changed',
      payload: {},
      createdAt: '2026-08-21T00:00:03.000Z'
    }));
    await waitFor(() => expect(getAgentTimeline).toHaveBeenCalledTimes(2));
    expect(getJob).toHaveBeenCalledTimes(1);

    act(() => emit({
      id: 'snapshot:1',
      jobId: 'job_1',
      revision: 1,
      kind: 'snapshot_changed',
      payload: { revision: 1 },
      createdAt: '2026-08-21T00:00:04.000Z'
    }));
    await waitFor(() => expect(getJob).toHaveBeenCalledTimes(2));
  });

  it('does not add an optimistic local turn before the Runtime timeline confirms it', async () => {
    let resolveStart!: (value: { turn: never }) => void;
    const startAgentTurn = vi.fn(() => new Promise<{ turn: never }>(resolve => {
      resolveStart = resolve;
    }));
    const getAgentTimeline = vi.fn(async () => ({
      session: null,
      turns: [],
      items: [],
      approvals: [],
      lastEventSequence: 0
    }));
    render(
      <CreatorSessionProvider
        initialJob={job(0, {})}
        service={{
          applyAction: vi.fn(),
          runAgentTurn: startAgentTurn,
          startAgentTurn,
          getAgentTimeline
        } as never}
      >
        <Harness />
      </CreatorSessionProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'run-agent' }));
    await waitFor(() => expect(startAgentTurn).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('turns')).toBeEmptyDOMElement();

    await act(async () => resolveStart({ turn: undefined as never }));
    expect(screen.getByLabelText('turns')).toBeEmptyDOMElement();
  });

  it('restores the complete Agent timeline again after a page refresh', async () => {
    const getAgentTimeline = vi.fn(async () => timeline({ status: 'completed', content: '服务端历史消息' }));
    const service = {
      applyAction: vi.fn(),
      runAgentTurn: vi.fn(),
      getAgentTimeline
    };
    const first = render(
      <CreatorSessionProvider initialJob={job(0, {})} service={service as never}>
        <Harness />
      </CreatorSessionProvider>
    );
    expect(await screen.findByLabelText('turns')).toHaveTextContent('服务端历史消息');
    first.unmount();

    render(
      <CreatorSessionProvider initialJob={job(0, {})} service={service as never}>
        <Harness />
      </CreatorSessionProvider>
    );
    expect(await screen.findByLabelText('turns')).toHaveTextContent('服务端历史消息');
    await waitFor(() => expect(getAgentTimeline).toHaveBeenCalledTimes(2));
  });

  it('steers the active Turn instead of starting another Turn when Agent is busy', async () => {
    const runAgentTurn = vi.fn();
    const steerAgentTurn = vi.fn(async () => ({ turn: {} }));
    render(
      <CreatorSessionProvider
        initialJob={job(0, {})}
        service={{
          applyAction: vi.fn(),
          runAgentTurn,
          steerAgentTurn,
          getAgentTimeline: vi.fn(async () => timeline({ status: 'running', content: '处理中' }))
        } as never}
      >
        <Harness />
      </CreatorSessionProvider>
    );

    await waitFor(() => expect(screen.getByLabelText('busy')).toHaveTextContent('true'));
    fireEvent.click(screen.getByRole('button', { name: 'send-agent' }));
    await waitFor(() => expect(steerAgentTurn).toHaveBeenCalledWith(
      'job_1',
      expect.objectContaining({ message: '补充要求', clientMessageId: expect.any(String) })
    ));
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it('forwards the approval decision with the matching process generation', async () => {
    const respondAgentApproval = vi.fn(async () => ({ approval: {} }));
    render(
      <CreatorSessionProvider
        initialJob={job(0, {})}
        service={{
          applyAction: vi.fn(),
          runAgentTurn: vi.fn(),
          respondAgentApproval,
          getAgentTimeline: vi.fn(async () => timeline({ status: 'waiting_approval', content: '等待审批' }))
        } as never}
      >
        <Harness />
      </CreatorSessionProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    await waitFor(() => expect(respondAgentApproval).toHaveBeenCalledWith(
      'job_1',
      'approval_1',
      { decision: 'approved', processGeneration: 7 }
    ));
  });
});

function timeline(turn: { status: 'completed' | 'running' | 'waiting_approval'; content: string }) {
  return {
    session: {
      id: 'session_1',
      jobId: 'job_1',
      threadId: 'thread_1',
      runtimeThreadId: 'runtime_thread_1',
      status: 'active' as const,
      hostGeneration: 7,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:01.000Z',
      interruptedAt: null,
      closedAt: null
    },
    turns: [{
      id: 'turn_1',
      jobId: 'job_1',
      sessionId: 'session_1',
      role: 'assistant' as const,
      content: turn.content,
      status: turn.status,
      audit: [],
      createdAt: '2026-08-21T00:00:01.000Z'
    }],
    items: [],
    approvals: [],
    lastEventSequence: 1
  };
}
