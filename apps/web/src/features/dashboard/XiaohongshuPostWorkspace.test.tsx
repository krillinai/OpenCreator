import type { CreatorActionRequest, CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import XiaohongshuPostWorkspace from './XiaohongshuPostWorkspace.js';
import {
  CreatorSessionProvider,
  useOptionalCreatorSession
} from './creator-session-store.js';

describe('XiaohongshuPostWorkspace', () => {
  it('saves settings, generates a post, and copies the real artifact content', async () => {
    const copy = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy }
    });
    const markdown = '# 第一次参与开源项目\n\n先确认方向，再完成一个小闭环。\n\n#开源 #程序员\n';
    let current = initialJob();
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') {
        current = {
          ...current,
          revision: current.revision + 1,
          state: { ...current.state, ...(request.input.patch as CreatorJob['state']) }
        };
      }
      if (request.action === 'run-stage') current = completedJob(current);
      return {
        job: current,
        receipt: {
          actor: request.actor ?? 'user' as const,
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: current.revision,
          createdAt: current.updatedAt
        }
      };
    });
    const openArtifact = vi.fn(async () => new Response(markdown, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
    }));

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={current}
          service={{ applyAction, openArtifact, runAgentTurn: vi.fn() }}
        >
          <XiaohongshuPostWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const workflow = screen.getByRole('navigation', { name: '小红书帖子生成流程' });
    expect(screen.getByRole('button', { name: /创作设置/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: /帖子结果/ })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: '帖子结果' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '小红书帖子主题或素材' }), {
      target: { value: '分享第一次参与开源项目的过程' }
    });
    fireEvent.change(screen.getByPlaceholderText('例如：准备参与开源项目的程序员'), {
      target: { value: '准备参与开源项目的程序员' }
    });
    fireEvent.click(screen.getByRole('radio', { name: '教程干货' }));
    fireEvent.click(screen.getByRole('radio', { name: '精简' }));
    fireEvent.click(screen.getByRole('button', { name: '生成帖子' }));

    expect(await screen.findByRole('textbox', { name: '生成的小红书帖子' })).toHaveValue(markdown);
    expect(workflow).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /帖子结果/ })).toHaveAttribute('aria-current', 'step');
    expect(openArtifact).toHaveBeenCalledWith('xiaohongshu_job', 'xiaohongshu_post_v1');
    expect(applyAction).toHaveBeenLastCalledWith(
      'xiaohongshu_job',
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'generate' }
      })
    );
    expect(current.state).toMatchObject({
      topic: '分享第一次参与开源项目的过程',
      audience: '准备参与开源项目的程序员',
      style: 'tutorial',
      length: 'short'
    });

    fireEvent.click(screen.getByRole('button', { name: '复制帖子' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(markdown));
    expect(screen.getByText('帖子已复制到剪贴板')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByRole('heading', { name: '创作设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
  });

  it('uses settings updated through the collaboration session', async () => {
    const original = initialJob();
    const updated: CreatorJob = {
      ...original,
      revision: 1,
      state: {
        ...original.state,
        topic: 'Agent 更新后的主题',
        audience: '新手创作者',
        style: 'review',
        length: 'long',
        extraRequirements: '只使用可核实的信息'
      }
    };
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => ({
      job: { ...updated, revision: updated.revision + 1 },
      receipt: {
        actor: request.actor ?? 'user' as const,
        action: request.action,
        summary: request.action,
        affectedArtifacts: [],
        newRevision: updated.revision + 1,
        createdAt: updated.updatedAt
      }
    }));

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={original}
          service={{ applyAction, runAgentTurn: vi.fn() }}
        >
          <ApplyRemoteSnapshotButton job={updated} />
          <XiaohongshuPostWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '应用远程更新' }));
    await waitFor(() => expect(
      screen.getByRole('textbox', { name: '小红书帖子主题或素材' })
    ).toHaveValue('Agent 更新后的主题'));
    expect(screen.getByRole('radio', { name: '真实测评' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '详细' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: '生成帖子' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledOnce());
    expect(applyAction).toHaveBeenCalledWith(
      original.id,
      expect.objectContaining({ action: 'run-stage' })
    );
  });

  it('clears the previous post while a newer artifact is loading', async () => {
    const first = completedJob(initialJob());
    const secondArtifact: CreatorArtifact = {
      ...first.artifacts[0]!,
      id: 'xiaohongshu_post_v2',
      version: 2,
      metadata: {
        ...first.artifacts[0]!.metadata,
        title: '第二版帖子',
        resultVersion: 2
      }
    };
    const second: CreatorJob = {
      ...first,
      revision: first.revision + 1,
      artifacts: [...first.artifacts, secondArtifact],
      state: { ...first.state, latestResultVersion: 2, resultVersion: 2 }
    };
    let resolveSecond!: (response: Response) => void;
    const secondResponse = new Promise<Response>(resolve => { resolveSecond = resolve; });
    const openArtifact = vi.fn(async (_jobId: string, artifactId: string) => {
      if (artifactId === secondArtifact.id) return await secondResponse;
      return new Response('# 第一版帖子\n');
    });

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={first}
          service={{ applyAction: vi.fn(), openArtifact, runAgentTurn: vi.fn() }}
        >
          <ApplyRemoteSnapshotButton job={second} />
          <XiaohongshuPostWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(await screen.findByRole('textbox', { name: '生成的小红书帖子' }))
      .toHaveValue('# 第一版帖子\n');
    fireEvent.click(screen.getByRole('button', { name: '应用远程更新' }));
    await waitFor(() => expect(
      screen.queryByRole('textbox', { name: '生成的小红书帖子' })
    ).not.toBeInTheDocument());

    resolveSecond(new Response('# 第二版帖子\n'));
    expect(await screen.findByRole('textbox', { name: '生成的小红书帖子' }))
      .toHaveValue('# 第二版帖子\n');
  });

  it('releases the download URL after the browser starts the download', async () => {
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const createObjectURL = vi.fn(() => 'blob:xiaohongshu-post');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    try {
      render(
        <LanguageProvider initialPreference="zh-CN">
          <CreatorSessionProvider
            initialJob={completedJob(initialJob())}
            service={{
              applyAction: vi.fn(),
              openArtifact: vi.fn(async () => new Response('# 可下载的帖子\n')),
              runAgentTurn: vi.fn()
            }}
          >
            <XiaohongshuPostWorkspace onBack={vi.fn()} />
          </CreatorSessionProvider>
        </LanguageProvider>
      );

      expect(screen.getByRole('button', { name: /帖子结果/ })).toHaveAttribute('aria-current', 'step');
      expect(await screen.findByRole('textbox', { name: '生成的小红书帖子' }))
        .toHaveValue('# 可下载的帖子\n');
      fireEvent.click(screen.getByRole('button', { name: '下载 Markdown' }));

      expect(anchorClick).toHaveBeenCalledOnce();
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(revokeObjectURL).not.toHaveBeenCalled();
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:xiaohongshu-post'));
    } finally {
      anchorClick.mockRestore();
      restoreUrlMethod('createObjectURL', createObjectUrlDescriptor);
      restoreUrlMethod('revokeObjectURL', revokeObjectUrlDescriptor);
    }
  });
});

