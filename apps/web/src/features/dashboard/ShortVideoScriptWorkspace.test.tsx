import { changeControl } from '../../test/select-option.js';
import { createDefaultCreatorServicesConfig, type CreatorActionRequest, type CreatorArtifact, type CreatorJob } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import ShortVideoScriptWorkspace from './ShortVideoScriptWorkspace.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import { OfficialServicesContext } from './official-services.js';

describe('ShortVideoScriptWorkspace', () => {
  it('saves settings, generates a script, and copies and downloads the edited content', async () => {
    const copy = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy }
    });
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const createObjectURL = vi.fn(() => 'blob:short-video-script');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const markdown = '# 第一次参与开源\n\n| 段落 | 时间 | 口播 / 对白 | 画面建议 |\n';
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

    try {
      render(
        <LanguageProvider initialPreference="zh-CN">
          <CreatorSessionProvider
            initialJob={current}
            service={{ applyAction, openArtifact, runAgentTurn: vi.fn() }}
          >
            <ShortVideoScriptWorkspace onBack={vi.fn()} />
          </CreatorSessionProvider>
        </LanguageProvider>
      );

      fireEvent.change(screen.getByRole('textbox', { name: '短视频脚本主题或素材' }), {
        target: { value: '分享第一次参与开源项目的过程' }
      });
      fireEvent.change(screen.getByPlaceholderText('例如：准备参与开源项目的程序员'), {
        target: { value: '准备参与开源项目的程序员' }
      });
      changeControl(screen.getByRole('combobox', { name: '发布平台或场景' }), {
        target: { value: 'bilibili' }
      });
      fireEvent.change(screen.getByRole('spinbutton', { name: '目标时长（秒）' }), {
        target: { value: '90' }
      });
      changeControl(screen.getByRole('combobox', { name: '表达语气' }), {
        target: { value: 'professional' }
      });
      fireEvent.change(screen.getByPlaceholderText('例如：开场直接给结论，不使用夸张表达'), {
        target: { value: '给出三个具体步骤' }
      });
      fireEvent.click(screen.getByRole('button', { name: '生成脚本' }));

      const result = await screen.findByRole('textbox', { name: '生成的短视频脚本' });
      expect(result).toHaveValue(markdown);
      expect(openArtifact).toHaveBeenCalledWith('script_job', 'short_video_script_v1');
      expect(current.state).toMatchObject({
        topic: '分享第一次参与开源项目的过程',
        audience: '准备参与开源项目的程序员',
        platform: 'bilibili',
        targetDurationSeconds: 90,
        tone: 'professional',
        extraRequirements: '给出三个具体步骤'
      });

      fireEvent.change(result, { target: { value: '# 修改后的脚本\n' } });
      fireEvent.click(screen.getByRole('button', { name: '复制脚本' }));
      await waitFor(() => expect(copy).toHaveBeenCalledWith('# 修改后的脚本\n'));
      fireEvent.click(screen.getByRole('button', { name: '下载 Markdown' }));
      expect(anchorClick).toHaveBeenCalledOnce();
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:short-video-script'));
    } finally {
      anchorClick.mockRestore();
      restoreUrlMethod('createObjectURL', createObjectUrlDescriptor);
      restoreUrlMethod('revokeObjectURL', revokeObjectUrlDescriptor);
    }
  });

  it('rejects a target duration outside the supported range before submitting', () => {
    const applyAction = vi.fn();
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={initialJob()}
          service={{ applyAction, runAgentTurn: vi.fn() }}
        >
          <ShortVideoScriptWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    fireEvent.change(screen.getByRole('textbox', { name: '短视频脚本主题或素材' }), {
      target: { value: '测试脚本' }
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '目标时长（秒）' }), {
      target: { value: '10' }
    });
    fireEvent.click(screen.getByRole('button', { name: '生成脚本' }));

    expect(screen.getByRole('alert')).toHaveTextContent('目标时长应为 15 到 600 秒的整数');
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('shows the configured text model instead of an unavailable official model', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.llm.model = 'gpt-4o-mini';
    render(
      <LanguageProvider initialPreference="zh-CN">
        <OfficialServicesContext.Provider value={{ source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null }}>
          <ShortVideoScriptWorkspace
            embedded
            onBack={vi.fn()}
            creatorServicesService={{ getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })) } as never}
          />
        </OfficialServicesContext.Provider>
      </LanguageProvider>
    );

    expect(await screen.findByRole('status', { name: '文本模型' })).toHaveTextContent('gpt-4o-mini');
    expect(screen.queryByDisplayValue('暂不可用')).not.toBeInTheDocument();
    expect(document.querySelector('.official-model-value .model-brand-icon')).toHaveAttribute('data-brand', 'openai');
  });
});

function initialJob(): CreatorJob {
  return {
    id: 'script_job',
    projectId: 'project_1',
    templateId: 'short-video-script',
    templateVersion: 1,
    status: 'draft',
    revision: 0,
    state: {
      topic: '',
      audience: '',
      platform: 'douyin',
      targetDurationSeconds: 60,
      tone: 'natural',
      extraRequirements: '',
      currentStage: null
    },
    agentThreadId: null,
    stages: [],
    artifacts: [],
    providerRequests: [],
    activities: [],
    createdAt: '2026-09-08T09:00:00.000Z',
    updatedAt: '2026-09-08T09:00:00.000Z'
  };
}

function completedJob(job: CreatorJob): CreatorJob {
  const artifact: CreatorArtifact = {
    id: 'short_video_script_v1',
    jobId: job.id,
    kind: 'short_video_script',
    version: 1,
    status: 'completed',
    path: '/tmp/OpenCreator-short-video-script.md',
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      fileName: 'OpenCreator-short-video-script.md',
      title: '第一次参与开源',
      resultVersion: 1
    },
    createdAt: '2026-09-08T09:01:00.000Z'
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
      id: 'short_video_script_stage_v1',
      jobId: job.id,
      stageId: 'generate',
      executor: 'short-video-script',
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
      startedAt: '2026-09-08T09:00:30.000Z',
      finishedAt: '2026-09-08T09:01:00.000Z'
    }],
    artifacts: [artifact],
    updatedAt: '2026-09-08T09:01:00.000Z'
  };
}

function restoreUrlMethod(
  key: 'createObjectURL' | 'revokeObjectURL',
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor === undefined) delete (URL as unknown as Record<string, unknown>)[key];
  else Object.defineProperty(URL, key, descriptor);
}
