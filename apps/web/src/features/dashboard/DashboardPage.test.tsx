import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createDefaultCreatorServicesConfig,
  readCreatorResultSnapshots,
  type CreatorArtifact,
  type CreatorJob,
  type CreatorJson,
  type CreatorResultSnapshot
} from '@opencreator/protocol';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import DashboardPageView, {
  createCreatorJobWithRecovery
} from './DashboardPage.js';

function DashboardPage(props: ComponentProps<typeof DashboardPageView>) {
  return (
    <DashboardPageView
      projectId="project_1"
      creatorService={createInMemoryCreatorService()}
      {...props}
    />
  );
}

function createInMemoryCreatorService(): CreatorWebService {
  const jobs = new Map<string, CreatorJob>();
  let sequence = 0;
  const createJob = async (request: Parameters<CreatorWebService['createJob']>[0]) => {
    const now = new Date().toISOString();
    const job: CreatorJob = {
      id: `creator_test_job_${++sequence}`,
      projectId: request.projectId,
      templateId: request.templateId,
      templateVersion: 1,
      status: 'draft',
      revision: 0,
      state: request.state ?? {},
      agentThreadId: null,
      stages: [],
      artifacts: [],
      activities: [],
      createdAt: now,
      updatedAt: now
    };
    jobs.set(job.id, job);
    return { job };
  };
  const applyAction = async (
    jobId: string,
    request: Parameters<CreatorWebService['applyAction']>[1]
  ) => {
    const current = jobs.get(jobId);
    if (current === undefined) throw new Error(`Creator job not found: ${jobId}`);
    const updatesSettings = request.action === 'update-settings';
    const patch = updatesSettings
      && typeof request.input.patch === 'object'
      && request.input.patch !== null
      && !Array.isArray(request.input.patch)
        ? request.input.patch
        : {};
    let job: CreatorJob;
    if (updatesSettings) {
      job = {
        ...current,
        revision: current.revision + 1,
        state: { ...current.state, ...patch },
        updatedAt: new Date().toISOString()
      };
    } else if (current.templateId === 'video-translation' && request.action === 'edit-subtitle') {
      job = editTranslationSubtitles(current, request.input);
    } else if (current.templateId === 'video-translation' && request.action === 'commit-version') {
      job = commitTranslationVersion(current, request.input);
    } else if (
      current.templateId === 'video-translation'
      && request.action === 'run-stage'
      && typeof request.input.stageId === 'string'
    ) {
      job = completeTranslationStage(current, request.input.stageId, request.input);
    } else if (
      current.templateId === 'smart-dubbing'
      && request.action === 'run-stage'
      && request.input.stageId === 'tts'
    ) {
      job = completeSmartDubbingStage(current);
    } else {
      job = current;
    }
    jobs.set(job.id, job);
    return {
      job,
      receipt: {
        actor: request.actor ?? 'user',
        action: request.action,
        summary: request.action,
        affectedArtifacts: [],
        newRevision: job.revision,
        createdAt: job.updatedAt
      }
    };
  };
  return {
    createJob,
    getJob: async (jobId: string) => {
      const job = jobs.get(jobId);
      if (job === undefined) throw new Error(`Creator job not found: ${jobId}`);
      return { job };
    },
    applyAction,
    openArtifact: vi.fn(async (_jobId: string) => new Response(new Blob(['artifact']))),
    runAgentTurn: vi.fn(async () => {
      throw new Error('Agent turns require an explicit test fixture');
    })
  } as unknown as CreatorWebService;
}

function completeSmartDubbingStage(current: CreatorJob): CreatorJob {
  const now = new Date().toISOString();
  const version = current.artifacts.filter(artifact => artifact.kind === 'dubbed_audio').length + 1;
  const fileName = `OpenCreator-dubbing-V${version}.mp3`;
  const artifact: CreatorArtifact = {
    id: `smart_dubbing_audio_v${version}`,
    jobId: current.id,
    kind: 'dubbed_audio',
    version,
    status: 'completed',
    path: `/tmp/${fileName}`,
    sourceArtifactIds: [],
    metadata: {
      resultVersion: version,
      fileName,
      mime: 'audio/mpeg',
      bytes: 2048,
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voiceCode: current.state.voiceCode ?? 'nova',
      voiceName: current.state.voiceName ?? '星语',
      style: current.state.style ?? 'natural',
      speed: current.state.speed ?? 1,
      format: current.state.format ?? 'mp3',
      characterCount: typeof current.state.text === 'string' ? [...current.state.text].length : 0,
      settingsSnapshot: current.state
    },
    createdAt: now
  };
  return {
    ...current,
    status: 'completed',
    revision: current.revision + 2,
    state: {
      ...current.state,
      currentStage: 'tts',
      resultVersion: version,
      latestResultVersion: version
    },
    stages: [...current.stages, {
      id: `smart_dubbing_stage_v${version}`,
      jobId: current.id,
      stageId: 'tts',
      executor: 'smart-dubbing',
      status: 'succeeded',
      dispatchStatus: 'finished',
      claimOwner: null,
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: null,
      progress: {
        phase: 'completed',
        percent: 100,
        completed: 1,
        failed: 0,
        total: 1,
        resultVersion: version
      },
      errorCode: null,
      errorMessage: null,
      startedAt: now,
      finishedAt: now
    }],
    artifacts: [
      ...current.artifacts.map(existing => existing.kind === 'dubbed_audio'
        ? { ...existing, status: 'stale' as const }
        : existing),
      artifact
    ],
    updatedAt: now
  };
}

function createTtsServices(options?: {
  voiceId?: string;
  voiceName?: string;
}) {
  const config = createDefaultCreatorServicesConfig();
  const voiceId = options?.voiceId ?? config.tts.openai.defaultVoiceId;
  const voiceName = options?.voiceName ?? 'Marin';
  config.tts.openai.defaultVoiceId = voiceId;
  const getConfig = vi.fn(async () => ({
    config: structuredClone(config),
    configuredCredentials: []
  }));
  const getTtsVoices = vi.fn(async () => ({
    provider: 'openai' as const,
    model: config.tts.openai.model,
    voices: [{
      id: voiceId,
      name: voiceName,
      provider: 'openai' as const,
      kind: 'builtin' as const
    }]
  }));
  const previewTtsVoice = vi.fn(async () => new Response(
    new Blob(['preview-audio'], { type: 'audio/mpeg' })
  ));
  return {
    service: {
      getConfig,
      getTtsVoices,
      previewTtsVoice
    } as unknown as CreatorServicesSettingsService,
    getConfig,
    getTtsVoices,
    previewTtsVoice
  };
}

const defaultTranslationCues: CreatorJson[] = [
  { id: 1, start: '00:00:00,000', end: '00:00:02,000', text: 'Welcome to OpenCreator.' },
  { id: 2, start: '00:00:02,000', end: '00:00:04,000', text: 'Create once, publish everywhere.' },
  { id: 3, start: '00:00:04,000', end: '00:00:06,000', text: 'Your translated video is ready.' }
];

function editTranslationSubtitles(
  current: CreatorJob,
  input: Record<string, CreatorJson>
): CreatorJob {
  const now = new Date().toISOString();
  const baseResultVersion = positiveResultVersion(input.baseResultVersion);
  const preserveResultVersion = input.preserveResultVersion === true
    && baseResultVersion !== undefined;
  const version = preserveResultVersion
    ? baseResultVersion
    : latestResultVersion(current) + 1;
  const sourceArtifactId = typeof input.artifactId === 'string' ? input.artifactId : '';
  const source = current.artifacts.find(artifact => artifact.id === sourceArtifactId);
  const baseSnapshot = translationSnapshots(current)
    .find(snapshot => snapshot.version === baseResultVersion);
  const staleArtifactIds = preserveResultVersion
    ? Object.entries(baseSnapshot?.artifactRefs ?? {}).flatMap(([kind, ids]) => (
        ['dubbed_audio', 'dubbed_video', 'horizontal_video', 'vertical_video'].includes(kind)
          ? ids
          : []
      ))
    : [];
  const artifact = translationArtifact(current, {
    kind: 'target_subtitle',
    version,
    artifactVersion: (latestTranslationArtifact(current, 'target_subtitle')?.version ?? 0) + 1,
    fileName: `目标字幕-V${version}.srt`,
    metadata: {
      cues: Array.isArray(input.cues) ? input.cues : defaultTranslationCues,
      editedFromArtifactId: source?.id ?? null
    }
  });
  const snapshot = translationSnapshot(current, {
    version,
    action: 'edit-subtitle',
    description: '保存字幕修改',
    changedArtifacts: [artifact],
    state: current.state,
    baseResultVersion,
    preserveDownstreamArtifacts: preserveResultVersion,
    staleArtifactIds,
    createdAt: now
  });
  const snapshots = translationSnapshots(current);
  const resultSnapshots = preserveResultVersion
    ? snapshots.map(candidate => candidate.version === version ? snapshot : candidate)
    : [...snapshots, snapshot];
  const staleIds = new Set(staleArtifactIds);
  return {
    ...current,
    status: 'completed',
    revision: current.revision + 1,
    state: {
      ...current.state,
      resultVersion: version,
      latestResultVersion: Math.max(latestResultVersion(current), version),
      resultSnapshots
    },
    artifacts: [
      ...current.artifacts.map(candidate => (
        staleIds.has(candidate.id) ? { ...candidate, status: 'stale' as const } : candidate
      )),
      artifact
    ],
    updatedAt: now
  };
}

