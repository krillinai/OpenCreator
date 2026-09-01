import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreatorArtifact, CreatorJob, CreatorStageRun } from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import StickmanVideoWorkspace from './StickmanVideoWorkspace.js';

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:stickman-artifact')
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  });
});

describe('StickmanVideoWorkspace', () => {
  it('does not show ready results before persisted artifacts arrive', () => {
    renderWorkspace(job({ status: 'running', stages: [stage('acquire-source', 'running')] }));

    expect(document.querySelectorAll('.creator-collaboration-panel')).toHaveLength(1);
    expect(screen.queryByText('固定五项交付')).not.toBeInTheDocument();
    expect(screen.queryByText('项目 V1')).not.toBeInTheDocument();
    expect(screen.getAllByText('执行中').length).toBeGreaterThan(0);
  });

  it('renders storyboard and result versions from persisted artifact content after mount', async () => {
    const persisted = completedJob();
    renderWorkspace(persisted.job, persisted.contents);

    fireEvent.click(screen.getByRole('button', { name: /分镜与画面/ }));
    expect(await screen.findByText('解释核心概念')).toBeInTheDocument();
    expect(screen.getByText('白底黑线火柴人讲解核心概念')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /成片交付/ }));
    expect(await screen.findByText('固定五项交付')).toBeInTheDocument();
    expect(screen.getByText('项目 V1')).toBeInTheDocument();
    expect(screen.getByText('纯净视频')).toBeInTheDocument();
    expect(screen.getByText('双语字幕')).toBeInTheDocument();
  });

  it('submits shot edits and regeneration with the current revision and scope', async () => {
    const persisted = completedJob({ withSnapshot: false, reviewKind: 'approve-visuals' });
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: { ...persisted.job, revision: persisted.job.revision + 1 },
      receipt: {
        actor: 'user',
        action: request.action,
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: persisted.job.revision + 1,
        createdAt: persisted.job.updatedAt
      }
    }));
    renderWorkspace(persisted.job, persisted.contents, applyAction);

    const editButton = await screen.findByTitle('编辑镜头');
    fireEvent.click(editButton);
    const dialog = screen.getByRole('dialog', { name: '编辑镜头' });
    fireEvent.change(within(dialog).getByLabelText('画面提示词'), {
      target: { value: '新的镜头提示词' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      persisted.job.id,
      expect.objectContaining({
        action: 'edit-shot',
        expectedRevision: persisted.job.revision,
        input: expect.objectContaining({
          scopeKey: 'shot-01',
          revision: persisted.job.revision,
          patch: expect.objectContaining({ imagePrompt: '新的镜头提示词' })
        })
      })
    ));

    fireEvent.click(screen.getByTitle('重新生成图片'));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      persisted.job.id,
      expect.objectContaining({
        action: 'regenerate-shot',
        input: expect.objectContaining({
          scopeKey: 'shot-01',
          inputFingerprint: 'a'.repeat(64)
        })
      })
    ));
  });
});

function renderWorkspace(
  initialJob: CreatorJob,
  contents = new Map<string, unknown>(),
  applyAction = vi.fn(async () => ({
    job: initialJob,
    receipt: {
      actor: 'user' as const,
      action: 'noop',
      summary: 'noop',
      affectedArtifacts: [],
      newRevision: initialJob.revision,
      createdAt: initialJob.updatedAt
    }
  }))
) {
  return render(
    <LanguageProvider initialPreference="zh-CN">
      <CreatorSessionProvider
        initialJob={initialJob}
        service={{
          applyAction,
          runAgentTurn: vi.fn(),
          openArtifact: vi.fn(async (_jobId: string, artifactId: string) => {
            const value = contents.get(artifactId);
            return value === undefined
              ? new Response(new Blob(['media'], { type: 'application/octet-stream' }))
              : new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
          })
        } as never}
      >
        <StickmanVideoWorkspace onBack={vi.fn()} />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
}

function job(input: {
  status?: CreatorJob['status'];
  stages?: CreatorStageRun[];
  artifacts?: CreatorArtifact[];
  state?: CreatorJob['state'];
} = {}): CreatorJob {
  return {
    id: 'stickman-job-1',
    projectId: 'project-1',
    templateId: 'stickman-video',
    templateVersion: 2,
    status: input.status ?? 'draft',
    revision: 7,
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=test',
      style: '极简黑白线稿',
      characterPrompt: '统一火柴人角色',
      ratio: '16:9',
      targetDurationSeconds: 30,
      targetLanguage: 'zh-CN',
      voice: 'alloy',
      currentStage: null,
      ...(input.state ?? {})
    },
    agentThreadId: null,
    stages: input.stages ?? [],
    artifacts: input.artifacts ?? [],
    providerRequests: [],
    activities: [],
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:07.000Z'
  };
}

