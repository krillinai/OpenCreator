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

  it('places the reference upload before the thumbnail prompt in one row', () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });
    const prompt = within(workspace).getByRole('textbox', { name: '内容与补充要求' });
    const referenceUpload = within(workspace).getByLabelText('上传封面参考图');
    const row = prompt.closest('.cover-prompt-row');

    expect(row).toContainElement(referenceUpload);
    expect(referenceUpload.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0);
  });

  it('renders real result artifacts and downloads them without a selection state', async () => {
    const fixture = createFixture();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '内容与补充要求' }), {
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

    fireEvent.change(within(workspace).getByRole('textbox', { name: '内容与补充要求' }), {
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

  it('shows that a YouTube thumbnail was actually used for the generated version', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });

    fireEvent.change(within(workspace).getByPlaceholderText(
      '分析视频内容并参考 YouTube 原封面生成'
    ), {
      target: { value: 'https://www.youtube.com/watch?v=cover-reference' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));
    expect(within(workspace).queryByLabelText('任务摘要')).not.toBeInTheDocument();
    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    expect(await within(workspace).findByText('V1 · 已参考 YouTube 原封面'))
      .toBeInTheDocument();
    expect(within(workspace).getByLabelText('任务摘要'))
      .toHaveTextContent('实际参考YouTube 原封面');

    fireEvent.click(within(workspace).getByRole('tab', { name: '参考素材' }));
    expect(within(workspace).getByText('已用于本版本生成')).toBeInTheDocument();
  });

  it('configures one to four thumbnail options and sends the selected count', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '内容与补充要求' }), {
      target: { value: '四个不同构图方向的电影感人物封面' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));

    const countControl = within(workspace).getByRole('radiogroup', {
      name: '生成数量'
    });
    fireEvent.click(within(countControl).getByRole('radio', { name: '4 张' }));
    expect(within(countControl).getByRole('radio', { name: '4 张' }))
      .toHaveAttribute('aria-checked', 'true');
    expect(within(workspace).queryByLabelText('任务摘要')).not.toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    expect(await within(workspace).findByAltText('封面方案 4')).toBeInTheDocument();
    expect(within(workspace).getByLabelText('任务摘要')).toHaveTextContent('生成数量4');
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

  it('persists the selected style, language, and exact cover copy', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '内容与补充要求' }), {
      target: { value: '突出长期复利和可执行方法' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));
    fireEvent.click(within(workspace).getByRole('radio', { name: '财富' }));
    fireEvent.change(within(workspace).getByLabelText('封面文字语言'), {
      target: { value: 'en-US' }
    });
    fireEvent.change(within(workspace).getByRole('textbox', { name: '主标题 选填' }), {
      target: { value: 'Build Lasting Wealth' }
    });
    fireEvent.change(within(workspace).getByRole('textbox', { name: '副标题 选填' }), {
      target: { value: 'The power of long-term compounding' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    await within(workspace).findByAltText('封面方案 1');
    expect(fixture.currentJob().state).toMatchObject({
      coverStyle: 'wealth-platinum-red',
      coverTextLanguage: 'en-US',
      resolvedCoverTextLanguage: 'en-US',
      coverHeadline: 'Build Lasting Wealth',
      coverSubheadline: 'The power of long-term compounding'
    });
    expect(fixture.applyAction).toHaveBeenCalledWith(
      'creator_job_cover_ui',
      expect.objectContaining({
        action: 'update-settings',
        input: expect.objectContaining({
          patch: expect.objectContaining({
            coverStyle: 'wealth-platinum-red',
            resolvedCoverTextLanguage: 'en-US'
          })
        })
      })
    );
  });

  it('shows the OpenCreator display language as the concrete default option', () => {
    const fixture = createFixture();
    renderWorkspace(fixture, fixture.currentJob(), 'en-US');
    const workspace = screen.getByRole('region', { name: 'Thumbnail Generator workspace' });

    fireEvent.change(within(workspace).getByRole('textbox', { name: 'Content and requirements' }), {
      target: { value: 'A clear editorial thumbnail' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: 'Continue' }));

    expect(within(workspace).getByLabelText('Cover text language')).toHaveValue('en-US');
    expect(within(workspace).queryByRole('option', {
      name: /Follow OpenCreator/
    })).not.toBeInTheDocument();
  });

  it('requires a description for the custom style', () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '内容与补充要求' }), {
      target: { value: '突出核心主体' }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));
    fireEvent.click(within(workspace).getByRole('radio', { name: '自定义' }));
    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    expect(within(workspace).getByRole('alert')).toHaveTextContent('请填写自定义风格说明');
    expect(fixture.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage'))
      .toBe(false);
  });

  it('keeps an existing result reachable after returning to settings', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '封面生成 操作区' });
    const steps = within(workspace).getByRole('navigation', {
      name: '封面生成流程'
    });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '内容与补充要求' }), {
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

  it('restores a saved project at its second step', () => {
    const fixture = createFixture();
    const initialJob: CreatorJob = {
      ...fixture.currentJob(),
      state: {
        ...fixture.currentJob().state,
        prompt: '一张电影感人物封面',
        currentStep: 1,
        furthestStep: 1
      }
    };

    renderWorkspace(fixture, initialJob);

    expect(screen.getByRole('heading', { name: '封面设置' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '封面提示词' })).not.toBeInTheDocument();
  });

  it('opens an existing project on its latest generated version', async () => {
    const fixture = createFixture();
    const createdAt = fixture.currentJob().createdAt;
    const versionOne = {
      ...coverArtifact(fixture.currentJob().id, 1, 1, createdAt),
      id: 'cover_artifact_v1'
    };
    const versionTwo = {
      ...coverArtifact(fixture.currentJob().id, 1, 2, createdAt),
      id: 'cover_artifact_v2'
    };
    const initialJob: CreatorJob = {
      ...fixture.currentJob(),
      status: 'completed',
      artifacts: [versionOne, versionTwo],
      state: {
        ...fixture.currentJob().state,
        currentStep: 1,
        furthestStep: 2,
        resultVersion: 1,
        latestResultVersion: 2,
        resultSnapshots: [
          coverResultSnapshot(1, versionOne, createdAt),
          coverResultSnapshot(2, versionTwo, createdAt)
        ]
      }
    };

    renderWorkspace(fixture, initialJob);

    expect(await screen.findByRole('region', { name: '封面生成项目产出' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    await waitFor(() => expect(fixture.openArtifact).toHaveBeenCalledWith(
      initialJob.id,
      versionTwo.id
    ));
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

  it('shows the same normalized YouTube workflow progress in both panels', () => {
    const fixture = createFixture();
    const runningJob: CreatorJob = {
      ...fixture.currentJob(),
      status: 'running',
      revision: 3,
      state: {
        ...fixture.currentJob().state,
        sourceType: 'youtube',
        sourceUrl: 'https://www.youtube.com/watch?v=cover-test',
        currentStep: 2,
        furthestStep: 2,
        workspacePhase: 'result',
        currentStage: 'analyze-source'
      },
      stages: [{
        id: 'cover_analysis_running',
        jobId: 'creator_job_cover_ui',
        stageId: 'analyze-source',
        executor: 'cover-analysis',
        status: 'running',
        dispatchStatus: 'claimed',
        claimOwner: 'scheduler_1',
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: 'cover-analysis-running',
        progress: {
          workflow: true,
          phase: 'analyzing_source',
          percent: 45
        },
        errorCode: null,
        errorMessage: null,
        startedAt: '2026-09-02T08:00:01.000Z',
        finishedAt: null
      }]
    };

    renderWorkspace(fixture, runningJob);

    expect(screen.getByRole('progressbar', { name: '封面生成总进度' }))
      .toHaveAttribute('aria-valuenow', '16');
    expect(screen.getByRole('progressbar', { name: '分析视频内容进度' }))
      .toHaveAttribute('aria-valuenow', '16');
    expect(screen.queryByText('45%')).not.toBeInTheDocument();
  });

  it('shows YouTube metadata retries as matching indeterminate progress', () => {
    const fixture = createFixture();
    const runningJob: CreatorJob = {
      ...fixture.currentJob(),
      status: 'running',
      revision: 3,
      state: {
        ...fixture.currentJob().state,
        sourceType: 'youtube',
        sourceUrl: 'https://www.youtube.com/watch?v=cover-test',
        currentStep: 2,
        furthestStep: 2,
        workspacePhase: 'result',
        currentStage: 'analyze-source'
      },
      stages: [{
        id: 'cover_analysis_retrying',
        jobId: 'creator_job_cover_ui',
        stageId: 'analyze-source',
        executor: 'cover-analysis',
        status: 'running',
        dispatchStatus: 'claimed',
        claimOwner: 'scheduler_1',
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: 'cover-analysis-retrying',
        progress: {
          workflow: true,
          phase: 'reading_source_retry',
          percent: null,
          retryAttempt: 2,
          retryTotal: 3
        },
        errorCode: null,
        errorMessage: null,
        startedAt: '2026-09-02T08:00:01.000Z',
        finishedAt: null
      }]
    };

    renderWorkspace(fixture, runningJob);

    expect(screen.getByRole('progressbar', { name: '封面生成总进度' }))
      .not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('progressbar', { name: '分析视频内容进度' }))
      .not.toHaveAttribute('aria-valuenow');
    expect(screen.getAllByText('读取视频信息超时，正在重试 2/3').length)
      .toBeGreaterThanOrEqual(2);
  });
});

function renderWorkspace(
  fixture: ReturnType<typeof createFixture>,
  initialJob = fixture.currentJob(),
  language: 'zh-CN' | 'en-US' = 'zh-CN'
) {
  return render(
    <LanguageProvider initialPreference={language}>
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
    presetOrigin: null,
    state: {
      sourceType: 'prompt',
      sourceUrl: '',
      prompt: '',
      ratio: '16:9',
      candidateCount: 2,
      quality: 'medium',
      coverStyle: 'bilibili-red-blue-white',
      coverTextLanguage: 'auto',
      resolvedCoverTextLanguage: 'zh-CN',
      customStylePrompt: '',
      coverHeadline: '',
      coverSubheadline: '',
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
      const youtubeKeyframe = job.state.sourceType === 'youtube'
        ? sourceKeyframeArtifact(job.id, createdAt)
        : undefined;
      const selectedReference = typeof job.state.referenceImageArtifactId === 'string'
        ? job.artifacts.find(artifact => (
            artifact.id === job.state.referenceImageArtifactId
            && artifact.kind === 'reference_image'
          ))
        : undefined;
      const generationReference = selectedReference ?? youtubeKeyframe;
      const artifacts = Array.from(
        { length: candidateCount },
        (_, index) => coverArtifact(
          job.id,
          index + 1,
          version,
          createdAt,
          generationReference === undefined
            ? coverMetadata(job.state)
            : {
                ...coverMetadata(job.state),
                referenceArtifactId: generationReference.id,
                referenceArtifactKind: generationReference.kind
              }
        )
      );
      job = {
        ...job,
        status: 'completed',
        revision: job.revision + 1,
        artifacts: [
          ...job.artifacts,
          ...(youtubeKeyframe === undefined ? [] : [youtubeKeyframe]),
          ...artifacts
        ],
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
              ...(youtubeKeyframe === undefined
                ? {}
                : { source_keyframe: [youtubeKeyframe.id] }),
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

function coverMetadata(state: Record<string, CreatorJson>): Record<string, CreatorJson> {
  return {
    coverStyle: typeof state.coverStyle === 'string'
      ? state.coverStyle
      : 'bilibili-red-blue-white',
    coverTextLanguage: typeof state.resolvedCoverTextLanguage === 'string'
      ? state.resolvedCoverTextLanguage
      : 'zh-CN',
    headline: typeof state.coverHeadline === 'string' && state.coverHeadline
      ? state.coverHeadline
      : '自动生成标题',
    subheadline: typeof state.coverSubheadline === 'string'
      ? state.coverSubheadline
      : ''
  };
}

function coverArtifact(
  jobId: string,
  candidate: number,
  resultVersion: number,
  createdAt: string,
  metadataPatch: Record<string, CreatorJson> = {}
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
      fileName: `cover-${candidate}.png`,
      ...metadataPatch
    },
    createdAt
  };
}

function sourceKeyframeArtifact(
  jobId: string,
  createdAt: string
): CreatorArtifact {
  return {
    id: 'source_keyframe_1',
    jobId,
    kind: 'source_keyframe',
    version: 1,
    status: 'completed',
    path: '/tmp/source-thumbnail.jpg',
    sourceArtifactIds: [],
    metadata: {
      fileName: 'source-thumbnail.jpg',
      sourceTitle: 'Reference video',
      mimeType: 'image/jpeg'
    },
    createdAt
  };
}

function coverResultSnapshot(
  version: number,
  artifact: CreatorArtifact,
  createdAt: string
): CreatorJson {
  return {
    version,
    createdAt,
    action: 'stage-succeeded',
    stageId: 'generate',
    description: `生成封面 V${version}`,
    artifactRefs: { cover_image: [artifact.id] },
    changedArtifactIds: [artifact.id],
    staleArtifactIds: [],
    state: {
      prompt: `第 ${version} 版封面`,
      ratio: '16:9',
      quality: 'medium',
      candidateCount: 1
    }
  };
}

function png(label: string): ArrayBuffer {
  return Uint8Array.from(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label.padEnd(24, '.'))
  ])).buffer;
}
