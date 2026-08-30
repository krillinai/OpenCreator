import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CreatorActionRequest,
  CreatorArtifact,
  CreatorJob,
  CreatorJson
} from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CoverGeneratorWorkspace from './CoverGeneratorWorkspace.js';
import { CreatorSessionProvider } from './creator-session-store.js';

describe('CoverGeneratorWorkspace', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => `blob:cover-${blob.size}-${Math.random()}`)
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
  });

  it('renders real result artifacts and downloads them without a selection state', async () => {
    const fixture = createFixture();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '封面提示词' }), {
      target: { value: '一位创作者站在明亮的工作室中' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));
    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    expect(await within(workspace).findByAltText('封面方案 1')).toHaveAttribute(
      'src',
      expect.stringContaining('blob:cover-')
    );
    expect(within(workspace).getByAltText('封面方案 2')).toBeInTheDocument();
    expect(within(workspace).queryByText('V1 已生成，共 2 个方案'))
      .not.toBeInTheDocument();
    expect(fixture.applyAction).toHaveBeenCalledWith(
      'creator_job_cover_ui',
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'generate', workflow: true }
      })
    );

    fireEvent.click(within(workspace).getByRole('button', { name: '项目 V1' }));
    fireEvent.click(within(workspace).getByRole('menuitem', { name: /项目 V1/ }));
    expect(within(workspace).queryByText('正在查看 V1')).not.toBeInTheDocument();
    expect(within(workspace).queryByRole('button', { name: /设为项目封面/ }))
      .not.toBeInTheDocument();
    expect(within(workspace).queryByText(/· 已选/)).not.toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole('button', {
      name: '下载封面方案 1'
    }));
    expect(anchorClick).toHaveBeenCalled();
    anchorClick.mockRestore();
  });

  it('uploads a selected reference before starting generation', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });
    const reference = new File([png('reference')], 'reference.png', {
      type: 'image/png',
      lastModified: 123
    });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '封面提示词' }), {
      target: { value: '参考上传图片的主体和构图' }
    });
    fireEvent.change(within(workspace).getByLabelText('上传封面参考图'), {
      target: { files: [reference] }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));
    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(fixture.uploadReferenceImage).toHaveBeenCalledWith(
      'creator_job_cover_ui',
      expect.objectContaining({ file: reference })
    ));
    expect(fixture.applyAction).toHaveBeenCalledWith(
      'creator_job_cover_ui',
      expect.objectContaining({ action: 'run-stage' })
    );
  });

  it('configures one to four thumbnail options and sends the selected count', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '封面提示词' }), {
      target: { value: '四个不同构图方向的电影感人物封面' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));

    const countControl = within(workspace).getByRole('radiogroup', {
      name: '生成数量'
    });
    fireEvent.click(within(countControl).getByRole('radio', { name: '4 张' }));
    expect(within(countControl).getByRole('radio', { name: '4 张' }))
      .toHaveAttribute('aria-checked', 'true');
    expect(within(workspace).getByLabelText('任务摘要')).toHaveTextContent('生成数量4 张');

    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    expect(await within(workspace).findByAltText('封面方案 4')).toBeInTheDocument();
    expect(fixture.currentJob().state.candidateCount).toBe(4);
    expect(fixture.applyAction).toHaveBeenCalledWith(
      'creator_job_cover_ui',
      expect.objectContaining({
        action: 'update-settings',
        input: expect.objectContaining({
          patch: expect.objectContaining({ candidateCount: 4 })
        })
      })
    );
  });

  it('keeps an existing result reachable after returning to settings', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });
    const steps = within(workspace).getByRole('navigation', {
      name: '封面生成流程'
    });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '封面提示词' }), {
      target: { value: '一张可反复调整的电影感封面' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));
    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));
    expect(await within(workspace).findByAltText('封面方案 1')).toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole('button', { name: '上一步' }));
    expect(within(workspace).getByRole('heading', { name: '封面设置' }))
      .toBeInTheDocument();
    const resultStep = within(steps).getByRole('button', { name: '3 封面方案' });
    expect(resultStep).toBeEnabled();
    expect(resultStep.closest('li')).toHaveAttribute('data-visited', 'true');

    fireEvent.click(resultStep);
    expect(within(workspace).getByRole('region', { name: '封面生成项目产出' }))
      .toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole('button', { name: '上一步' }));
    fireEvent.click(within(workspace).getByRole('button', { name: '返回 V1 方案' }));
    expect(within(workspace).getByRole('region', { name: '封面生成项目产出' }))
      .toBeInTheDocument();
    expect(within(workspace).queryByText('已返回 V1 封面方案'))
      .not.toBeInTheDocument();
    expect(fixture.applyAction.mock.calls.filter(([, request]) => (
      request.action === 'run-stage'
    ))).toHaveLength(1);
  });

  it('shows real generation progress in the workspace and collaboration panel', () => {
    const fixture = createFixture();
    const runningJob: CreatorJob = {
      ...fixture.currentJob(),
      status: 'running',
      revision: 3,
      state: {
        ...fixture.currentJob().state,
        prompt: '电影感人物封面',
        currentStep: 2,
        furthestStep: 2,
        workspacePhase: 'result',
        currentStage: 'generate'
      },
      stages: [{
        id: 'cover_stage_running',
        jobId: 'creator_job_cover_ui',
        stageId: 'generate',
        executor: 'image',
        status: 'running',
        dispatchStatus: 'claimed',
        claimOwner: 'scheduler_1',
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: 'cover-stage-running',
        progress: {
          phase: 'generating_candidates',
          percent: 53,
          completed: 1,
          failed: 0,
          total: 2
        },
        errorCode: null,
        errorMessage: null,
        startedAt: '2026-08-30T08:00:01.000Z',
        finishedAt: null
      }]
    };

    renderWorkspace(fixture, runningJob);

    expect(screen.getByRole('progressbar', { name: '封面生成总进度' }))
      .toHaveAttribute('aria-valuenow', '53');
    expect(screen.getByRole('progressbar', { name: '生成封面方案进度' }))
      .toHaveAttribute('aria-valuenow', '53');
    expect(screen.getAllByText(/已完成 1\/2/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: '终止任务' }).length)
      .toBeGreaterThanOrEqual(1);
  });
});

