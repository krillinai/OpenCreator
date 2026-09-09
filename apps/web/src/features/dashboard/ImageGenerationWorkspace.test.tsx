import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CreatorActionRequest,
  CreatorArtifact,
  CreatorJob,
  CreatorJson
} from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import ImageGenerationWorkspace from './ImageGenerationWorkspace.js';
import { CreatorSessionProvider } from './creator-session-store.js';

describe('ImageGenerationWorkspace', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:image-generation-reference')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
  });

  it('places the reference upload before the prompt in one row', () => {
    const fixture = createFixture({ pending: true });
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '图像生成 操作区' });
    const prompt = within(workspace).getByRole('textbox', { name: '提示词' });
    const referenceUpload = within(workspace).getByLabelText('上传图像生成参考图');
    const row = prompt.closest('.cover-prompt-row');

    expect(row).toContainElement(referenceUpload);
    expect(prompt).toHaveAttribute('rows', '7');
    expect(referenceUpload.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0);
  });

  it('does not persist an untouched pending project', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture({ pending: true });
      renderWorkspace(fixture);

      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(fixture.ensureJob).not.toHaveBeenCalled();
      expect(fixture.applyAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['gemini', 'Gemini'],
    ['jimeng', '即梦'],
    ['kling', '可灵']
  ] as const)('keeps the preset-selected %s provider', async (provider, label) => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture();
      const initialJob: CreatorJob = {
        ...fixture.currentJob(),
        presetOrigin: {
          module: 'image-generation',
          id: `${provider}-preset`,
          version: 1,
          locale: 'zh-CN',
          title: `${label} 模板`,
          contentHash: 'a'.repeat(64)
        },
        state: {
          ...fixture.currentJob().state,
          provider,
          currentStep: 1,
          furthestStep: 1
        }
      };

      renderWorkspace(fixture, initialJob);
      expect(screen.getByRole('radio', { name: label })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(fixture.applyAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores a saved project at its second step', () => {
    const fixture = createFixture();
    const initialJob: CreatorJob = {
      ...fixture.currentJob(),
      state: {
        ...fixture.currentJob().state,
        prompt: '一张产品主视觉',
        currentStep: 1,
        furthestStep: 1
      }
    };

    renderWorkspace(fixture, initialJob);

    expect(screen.getByRole('heading', { name: '生成设置' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '提示词' })).not.toBeInTheDocument();
  });

  it('opens an existing project on its latest generated version', async () => {
    const fixture = createFixture();
    const createdAt = fixture.currentJob().createdAt;
    const versionOne = imageArtifact(fixture.currentJob().id, 1, createdAt);
    const versionTwo = imageArtifact(fixture.currentJob().id, 2, createdAt);
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
          imageResultSnapshot(1, versionOne, createdAt),
          imageResultSnapshot(2, versionTwo, createdAt)
        ]
      }
    };

    renderWorkspace(fixture, initialJob);

    expect(await screen.findByRole('heading', { name: '生成结果' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    await waitFor(() => expect(fixture.openArtifact).toHaveBeenCalledWith(
      initialJob.id,
      versionTwo.id
    ));
  });

  it('uploads the selected reference before starting image generation', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '图像生成 操作区' });
    const reference = new File([png('reference')], 'reference.png', {
      type: 'image/png',
      lastModified: 123
    });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '提示词' }), {
      target: { value: '参考上传图片的主体和构图生成新画面' }
    });
    fireEvent.change(within(workspace).getByLabelText('上传图像生成参考图'), {
      target: { files: [reference] }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));
    fireEvent.click(within(workspace).getByRole('button', { name: '继续' }));
    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(fixture.uploadReferenceImage).toHaveBeenCalledWith(
      'creator_job_image_ui',
      expect.objectContaining({ file: reference })
    ));
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith(
      'creator_job_image_ui',
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'generate' }
      })
    ));
    const uploadOrder = fixture.uploadReferenceImage.mock.invocationCallOrder[0]!;
    const runOrder = fixture.applyAction.mock.invocationCallOrder.at(-1)!;
    expect(uploadOrder).toBeLessThan(runOrder);
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
        ensureJob={fixture.ensureJob}
        service={{
          applyAction: fixture.applyAction,
          uploadReferenceImage: fixture.uploadReferenceImage,
          openArtifact: fixture.openArtifact,
          runAgentTurn: vi.fn()
        } as never}
      >
        <ImageGenerationWorkspace onBack={vi.fn()} />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
}

function imageArtifact(jobId: string, resultVersion: number, createdAt: string): CreatorArtifact {
  return {
    id: `generated_image_v${resultVersion}`,
    jobId,
    kind: 'generated_image',
    version: resultVersion,
    status: 'completed',
    path: `/tmp/generated-image-v${resultVersion}.png`,
    sourceArtifactIds: [],
    metadata: {
      candidate: 1,
      resultVersion,
      fileName: `generated-image-v${resultVersion}.png`,
      mimeType: 'image/png'
    },
    createdAt
  };
}

function imageResultSnapshot(
  version: number,
  artifact: CreatorArtifact,
  createdAt: string
): CreatorJson {
  return {
    version,
    createdAt,
    action: 'stage-succeeded',
    stageId: 'generate',
    description: `生成图片 V${version}`,
    artifactRefs: { generated_image: [artifact.id] },
    changedArtifactIds: [artifact.id],
    staleArtifactIds: [],
    state: {
      prompt: `第 ${version} 版图片`,
      provider: 'openai',
      size: '1024x1024',
      quality: 'medium',
      candidateCount: 1
    }
  };
}

function createFixture(options: { pending?: boolean } = {}) {
  const createdAt = '2026-09-01T08:00:00.000Z';
  let job: CreatorJob = {
    id: options.pending ? 'pending:project_1:image-generation' : 'creator_job_image_ui',
    projectId: 'project_1',
    templateId: 'image-generation',
    templateVersion: options.pending ? 1 : 2,
    status: 'draft',
    revision: 0,
    presetOrigin: null,
    state: options.pending ? {} : {
      prompt: '',
      provider: 'openai',
      size: '1024x1024',
      quality: 'medium',
      candidateCount: 2,
      referenceImageArtifactId: null,
      currentStep: 0,
      furthestStep: 0,
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
    const patch = request.action === 'update-settings'
      ? request.input.patch as Record<string, CreatorJson>
      : {};
    job = {
      ...job,
      revision: job.revision + 1,
      state: { ...job.state, ...patch }
    };
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

  const ensureJob = vi.fn(async (state: Record<string, CreatorJson>) => {
    job = {
      ...job,
      id: 'creator_job_image_ui',
      templateVersion: 2,
      state
    };
    return job;
  });

  const uploadReferenceImage = vi.fn(async (_jobId: string, input: {
    file: File;
    expectedRevision: number;
  }) => {
    const artifact: CreatorArtifact = {
      id: 'reference_artifact_image_1',
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
      state: { ...job.state, referenceImageArtifactId: artifact.id }
    };
    return { job, artifact, deduplicated: false };
  });

  return {
    currentJob: () => job,
    ensureJob,
    applyAction,
    uploadReferenceImage,
    openArtifact: vi.fn(async () => (
      new Response(new Blob([png('reference')], { type: 'image/png' }))
    ))
  };
}

function png(label: string): ArrayBuffer {
  return Uint8Array.from(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label.padEnd(24, '.'))
  ])).buffer;
}