function commitTranslationVersion(
  current: CreatorJob,
  input: Record<string, CreatorJson>
): CreatorJob {
  const now = new Date().toISOString();
  const version = latestResultVersion(current) + 1;
  const snapshot = translationSnapshot(current, {
    version,
    action: 'commit-version',
    description: '保存版本设置',
    changedArtifacts: [],
    state: current.state,
    baseResultVersion: positiveResultVersion(input.baseResultVersion),
    createdAt: now
  });
  return {
    ...current,
    status: 'completed',
    revision: current.revision + 1,
    state: {
      ...current.state,
      resultVersion: version,
      latestResultVersion: version,
      resultSnapshots: [...translationSnapshots(current), snapshot]
    },
    updatedAt: now
  };
}

function completeTranslationStage(
  current: CreatorJob,
  stageId: string,
  input: Record<string, CreatorJson>
): CreatorJob {
  const now = new Date().toISOString();
  const targetResultVersion = positiveResultVersion(input.targetResultVersion);
  const existingTarget = targetResultVersion === undefined
    ? undefined
    : translationSnapshots(current).find(snapshot => snapshot.version === targetResultVersion);
  const version = existingTarget === undefined
    ? latestResultVersion(current) + 1
    : targetResultVersion!;
  const generatedArtifacts: CreatorArtifact[] = [];
  if (stageId === 'subtitle') {
    generatedArtifacts.push(translationArtifact(current, {
      kind: 'target_subtitle',
      version,
      fileName: `目标字幕-V${version}.srt`,
      metadata: { cues: defaultTranslationCues }
    }));
  } else if (stageId === 'tts') {
    generatedArtifacts.push(translationArtifact(current, {
      kind: 'dubbed_audio',
      version,
      fileName: `目标语言配音-V${version}.wav`
    }));
  } else if (stageId === 'render-horizontal') {
    generatedArtifacts.push(translationArtifact(current, {
      kind: 'horizontal_video',
      version,
      fileName: `翻译成片-V${version}.mp4`
    }));
  } else if (stageId === 'render-vertical') {
    generatedArtifacts.push(translationArtifact(current, {
      kind: 'vertical_video',
      version,
      fileName: `竖屏翻译成片-V${version}.mp4`
    }));
  }
  const snapshot = translationSnapshot(current, {
    version,
    action: 'stage-succeeded',
    description: version === 1 ? '初次生成' : `生成项目 V${version}`,
    changedArtifacts: generatedArtifacts,
    state: current.state,
    stageId,
    baseResultVersion: positiveResultVersion(input.baseResultVersion),
    createdAt: now
  });
  const resultSnapshots = existingTarget === undefined
    ? [...translationSnapshots(current), snapshot]
    : translationSnapshots(current).map(candidate => (
        candidate.version === version ? snapshot : candidate
      ));
  return {
    ...current,
    status: 'completed',
    revision: current.revision + 1,
    state: {
      ...current.state,
      currentStage: stageId,
      resultVersion: version,
      latestResultVersion: Math.max(latestResultVersion(current), version),
      resultSnapshots
    },
    stages: [
      ...current.stages,
      {
        id: `translation_stage_${current.stages.length + 1}`,
        jobId: current.id,
        stageId,
        executor: 'krillinai',
        status: 'succeeded',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        progress: {
          workflow: true,
          resultVersion: version,
          ...(positiveResultVersion(input.baseResultVersion) === undefined
            ? {}
            : { baseResultVersion: positiveResultVersion(input.baseResultVersion)! }),
          ...(positiveResultVersion(input.inputResultVersion) === undefined
            ? {}
            : { inputResultVersion: positiveResultVersion(input.inputResultVersion)! }),
          ...(targetResultVersion === undefined ? {} : { targetResultVersion })
        },
        errorCode: null,
        errorMessage: null,
        startedAt: now,
        finishedAt: now
      }
    ],
    artifacts: [...current.artifacts, ...generatedArtifacts],
    updatedAt: now
  };
}

function translationArtifact(
  current: CreatorJob,
  input: {
    kind: string;
    version: number;
    artifactVersion?: number;
    fileName: string;
    metadata?: Record<string, CreatorJson>;
  }
): CreatorArtifact {
  return {
    id: `${input.kind}_v${input.version}_${current.artifacts.length + 1}`,
    jobId: current.id,
    kind: input.kind,
    version: input.artifactVersion ?? input.version,
    status: 'completed',
    path: `/tmp/${input.fileName}`,
    sourceArtifactIds: [],
    metadata: {
      resultVersion: input.version,
      fileName: input.fileName,
      settingsSnapshot: current.state,
      ...(input.metadata ?? {})
    },
    createdAt: new Date().toISOString()
  };
}

function translationSnapshot(
  current: CreatorJob,
  input: {
    version: number;
    action: string;
    description: string;
    changedArtifacts: CreatorArtifact[];
    state: Record<string, CreatorJson>;
    stageId?: string;
    baseResultVersion?: number;
    preserveDownstreamArtifacts?: boolean;
    staleArtifactIds?: string[];
    createdAt: string;
  }
): CreatorResultSnapshot {
  const snapshots = translationSnapshots(current);
  const existing = snapshots.find(snapshot => snapshot.version === input.version);
  const base = existing
    ?? snapshots.find(snapshot => snapshot.version === input.baseResultVersion)
    ?? snapshots.at(-1);
  const previousRefs = base?.artifactRefs ?? {};
  const artifactRefs: Record<string, string[]> = Object.fromEntries(
    Object.entries(previousRefs).map(([kind, ids]) => [kind, [...ids]])
  );
  for (const artifact of input.changedArtifacts) artifactRefs[artifact.kind] = [artifact.id];
  if (input.preserveDownstreamArtifacts !== true) {
    pruneTranslationArtifactRefs(
      artifactRefs,
      input.state,
      input.stageId,
      input.action
    );
  }
  const referencedIds = new Set(Object.values(artifactRefs).flat());
  const changedIds = new Set(input.changedArtifacts.map(artifact => artifact.id));
  return {
    version: input.version,
    createdAt: existing?.createdAt ?? input.createdAt,
    action: input.action,
    stageId: input.action === 'stage-succeeded' ? input.stageId ?? 'subtitle' : null,
    description: input.description,
    artifactRefs,
    changedArtifactIds: [
      ...(existing?.changedArtifactIds ?? []),
      ...input.changedArtifacts.map(artifact => artifact.id)
    ],
    staleArtifactIds: [...new Set([
      ...(base?.staleArtifactIds ?? []),
      ...(input.staleArtifactIds ?? [])
    ])].filter(id => referencedIds.has(id) && !changedIds.has(id)),
    state: { ...input.state }
  };
}

function translationSnapshots(job: CreatorJob): CreatorResultSnapshot[] {
  return readCreatorResultSnapshots(job.state.resultSnapshots);
}

function latestResultVersion(job: CreatorJob): number {
  return translationSnapshots(job).reduce(
    (highest, snapshot) => Math.max(highest, snapshot.version),
    0
  );
}