function renderWorkspace(
  fixture: ReturnType<typeof createFixture>,
  initialJob = fixture.currentJob()
) {
  return render(
    <LanguageProvider initialPreference="zh-CN">
      <CreatorSessionProvider
        initialJob={initialJob}
        service={{
          applyAction: fixture.applyAction,
          uploadReferenceImage: fixture.uploadReferenceImage,
          openArtifact: fixture.openArtifact,
          runAgentTurn: vi.fn()
        } as never}
      >
        <CoverGeneratorWorkspace onBack={vi.fn()} />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
}

function createFixture() {
  const createdAt = '2026-08-29T08:00:00.000Z';
  let job: CreatorJob = {
    id: 'creator_job_cover_ui',
    projectId: 'project_1',
    templateId: 'cover',
    templateVersion: 2,
    status: 'draft',
    revision: 0,
    state: {
      sourceType: 'prompt',
      sourceUrl: '',
      prompt: '',
      ratio: '16:9',
      candidateCount: 2,
      quality: 'medium',
      referenceImageArtifactId: null,
      currentStep: 0,
      furthestStep: 0,
      workspacePhase: 'configure',
      resultVersion: null,
      resultTab: 'options',
      draftBaseVersion: null,
      currentStage: null
    },
    agentThreadId: null,
    stages: [],
    artifacts: [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };

  const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
    if (request.action === 'update-settings') {
      job = {
        ...job,
        revision: job.revision + 1,
        state: {
          ...job.state,
          ...(request.input.patch as Record<string, CreatorJson>)
        }
      };
    } else if (request.action === 'run-stage') {
      const version = 1;
      const candidateCount = typeof job.state.candidateCount === 'number'
        ? Math.max(1, Math.min(4, Math.floor(job.state.candidateCount)))
        : 2;
      const artifacts = Array.from(
        { length: candidateCount },
        (_, index) => coverArtifact(job.id, index + 1, version, createdAt)
      );
      job = {
        ...job,
        status: 'completed',
        revision: job.revision + 1,
        artifacts,
        state: {
          ...job.state,
          currentStage: 'generate',
          resultVersion: version,
          latestResultVersion: version,
          resultSnapshots: [{
            version,
            createdAt,
            action: 'stage-succeeded',
            stageId: 'generate',
            description: '生成封面',
            artifactRefs: {
              cover_image: artifacts.map(artifact => artifact.id),
              ...(typeof job.state.referenceImageArtifactId === 'string'
                ? { reference_image: [job.state.referenceImageArtifactId] }
                : {})
            },
            changedArtifactIds: artifacts.map(artifact => artifact.id),
            staleArtifactIds: [],
            state: {
              ...job.state,
              currentStep: undefined as never
            }
          }]
        }
      };
    }
    return {
      job,
      receipt: {
        actor: 'user' as const,
        action: request.action,
        summary: request.action,
        affectedArtifacts: [],
        newRevision: job.revision,
        createdAt
      }
    };
  });

  const uploadReferenceImage = vi.fn(async (_jobId: string, input: {
    file: File;
    expectedRevision: number;
  }) => {
    const artifact: CreatorArtifact = {
      id: 'reference_artifact_1',
      jobId: job.id,
      kind: 'reference_image',
      version: 1,
      status: 'completed',
      path: '/tmp/reference.png',
      sourceArtifactIds: [],
      metadata: {
        fileName: input.file.name,
        size: input.file.size,
        lastModified: input.file.lastModified,
        mimeType: input.file.type
      },
      createdAt
    };
    job = {
      ...job,
      revision: job.revision + 1,
      artifacts: [...job.artifacts, artifact],
      state: {
        ...job.state,
        referenceImageArtifactId: artifact.id
      }
    };
    return { job, artifact, deduplicated: false };
  });

  return {
    currentJob: () => job,
    applyAction,
    uploadReferenceImage,
    openArtifact: vi.fn(async (_jobId: string, artifactId: string) => (
      new Response(new Blob([png(artifactId)], { type: 'image/png' }))
    ))
  };
}

function coverArtifact(
  jobId: string,
  candidate: number,
  resultVersion: number,
  createdAt: string
): CreatorArtifact {
  return {
    id: `cover_artifact_${candidate}`,
    jobId,
    kind: 'cover_image',
    version: candidate,
    status: 'completed',
    path: `/tmp/cover-${candidate}.png`,
    sourceArtifactIds: [],
    metadata: {
      candidate,
      resultVersion,
      ratio: '16:9',
      quality: 'medium',
      mimeType: 'image/png',
      fileName: `cover-${candidate}.png`
    },
    createdAt
  };
}

function png(label: string): ArrayBuffer {
  return Uint8Array.from(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label.padEnd(24, '.'))
  ])).buffer;
}
