import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  readCreatorResultSnapshots,
  type CreatorArtifact,
  type CreatorJob,
  type CreatorJson,
  type CreatorStageRun
} from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorSessionProvider, useCreatorSession } from './creator-session-store.js';
import VideoTranslationWorkspace from './VideoTranslationWorkspace.js';

describe('VideoTranslationWorkspace task controls', () => {
  it('restores a video translation v1 job from legacy subtitle fields', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job({
            status: 'draft',
            revision: 0,
            stages: [],
            state: {
              currentStep: 2,
              furthestStep: 2,
              subtitleFont: 'serif',
              subtitleSize: 'large',
              subtitleColor: '#7EE7FF'
            }
          })}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByRole('combobox', { name: '字幕字体' })).toHaveValue('serif');
    expect(screen.getByRole('radio', { name: '大' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '#7EE7FF' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('edits every subtitle style field and persists one structured patch', async () => {
    let currentJob = job({
      status: 'draft',
      revision: 0,
      stages: [],
      templateVersion: 2,
      state: {
        currentStep: 2,
        furthestStep: 2,
        subtitleStyle: {
          fontPreset: 'sans',
          fontWeight: 'bold',
          fontSize: 'medium',
          primaryColor: '#FFFFFF',
          secondaryColor: '#FFD45C',
          outlineColor: '#000000',
          outlineWidth: 2,
          shadow: {
            enabled: false,
            color: '#000000',
            opacity: 0.65,
            offsetX: 2,
            offsetY: 2,
            blur: 1
          }
        }
      }
    });
    const applyAction = vi.fn(async (_jobId: string, request: {
      action: string;
      input: { patch?: Record<string, CreatorJson> };
    }) => {
      currentJob = {
        ...currentJob,
        revision: currentJob.revision + 1,
        state: {
          ...currentJob.state,
          ...(request.input.patch ?? {})
        }
      };
      return {
        job: currentJob,
        receipt: {
          actor: 'user' as const,
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: currentJob.revision,
          createdAt: currentJob.updatedAt
        }
      };
    });

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={currentJob}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    fireEvent.change(screen.getByRole('combobox', { name: '字幕字体' }), {
      target: { value: 'rounded' }
    });
    fireEvent.click(screen.getByRole('radio', { name: '常规' }));
    fireEvent.click(screen.getByRole('radio', { name: '小' }));
    fireEvent.change(screen.getByLabelText('自定义译文颜色'), {
      target: { value: '#123456' }
    });
    fireEvent.change(screen.getByLabelText('原文颜色'), {
      target: { value: '#654321' }
    });
    fireEvent.change(screen.getByLabelText('描边颜色'), {
      target: { value: '#111111' }
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '描边宽度' }), {
      target: { value: '3.5' }
    });
    fireEvent.click(screen.getByRole('switch', { name: '字幕阴影' }));
    fireEvent.change(screen.getByLabelText('阴影颜色'), {
      target: { value: '#222222' }
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '不透明度' }), {
      target: { value: '0.4' }
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '水平偏移' }), {
      target: { value: '-4' }
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '垂直偏移' }), {
      target: { value: '6' }
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '模糊' }), {
      target: { value: '2.5' }
    });

    await waitFor(() => expect(applyAction).toHaveBeenCalledTimes(1));
    expect(applyAction).toHaveBeenCalledWith(
      'job_control',
      expect.objectContaining({
        action: 'update-settings',
        input: expect.objectContaining({
          patch: expect.objectContaining({
            subtitleStyle: {
              fontPreset: 'rounded',
              fontWeight: 'regular',
              fontSize: 'small',
              primaryColor: '#123456',
              secondaryColor: '#654321',
              outlineColor: '#111111',
              outlineWidth: 3.5,
              shadow: {
                enabled: true,
                color: '#222222',
                opacity: 0.4,
                offsetX: -4,
                offsetY: 6,
                blur: 2.5
              }
            }
          })
        })
      })
    );
    const persistedPatch = applyAction.mock.calls[0]?.[1].input.patch ?? {};
    expect(persistedPatch).not.toHaveProperty('subtitleFont');
    expect(persistedPatch).not.toHaveProperty('subtitleSize');
    expect(persistedPatch).not.toHaveProperty('subtitleColor');
  });

  it('offers the complete target language catalog without expanding unsupported source languages', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job({
            status: 'draft',
            revision: 0,
            stages: [],
            state: { currentStep: 1, furthestStep: 1 }
          })}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const sourceSelect = screen.getByRole('combobox', { name: '源语言' });
    const targetSelect = screen.getByRole('combobox', { name: '翻译为' });
    const sourceOptions = within(sourceSelect).getAllByRole('option');
    const targetOptions = within(targetSelect).getAllByRole('option');
    const targetValues = targetOptions.map(option => (option as HTMLOptionElement).value);

    expect(sourceOptions).toHaveLength(8);
    expect(targetOptions).toHaveLength(101);
    expect(new Set(targetValues).size).toBe(101);
    expect(within(targetSelect).getByRole('option', { name: 'বাংলা' })).toHaveAttribute('value', 'bn');
    expect(within(targetSelect).getByRole('option', { name: 'Gàidhlig' })).toHaveAttribute('value', 'gd');
    expect(within(targetSelect).getByRole('option', { name: 'Gaelg' })).toHaveAttribute('value', 'gv');
  });

  it('uses the source video for synchronized subtitle preview when no rendered video exists', async () => {
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const createObjectURL = vi.fn(() => 'blob:source-video-preview');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    const source = sourceVideoArtifact(1);
    const subtitle = subtitleArtifact(1, '同步字幕');
    const currentJob = job({
      status: 'completed',
      revision: 2,
      stages: [],
      artifacts: [source, subtitle]
    });
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' })));
    const view = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={currentJob}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn(),
            openArtifact
          } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    try {
      expect(await screen.findByRole('heading', { name: '视频翻译项目' })).toBeInTheDocument();
      await waitFor(() => expect(openArtifact).toHaveBeenCalledWith('job_control', source.id));
      expect(createObjectURL).toHaveBeenCalledOnce();

      fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
      expect(await screen.findByLabelText('横屏字幕视频预览')).toHaveAttribute(
        'src',
        'blob:source-video-preview'
      );
      expect(screen.getByText('当前使用原视频同步预览')).toBeInTheDocument();
    } finally {
      view.unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:source-video-preview');
      restoreUrlMethod('createObjectURL', createObjectUrlDescriptor);
      restoreUrlMethod('revokeObjectURL', revokeObjectUrlDescriptor);
    }
  });

  it('shows and exports the bilingual subtitle artifact for a bilingual project version', async () => {
    const target = subtitleArtifact(2, '译文在上');
    const source = textSubtitleArtifact({
      id: 'source-subtitle-v2',
      kind: 'source_subtitle',
      version: 2,
      fileName: 'origin_language_srt.srt',
      text: 'Source below'
    });
    const bilingual = textSubtitleArtifact({
      id: 'bilingual-subtitle-v2',
      kind: 'bilingual_subtitle',
      version: 2,
      fileName: 'bilingual_srt.srt',
      text: '译文在上\nSource below'
    });
    const currentJob = job({
      status: 'completed',
      revision: 4,
      stages: [],
      artifacts: [target, source, bilingual],
      state: {
        workspacePhase: 'result',
        resultVersion: 2,
        latestResultVersion: 2,
        resultTab: 'video',
        resultSnapshots: [{
          version: 2,
          createdAt: '2026-09-03T07:02:33.597Z',
          action: 'stage-succeeded',
          stageId: 'subtitle',
          description: '生成字幕',
          artifactRefs: {
            target_subtitle: [target.id],
            source_subtitle: [source.id],
            bilingual_subtitle: [bilingual.id]
          },
          changedArtifactIds: [target.id, source.id, bilingual.id],
          staleArtifactIds: [],
          state: {
            sourceType: 'url',
            sourceUrl: 'https://www.youtube.com/watch?v=job-control',
            sourceLanguage: 'en',
            targetLanguage: 'zh_cn',
            bilingual: true,
            subtitlePosition: 'top',
            preferPlatformCaptions: true,
            dubbing: false,
            voiceCode: '',
            composeVideo: false,
            videoFormat: 'horizontal',
            verticalTitle: '',
            verticalSubtitle: ''
          }
        }]
      }
    });

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={currentJob}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(await screen.findByText('bilingual_srt.srt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('译文在上');
    expect(screen.getByLabelText('横屏字幕原文 1')).toHaveValue('Source below');
    fireEvent.change(screen.getByLabelText('横屏字幕原文 1'), { target: { value: 'Corrected English source' } });
    expect(screen.getByLabelText('横屏字幕原文 1')).toHaveValue('Corrected English source');
    expect(screen.getByRole('button', { name: '保存横屏字幕' })).toBeEnabled();
  });

  it('keeps subtitle edits across Runtime revisions and saves the selected subtitle format', async () => {
    const target = subtitleArtifact(1, '横屏原字幕');
    const source = textSubtitleArtifact({
      id: 'source-subtitle-v1',
      kind: 'source_subtitle',
      version: 1,
      fileName: 'origin_language_srt.srt',
      text: 'Original horizontal subtitle'
    });
    const vertical: CreatorArtifact = {
      id: 'vertical-subtitle-v1',
      jobId: 'job_control',
      kind: 'vertical_subtitle',
      version: 1,
      status: 'completed',
      path: '/tmp/vertical-subtitle-v1.srt',
      sourceArtifactIds: [],
      metadata: {
        resultVersion: 1,
        fileName: 'short_origin_mixed_srt.srt',
        cues: [{
          id: 1,
          start: '00:00:00,000',
          end: '00:00:01,000',
          text: '竖屏原字幕'
        }]
      },
      createdAt: '2026-09-03T08:00:00.000Z'
    };
    let currentJob = job({
      status: 'completed',
      revision: 4,
      stages: [],
      artifacts: [target, source, vertical],
      state: {
        workspacePhase: 'result',
        resultVersion: 1,
        latestResultVersion: 1,
        resultTab: 'video',
        resultSnapshots: [{
          version: 1,
          createdAt: '2026-09-03T08:00:00.000Z',
          action: 'stage-succeeded',
          stageId: 'subtitle',
          description: '生成字幕',
          artifactRefs: {
            target_subtitle: [target.id],
            source_subtitle: [source.id],
            vertical_subtitle: [vertical.id]
          },
          changedArtifactIds: [target.id, source.id, vertical.id],
          staleArtifactIds: [],
          state: {
            sourceType: 'url',
            sourceUrl: 'https://www.youtube.com/watch?v=job-control',
            sourceLanguage: 'en',
            targetLanguage: 'zh_cn',
            bilingual: true,
            subtitlePosition: 'top',
            preferPlatformCaptions: true,
            dubbing: false,
            voiceCode: '',
            composeVideo: false,
            videoFormat: 'horizontal',
            verticalTitle: '',
            verticalSubtitle: ''
          }
        }]
      }
    });
    const applyAction = vi.fn(async (_jobId: string, request: {
      action: string;
      input: {
        patch?: Record<string, CreatorJson>;
        artifactId?: string;
        cues?: CreatorJson;
        baseResultVersion?: number;
        preserveResultVersion?: boolean;
      };
    }) => {
      if (request.action === 'edit-subtitle') {
        const source = currentJob.artifacts.find(artifact => artifact.id === request.input.artifactId)!;
        const baseResultVersion = request.input.baseResultVersion ?? 1;
        const editedArtifact: CreatorArtifact = {
          ...source,
          id: `${source.id}-edited`,
          version: source.version + 1,
          path: `${source.path}.edited.srt`,
          metadata: {
            ...source.metadata,
            resultVersion: baseResultVersion,
            cues: request.input.cues ?? []
          },
          createdAt: '2026-09-03T09:00:00.000Z'
        };
        currentJob = {
          ...currentJob,
          revision: currentJob.revision + 1,
          artifacts: [...currentJob.artifacts, editedArtifact],
          state: {
            ...currentJob.state,
            resultVersion: baseResultVersion,
            latestResultVersion: baseResultVersion,
            resultSnapshots: readCreatorResultSnapshots(currentJob.state.resultSnapshots).map(snapshot => (
              snapshot.version === baseResultVersion
                ? {
                    ...snapshot,
                    artifactRefs: {
                      ...snapshot.artifactRefs,
                      [source.kind]: [editedArtifact.id]
                    },
                    changedArtifactIds: [...snapshot.changedArtifactIds, editedArtifact.id]
                  }
                : snapshot
            ))
          }
        };
      } else {
        currentJob = {
          ...currentJob,
          revision: currentJob.revision + 1,
          state: request.action === 'update-settings'
            ? { ...currentJob.state, ...(request.input.patch ?? {}) }
            : currentJob.state
        };
      }
      return {
        job: currentJob,
        receipt: {
          actor: 'user' as const,
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: currentJob.revision,
          createdAt: currentJob.updatedAt
        }
      };
    });

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={currentJob}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(await screen.findByRole('heading', { name: '视频翻译项目' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    const horizontal = screen.getByRole('textbox', { name: '横屏字幕 1' });
    fireEvent.change(horizontal, { target: { value: '横屏修改后字幕' } });
    expect(horizontal).toHaveValue('横屏修改后字幕');

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      'job_control',
      expect.objectContaining({
        action: 'update-settings',
        input: expect.objectContaining({
          patch: expect.objectContaining({ resultTab: 'subtitles' })
        })
      })
    ));
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('横屏修改后字幕');
    expect(screen.getByRole('button', { name: '保存横屏字幕' })).toBeEnabled();

    fireEvent.click(screen.getByRole('radio', { name: '竖屏' }));
    fireEvent.change(screen.getByRole('textbox', { name: '竖屏字幕 1' }), {
      target: { value: '竖屏修改后字幕' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存竖屏字幕' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      'job_control',
      expect.objectContaining({
        action: 'edit-subtitle',
        input: expect.objectContaining({
          artifactId: vertical.id,
          baseResultVersion: 1,
          preserveResultVersion: true,
          cues: [expect.objectContaining({ text: '竖屏修改后字幕' })]
        })
      })
    ));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /字幕/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('radio', { name: '竖屏' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('button', { name: '保存竖屏字幕' })).toBeDisabled();
    });
    expect(screen.getAllByRole('status').some(status => (
      status.textContent?.includes('竖屏字幕已保存，项目仍为 V1')
    ))).toBe(true);
  });

  it('opens an existing project on its latest completed version', async () => {
    const artifacts = [
      subtitleArtifact(1, '第一版本字幕'),
      subtitleArtifact(2, '第二版本字幕')
    ];
    let currentJob = job({
      status: 'completed',
      revision: 6,
      stages: [],
      artifacts,
      state: {
        currentStep: 1,
        furthestStep: 3,
        workspacePhase: 'configure',
        resultVersion: 1,
        latestResultVersion: 2,
        resultTab: 'settings',
        draftBaseVersion: 1
      }
    });
    const applyAction = vi.fn(async (_jobId: string, request: {
      action: string;
      input: { patch?: Record<string, CreatorJson> };
    }) => {
      currentJob = {
        ...currentJob,
        revision: currentJob.revision + 1,
        state: { ...currentJob.state, ...(request.input.patch ?? {}) }
      };
      return {
        job: currentJob,
        receipt: {
          actor: 'user' as const,
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: currentJob.revision,
          createdAt: currentJob.updatedAt
        }
      };
    });

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={currentJob}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(await screen.findByRole('heading', { name: '视频翻译项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '生成物' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('target-subtitle-v2.srt')).toBeInTheDocument();
    expect(screen.queryByText('正在基于 V1 调整')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '配音' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      'job_control',
      expect.objectContaining({
        input: expect.objectContaining({
          patch: expect.objectContaining({ resultTab: 'voice' })
        })
      })
    ));
    expect(screen.getByRole('tab', { name: '配音' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      'job_control',
      expect.objectContaining({
        input: expect.objectContaining({
          patch: expect.objectContaining({ resultTab: 'settings' })
        })
      })
    ));
    expect(screen.getByRole('tab', { name: '任务设置' })).toHaveAttribute('aria-selected', 'true');
  });

  it('confirms cancellation and resumes from the canceled stage', async () => {
    const runningStage = stage({
      id: 'stage_subtitle_1',
      status: 'running',
      dispatchStatus: 'claimed',
      progress: {
        workflow: true,
        percent: 4,
        krillinEventPayload: {
          phase: 'translating_subtitles',
          percent: 4,
          message: '正在翻译字幕'
        }
      }
    });
    const runningJob = job({
      status: 'running',
      revision: 2,
      stages: [runningStage]
    });
    const canceledStage: CreatorStageRun = {
      ...runningStage,
      status: 'canceled',
      dispatchStatus: 'finished',
      progress: { ...runningStage.progress, cancelRequested: true },
      errorCode: 'creator_stage_canceled',
      errorMessage: 'Creator stage was canceled',
      finishedAt: '2026-08-28T06:00:10.000Z'
    };
    const canceledJob = job({
      status: 'canceled',
      revision: 3,
      stages: [canceledStage]
    });
    const resumedStage = stage({
      id: 'stage_subtitle_2',
      status: 'queued',
      dispatchStatus: 'queued',
      progress: {
        workflow: true,
        resumedFromStageRunId: canceledStage.id
      }
    });
    const resumedJob = job({
      status: 'running',
      revision: 4,
      stages: [canceledStage, resumedStage]
    });
    let currentJob = runningJob;
    const applyAction = vi.fn(async (_jobId: string, request: {
      action: string;
      input: { patch?: Record<string, CreatorJson> };
    }) => {
      currentJob = {
        ...currentJob,
        revision: currentJob.revision + 1,
        state: {
          ...currentJob.state,
          ...(request.input.patch ?? {})
        }
      };
      return {
        job: currentJob,
        receipt: {
          actor: 'user' as const,
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: currentJob.revision,
          createdAt: currentJob.updatedAt
        }
      };
    });
    const cancelJob = vi.fn(async () => {
      currentJob = canceledJob;
      return {
        job: currentJob,
        stage: canceledStage,
        control: 'canceled' as const
      };
    });
    const resumeJob = vi.fn(async () => {
      currentJob = {
        ...resumedJob,
        revision: currentJob.revision + 1
      };
      return {
        job: currentJob,
        stage: resumedStage,
        control: 'resumed' as const
      };
    });

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={runningJob}
          service={{
            applyAction,
            cancelJob,
            resumeJob,
            runAgentTurn: vi.fn()
          } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const workspace = screen.getByRole('region', { name: '视频翻译操作区' });
    expect(await within(workspace).findByRole('button', { name: '终止任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '终止字幕翻译' })).toBeInTheDocument();
    expect(within(workspace).queryByRole('button', { name: '开始翻译' })).not.toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole('button', { name: '终止任务' }));
    const dialog = screen.getByRole('dialog', { name: '终止翻译任务？' });
    expect(dialog).toHaveTextContent('当前正在执行“字幕翻译”，进度 4%');
    expect(dialog).toHaveTextContent('当前 4% 的阶段内进度不会保留');
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '终止任务' }));

    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith('job_control'));
    const resumeButton = await within(workspace).findByRole('button', { name: '继续任务' });
    await waitFor(() => expect(resumeButton).toBeEnabled());
    expect(screen.getByRole('button', { name: '继续字幕翻译' })).toBeInTheDocument();
    expect(screen.getByText('已终止，可继续')).toBeInTheDocument();

    fireEvent.click(resumeButton);
    await waitFor(() => expect(resumeJob).toHaveBeenCalledWith('job_control'));
    expect(await within(workspace).findByRole('button', { name: '终止任务' })).toBeInTheDocument();
    expect(within(workspace).queryByRole('button', { name: '开始翻译' })).not.toBeInTheDocument();
  });

  it('clears a start revision conflict after Runtime confirms the stage is active without retrying', async () => {
    let currentSession: ReturnType<typeof useCreatorSession> | undefined;
    let rejectStart: ((reason: unknown) => void) | undefined;
    const initialJob = job({
      status: 'draft',
      revision: 2,
      stages: []
    });
    const runningJob = job({
      status: 'running',
      revision: 3,
      stages: [stage({
        id: 'stage_subtitle_started',
        status: 'running',
        dispatchStatus: 'claimed',
        progress: { workflow: true, percent: 2 }
      })]
    });
    const applyAction = vi.fn((_jobId: string, request: { action: string }) => {
      if (request.action !== 'run-stage') {
        return Promise.resolve({
          job: initialJob,
          receipt: {
            actor: 'user' as const,
            action: request.action,
            summary: request.action,
            affectedArtifacts: [],
            newRevision: initialJob.revision,
            createdAt: initialJob.updatedAt
          }
        });
      }
      return new Promise<never>((_resolve, reject) => {
        rejectStart = reject;
      });
    });
    function SessionCapture() {
      currentSession = useCreatorSession();
      return null;
    }

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={initialJob}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <SessionCapture />
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const workspace = screen.getByRole('region', { name: '视频翻译操作区' });
    fireEvent.click(within(workspace).getByRole('button', { name: '开始翻译' }));
    await waitFor(() => expect(rejectStart).toBeTypeOf('function'));

    act(() => currentSession!.applyRemoteSnapshot(runningJob));
    await act(async () => {
      rejectStart!(Object.assign(new Error('Creator job revision changed'), {
        code: 'creator_revision_conflict'
      }));
    });

    await waitFor(() => {
      expect(screen.queryByText('任务状态刚刚发生变化，请重试一次。你的设置没有丢失。')).not.toBeInTheDocument();
    });
    expect(screen.getByText('翻译任务已开始，进度会实时同步到创作动态')).toBeInTheDocument();
    expect(within(workspace).getByRole('button', { name: '终止任务' })).toBeInTheDocument();
    expect(applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage')).toHaveLength(1);
  });
});

function job(input: {
  status: CreatorJob['status'];
  revision: number;
  stages: CreatorStageRun[];
  templateVersion?: number;
  state?: Record<string, CreatorJson>;
  artifacts?: CreatorArtifact[];
}): CreatorJob {
  return {
    id: 'job_control',
    projectId: 'project_1',
    templateId: 'video-translation',
    templateVersion: input.templateVersion ?? 1,
    status: input.status,
    revision: input.revision,
    presetOrigin: null,
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=job-control',
      sourceLanguage: 'en',
      targetLanguage: 'zh_cn',
      bilingual: true,
      subtitlePosition: 'top',
      preferPlatformCaptions: true,
      subtitleFont: 'system',
      subtitleSize: 'medium',
      subtitleColor: '#FFFFFF',
      dubbing: false,
      voiceCode: '',
      composeVideo: false,
      videoFormat: 'horizontal',
      verticalTitle: '',
      verticalSubtitle: '',
      currentStep: 3,
      furthestStep: 3,
      workspacePhase: 'configure',
      ...input.state
    },
    agentThreadId: null,
    stages: input.stages,
    artifacts: input.artifacts ?? [],
    activities: [],
    createdAt: '2026-08-28T06:00:00.000Z',
    updatedAt: '2026-08-28T06:00:00.000Z'
  };
}

function subtitleArtifact(resultVersion: number, text: string): CreatorArtifact {
  return {
    id: `target_subtitle_v${resultVersion}`,
    jobId: 'job_control',
    kind: 'target_subtitle',
    version: resultVersion,
    status: 'completed',
    path: `/tmp/target-subtitle-v${resultVersion}.srt`,
    sourceArtifactIds: [],
    metadata: {
      resultVersion,
      fileName: `target-subtitle-v${resultVersion}.srt`,
      cues: [{
        id: 1,
        start: '00:00:00,000',
        end: '00:00:01,000',
        text
      }]
    },
    createdAt: `2026-08-28T06:00:0${resultVersion}.000Z`
  };
}

function textSubtitleArtifact(input: {
  id: string;
  kind: 'source_subtitle' | 'bilingual_subtitle';
  version: number;
  fileName: string;
  text: string;
}): CreatorArtifact {
  return {
    id: input.id,
    jobId: 'job_control',
    kind: input.kind,
    version: input.version,
    status: 'completed',
    path: `/tmp/${input.fileName}`,
    sourceArtifactIds: [],
    metadata: {
      resultVersion: input.version,
      fileName: input.fileName,
      cues: [{
        id: 1,
        start: '00:00:00,000',
        end: '00:00:01,000',
        text: input.text
      }]
    },
    createdAt: `2026-09-03T07:02:3${input.version}.000Z`
  };
}

function sourceVideoArtifact(resultVersion: number): CreatorArtifact {
  return {
    id: `source_video_v${resultVersion}`,
    jobId: 'job_control',
    kind: 'source_video',
    version: resultVersion,
    status: 'completed',
    path: `/tmp/source-video-v${resultVersion}.mp4`,
    sourceArtifactIds: [],
    metadata: {
      resultVersion,
      fileName: `source-video-v${resultVersion}.mp4`,
      width: 1920,
      height: 1080
    },
    createdAt: `2026-08-28T06:00:0${resultVersion}.000Z`
  };
}

function restoreUrlMethod(
  key: 'createObjectURL' | 'revokeObjectURL',
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor === undefined) delete (URL as unknown as Record<string, unknown>)[key];
  else Object.defineProperty(URL, key, descriptor);
}

function stage(input: {
  id: string;
  status: CreatorStageRun['status'];
  dispatchStatus: CreatorStageRun['dispatchStatus'];
  progress: CreatorStageRun['progress'];
}): CreatorStageRun {
  return {
    id: input.id,
    jobId: 'job_control',
    stageId: 'subtitle',
    executor: 'krillinai',
    status: input.status,
    dispatchStatus: input.dispatchStatus,
    claimOwner: input.dispatchStatus === 'claimed' ? 'scheduler_1' : null,
    claimExpiresAt: input.dispatchStatus === 'claimed'
      ? '2026-08-28T06:01:00.000Z'
      : null,
    attempt: input.status === 'queued' ? 0 : 1,
    idempotencyKey: input.id,
    progress: input.progress,
    errorCode: null,
    errorMessage: null,
    startedAt: input.status === 'queued' ? null : '2026-08-28T06:00:01.000Z',
    finishedAt: null
  };
}