function ApplyRemoteSnapshotButton(props: { job: CreatorJob }) {
  const session = useOptionalCreatorSession();
  return (
    <button type="button" onClick={() => session?.applyRemoteSnapshot(props.job)}>
      应用远程更新
    </button>
  );
}

function initialJob(): CreatorJob {
  return {
    id: 'xiaohongshu_job',
    projectId: 'project_1',
    templateId: 'xiaohongshu-post',
    templateVersion: 1,
    status: 'draft',
    revision: 0,
    state: {
      topic: '',
      audience: '',
      style: 'experience',
      length: 'medium',
      extraRequirements: '',
      currentStage: null
    },
    agentThreadId: null,
    stages: [],
    artifacts: [],
    providerRequests: [],
    activities: [],
    createdAt: '2026-09-08T08:00:00.000Z',
    updatedAt: '2026-09-08T08:00:00.000Z'
  };
}

function completedJob(job: CreatorJob): CreatorJob {
  const artifact: CreatorArtifact = {
    id: 'xiaohongshu_post_v1',
    jobId: job.id,
    kind: 'xiaohongshu_post',
    version: 1,
    status: 'completed',
    path: '/tmp/OpenCreator-xiaohongshu-post.md',
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      fileName: 'OpenCreator-xiaohongshu-post.md',
      title: '第一次参与开源项目',
      resultVersion: 1
    },
    createdAt: '2026-09-08T08:01:00.000Z'
  };
  return {
    ...job,
    status: 'completed',
    revision: job.revision + 2,
    state: {
      ...job.state,
      currentStage: 'generate',
      resultVersion: 1,
      latestResultVersion: 1
    },
    stages: [{
      id: 'xiaohongshu_stage_v1',
      jobId: job.id,
      stageId: 'generate',
      executor: 'xiaohongshu-post',
      status: 'succeeded',
      dispatchStatus: 'finished',
      claimOwner: null,
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: null,
      scopeKey: null,
      inputFingerprint: null,
      progress: {
        phase: 'completed',
        percent: 100,
        completed: 1,
        failed: 0,
        total: 1,
        resultVersion: 1
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-09-08T08:00:30.000Z',
      finishedAt: '2026-09-08T08:01:00.000Z'
    }],
    artifacts: [artifact],
    updatedAt: '2026-09-08T08:01:00.000Z'
  };
}

function restoreUrlMethod(
  key: 'createObjectURL' | 'revokeObjectURL',
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor === undefined) delete (URL as unknown as Record<string, unknown>)[key];
  else Object.defineProperty(URL, key, descriptor);
}