function positiveResultVersion(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function pruneTranslationArtifactRefs(
  refs: Record<string, string[]>,
  state: Record<string, CreatorJson>,
  stageId: string | undefined,
  action: string
) {
  const remove = (...kinds: string[]) => {
    for (const kind of kinds) delete refs[kind];
  };
  if (stageId === 'subtitle' || action === 'edit-subtitle') {
    remove('dubbed_audio', 'dubbed_video', 'horizontal_video', 'vertical_video');
  } else if (stageId === 'tts') {
    remove('horizontal_video', 'vertical_video');
  } else if (stageId === 'render-horizontal' && state.videoFormat === 'all') {
    remove('vertical_video');
  }
  if (state.dubbing !== true) remove('dubbed_audio', 'dubbed_video');
  if (state.composeVideo !== true) {
    remove('horizontal_video', 'vertical_video');
  } else if (stageId === undefined) {
    if (state.videoFormat === 'horizontal') {
      remove('vertical_video');
    } else if (state.videoFormat === 'vertical') {
      remove('horizontal_video');
    }
  }
}

function latestTranslationArtifact(job: CreatorJob, kind: string) {
  return [...job.artifacts].reverse().find(artifact => (
    artifact.kind === kind && artifact.status === 'completed'
  ));
}

async function startVideoTranslation() {
  const workspace = screen.getByRole('region', { name: '视频翻译操作区' });
  fireEvent.click(within(workspace).getByRole('button', { name: '开始翻译' }));
  await screen.findByRole('heading', { name: '视频翻译项目' });
}

function completedAgentTurn(jobId: string, content: string) {
  const createdAt = new Date().toISOString();
  return {
    turn: {
      id: `agent_turn_${Date.now()}`,
      jobId,
      role: 'assistant' as const,
      content,
      status: 'completed' as const,
      audit: [],
      createdAt,
      startedAt: createdAt,
      completedAt: createdAt
    }
  };
}

describe('DashboardPage', () => {
  it('accepts a late creator job response after all short retry windows expire', async () => {
    vi.useFakeTimers();
    try {
      const createdAt = '2026-08-30T00:00:00.000Z';
      const job: CreatorJob = {
        id: 'creator_late_job',
        projectId: 'project_1',
        templateId: 'cover',
        templateVersion: 2,
        status: 'draft',
        revision: 0,
        state: { prompt: '迟到但已成功创建的任务' },
        agentThreadId: null,
        stages: [],
        artifacts: [],
        activities: [],
        createdAt,
        updatedAt: createdAt
      };
      let resolveCreation!: (response: { job: CreatorJob }) => void;
      const lateResponse = new Promise<{ job: CreatorJob }>(resolve => {
        resolveCreation = resolve;
      });
      const createJob = vi.fn(() => lateResponse);
      const work = createCreatorJobWithRecovery(
        { createJob } as unknown as CreatorWebService,
        {
          projectId: job.projectId,
          templateId: job.templateId,
          creationKey: 'creator-late-response'
        }
      );

      await vi.advanceTimersByTimeAsync(12_750);
      expect(createJob).toHaveBeenCalledTimes(3);

      resolveCreation({ job });
      await expect(work).resolves.toEqual(job);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens a Skill workspace directly and keeps its prompt as an inactive hint', () => {
    const onSelectPrompt = vi.fn();
    const onBackToHome = vi.fn();
    render(
      <DashboardPage
        onSelectPrompt={onSelectPrompt}
        onBackToHome={onBackToHome}
        skillLaunch={{
          skillId: 'video-translation-multilingual',
          workspace: 'video-translation',
          promptHint: '上传视频，或者输入有效的视频链接'
        }}
      />
    );

    expect(screen.getByRole('heading', { name: '视频翻译配音' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '告诉 Agent 你的要求' }))
      .toHaveAttribute('placeholder', '上传视频，或者输入有效的视频链接');
    expect(screen.getByRole('textbox', { name: '告诉 Agent 你的要求' })).toHaveValue('');
    expect(onSelectPrompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBackToHome).toHaveBeenCalledOnce();
  });

  it('renders the app directory in the selected English display language', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <DashboardPage onSelectPrompt={vi.fn()} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Featured apps' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video Editing' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search apps' })).toBeInTheDocument();
    expect(screen.getByText('Translate & Dub Video')).toBeInTheDocument();
    expect(screen.getAllByText('Thumbnail Generator')).toHaveLength(2);
    expect(screen.getAllByText('Image Generation')).toHaveLength(2);
    expect(screen.queryByText('Digital Avatar')).not.toBeInTheDocument();
  });

  it('keeps the video translation workflow and Agent in English', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <DashboardPage onSelectPrompt={vi.fn()} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Translate & Dub Video' }));
    expect(screen.getByRole('heading', { name: 'Translate & Dub Video' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Drop a video here' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Video link' })).toHaveAttribute(
      'placeholder',
      'Paste a YouTube, Bilibili, or other video link'
    );
    expect(screen.getByText('No collaboration activity yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask Agent to review settings' })).toBeInTheDocument();
    expect(screen.queryByText('拖放视频到这里')).not.toBeInTheDocument();
  });

  it('uses the Home-style Agent composer across creator workspaces', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    const translationInput = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    expect(translationInput.closest('form')).toHaveClass('tool-agent-composer');
    expect(screen.queryByRole('button', { name: '添加上下文' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 完全访问权限' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择模型 默认模型' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    fireEvent.click(screen.getByRole('button', { name: /^视频下载/ }));
    const downloadInput = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    expect(downloadInput.closest('form')).toHaveClass('tool-agent-composer');
    expect(screen.queryByRole('button', { name: '添加上下文' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择模型 默认模型' })).not.toBeInTheDocument();
  });

  it('renders featured apps and the searchable creator app directory', () => {
    const { container } = render(<DashboardPage onSelectPrompt={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '精选应用' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /打开.+/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: '打开视频翻译配音' }).querySelector('img'))
      .toHaveAttribute('src', '/dashboard/templates/video-translation-example.png');
    expect(screen.getByRole('button', { name: '打开封面生成' }).querySelector('img'))
      .toHaveAttribute('src', '/dashboard/templates/peter-openclaw-cover.png');
    expect(screen.getByRole('button', { name: '打开图像生成' }).querySelector('img'))
      .toHaveAttribute('src', '/dashboard/templates/image-generation-cover.png');
    expect(screen.getByRole('region', { name: '创作应用' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索应用' })).toBeInTheDocument();
    const videoTranslationCard = screen.getByRole('button', { name: /^视频翻译/ });
    expect(within(videoTranslationCard).getByText('HOT')).toBeInTheDocument();
    expect(within(videoTranslationCard).queryByText('NEW')).not.toBeInTheDocument();
    const appCards = Array.from(container.querySelectorAll('.dashboard-app-card'));
    expect(appCards).toHaveLength(5);
    expect(appCards.map(card => card.querySelector('strong')?.textContent)).toEqual([
      '视频翻译',
      '视频下载',
      '封面生成',
      '智能配音',
      '图像生成'
    ]);
    expect(screen.queryByRole('button', { name: /^火柴人动画/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^自动剪辑/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^智能配音/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^视频生成/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^数字人口播/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^视频转格式/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^画面扩展/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^数字人分身/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^产品视觉/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^声音清理/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^字幕生成/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^音频增强/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^互动视频/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^视频下载 支持YouTube，Bilibili等/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^封面生成 生成视频与内容封面/ }))
      .toBeInTheDocument();
  });

  it('opens the video translation workspace and keeps its result in place', async () => {
    const onSelectPrompt = vi.fn();
    render(
      <DashboardPage
        onSelectPrompt={onSelectPrompt}
        videoMetadataService={{
          getVideoMetadata: vi.fn(async () => ({
            platform: 'youtube' as const,
            title: '测试视频标题',
            authorName: '测试作者',
            thumbnailUrl: 'https://i.ytimg.com/vi/test/hqdefault.jpg'
          }))
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));

    expect(screen.getByRole('heading', { name: '视频翻译配音' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '拖放视频到这里' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    expect(screen.getByRole('img', { name: 'YouTube 视频缩略图' })).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/test/hqdefault.jpg'
    );
    expect(await screen.findByText('测试视频标题')).toBeInTheDocument();
    expect(screen.getByText('YouTube 视频 · 测试作者')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '播放 YouTube 视频预览' }));
    expect(screen.getByTitle('YouTube 视频预览')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/test');
    expect(screen.queryByRole('heading', { name: '拖放视频到这里' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改用本地视频' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '视频链接' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('heading', { name: '设置翻译语言' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '源语言' })).toHaveValue('en');
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('zh_cn');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('heading', { name: '设置字幕样式' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '字幕字体' }), { target: { value: 'rounded' } });
    fireEvent.click(screen.getByRole('radio', { name: '大' }));
    fireEvent.click(screen.getByRole('button', { name: '#FFE45C' }));
    const subtitlePreview = screen.getByRole('region', { name: '字幕样式预览' });
    expect(subtitlePreview).toHaveTextContent('这是一段译文字幕');
    expect(subtitlePreview).toHaveTextContent('这是一段原文字幕');
    expect(subtitlePreview.querySelectorAll('[data-subtitle-kind]')[0]).toHaveAttribute('data-subtitle-kind', 'translation');
    expect(subtitlePreview.querySelector(':scope > div')).toHaveStyle({ '--subtitle-preview-font-size': '18px' });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('English → 简体中文');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('圆体 · 大 · #FFE45C');
    expect(screen.getByLabelText('任务摘要')).toHaveClass('video-translation-summary', 'creator-task-summary');
    expect(screen.getByLabelText('任务摘要').parentElement).toHaveClass('video-translation-final-grid');
    await startVideoTranslation();

    expect(onSelectPrompt).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '视频翻译项目' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '生成物' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('项目 V1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('button', { name: '保存横屏字幕' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    expect(screen.getByText('圆体 · 大 · #FFE45C')).toBeInTheDocument();
    expect(screen.queryByText(/之前的版本仍可查看/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '生成新版本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成新版本' })).not.toBeInTheDocument();
  });

  it('shows the translation steps and reopens completed steps', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));

    const steps = screen.getByRole('navigation', { name: '翻译流程' });
    expect(within(steps).getByRole('button', { name: '1 添加视频' })).toHaveAttribute('aria-current', 'step');
    expect(within(steps).getByRole('button', { name: '2 翻译设置' })).toBeDisabled();
    expect(within(steps).getByRole('button', { name: '3 字幕样式' })).toBeDisabled();
    expect(within(steps).getByRole('button', { name: '4 配音与输出' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=steps-test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(within(steps).getByRole('button', { name: /翻译设置$/ })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '在下' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(within(steps).getByRole('button', { name: /字幕样式$/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    const bottomTranslationPreview = screen.getByRole('region', { name: '字幕样式预览' });
    expect(bottomTranslationPreview.querySelectorAll('[data-subtitle-kind]')[0]).toHaveAttribute('data-subtitle-kind', 'original');
    expect(bottomTranslationPreview.querySelectorAll('[data-subtitle-kind]')[1]).toHaveAttribute('data-subtitle-kind', 'translation');

    fireEvent.click(within(steps).getByRole('button', { name: /翻译设置$/ }));
    fireEvent.click(screen.getByRole('switch', { name: '双语字幕' }));
    fireEvent.click(within(steps).getByRole('button', { name: /字幕样式$/ }));
    const translationOnlyPreview = screen.getByRole('region', { name: '字幕样式预览' });
    expect(translationOnlyPreview.querySelector('[data-subtitle-kind="original"]')).not.toBeInTheDocument();
    expect(translationOnlyPreview.querySelector('[data-subtitle-kind="translation"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(within(steps).getByRole('button', { name: /配音与输出$/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByLabelText('任务摘要')).toBeInTheDocument();

    fireEvent.click(within(steps).getByRole('button', { name: /翻译设置$/ }));
    expect(screen.getByRole('heading', { name: '设置翻译语言' })).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole('button', { name: /字幕样式$/ }));
    expect(screen.getByRole('heading', { name: '设置字幕样式' })).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole('button', { name: /配音与输出$/ }));
    expect(screen.getByRole('heading', { name: '选择输出内容' })).toBeInTheDocument();
  });

  it('uses the selected vertical output ratio for the subtitle preview', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=vertical-preview' }
    });

    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '合成字幕视频' }));
    fireEvent.click(screen.getByRole('radio', { name: /9:16/ }));
    fireEvent.click(within(screen.getByRole('navigation', { name: '翻译流程' })).getByRole('button', {
      name: /字幕样式$/
    }));

    expect(screen.getByRole('region', { name: '字幕样式预览' })).toHaveAttribute('data-ratio', '9:16');
  });

  it('submits public video link analysis from the dashboard', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频下载/ }));

    expect(screen.getByRole('heading', { name: '视频下载' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=download-test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));

    expect(await screen.findByText('解析任务已提交，真实规格返回后会自动显示'))
      .toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '下载规格' })).not.toBeInTheDocument();
  });

  it('generates a stickman character before storyboard and video', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="stickman-video" />);

    expect(screen.getByRole('heading', { name: '火柴人动画' })).toBeInTheDocument();
    const stickmanSteps = screen.getByRole('navigation', { name: '火柴人生成流程' });
    expect(within(stickmanSteps).getByRole('button', { name: '1 选择角色' })).toHaveAttribute('aria-current', 'step');
    expect(within(stickmanSteps).getByRole('button', { name: '2 故事与分镜' })).toBeDisabled();
    expect(within(stickmanSteps).getByRole('button', { name: '3 确认分镜' })).toBeDisabled();
    expect(within(stickmanSteps).getByRole('button', { name: '4 配音与音乐' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: '默认角色' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '生成角色' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '上传角色' })).toBeInTheDocument();
    const characterPresets = screen.getByRole('radiogroup', { name: '默认角色' });
    expect(within(characterPresets).getAllByRole('radio')).toHaveLength(10);
    const defaultCharacter = within(characterPresets).getByRole('radio', { name: /默认角色/ });
    expect(defaultCharacter).toBeChecked();
    expect(screen.queryByText('简洁造型，适合通用叙事')).not.toBeInTheDocument();
    const selectedCharacterPreview = screen.getByRole('complementary', { name: '已选角色全身预览' });
    expect(within(selectedCharacterPreview).getByRole('img', { name: '默认角色' })).toHaveAttribute(
      'src',
      '/dashboard/characters/default.png'
    );
    expect(within(characterPresets).getByRole('radio', { name: /^健身$/ })).toBeInTheDocument();
    expect(within(characterPresets).getByRole('radio', { name: /^嘻哈$/ })).toBeInTheDocument();
    fireEvent.click(within(characterPresets).getByRole('radio', { name: /科技男/ }));
    expect(within(characterPresets).getByRole('radio', { name: /科技男/ })).toBeChecked();
    expect(within(selectedCharacterPreview).getByRole('img', { name: '科技男' })).toHaveAttribute(
      'src',
      '/dashboard/characters/tech-guy.png'
    );
    fireEvent.click(screen.getByRole('tab', { name: '上传角色' }));
    expect(screen.getByRole('complementary', { name: '角色图片上传建议' })).toHaveTextContent(
      '人物全身完整可见，背景干净简洁，保持单人清晰且无遮挡。'
    );
    fireEvent.click(screen.getByRole('tab', { name: '生成角色' }));
    const generateCharacterButton = screen.getByRole('button', { name: '生成角色形象' });
    const characterActions = generateCharacterButton.closest('footer');
    expect(characterActions).toHaveClass('stickman-wizard-actions');
    expect(within(characterActions!).getByRole('button', { name: '下一步：故事与分镜' })).toBeEnabled();
    fireEvent.click(generateCharacterButton);
    expect(screen.getByRole('img', { name: '生成的火柴人角色形象' })).toHaveAttribute(
      'src',
      '/dashboard/characters/default.png'
    );
    fireEvent.click(screen.getByRole('tab', { name: '默认角色' }));
    fireEvent.click(screen.getByRole('radio', { name: /科技男/ }));
    expect(screen.queryByRole('heading', { name: '生成分镜' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步：故事与分镜' }));
    expect(screen.queryByRole('heading', { name: '准备主角' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '生成分镜' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '故事创意' })).toHaveAttribute('rows', '5');
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByRole('heading', { name: '准备主角' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步：故事与分镜' }));
    fireEvent.click(screen.getByRole('button', { name: '生成分镜图' }));
    expect(within(stickmanSteps).getByRole('button', { name: /确认分镜$/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { name: '确认故事分镜' })).toBeInTheDocument();
    expect(screen.getByText('建立场景')).toBeInTheDocument();
    expect(screen.getAllByText(/s$/)).toHaveLength(4);
    const firstSubtitle = screen.getByRole('textbox', { name: '分镜 1 字幕' });
    expect(firstSubtitle).toHaveValue('灵感来了，就别让它从手中溜走。');
    fireEvent.change(firstSubtitle, { target: { value: '灵感来了，马上抓住它。' } });
    fireEvent.click(screen.getByRole('button', { name: '查看分镜 1 提示词' }));
    const promptDialog = screen.getByRole('dialog', { name: '画面提示词' });
    const imagePrompt = within(promptDialog).getByRole('textbox', { name: '分镜 1 画面提示词' });
    const imagePromptValue = (imagePrompt as HTMLTextAreaElement).value;
    expect(imagePromptValue).toContain('镜头主题：建立场景');
    expect(imagePromptValue).toContain('主角：科技男');
    expect(imagePromptValue).toContain('画面比例：16:9');
    expect(imagePromptValue).toContain('不要在画面中渲染字幕');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '画面提示词' })).not.toBeInTheDocument();
    const regenerateFirstShot = screen.getByRole('button', { name: '重新生成分镜 1 图片' });
    expect(regenerateFirstShot).toHaveTextContent('重新生成');
    fireEvent.click(regenerateFirstShot);
    const regenerateDialog = screen.getByRole('dialog', { name: '重新生成图片' });
    expect(screen.getByRole('img', { name: '分镜 1：建立场景' })).toHaveAttribute('data-image-version', '0');
    const editablePrompt = within(regenerateDialog).getByRole('textbox', { name: '分镜 1 画面提示词' });
    expect(editablePrompt).not.toHaveAttribute('readonly');
    fireEvent.change(editablePrompt, { target: { value: '自定义镜头提示词：角色在城市天台抓住手稿，不要生成文字。' } });
    fireEvent.click(within(regenerateDialog).getByRole('button', { name: '确认重新生成' }));
    expect(screen.queryByRole('dialog', { name: '重新生成图片' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '分镜 1：建立场景' })).toHaveAttribute('data-image-version', '1');
    expect(screen.getByRole('status')).toHaveTextContent('分镜 1 的图片已重新生成');
    fireEvent.click(screen.getByRole('button', { name: '查看分镜 1 提示词' }));
    expect(screen.getByRole('textbox', { name: '分镜 1 画面提示词' })).toHaveValue('自定义镜头提示词：角色在城市天台抓住手稿，不要生成文字。');
    expect(screen.getByRole('textbox', { name: '分镜 1 画面提示词' })).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: '关闭提示词' }));
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步：配音与音乐' }));
    expect(within(stickmanSteps).getByRole('button', { name: /配音与音乐$/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('角色科技男');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('分镜4 个镜头');
    expect(screen.getByLabelText('任务摘要')).not.toHaveClass('is-compact');
    expect(screen.getByLabelText('任务摘要').parentElement).toHaveClass('creator-task-final-grid');
    expect(screen.getByRole('switch', { name: '生成旁白配音' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByRole('combobox', { name: '配音音色' }), { target: { value: 'energetic' } });
    const backgroundMusic = new File(['music'], 'city-theme.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText('上传背景音乐'), { target: { files: [backgroundMusic] } });
    fireEvent.change(screen.getByRole('slider', { name: '背景音乐音量' }), { target: { value: '35' } });
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('配音自动匹配 · 活力青年');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('背景音乐city-theme.mp3 · 35%');
    fireEvent.click(screen.getByRole('button', { name: /根据分镜生成视频/ }));
    expect(screen.getByText('火柴人动画-V1.mp4')).toBeInTheDocument();
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('当前版本V1');
    expect(screen.getByLabelText('任务摘要').parentElement).toHaveClass('creator-result-layout');
    expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '成片' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '分镜' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '角色' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '任务设置' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '分镜' }));
    expect(screen.getByRole('heading', { name: '故事分镜' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调整分镜' })).toBeInTheDocument();
    expect(screen.getByText('灵感来了，马上抓住它。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '调整分镜' }));
    expect(screen.getByRole('textbox', { name: '分镜 1 字幕' })).toHaveValue('灵感来了，马上抓住它。');
    fireEvent.click(within(stickmanSteps).getByRole('button', { name: /配音与音乐$/ }));
    fireEvent.click(screen.getByRole('tab', { name: '角色' }));
    expect(screen.getByRole('img', { name: '科技男' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更换角色' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    expect(screen.getByRole('heading', { name: '当前版本设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调整角色' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调整故事与画面' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调整配音与音乐' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '火柴人项目产出' })).toHaveTextContent('city-theme.mp3 · 35%');

    fireEvent.click(within(stickmanSteps).getByRole('button', { name: /故事与分镜$/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '故事创意' }), {
      target: { value: '一个商务角色在会议中用图表解释新产品。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '生成分镜图' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步：配音与音乐' }));
    expect(screen.getByText('正在基于 V1 调整')).toBeInTheDocument();
    expect(screen.getByText('原版本的角色、分镜和成片仍可查看')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));

    expect(screen.getByText('火柴人动画-V2.mp4')).toBeInTheDocument();
    expect(screen.getByText('V2 已生成完成，之前的版本仍可查看')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    const stickmanVersionMenu = screen.getByRole('menu');
    expect(within(stickmanVersionMenu).getByText('项目 V1')).toBeInTheDocument();
    expect(within(stickmanVersionMenu).getByText('项目 V2')).toBeInTheDocument();
    fireEvent.click(within(stickmanVersionMenu).getByText('项目 V1').closest('button') as HTMLButtonElement);
    expect(screen.getByText('火柴人动画-V1.mp4')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('navigation', { name: '火柴人生成流程' })).getByRole('button', { name: /故事与分镜$/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '视频比例' }), {
      target: { value: '9:16' }
    });
    fireEvent.click(screen.getByRole('button', { name: '生成分镜图' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步：配音与音乐' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 V3' }));
    expect(screen.getByText('火柴人动画-V3.mp4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目 V3' }));
    expect(screen.getByRole('menu')).toHaveTextContent('基于 V1 调整，当前查看');
  });

  it('uses the same transparent stickman artwork in dark and light themes', () => {
    document.documentElement.dataset.theme = 'dark';
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="stickman-video" />);

    const defaultCharacter = screen.getByRole('radio', { name: /默认角色/ });
    const artwork = defaultCharacter.querySelector<HTMLImageElement>('.stickman-character-artwork');
    expect(artwork).toHaveAttribute('src', '/dashboard/characters/default.png');

    document.documentElement.dataset.theme = 'light';
    expect(artwork).toHaveAttribute('src', '/dashboard/characters/default.png');
    document.documentElement.dataset.theme = 'dark';
  });

  it('previews an Auto Clips video from a link or local upload', async () => {
    const createObjectURL = vi.fn(() => 'blob:auto-clips-preview');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace="auto-clips"
        videoMetadataService={{
          getVideoMetadata: vi.fn(async () => ({
            platform: 'youtube' as const,
            title: '自动剪辑测试视频',
            authorName: '测试创作者',
            thumbnailUrl: 'https://i.ytimg.com/vi/auto-clips/hqdefault.jpg'
          }))
        }}
      />
    );

    expect(screen.getByRole('heading', { name: '拖放视频到这里' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择本地视频' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveAttribute(
      'placeholder',
      '粘贴 YouTube、Bilibili 或其他视频链接'
    );
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=auto-clips' }
    });
    expect(screen.getByRole('img', { name: 'YouTube 视频缩略图' })).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/auto-clips/hqdefault.jpg'
    );
    expect(await screen.findByText('自动剪辑测试视频')).toBeInTheDocument();
    expect(screen.getByText('YouTube 视频 · 测试创作者')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '视频链接' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '播放 YouTube 视频预览' }));
    expect(screen.getByTitle('YouTube 视频预览')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/auto-clips'
    );

    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeInTheDocument();

    const file = new File(['video'], 'long-interview.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('上传本地视频'), { target: { files: [file] } });
    const localPreview = await screen.findByLabelText('本地视频预览');
    expect(localPreview).toHaveAttribute('src', 'blob:auto-clips-preview');
    Object.defineProperties(localPreview, {
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 }
    });
    fireEvent.loadedMetadata(localPreview);
    expect(screen.getByText('long-interview.mp4')).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(screen.queryByRole('textbox', { name: '视频链接' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步：分析设置' }));
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('输出画幅竖屏');
    fireEvent.click(screen.getByRole('button', { name: '识别语义并提取片段' }));
    expect(screen.getByRole('region', { name: '候选片段网格' })).toHaveAttribute('data-orientation', 'portrait');
  });

  it('extracts ten scored clips with subtitles from a long video', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="auto-clips" />);

    const clipSteps = screen.getByRole('navigation', { name: '自动剪辑流程' });
    expect(within(clipSteps).getByRole('button', { name: '1 添加视频' })).toHaveAttribute('aria-current', 'step');
    expect(within(clipSteps).getByRole('button', { name: '2 分析设置' })).toBeDisabled();
    expect(within(clipSteps).getByRole('button', { name: '3 选择与导出' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=long-video' }
    });
    fireEvent.click(screen.getByRole('button', { name: '下一步：分析设置' }));
    expect(screen.getByRole('heading', { name: '设置分析目标' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '片段数量' })).toHaveValue(10);
    expect(screen.getByText('将生成 10 个候选片段')).toBeInTheDocument();
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('内容偏好综合表现');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('候选片段10');
    expect(screen.getByLabelText('任务摘要').parentElement).toHaveClass('creator-task-final-grid');
    fireEvent.click(screen.getByRole('button', { name: '识别语义并提取片段' }));

    expect(screen.getByText('已找到 10 个候选片段')).toBeInTheDocument();
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '候选片段' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '字幕与评分' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '导出内容' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '任务设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '网格视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: '候选片段网格' })).toHaveAttribute('data-orientation', 'landscape');
    expect(screen.getAllByRole('button', { name: /^查看片段/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: '候选片段列表' })).toBeInTheDocument();
    expect(screen.getByText(/很多人一开始就急着使用工具/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^下载片段/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: '网格视图' }));
    expect(screen.getByRole('region', { name: '候选片段网格' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^查看片段 1 / }));
    const detail = screen.getByRole('complementary', { name: '片段 1 详情' });
    expect(detail).toHaveTextContent('开头吸引力94');
    expect(detail).toHaveTextContent('语义完整度92');
    expect(detail).toHaveTextContent('很多人一开始就急着使用工具');

    fireEvent.click(within(clipSteps).getByRole('button', { name: /分析设置$/ }));
    fireEvent.click(screen.getByRole('button', { name: '识别语义并提取片段' }));
    expect(screen.getByRole('status')).toHaveTextContent('设置没有变化，继续查看 V1，未创建新版本');
    expect(screen.queryByRole('button', { name: '项目 V2' })).not.toBeInTheDocument();

    fireEvent.click(within(clipSteps).getByRole('button', { name: /分析设置$/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '内容偏好' }), { target: { value: 'viral' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: '片段数量' }), { target: { value: '5' } });
    expect(screen.getByText('将生成 5 个候选片段')).toBeInTheDocument();
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('候选片段5');
    fireEvent.click(screen.getByRole('button', { name: '重新分析并生成 V2' }));
    expect(screen.getByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    expect(screen.getByText('已找到 5 个候选片段')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^查看片段/ })).toHaveLength(5);
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    expect(screen.getByRole('menu')).toHaveTextContent('项目 V1');
  });

  it('opens the three-step cover workflow and configures the output count', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^封面生成/ }));

    expect(screen.getByRole('heading', { name: '封面生成' })).toBeInTheDocument();
    const coverSteps = screen.getByRole('navigation', { name: '封面生成流程' });
    expect(within(coverSteps).getByRole('button', { name: '1 生成依据' })).toHaveAttribute('aria-current', 'step');
    expect(within(coverSteps).getByRole('button', { name: '2 封面设置' })).toBeDisabled();
    expect(within(coverSteps).getByRole('button', { name: '3 封面方案' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: '内容与补充要求' }), {
      target: { value: '蓝色科技感，人物主体清晰，电影级光线' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(within(coverSteps).getByRole('button', { name: /封面设置$/ }))
      .toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('radio', { name: /1:1/ }));
    fireEvent.click(screen.getByRole('radio', { name: '4 张' }));
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
  });

  it('edits and saves generated subtitles without leaving the result workspace', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    const firstSubtitle = screen.getByRole('textbox', { name: '横屏字幕 1' });
    fireEvent.change(firstSubtitle, { target: { value: 'A manually edited subtitle.' } });
    expect(screen.getByLabelText('有未保存的字幕修改')).toBeInTheDocument();
    const subtitleEditor = screen.getByRole('region', { name: '生成新版本' })
      .previousElementSibling as HTMLElement;
    expect(subtitleEditor).toContainElement(firstSubtitle);
    fireEvent.click(screen.getByRole('button', { name: '保存横屏字幕' }));

    expect(await screen.findByRole('button', { name: '项目 V1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '字幕' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('status').some(status => (
      status.textContent?.includes('横屏字幕已保存，项目仍为 V1')
    ))).toBe(true);
    expect(screen.getByRole('button', { name: '保存横屏字幕' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '项目 V2' })).not.toBeInTheDocument();
  });

  it('requires confirmation before subtitle changes create a new output version', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    fireEvent.change(screen.getByRole('textbox', { name: '横屏字幕 2' }), {
      target: { value: 'Welcome back to OpenCreator.' }
    });
    expect(screen.getByRole('textbox', { name: '横屏字幕 2' })).toHaveValue('Welcome back to OpenCreator.');
    expect(screen.getByLabelText('有未保存的字幕修改')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存并生成 V2' }));
    const regenerateConfirmation = screen.getByRole('group', { name: '确认生成新版本' });
    expect(regenerateConfirmation).toHaveTextContent('确认生成 V2');
    expect(regenerateConfirmation).toHaveTextContent('更新字幕、成片');
    fireEvent.click(within(regenerateConfirmation).getByRole('button', { name: '确认生成 V2' }));

    const versionTrigger = await screen.findByRole('button', { name: '项目 V2' });
    expect(versionTrigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(versionTrigger.querySelector('.video-result-version-chevron')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('textbox', { name: '横屏字幕 2' })).toHaveValue('Welcome back to OpenCreator.');
  });

  it('saves manual subtitle edits while generating a new version', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    fireEvent.change(screen.getByRole('textbox', { name: '横屏字幕 1' }), {
      target: { value: 'The manually revised opening.' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存并生成 V2' }));

    const confirmation = screen.getByRole('group', { name: '确认生成新版本' });
    expect(confirmation).toHaveTextContent('将更新字幕、成片');
    expect(confirmation).toHaveTextContent('V1 的全部产出会保留');
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认生成 V2' }));

    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('The manually revised opening.');
  });

  it('adds dubbing through settings and generates it in the next version', async () => {
    const createObjectURL = vi.fn(() => 'blob:video-translation-dubbing');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL
    });
    const rendered = render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '配音' }));
    fireEvent.click(screen.getByRole('button', { name: '开启配音并生成新版本' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '生成目标语言配音' }));
    fireEvent.click(screen.getByRole('button', { name: '返回 V1 成品' }));
    const regenerationRegion = screen.getByRole('region', { name: '生成新版本' });
    expect(regenerationRegion).toHaveTextContent('生成 V2');
    expect(regenerationRegion).not.toHaveTextContent('配置草稿');
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));
    fireEvent.click(screen.getByRole('button', { name: '确认生成 V2' }));

    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '配音' }));
    expect(screen.getByText('配音文件已生成')).toBeInTheDocument();
    expect(screen.getByText('目标语言配音-V2.wav')).toBeInTheDocument();
    expect(await screen.findByLabelText('目标语言配音试听')).toHaveAttribute(
      'src',
      'blob:video-translation-dubbing'
    );
    expect(createObjectURL).toHaveBeenCalledOnce();

    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-translation-dubbing');
  });

  it('returns to settings and creates a new version without replacing the old one', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '调整设置' }));
    fireEvent.change(screen.getByRole('combobox', { name: '翻译为' }), {
      target: { value: 'ja' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加视频' }));
    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=draft-source' }
    });

    expect(screen.getByText('正在基于 V1 调整')).toBeInTheDocument();
    expect(screen.getByText('原成品已保留，当前修改为配置草稿')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回 V1 成品' }));
    expect(screen.getByText('项目 V1')).toBeInTheDocument();
    expect(screen.getByText('https://www.youtube.com/watch?v=test')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '调整设置' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('ja');
    fireEvent.click(screen.getByRole('button', { name: '添加视频' }));
    expect(screen.getByRole('img', { name: 'YouTube 视频缩略图' })).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/draft-source/hqdefault.jpg'
    );
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('ja');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));

    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    const versionMenu = screen.getByRole('menu');
    expect(within(versionMenu).getByText('项目 V1')).toBeInTheDocument();
    expect(within(versionMenu).getByText('项目 V2')).toBeInTheDocument();
    expect(versionMenu).toHaveTextContent('生成项目 V2，当前查看');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    const reopenedVersionMenu = screen.getByRole('menu');
    fireEvent.click(within(reopenedVersionMenu).getByText('项目 V1').closest('button') as HTMLButtonElement);

    expect(screen.getByText('项目 V1')).toBeInTheDocument();
    expect(screen.queryByText('正在查看 V1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    const settings = screen.getByText('目标语言').closest('dl');
    expect(settings).not.toBeNull();
    expect(within(settings as HTMLElement).getByText('简体中文')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('Welcome to OpenCreator.');
  });

  it('reuses completed subtitles when video composition is enabled for a new version', async () => {
    const baseService = createInMemoryCreatorService();
    const applyAction = vi.fn(baseService.applyAction.bind(baseService));
    const creatorService = {
      ...baseService,
      applyAction
    } as CreatorWebService;
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorService={creatorService}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=reuse-subtitles' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '调整设置' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '合成字幕视频' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        action: 'run-stage',
        input: expect.objectContaining({
          stageId: 'render-horizontal',
          workflow: true,
          baseResultVersion: 1,
          inputResultVersion: 1
        })
      })
    ));
    const runStageIds = applyAction.mock.calls.flatMap(([, request]) => (
      request.action === 'run-stage' && typeof request.input.stageId === 'string'
        ? [request.input.stageId]
        : []
    ));
    expect(runStageIds).toEqual(['subtitle', 'render-horizontal']);
    expect(screen.getByText('新版本已从“横屏成片”开始，已有前置产物会直接复用'))
      .toBeInTheDocument();
  });

  it('does not bind a changed URL source to the selected version input artifacts', async () => {
    const baseService = createInMemoryCreatorService();
    const applyAction = vi.fn(baseService.applyAction.bind(baseService));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorService={{ ...baseService, applyAction } as CreatorWebService}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=source-v1' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '调整设置' }));
    fireEvent.click(screen.getByRole('button', { name: '添加视频' }));
    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=source-v2' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));

    await waitFor(() => {
      const regeneration = applyAction.mock.calls.find(([, request]) => (
        request.action === 'run-stage'
        && request.input.stageId === 'subtitle'
        && request.input.baseResultVersion === 1
      ));
      expect(regeneration?.[1].input).toEqual({
        stageId: 'subtitle',
        workflow: true,
        baseResultVersion: 1
      });
    });
  });

  it('commits a new version when output is disabled without rerunning a stage', async () => {
    const baseService = createInMemoryCreatorService();
    const applyAction = vi.fn(baseService.applyAction.bind(baseService));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorService={{ ...baseService, applyAction } as CreatorWebService}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=settings-only' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '合成字幕视频' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '调整设置' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '合成字幕视频' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        action: 'commit-version',
        input: { baseResultVersion: 1 }
      })
    ));
    expect(applyAction.mock.calls.flatMap(([, request]) => (
      request.action === 'run-stage' ? [request.input.stageId] : []
    ))).toEqual(['subtitle']);
    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeInTheDocument();
  });

  it('merges a manual subtitle edit and downstream render into one project version', async () => {
    const baseService = createInMemoryCreatorService();
    const applyAction = vi.fn(baseService.applyAction.bind(baseService));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorService={{ ...baseService, applyAction } as CreatorWebService}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=single-version' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '合成字幕视频' }));
    await startVideoTranslation();

    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    fireEvent.change(screen.getByRole('textbox', { name: '横屏字幕 1' }), {
      target: { value: 'Edited before rendering.' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存并生成 V2' }));
    fireEvent.click(screen.getByRole('button', { name: '确认生成 V2' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        action: 'edit-subtitle',
        input: expect.objectContaining({
          baseResultVersion: 1,
          preserveResultVersion: true
        })
      })
    ));
    expect(applyAction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        action: 'run-stage',
        input: expect.objectContaining({
          stageId: 'render-horizontal',
          baseResultVersion: 1,
          inputResultVersion: 1
        })
      })
    );
    const renderRequest = applyAction.mock.calls.find(([, request]) => (
      request.action === 'run-stage'
      && request.input.stageId === 'render-horizontal'
    ))?.[1];
    expect(renderRequest?.input).not.toHaveProperty('targetResultVersion');
    const versionTrigger = await screen.findByRole('button', { name: '项目 V2' });
    fireEvent.click(versionTrigger);
    expect(screen.getByRole('menu')).not.toHaveTextContent('项目 V3');
  });

  it('resizes the immersive operation and Agent panes', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));

    const separator = screen.getByRole('separator', { name: '调整操作区和对话区宽度' });
    expect(separator).toHaveAttribute('aria-valuemin', '780');
    const layout = separator.parentElement as HTMLDivElement;
    vi.spyOn(layout, 'getBoundingClientRect').mockReturnValue({
      bottom: 800,
      height: 800,
      left: 0,
      right: 1200,
      top: 0,
      width: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    fireEvent.mouseDown(separator, { button: 0, clientX: 800 });
    fireEvent.mouseMove(window, { clientX: 720 });
    fireEvent.mouseUp(window);
    expect(layout).toHaveStyle({ '--video-translation-pane-width': '780px' });

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(layout).toHaveStyle({ '--video-translation-pane-width': '780px' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(layout).toHaveStyle({ '--video-translation-pane-width': '812px' });
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(layout).toHaveStyle({ '--video-translation-pane-width': '780px' });
    fireEvent.doubleClick(separator);
    expect(layout.style.getPropertyValue('--video-translation-pane-width')).toBe('');
  });

  it('supports local video, dubbing and vertical output options', async () => {
    const tts = createTtsServices();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorServicesService={tts.service}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '打开视频翻译配音' }));

    const video = new File(['video'], 'demo.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('上传本地视频'), { target: { files: [video] } });
    expect(screen.getByText('本地视频 · 1 KB')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '视频链接' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除当前视频来源' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    expect(screen.getByRole('heading', { name: '拖放视频到这里' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('上传本地视频'), { target: { files: [video] } });
    expect(within(screen.getByRole('region', { name: '视频预览' })).getByText('demo.mp4'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('switch', { name: '优先使用平台字幕' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '生成目标语言配音' }));
    fireEvent.click(screen.getByRole('switch', { name: '合成字幕视频' }));
    expect(screen.getByRole('radio', { name: /16:9/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /双画幅/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: /9:16/ }));

    expect(screen.getByText('demo.mp4')).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: '配音音色' })).toHaveValue('marin');
    expect(tts.getTtsVoices).toHaveBeenCalledWith('openai', 'gpt-4o-mini-tts');
    expect(screen.getByRole('textbox', { name: /竖屏主标题/ })).toBeInTheDocument();
  });

  it('only allows portrait output after detecting a portrait source video', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:portrait-translation-preview')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开视频翻译配音' }));

    const video = new File(['video'], 'portrait.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('上传本地视频'), { target: { files: [video] } });
    const preview = await screen.findByLabelText('本地视频预览');
    Object.defineProperties(preview, {
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 }
    });
    fireEvent.loadedMetadata(preview);

    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '合成字幕视频' }));

    expect(screen.getByRole('radio', { name: /16:9/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /双画幅/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /9:16/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /9:16/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('requires a video before advancing to translation settings', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请先添加需要翻译的视频');
    expect(screen.getByRole('alert').parentElement).toHaveClass('video-translation-action-group');
    expect(screen.getByRole('heading', { name: '拖放视频到这里' })).toBeInTheDocument();
  });

  it('delegates translation changes to the Creator Agent without local command parsing', async () => {
    const creatorService = createInMemoryCreatorService();
    vi.mocked(creatorService.runAgentTurn).mockImplementation(async (jobId, request) => (
      completedAgentTurn(jobId, `已收到：${request.message}`)
    ));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        projectId="project_1"
        creatorService={creatorService}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    const composer = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    fireEvent.change(composer, { target: { value: '目标语言改成日语' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => {
      expect(creatorService.runAgentTurn).toHaveBeenCalledWith(
        expect.stringMatching(/^creator_test_job_/),
        expect.objectContaining({
          message: '目标语言改成日语',
          sandbox: 'danger-full-access'
        })
      );
    });
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('zh_cn');
  });

  it('sends the translation review quick action through the Creator Agent', async () => {
    const creatorService = createInMemoryCreatorService();
    vi.mocked(creatorService.runAgentTurn).mockImplementation(async (jobId, request) => (
      completedAgentTurn(jobId, `已检查：${request.message}`)
    ));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        projectId="project_1"
        creatorService={creatorService}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.click(screen.getByRole('button', { name: '让 Agent 检查设置' }));

    await waitFor(() => {
      expect(creatorService.runAgentTurn).toHaveBeenCalledWith(
        expect.stringMatching(/^creator_test_job_/),
        expect.objectContaining({
          message: '检查当前视频翻译设置，指出缺失项，并给出下一步建议。',
          sandbox: 'danger-full-access'
        })
      );
    });
  });

  it('keeps a failed Creator Agent request in the composer for retry', async () => {
    const creatorService = createInMemoryCreatorService();
    vi.mocked(creatorService.runAgentTurn).mockRejectedValue(new Error('Creator Agent unavailable'));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        projectId="project_1"
        creatorService={creatorService}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));

    const composer = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    fireEvent.change(composer, { target: { value: '检查当前翻译设置' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => {
      expect(composer).toHaveValue('检查当前翻译设置');
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Creator Agent unavailable');
  });

  it('returns from the video translation workspace to the app directory', () => {
    const onWorkspaceModeChange = vi.fn();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        onWorkspaceModeChange={onWorkspaceModeChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByRole('heading', { name: '精选应用' })).toBeInTheDocument();
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(false);
  });

  it('filters apps by category and search query', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '图像创作' }));
    const directory = screen.getByRole('region', { name: '创作应用' });
    expect(within(directory).getByRole('button', { name: /^封面生成/ })).toBeInTheDocument();
    expect(within(directory).getByRole('button', { name: /^图像生成/ })).toBeInTheDocument();
    expect(directory.querySelectorAll('.dashboard-app-card')).toHaveLength(2);
    expect(within(directory).queryByRole('button', { name: /^视频翻译/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索应用' }), {
      target: { value: '不存在的应用' }
    });
    expect(screen.getByText('没有找到相关应用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看全部应用' }));
    expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: '音频处理' }));
    expect(within(directory).getByRole('button', { name: /^智能配音/ })).toBeInTheDocument();
    expect(directory.querySelectorAll('.dashboard-app-card')).toHaveLength(1);
  });

  it('creates downloadable audio in the smart dubbing workspace', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:smart-dubbing')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const tts = createTtsServices({ voiceId: 'nova', voiceName: '星语' });
    const creatorService = createInMemoryCreatorService();
    const applyAction = vi.spyOn(creatorService, 'applyAction');
    const openArtifact = vi.spyOn(creatorService, 'openArtifact');
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace="smart-dubbing"
        creatorService={creatorService}
        creatorServicesService={tts.service}
      />
    );

    expect(screen.getByRole('heading', { name: '智能配音' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '配音文案内容' }), {
      target: { value: '这是一段需要生成语音的测试文案。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(await screen.findByRole('combobox', { name: '配音音色' })).toHaveValue('nova');
    fireEvent.click(screen.getByRole('button', { name: '试听当前音色' }));
    expect(await screen.findByRole('button', { name: '暂停音色试听' })).toBeInTheDocument();
    expect(tts.previewTtsVoice).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voiceId: 'nova'
    });
    expect(play).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '暂停音色试听' }));
    expect(pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: '温暖' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    const summary = screen.getByLabelText('任务摘要');
    expect(summary).toHaveTextContent('星语');
    expect(summary).toHaveTextContent('温暖');
    expect(summary).toHaveTextContent('1.00x');
    expect(summary).toHaveTextContent('MP3');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    expect(await screen.findByLabelText('智能配音试听')).toHaveAttribute('src', 'blob:smart-dubbing');
    expect(screen.getByText('OpenCreator-dubbing-V1.mp3')).toBeInTheDocument();
    expect(screen.queryByText('Creator Runtime 未连接，Agent 不会生成替代回复。')).not.toBeInTheDocument();
    expect(applyAction).toHaveBeenCalledWith(
      expect.stringMatching(/^creator_test_job_/),
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'tts' }
      })
    );
    expect(openArtifact).toHaveBeenCalledWith(
      expect.stringMatching(/^creator_test_job_/),
      'smart_dubbing_audio_v1'
    );
  });

  it('links TTS configuration errors to voice service settings', async () => {
    const tts = createTtsServices({ voiceId: 'nova', voiceName: '星语' });
    const creatorService = createInMemoryCreatorService();
    const applyAction = creatorService.applyAction.bind(creatorService);
    vi.spyOn(creatorService, 'applyAction').mockImplementation(async (jobId, request) => {
      if (request.action === 'run-stage') {
        throw Object.assign(new Error('TTS API key is missing'), {
          code: 'creator_tts_config_missing'
        });
      }
      return applyAction(jobId, request);
    });
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace="smart-dubbing"
        creatorService={creatorService}
        creatorServicesService={tts.service}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: '配音文案内容' }), {
      target: { value: '这是一段需要配置服务后生成的配音文案。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(await screen.findByRole('combobox', { name: '配音音色' })).toHaveValue('nova');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    expect(await screen.findAllByText('请先在设置的配音服务中配置当前服务商的 API Key'))
      .toHaveLength(2);
    expect(screen.getByRole('link', { name: '打开配音服务设置' })).toHaveAttribute(
      'href',
      '#/settings?tab=ai-services&section=tts'
    );
  });

  it('generates image assets through the Creator Runtime', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => `blob:image-${blob.size}`)
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    const prompt = '一间清晨的现代创意工作室';
    const createdAt = '2026-08-26T00:00:00.000Z';
    let job: CreatorJob = {
      id: 'creator_image_job',
      projectId: 'project_1',
      templateId: 'image-generation',
      templateVersion: 1,
      status: 'draft',
      revision: 0,
      state: {
        prompt: '',
        provider: 'gemini',
        size: '1024x1024',
        quality: 'medium',
        candidateCount: 2,
        currentStage: null
      },
      agentThreadId: null,
      stages: [],
      artifacts: [],
      activities: [],
      createdAt,
      updatedAt: createdAt
    };
    const applyAction = vi.fn(async (_jobId: string, request: {
      action: string;
      input: Record<string, unknown>;
    }) => {
      if (request.action === 'update-settings') {
        job = {
          ...job,
          revision: job.revision + 1,
          state: {
            ...job.state,
            ...(request.input.patch as Record<string, string | number>)
          }
        };
      } else {
        const version = typeof job.state.latestResultVersion === 'number'
          ? job.state.latestResultVersion + 1
          : 1;
        const artifacts: CreatorArtifact[] = [1, 2].map(candidate => ({
          id: `image_artifact_v${version}_${candidate}`,
          jobId: job.id,
          kind: 'generated_image',
          version,
          status: 'completed',
          path: `/tmp/image-${candidate}.png`,
          sourceArtifactIds: [],
          metadata: {
            provider: 'openai',
            model: 'gpt-image-1',
            candidate,
            imageSize: '1536x1024',
            quality: 'high',
            mimeType: 'image/png',
            bytes: candidate * 1024,
            fileName: `image-${candidate}.png`,
            resultVersion: version
          },
          createdAt
        }));
        job = {
          ...job,
          status: 'completed',
          revision: job.revision + 2,
          state: {
            ...job.state,
            currentStage: 'generate',
            resultVersion: version,
            latestResultVersion: version,
            resultSnapshots: [
              ...(Array.isArray(job.state.resultSnapshots) ? job.state.resultSnapshots : []),
              {
              version,
              createdAt,
              action: 'stage-succeeded',
              stageId: 'generate',
              description: '生成图片',
              artifactRefs: { generated_image: artifacts.map(artifact => artifact.id) },
              changedArtifactIds: artifacts.map(artifact => artifact.id),
              staleArtifactIds: [],
              state: {
                prompt,
                provider: 'openai',
                size: '1536x1024',
                quality: 'high',
                candidateCount: 2
              }
            }]
          },
          stages: [{
            id: 'stage_generate_1',
            jobId: job.id,
            stageId: 'generate',
            executor: 'image',
            status: 'succeeded',
            dispatchStatus: 'finished',
            claimOwner: null,
            claimExpiresAt: null,
            attempt: 1,
            idempotencyKey: null,
            progress: { status: 'succeeded' },
            errorCode: null,
            errorMessage: null,
            startedAt: createdAt,
            finishedAt: createdAt
          }],
          artifacts: [...job.artifacts, ...artifacts]
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
    const openArtifact = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' })));
    const creatorService = {
      createJob: vi.fn(async () => ({ job })),
      getJob: vi.fn(async () => ({ job })),
      applyAction,
      openArtifact,
      runAgentTurn: vi.fn()
    } as unknown as CreatorWebService;
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        projectId="project_1"
        creatorService={creatorService}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^图像生成/ }));
    expect(await screen.findByRole('heading', { name: '图像生成' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), {
      target: { value: prompt }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('radio', { name: 'GPT Image' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radio', { name: '即梦' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '可灵' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Gemini' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /横向/ }));
    fireEvent.click(screen.getByRole('radio', { name: '高清' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('横向 · 3:2');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('高清');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    expect(await screen.findByRole('img', { name: '生成图片 1' })).toHaveAttribute('src', 'blob:image-13');
    expect(screen.getByRole('img', { name: '生成图片 2' })).toBeInTheDocument();
    expect(applyAction).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'generate' }
      })
    );
    expect(applyAction).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({
        action: 'update-settings',
        input: expect.objectContaining({
          patch: expect.objectContaining({ provider: 'openai' })
        })
      })
    );
    expect(openArtifact).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(await screen.findByRole('button', { name: /项目 V2/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /项目 V2/ }));
    expect(screen.getByRole('menu')).toHaveTextContent('项目 V1');
    expect(openArtifact).toHaveBeenCalledWith(job.id, 'image_artifact_v2_1');
    expect(openArtifact).toHaveBeenCalledWith(job.id, 'image_artifact_v2_2');
  });

  it('submits and previews a video generation result', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:generated-video')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    const result = {
      id: 'video_result_1234',
      prompt: '一辆红色跑车沿着海岸公路行驶',
      provider: 'veo' as const,
      model: 'veo-3.1-generate-preview',
      videoSize: '720x1280' as const,
      duration: 8 as const,
      status: 'completed' as const,
      progress: 100,
      fileName: 'OpenCreator-video.mp4',
      mime: 'video/mp4' as const,
      size: 4096,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:02:00.000Z'
    };
    const generate = vi.fn(async () => ({ result }));
    const get = vi.fn(async () => ({ result }));
    const openContent = vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' })));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace="video-generation"
        videoGenerationService={{ generate, get, openContent }}
      />
    );

    const promptInput = screen.getByRole('textbox', { name: '提示词' });
    const referenceImageInput = screen.getByLabelText('上传视频参考图');
    expect(referenceImageInput.compareDocumentPosition(promptInput) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    fireEvent.change(promptInput, {
      target: { value: result.prompt }
    });
    const referenceImage = new File(['reference'], 'coast-reference.png', {
      type: 'image/png'
    });
    fireEvent.change(referenceImageInput, {
      target: { files: [referenceImage] }
    });
    expect(screen.getByRole('img', { name: '视频参考图预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除参考图' }));
    expect(screen.queryByRole('img', { name: '视频参考图预览' })).not.toBeInTheDocument();
    fireEvent.change(referenceImageInput, {
      target: { files: [referenceImage] }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    const providerSelect = screen.getByRole('combobox', { name: '视频服务' });
    const formatSelect = screen.getByRole('combobox', { name: '画幅' });
    const durationSelect = screen.getByRole('combobox', { name: '视频时长' });
    expect(providerSelect).toHaveValue('seedance');
    fireEvent.change(providerSelect, { target: { value: 'veo' } });
    expect(providerSelect).toHaveValue('veo');
    expect(durationSelect).toHaveValue('4');
    fireEvent.change(formatSelect, { target: { value: '720x1280' } });
    fireEvent.change(durationSelect, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('竖屏 · 9:16');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('8 秒');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('coast-reference.png');
    const generationActions = screen.getByLabelText('视频生成操作');
    const generateButton = within(generationActions).getByRole('button', { name: '开始生成' });
    expect(screen.getByText('准备生成视频')).not.toContainElement(generateButton);
    fireEvent.click(generateButton);

    expect(await screen.findByLabelText('生成视频预览')).toHaveAttribute('src', 'blob:generated-video');
    expect(generate).toHaveBeenCalledWith({
      prompt: result.prompt,
      provider: 'veo',
      size: '720x1280',
      duration: 8,
      referenceImage: {
        mime: 'image/png',
        data: 'cmVmZXJlbmNl'
      }
    });
    expect(openContent).toHaveBeenCalledWith(result.id);
    expect(get).not.toHaveBeenCalled();
  });

  it('builds and confirms a digital avatar production plan from a direct workspace', () => {
    const onSelectPrompt = vi.fn();
    render(<DashboardPage onSelectPrompt={onSelectPrompt} workspace="digital-avatar" />);

    expect(screen.getByRole('heading', { name: '数字人口播' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '数字人口播画面预览' }).querySelector('img'))
      .toHaveAttribute('src', '/dashboard/templates/digital-presenter.jpg');

    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('heading', { name: '文案与声音' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '口播文案' }), {
      target: { value: '这是一段用于数字人口播原型测试的文案。' }
    });
    fireEvent.click(screen.getByRole('radio', { name: '专业' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(screen.getByRole('heading', { name: '画面设置' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '9:16' }));
    fireEvent.click(screen.getByRole('radio', { name: '居右' }));
    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    fireEvent.click(screen.getByRole('switch', { name: '显示字幕' }));
    expect(screen.getByRole('img', { name: '数字人口播画面预览' }))
      .toHaveAttribute('data-ratio', '9:16');
    expect(screen.getByRole('img', { name: '数字人口播画面预览' }))
      .toHaveAttribute('data-position', 'right');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    const summary = screen.getByLabelText('任务摘要');
    expect(summary).toHaveTextContent('示例人物');
    expect(summary).toHaveTextContent('星语 · 专业');
    expect(summary).toHaveTextContent('9:16 · 居右');
    expect(summary).toHaveTextContent('关闭');
    fireEvent.click(screen.getByRole('button', { name: '确认制作方案' }));
    expect(screen.getByRole('button', { name: '已确认' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('制作方案已确认');
    expect(onSelectPrompt).not.toHaveBeenCalled();
  });
});