function stage(stageId: string, status: CreatorStageRun['status'], scopeKey: string | null = null): CreatorStageRun {
  return {
    id: `${stageId}-${scopeKey ?? 'global'}`,
    jobId: 'stickman-job-1',
    stageId,
    executor: stageId === 'images' ? 'stickman-image' : 'download',
    status,
    dispatchStatus: status === 'queued' || status === 'running' ? 'claimed' : 'finished',
    claimOwner: status === 'running' ? 'scheduler' : null,
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: `${stageId}-key`,
    scopeKey,
    inputFingerprint: scopeKey === null ? null : 'a'.repeat(64),
    progress: {},
    errorCode: null,
    errorMessage: null,
    startedAt: '2026-08-31T00:00:01.000Z',
    finishedAt: status === 'succeeded' ? '2026-08-31T00:00:02.000Z' : null
  };
}

function artifact(id: string, kind: string, scopeKey: string | null = null): CreatorArtifact {
  return {
    id,
    jobId: 'stickman-job-1',
    kind,
    version: 1,
    status: 'completed',
    path: `/tmp/${id}`,
    scopeKey,
    inputFingerprint: scopeKey === null ? null : 'a'.repeat(64),
    sha256: id.padEnd(64, '0').slice(0, 64),
    sourceArtifactIds: [],
    metadata: { fileName: `${kind}.${kind.includes('video') ? 'mp4' : kind.includes('subtitle') ? 'srt' : 'json'}` },
    createdAt: '2026-08-31T00:00:03.000Z'
  };
}

function completedJob(options: { withSnapshot?: boolean; reviewKind?: string } = {}) {
  const script = artifact('script', 'script_manifest');
  const shots = artifact('shots', 'shot_spec');
  const shotImage = artifact('shot-image', 'shot_image', 'shot-01');
  const validation = artifact('validation', 'visual_validation');
  const deliveries = [
    artifact('clean', 'clean_video'),
    artifact('cover', 'cover_image'),
    artifact('copy', 'publish_copy'),
    artifact('bilingual-video', 'bilingual_video'),
    artifact('bilingual-srt', 'bilingual_subtitle'),
    artifact('manifest', 'delivery_manifest')
  ];
  const withSnapshot = options.withSnapshot ?? true;
  const state: CreatorJob['state'] = {
    approvedScriptArtifactId: script.id,
    approvedShotSpecArtifactId: shots.id,
    approvedVisualValidationArtifactId: validation.id,
    ...(options.reviewKind === undefined ? {} : {
      needsInput: {
        code: 'creator_review_required',
        kind: options.reviewKind,
        message: '请审核画面后继续',
        artifactId: validation.id
      }
    }),
    ...(withSnapshot ? {
      resultSnapshots: [{
        version: 1,
        createdAt: '2026-08-31T00:00:06.000Z',
        action: 'stage-succeeded',
        stageId: 'package-validation',
        description: '完成固定五项交付',
        artifactRefs: Object.fromEntries(deliveries.map(item => [item.kind, [item.id]])),
        changedArtifactIds: deliveries.map(item => item.id),
        staleArtifactIds: [],
        state: {}
      }]
    } : {})
  };
  return {
    job: job({
      status: withSnapshot ? 'completed' : 'needs_input',
      stages: [stage('images', 'succeeded', 'shot-01')],
      artifacts: [script, shots, shotImage, validation, ...deliveries],
      state
    }),
    contents: new Map<string, unknown>([
      [script.id, {
        title: '测试脚本',
        language: 'zh-CN',
        segments: [{ id: 'segment-01', narration: '解释核心概念', durationSeconds: 5, sourceKeyPoint: '核心概念' }]
      }],
      [shots.id, {
        scriptArtifactId: script.id,
        shots: [{ id: 'shot-01', sourceSegmentId: 'segment-01', narration: '解释核心概念', imagePrompt: '白底黑线火柴人讲解核心概念', motion: 'push-in', durationSeconds: 5 }]
      }]
    ])
  };
}
