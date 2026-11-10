import { changeControl } from '../../test/select-option.js';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createDefaultCreatorServicesConfig,
  readCreatorResultSnapshots,
  type CreatorActionRequest,
  type CreatorArtifact,
  type CreatorJob,
  type CreatorJson,
  type CreatorResultSnapshot
} from '@opencreator/protocol';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { ApiClientError } from '../../runtime/errors.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import DashboardPageView, {
  createCreatorJobWithRecovery
} from './DashboardPage.js';
import type { CreatorWorkspace } from './creator-workspace.js';

function DashboardPage(props: ComponentProps<typeof DashboardPageView>) {
  return (
    <DashboardPageView
      projectId="project_1"
      creatorService={createInMemoryCreatorService()}
      {...props}
    />
  );
}

function RoutedDashboardPage(props: { service: CreatorWebService; initialWorkspace?: CreatorWorkspace }) {
  const [route, setRoute] = useState<{ workspace?: CreatorWorkspace; jobId?: string }>({ workspace: props.initialWorkspace });
  return <DashboardPage
    creatorService={props.service}
    workspace={route.workspace}
    jobId={route.jobId}
    onSelectPrompt={vi.fn()}
    onWorkspaceNavigate={(workspace, jobId) => setRoute({ workspace: workspace ?? undefined, jobId })}
  />;
}

async function createCompletedTranslationJob(service: CreatorWebService) {
  const { job } = await service.createJob({ projectId: 'project_1', templateId: 'video-translation', state: {
    sourceUrl: 'https://www.youtube.com/watch?v=history', composeVideo: true
  } });
  const subtitles = await service.applyAction(job.id, { action: 'run-stage', expectedRevision: job.revision, input: { stageId: 'subtitle' } });
  const rendered = await service.applyAction(job.id, { action: 'run-stage', expectedRevision: subtitles.job.revision, input: { stageId: 'render-horizontal' } });
  return rendered.job;
}

async function createCompletedDownloadJob(service: CreatorWebService) {
  const { job } = await service.createJob({ projectId: 'project_1', templateId: 'video-download', state: {
    sourceUrl: 'https://x.com/history', title: 'Download project'
  } });
  return { ...job, status: 'completed' as const, artifacts: [translationArtifact(job, {
    kind: 'source_video', version: 1, fileName: 'download.mp4'
  })] };
}

function withHistoryJobs(service: CreatorWebService, jobs: CreatorJob[]): CreatorWebService {
  return {
    ...service,
    listJobs: vi.fn(async () => ({ jobs })),
    getJob: vi.fn(async (jobId: string) => {
      const job = jobs.find(candidate => candidate.id === jobId);
      return job ? { job } : service.getJob(jobId);
    })
  } as CreatorWebService;
}

function openBlankWorkspace(moduleName: string, _blankName: string) {
  fireEvent.click(screen.getByRole('button', {
    name: new RegExp(`^${moduleName}`)
  }));
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});


async function translateTestVideo(id = 'test') {
  openBlankWorkspace('视频翻译', '空白视频翻译');
  fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
    target: { value: `https://www.youtube.com/watch?v=${id}` }
  });
  await startVideoTranslation();
}

function openTranslationPanel(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

async function waitForSubtitleAutosave() {
  await waitFor(() => expect(screen.queryByLabelText('有未保存的字幕修改')).not.toBeInTheDocument(), { timeout: 3000 });
}

function openSubtitleEditor() {
  const entry = screen.queryByRole('button', { name: '深度编辑' });
  if (entry) fireEvent.click(entry);
}

afterEach(() => vi.unstubAllGlobals());

describe('Creator initial session recovery', () => {
  it('automatically opens an existing project after the first snapshot fails', async () => {
    const service = createInMemoryCreatorService();
    const { job } = await service.createJob({ projectId: 'project_1', templateId: 'video-translation' });
    const getJob = vi.spyOn(service, 'getJob');
    getJob.mockRejectedValueOnce(new TypeError('offline'));
    const applyAction = vi.spyOn(service, 'applyAction');
    const runAgentTurn = vi.spyOn(service, 'runAgentTurn');
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="video-translation" jobId={job.id} creatorService={service} />);
    expect(await screen.findByText('正在恢复项目会话与任务状态…')).toBeVisible();
    expect(await screen.findByRole('form', { name: '视频翻译' })).toBeVisible();
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(applyAction).not.toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();
  });
});

function createInMemoryCreatorService(): CreatorWebService {
  const jobs = new Map<string, CreatorJob>();
  let sequence = 0;
  const createJob = async (request: Parameters<CreatorWebService['createJob']>[0]) => {
    const now = new Date().toISOString();
    if (!('templateId' in request)) throw new Error('Preset creation is not used by this fixture');
    const job: CreatorJob = {
      id: `creator_test_job_${++sequence}`,
      projectId: request.projectId,
      templateId: request.templateId,
      templateVersion: 1,
      status: 'draft',
      revision: 0,
      presetOrigin: null,
      state: request.state ?? {},
      agentThreadId: null,
      stages: [],
      artifacts: [],
      providerRequests: [],
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
    } else if (request.action === 'select-result-version') {
      job = {
        ...current,
        revision: current.revision + 1,
        state: { ...current.state, resultVersion: request.input.version! },
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
    listJobs: async () => ({ jobs: [...jobs.values()] }),
    listVisualAssets: vi.fn(async () => ({ assets: dashboardVisualAssetCatalog() })),
    openVisualAssetPreview: vi.fn(async () => new Response(new Blob(['preview']))),
    getJob: async (jobId: string) => {
      const job = jobs.get(jobId);
      if (job === undefined) throw new Error(`Creator job not found: ${jobId}`);
      return { job };
    },
    applyAction,
    uploadSourceVideo: vi.fn(async (jobId, { file }) => {
      const current = jobs.get(jobId)!;
      const artifact = translationArtifact(current, { kind: 'source_video', version: 1, fileName: file.name });
      const job = { ...current, revision: current.revision + 1,
        state: { ...current.state, sourceVideoArtifactId: artifact.id }, artifacts: [...current.artifacts, artifact] };
      jobs.set(jobId, job);
      return { job, artifact, deduplicated: false };
    }),
    openArtifact: vi.fn(async (_jobId: string) => new Response(new Blob(['artifact']))),
    runAgentTurn: vi.fn(async () => {
      throw new Error('Agent turns require an explicit test fixture');
    })
  } as unknown as CreatorWebService;
}

function dashboardVisualAssetCatalog() {
  return [{
    id: 'stickman.character.default',
    revision: 1,
    templateId: 'stickman-video',
    kind: 'character' as const,
    source: 'builtin' as const,
    status: 'ready' as const,
    name: { zhCN: '默认角色', en: 'Default character' },
    description: { zhCN: '默认火柴人角色', en: 'Default stickman character' },
    previewUrl: null,
    referenceCount: 1,
    recommended: true,
    tags: []
  }, {
    id: 'stickman.style.paper-pencil',
    revision: 1,
    templateId: 'stickman-video',
    kind: 'style' as const,
    source: 'builtin' as const,
    status: 'ready' as const,
    name: { zhCN: '纸面铅笔手绘', en: 'Pencil sketch on paper' },
    description: { zhCN: '纸面铅笔手绘风格', en: 'Pencil sketch style' },
    previewUrl: null,
    referenceCount: 0,
    recommended: true,
    tags: [],
    styleAttributes: {
      medium: { zhCN: '手绘线条', en: 'Hand-drawn lines' },
      palette: { zhCN: '黑白灰', en: 'Monochrome' },
      sceneDensity: { zhCN: '适中', en: 'Medium' },
      swatch: {
        background: '#ffffff',
        foreground: '#171717',
        accent: '#a3a3a3',
        texture: 'paper' as const
      }
    }
  }];
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
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
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
      scopeKey: null,
      inputFingerprint: null,
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
    configuredCredentials: ['tts.openai.apiKey']
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
      getCapabilities: vi.fn(async () => ({ transcription: { providers: [] } })),
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
        scopeKey: null,
        inputFingerprint: null,
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
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
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
  if (screen.queryByRole('dialog', { name: '翻译设置' })) {
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
  }
  const composer = screen.getByRole('form', { name: '视频翻译' });
  fireEvent.click(within(composer).getByRole('button', { name: '开始翻译' }));
  const results = await screen.findAllByRole('link', { name: /^打开 / });
  fireEvent.click(results[0]!);
  await screen.findByRole('textbox', { name: '横屏字幕 1' });
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
  it('greets a signed-in user with the nickname from their email', () => {
    render(<DashboardPage
      onSelectPrompt={vi.fn()}
      gatewayState={{
        source: 'gateway',
        authState: 'signed_in',
        activationState: 'ready',
        account: { id: 'user-1', email: 'joshua@example.test', verified: true },
        bindingVersion: null,
        models: [],
        activationError: null
      }}
    />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/，joshua$/);
  });

  it.each(['signed_out', 'signed_in'] as const)('requires official sign-in before generating when %s with the current model source', async authState => {
    const creatorService = createInMemoryCreatorService();
    const createJob = vi.spyOn(creatorService, 'createJob');
    const gatewayState: ComponentProps<typeof DashboardPageView>['gatewayState'] = {
      source: authState === 'signed_in' ? 'manual' : 'gateway',
      authState,
      activationState: 'ready',
      account: authState === 'signed_in' ? { id: 'user-1', email: 'local@example.test', verified: true } : null,
      bindingVersion: null,
      models: [],
      activationError: null
    };
    render(<DashboardPage
      onSelectPrompt={vi.fn()}
      workspace="image-generation"
      creatorService={creatorService}
      gatewayState={gatewayState}
      gatewayAccountService={{ getState: vi.fn(async () => gatewayState) } as unknown as ComponentProps<typeof DashboardPageView>['gatewayAccountService']}
    />);

    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), { target: { value: '需要登录后生成的画面' } });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    const dialog = await screen.findByRole('dialog', { name: '登录后继续创作' });
    expect(createJob).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: authState === 'signed_in' ? '重新连接' : '登录 OpenCreator' })).toBeEnabled();
    if (authState === 'signed_in') expect(dialog).toHaveTextContent('当前使用本地模型服务');
  });

  it('does not retry a deterministic job creation response', async () => {
    const error = new ApiClientError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Unknown creator template: stickman-video@1'
    });
    const createJob = vi.fn(async () => { throw error; });

    await expect(createCreatorJobWithRecovery(
      { createJob } as unknown as CreatorWebService,
      { projectId: 'project_1', templateId: 'stickman-video', templateVersion: 2 }
    )).rejects.toBe(error);
    expect(createJob).toHaveBeenCalledTimes(1);
  });

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
        presetOrigin: null,
        state: { prompt: '迟到但已成功创建的任务' },
        agentThreadId: null,
        stages: [],
        artifacts: [],
        providerRequests: [],
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

  it('opens a Skill workspace directly in the unified composer', () => {
    const onSelectPrompt = vi.fn();
    render(
      <DashboardPage
        onSelectPrompt={onSelectPrompt}
        skillLaunch={{
          skillId: 'video-translation-multilingual',
          workspace: 'video-translation',
          promptHint: '上传视频，或者输入有效的视频链接'
        }}
      />
    );

    expect(screen.getByRole('form', { name: '视频翻译' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '告诉 Agent 你的要求' })).not.toBeInTheDocument();
    expect(onSelectPrompt).not.toHaveBeenCalled();
  });

  it.each([
    ['video-translation', '视频翻译', '视频翻译', ['视频翻译', '视频生成', '视频转录', '视频下载免费', '视频切片'], undefined],
    ['transcription', '视频转录', '视频转录', ['视频翻译', '视频生成', '视频转录', '视频下载免费', '视频切片'], undefined],
    ['image-generation', '图像生成', '图像生成', ['图像生成', '封面生成'], undefined],
    ['cover-generator', '封面生成', '封面生成', ['图像生成', '封面生成'], undefined],
    ['video-generation', '视频生成', '视频生成', ['视频翻译', '视频生成', '视频转录', '视频下载免费', '视频切片'], undefined],
    ['auto-clips', '视频切片', '视频切片', ['视频翻译', '视频生成', '视频转录', '视频下载免费', '视频切片'], undefined],
    ['smart-dubbing', '文本转语音', '文本转语音', ['音频转录', '文本转语音'], undefined],
    ['short-video-script', '短视频脚本生成', '短视频脚本生成', ['短视频脚本生成'], undefined],
    ['transcription', '音频转录', '视频转录', ['音频转录', '文本转语音'], 'audio-transcription']
  ] as const)('opens %s with only its creation-mode tabs and no default Agent', (workspace, tab, form, tabs, requestedMode) => {
    const onWorkspaceModeChange = vi.fn();
    if (requestedMode !== undefined) {
      window.sessionStorage.setItem('opencreator.dashboard-generation-mode', requestedMode);
    }
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace={workspace}
        onWorkspaceModeChange={onWorkspaceModeChange}
      />
    );

    expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map(item => item.textContent)).toEqual(tabs);
    expect(screen.getByRole('form', { name: form })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ['video-translation', '视频翻译'],
    ['transcription', '视频转录'],
    ['image-generation', '图像生成'],
    ['cover-generator', '封面生成'],
    ['video-generation', '视频生成'],
    ['video-download', '视频下载'],
    ['auto-clips', '视频切片'],
    ['smart-dubbing', '文本转语音'],
    ['short-video-script', '短视频脚本生成']
  ] as const)('opens an existing %s job in the unified composer', async (workspace, form) => {
    const creatorService = createInMemoryCreatorService();
    const { job } = await creatorService.createJob({
      projectId: 'project_1',
      templateId: workspace === 'cover-generator' ? 'cover' : workspace === 'auto-clips' ? 'auto-clip' : workspace,
      state: workspace === 'image-generation' ? { prompt: '来自模版的提示词' } : {}
    });
    const createJob = vi.spyOn(creatorService, 'createJob');
    const getJob = vi.spyOn(creatorService, 'getJob');
    render(<DashboardPage
      onSelectPrompt={vi.fn()}
      workspace={workspace}
      jobId={job.id}
      creatorService={creatorService}
    />);

    expect(await screen.findByRole('form', { name: form })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
    expect(getJob).toHaveBeenCalledWith(job.id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(createJob).not.toHaveBeenCalled();
    if (workspace === 'image-generation') {
      expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue('来自模版的提示词');
    }
  });

  it('keeps dubbing and composition enabled when starting from Voiceover', async () => {
    const creatorService = createInMemoryCreatorService();
    const createJob = vi.spyOn(creatorService, 'createJob');
    window.sessionStorage.setItem('opencreator.dashboard-generation-mode', 'voiceover');
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace="video-translation"
        creatorService={creatorService}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=voiceover-entry' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    await waitFor(() => expect(createJob).toHaveBeenCalled());
    const { job } = await creatorService.getJob('creator_test_job_1');
    expect(job.state).toMatchObject({ dubbing: true, composeVideo: true });
  });

  it('selects and persists a transcription provider and model', async () => {
    const creatorService = createInMemoryCreatorService();
    const createJob = vi.spyOn(creatorService, 'createJob');
    const config = createDefaultCreatorServicesConfig();
    const saveConfig = vi.fn(async (next: typeof config) => ({ config: next, configuredCredentials: [] }));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace="transcription"
        creatorService={creatorService}
        creatorServicesService={{
          getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })),
          saveConfig
        } as unknown as CreatorServicesSettingsService}
      />
    );

    const select = await screen.findByRole('combobox', { name: '语音识别模型' });
    changeControl(select, { target: { value: 'whisper.cpp:large-v3-turbo' } });
    await waitFor(() => expect(saveConfig).toHaveBeenCalled());
    expect(saveConfig.mock.calls[0]?.[0].transcription).toMatchObject({
      provider: 'whisper.cpp',
      whisperCpp: { model: 'large-v3-turbo' }
    });

    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=transcription-model' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始转录' }));
    await waitFor(() => expect(createJob).toHaveBeenCalled());
    const { job } = await creatorService.getJob('creator_test_job_1');
    expect(job.state).toMatchObject({
      transcriptionProvider: 'whisper.cpp',
      transcriptionModel: 'large-v3-turbo'
    });
  });

  it('selects and persists a speech provider and model', async () => {
    const creatorService = createInMemoryCreatorService();
    const createJob = vi.spyOn(creatorService, 'createJob');
    const config = createDefaultCreatorServicesConfig();
    const saveConfig = vi.fn(async (next: typeof config) => ({ config: next, configuredCredentials: [] }));
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace="smart-dubbing"
        creatorService={creatorService}
        creatorServicesService={{
          getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })),
          saveConfig,
          getTtsVoices: vi.fn(async () => ({
            provider: 'minimax',
            model: config.tts.minimax.model,
            voices: []
          }))
        } as unknown as CreatorServicesSettingsService}
      />
    );

    const select = await screen.findByRole('combobox', { name: '语音模型' });
    const value = `minimax:${config.tts.minimax.model}`;
    changeControl(select, { target: { value } });
    await waitFor(() => expect(saveConfig).toHaveBeenCalled());
    expect(saveConfig.mock.calls[0]?.[0].tts).toMatchObject({
      provider: 'minimax',
      minimax: { model: config.tts.minimax.model }
    });

    fireEvent.change(screen.getByRole('textbox', { name: '配音文案内容' }), {
      target: { value: '测试可选择的语音模型。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(createJob).toHaveBeenCalled());
    const { job } = await creatorService.getJob('creator_test_job_1');
    expect(job.state).toMatchObject({
      ttsProvider: 'minimax',
      ttsModel: config.tts.minimax.model
    });
  });

  it('renders the app directory in the selected English display language', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <DashboardPage onSelectPrompt={vi.fn()} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening), creator$/);
    expect(screen.getByText('What would you like to create?')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Generation type' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Image Generation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Video Downloader/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Featured apps' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Video Editing' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search apps' })).not.toBeInTheDocument();
    const videoTranslationCard = screen.getByRole('button', { name: /Video Translation & Dubbing/ });
    expect(within(videoTranslationCard).getByText('120+ Languages')).toBeInTheDocument();
    expect(within(videoTranslationCard).getByText('Hollywood Subtitles')).toBeInTheDocument();
    expect(within(videoTranslationCard).queryByText('Cinematic subtitles & dubbing')).not.toBeInTheDocument();
    const videoGenerationCard = screen.getByRole('button', { name: /Video Generation Seedance/ });
    expect(within(videoGenerationCard).queryByText('Generate video clips from text or a reference image')).not.toBeInTheDocument();
    for (const model of ['Seedance', 'Veo', 'Kling']) expect(within(videoGenerationCard).getByText(model)).toBeInTheDocument();
    for (const model of ['GPT Images', 'Seedream', 'Nano Banana']) expect(screen.getByText(model)).toBeInTheDocument();
    expect(screen.queryByText('Generate images and visual assets')).not.toBeInTheDocument();
    expect(screen.getAllByText('Image Generation')).toHaveLength(2);
    expect(screen.getByText('Free · Unlimited')).toBeInTheDocument();
    expect(screen.queryByText('Digital Avatar')).not.toBeInTheDocument();
  });

  it('renders the app directory in Brazilian Portuguese', () => {
    const { container } = render(<LanguageProvider initialPreference="pt-BR"><DashboardPage onSelectPrompt={vi.fn()} /></LanguageProvider>);
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('Painel');
    expect(container.querySelector('.creator-tool-embedded')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Aplicativos em destaque' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Pesquisar aplicativos' })).not.toBeInTheDocument();
    expect(container.querySelector('.dashboard-app-grid')).toBeInTheDocument();
  });

  it('hides the create project dropdown from the dashboard header', () => {
    const onCreateProject = vi.fn();

    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        onCreateProject={onCreateProject}
      />
    );

    expect(screen.queryByRole('button', { name: '新建项目' })).not.toBeInTheDocument();
    expect(onCreateProject).not.toHaveBeenCalled();
  });

  it('keeps the unified video translation composer in English', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <DashboardPage onSelectPrompt={vi.fn()} workspace="video-translation" />
      </LanguageProvider>
    );
    expect(screen.getByRole('form', { name: 'Video Translation' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Video link' })).toHaveAttribute(
      'placeholder',
      'Paste a video URL'
    );
    expect(screen.queryByText('No collaboration activity yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask Agent to review settings' })).not.toBeInTheDocument();
    expect(screen.queryByText('拖放视频到这里')).not.toBeInTheDocument();
  });

  it('does not show the Agent composer after a task starts', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);

    await translateTestVideo();
    expect(screen.queryByRole('textbox', { name: '告诉 Agent 你的要求' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-agent-panel="hidden"]')).toBeInTheDocument();
  });

  it('returns from a generation history project to history instead of the composer', async () => {
    const baseService = createInMemoryCreatorService();
    const translation = await createCompletedTranslationJob(baseService);
    const service = withHistoryJobs(baseService, [translation]);
    render(<RoutedDashboardPage service={service} initialWorkspace="video-translation" />);

    fireEvent.click(screen.getByRole('button', { name: '生成记录' }));
    expect(screen.getByRole('button', { name: 'video' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'video' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开项目编辑区 · youtube.com' }));
    expect(await screen.findByRole('heading', { name: '视频翻译', level: 2 })).toBeVisible();

    fireEvent.click(within(screen.getByRole('region', { name: '视频翻译项目产出' })).getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('tab', { name: '生成记录' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'video' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('youtube.com').length).toBeGreaterThan(0);
    expect(screen.queryByRole('form', { name: '视频翻译' })).not.toBeInTheDocument();
  });

  it('restores the original tool and type filter after opening a different workflow', async () => {
    const baseService = createInMemoryCreatorService();
    const translation = await createCompletedTranslationJob(baseService);
    const download = await createCompletedDownloadJob(baseService);
    const service = withHistoryJobs(baseService, [translation, download]);
    render(<RoutedDashboardPage service={service} initialWorkspace="video-translation" />);

    fireEvent.click(screen.getByRole('button', { name: '生成记录' }));
    expect(screen.getByRole('button', { name: 'video' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(await screen.findByRole('button', { name: '打开项目编辑区 · Download project' }));
    expect(await screen.findByRole('heading', { name: '视频下载' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('tab', { name: '生成记录' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'video' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Download project')).toBeVisible();
    expect(screen.getAllByText('youtube.com').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: '创作' }));
    expect(screen.getByRole('form', { name: '视频翻译' })).toBeVisible();
  });

  it('returns to the dashboard home instead of the fallback image workspace', async () => {
    const service = withHistoryJobs(createInMemoryCreatorService(), []);
    render(<RoutedDashboardPage service={service} />);

    fireEvent.click(screen.getByRole('button', { name: '生成记录' }));
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '创作' }));

    expect(await screen.findByRole('heading', { name: /好，创作者$/ })).toBeVisible();
    expect(document.querySelector('.dashboard-unified-workspace-page')).not.toBeInTheDocument();
  });

  it('leaves the workspace when the dashboard route clears its tool', async () => {
    const service = createInMemoryCreatorService();
    const view = render(<DashboardPage creatorService={service} workspace="video-translation" onSelectPrompt={vi.fn()} />);
    expect(await screen.findByRole('form', { name: '视频翻译' })).toBeVisible();

    view.rerender(<DashboardPage creatorService={service} workspace={undefined} onSelectPrompt={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: /好，创作者$/ })).toBeVisible();
    expect(screen.queryByRole('form', { name: '视频翻译' })).not.toBeInTheDocument();
  });

  it('renders the generation composer and searchable creator app directory', () => {
    const { container } = render(<DashboardPage onSelectPrompt={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/好，创作者$/);
    expect(screen.getByText('需要帮你做点什么')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '快速生成' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '精选应用' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /打开.+/ })).toHaveLength(0);
    expect(screen.getByRole('tablist', { name: '生成类型' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '图像生成' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '视频生成' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: '视频翻译' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('textbox', { name: '提示词' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图片设置' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请先描述需要生成的画面');
    expect(screen.getByRole('region', { name: '创作应用' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: '搜索应用' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '推荐' })).toHaveAttribute('aria-selected', 'true');
    const videoTranslationCard = screen.getByRole('button', { name: /^视频翻译/ });
    expect(within(videoTranslationCard).getByText('120+ 语言互译')).toBeInTheDocument();
    expect(within(videoTranslationCard).getByText('影视级字幕')).toBeInTheDocument();
    expect(within(videoTranslationCard).queryByText('影视级字幕 · 配音 · 唇形同步')).not.toBeInTheDocument();
    const videoGenerationCard = screen.getByRole('button', { name: /^视频生成/ });
    expect(within(videoGenerationCard).queryByText('文字或参考图生成视频片段')).not.toBeInTheDocument();
    for (const model of ['Seedance', 'Veo', 'Kling']) expect(within(videoGenerationCard).getByText(model)).toBeInTheDocument();
    for (const model of ['GPT Images', 'Seedream', 'Nano Banana']) expect(screen.getByText(model)).toBeInTheDocument();
    expect(screen.queryByText('生成创意图片与视觉素材')).not.toBeInTheDocument();
    const appCards = Array.from(container.querySelectorAll('.dashboard-app-card'));
    expect(appCards).toHaveLength(4);
    expect(appCards.map(card => card.querySelector('.dashboard-app-title strong')?.textContent)).toEqual([
      '视频下载',
      '视频翻译',
      '视频生成',
      '图像生成'
    ]);
    expect(appCards.map(card => card.querySelector('img')?.getAttribute('src'))).toEqual([
      '/platforms/youtube.png',
      undefined,
      undefined,
      '/dashboard/templates/image-generation/gpt-image.webp'
    ]);
    const videoDownloadCard = appCards[0] as HTMLElement;
    expect(videoDownloadCard.querySelectorAll('.dashboard-download-cover-sources img')).toHaveLength(12);
    expect(within(videoDownloadCard).getByText('免费 · 无限下载')).toBeInTheDocument();
    const videoPreview = screen.getByLabelText('视频生成示例');
    expect(videoPreview).toHaveAttribute('src', '/dashboard/templates/seedance-2.5-demo.mp4');
    expect(videoPreview).toHaveProperty('autoplay', true);
    expect(videoPreview).toHaveProperty('muted', true);
    expect(videoPreview).toHaveProperty('loop', true);
    expect(videoPreview).toHaveProperty('playsInline', true);
    const translationPreview = screen.getByLabelText('视频翻译示例');
    expect(translationPreview).toHaveAttribute('src', '/dashboard/templates/video-translation-demo.mp4');
    expect(translationPreview).toHaveAttribute('poster', '/dashboard/templates/video-translation-example.png');
    expect(translationPreview).toHaveProperty('autoplay', true);
    expect(translationPreview).toHaveProperty('muted', true);
    expect(translationPreview).toHaveProperty('loop', true);
    expect(translationPreview).toHaveProperty('playsInline', true);
    expect(screen.queryByRole('button', { name: /^火柴人动画 角色、分镜与完整动画/ }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^自动剪辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^文本转语音/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^视频生成/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^文章写作/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^数字人口播/ })).not.toBeInTheDocument();
  });

  it('starts video translation with the compact model selector and integrated settings', async () => {
    const creatorService = createInMemoryCreatorService();
    const onWorkspaceNavigate = vi.fn();
    const gatewayState: ComponentProps<typeof DashboardPageView>['gatewayState'] = {
      source: 'gateway',
      authState: 'signed_in',
      activationState: 'ready',
      account: { id: 'a', email: 'a@test', verified: true },
      bindingVersion: '1',
      activationError: null,
      selectedModels: { text: 'vendor/text-one' },
      models: ['one', 'two'].map(name => ({
        id: `vendor/text-${name}`,
        modality: 'text',
        capabilities: ['responses', 'chat']
      }))
    };
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorService={creatorService}
        gatewayState={gatewayState}
        onWorkspaceNavigate={onWorkspaceNavigate}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '视频翻译' }));
    const composer = screen.getByRole('form', { name: '视频翻译' });
    const actionBar = composer.querySelector('.dashboard-translation-action-bar');
    expect(actionBar).not.toBeNull();
    expect(within(actionBar as HTMLElement).getByRole('combobox', { name: '翻译模型' })).toBeInTheDocument();
    expect(within(actionBar as HTMLElement).getByRole('button', { name: '翻译设置' })).toBeInTheDocument();
    expect(within(actionBar as HTMLElement).queryByRole('combobox', { name: '翻译为' })).not.toBeInTheDocument();
    expect(within(composer).getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveAttribute('type', 'url');
    expect(screen.getByLabelText('上传视频、音频或 SRT 字幕')).toHaveAttribute('type', 'file');

    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请先上传视频、字幕或填写一个视频链接');
    const sourceUrl = 'https://www.youtube.com/watch?v=dashboard-translation';
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), { target: { value: sourceUrl } });
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    const settings = screen.getByRole('dialog', { name: '翻译设置' });
    expect(within(settings).getByRole('combobox', { name: '源语言' })).toBeInTheDocument();
    changeControl(within(settings).getByRole('combobox', { name: '翻译为' }), { target: { value: 'ja' } });
    fireEvent.click(within(settings).getByRole('switch', { name: '双语字幕' }));
    fireEvent.click(within(settings).getByRole('switch', { name: '暂不下载原视频' }));
    expect(settings.querySelector('header')).toBeNull();
    expect(within(settings).queryByRole('button', { name: '关闭翻译设置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    await waitFor(() => expect(onWorkspaceNavigate).toHaveBeenCalledWith('video-translation', expect.any(String)));
    const navigation = onWorkspaceNavigate.mock.calls.find(([workspace, jobId]) => workspace === 'video-translation' && typeof jobId === 'string');
    const { job } = await creatorService.getJob(navigation![1] as string);
    expect(job.state).toMatchObject({
      sourceUrl,
      targetLanguage: 'ja',
      bilingual: false,
      skipVideoDownload: true
    });
    expect(await screen.findByRole('button', { name: '展开创作对话框' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '视频翻译' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '生成记录' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens image and video workspaces after generating with the selected models and prompts', async () => {
    const creatorService = createInMemoryCreatorService();
    const view = render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={creatorService} />);

    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), {
      target: { value: '晨光中的未来城市' }
    });
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(screen.getByRole('button', { name: 'Google 1 个模型' }));
    fireEvent.click(screen.getByRole('option', { name: 'Gemini' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    fireEvent.click(await screen.findByRole('button', { name: '展开创作对话框' }));
    expect(screen.getByRole('tab', { name: '生成记录' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue('晨光中的未来城市'));
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('Gemini');

    view.rerender(<DashboardPage onSelectPrompt={vi.fn()} creatorService={creatorService} workspace="video-generation" />);
    fireEvent.click(await screen.findByRole('tab', { name: '视频生成' }));
    const videoPrompt = screen.getByRole('textbox', { name: '提示词' });
    expect(videoPrompt).toHaveValue('');
    fireEvent.change(videoPrompt, { target: { value: '镜头穿过未来城市' } });
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(screen.getByRole('option', { name: 'Seedance 2.0' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    fireEvent.click(await screen.findByRole('button', { name: '展开创作对话框' }));
    expect(screen.getByRole('tab', { name: '生成记录' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue('镜头穿过未来城市'));
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('Seedance 2.0');
  });

  it('uses the workspace prompt controls in the dashboard composer', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);

    const prompt = screen.getByRole('textbox', { name: '提示词' });
    expect(prompt).toHaveAttribute('rows', '5');
    expect(screen.queryByRole('button', { name: '展开编辑区' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '填入示例提示词' }));
    expect(prompt).toHaveValue('一间通透的现代创意工作室，清晨自然光从落地窗照入，桌面有相机、手稿和绿植，真实摄影质感，构图干净，细节丰富');
    fireEvent.click(screen.getByRole('button', { name: '清空提示词' }));
    expect(prompt).toHaveValue('');
    fireEvent.click(screen.getByRole('tab', { name: '视频生成' }));
    fireEvent.click(screen.getByRole('button', { name: '填入示例提示词' }));
    expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue('一辆复古红色跑车沿着海岸公路行驶，黄昏金色阳光，低机位跟拍，海风吹动路边植物，电影级真实质感，镜头运动平稳');
  });

  it('removes image and video settings headers from dashboard popovers', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    for (const [tab, label] of [['图像生成', '图片设置'], ['视频生成', '视频设置']] as const) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      fireEvent.click(screen.getByRole('button', { name: label }));
      const dialog = screen.getByRole('dialog', { name: label });
      expect(dialog.querySelector('header')).toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: label })).not.toBeInTheDocument();
    }
  });

  it('hides the All tab and keeps every module available through categories', () => {
    const { container } = render(<DashboardPage onSelectPrompt={vi.fn()} />);
    const titles: string[] = [];
    for (const [category, expected] of [
      ['视频创作', ['视频生成', '火柴人动画']],
      ['视频编辑', ['视频下载', '视频翻译', '视频切片']],
      ['图像创作', ['图像生成', '封面生成']],
      ['文案创作', ['短视频脚本']],
      ['音频处理', ['文本转语音', '视频转录']]
    ] as const) {
      fireEvent.click(screen.getByRole('tab', { name: category }));
      const current = Array.from(container.querySelectorAll('.dashboard-app-title strong')).map(card => card.textContent ?? '');
      expect(current).toEqual(expected);
      titles.push(...current);
    }
    expect([...titles].sort()).toEqual([
      '视频下载', '视频翻译', '视频生成', '图像生成', '火柴人动画',
      '视频切片', '封面生成', '短视频脚本', '文本转语音', '视频转录'
    ].sort());
    expect(screen.queryByRole('tab', { name: '全部' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: '搜索应用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^数字人口播/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '推荐' }));
    expect(container.querySelectorAll('.dashboard-app-card')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /^小红书帖子/ })).not.toBeInTheDocument();
  });

  it('opens the WeChat article writer directly while hiding its directory entry', () => {
    const { container } = render(<DashboardPage workspace="wechat-article" onSelectPrompt={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '文章写作' })).toBeInTheDocument();
    expect(screen.getByText('公众号、X 等平台文章')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '文章写作流程' })).toBeInTheDocument();
    expect(screen.getByText('从右侧添加链接或文件。没有资料也可以继续写作。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByText('写作模板')).toBeInTheDocument();
    expect(screen.queryByText('排版模板')).not.toBeInTheDocument();
    expect(container.querySelector('.wechat-layout-list')).not.toBeInTheDocument();
  });

  it('requires a Bilibili part selection and persists it without duplicate metadata requests', async () => {
    const creatorService = createInMemoryCreatorService();
    const applyAction = vi.spyOn(creatorService, 'applyAction');
    const parts = [1, 2, 3].map(index => ({ index, title: `课程 ${index}`, cid: 1000 + index, width: 1920, height: 1080 }));
    const getVideoMetadata = vi.fn(async () => ({ platform: 'bilibili' as const, title: '课程合集', parts }));
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="video-translation" creatorService={creatorService}
      videoMetadataService={{ getVideoMetadata }} />);
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.bilibili.com/video/BV18E421w7bf/?spm_id_from=share' }
    });
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    expect(screen.getByText('正在读取 B 站分集信息，请稍候…')).toBeInTheDocument();
    const selector = await screen.findByRole('combobox', { name: '选择要翻译的分集' });
    expect(selector).toHaveValue('');
    expect(screen.queryByTitle('Bilibili 视频预览')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));
    expect(screen.getByText('请确认链接有效，并选择要翻译的分集后开始')).toBeInTheDocument();
    changeControl(selector, { target: { value: '3' } });
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveValue('https://www.bilibili.com/video/BV18E421w7bf?p=3');
    expect(selector).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      action: 'update-settings', input: expect.objectContaining({ patch: expect.objectContaining({ sourceUrl: 'https://www.bilibili.com/video/BV18E421w7bf?p=3' }) })
    })));
    expect(getVideoMetadata).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2, 3])('preselects an explicit Bilibili P%s link', async index => {
    const parts = [1, 2, 3].map(index => ({ index, title: `课程 ${index}` }));
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="video-translation"
      videoMetadataService={{ getVideoMetadata: vi.fn(async () => ({ platform: 'bilibili' as const, title: '课程合集', parts, selectedPart: parts[index - 1]! })) }} />);
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: `https://www.bilibili.com/video/BV18E421w7bf?p=${index}` }
    });
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    expect(await screen.findByRole('combobox', { name: '选择要翻译的分集' })).toHaveValue(String(index));
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveValue(`https://www.bilibili.com/video/BV18E421w7bf?p=${index}`);
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));
    await waitFor(() => expect(screen.queryByRole('combobox', { name: '选择要翻译的分集' })).not.toBeInTheDocument());
  });

  it('shows a recoverable Bilibili lookup error rather than silently translating P1', async () => {
    const getVideoMetadata = vi.fn()
      .mockRejectedValueOnce(new Error('无法读取 B 站分集信息，请重试'))
      .mockResolvedValueOnce({ platform: 'bilibili', title: '课程合集', parts: [{ index: 1, title: '课程 1' }, { index: 2, title: '课程 2' }] });
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="video-translation" videoMetadataService={{ getVideoMetadata }} />);
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.bilibili.com/video/BV18E421w7bf' }
    });
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    expect(await screen.findByText('无法读取 B 站分集信息，请重试')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));
    expect(screen.getByText('请确认链接有效，并选择要翻译的分集后开始')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    fireEvent.click(screen.getByRole('button', { name: '重新读取分集' }));
    expect(await screen.findByRole('combobox', { name: '选择要翻译的分集' })).toHaveValue('');
    expect(getVideoMetadata).toHaveBeenCalledTimes(2);
  });

  it('opens the video translation workspace and keeps its result in place', async () => {
    const onSelectPrompt = vi.fn();
    const creatorService = createInMemoryCreatorService();
    render(
      <DashboardPage
        onSelectPrompt={onSelectPrompt}
        creatorService={creatorService}
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

    await translateTestVideo();
    fireEvent.click(screen.getByRole('button', { name: '自定义样式' }));
    changeControl(screen.getByRole('combobox', { name: '字幕字体' }), { target: { value: 'rounded' } });
    changeControl(screen.getByRole('combobox', { name: '字幕大小' }), { target: { value: 'large' } });
    fireEvent.click(screen.getByRole('button', { name: '选择译文颜色' }));
    fireEvent.click(screen.getByRole('button', { name: '#FFE45C' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '#FFE45C' }), { key: 'Escape' });
    expect(screen.getByRole('combobox', { name: '字幕字体' })).toHaveValue('rounded');
    expect(screen.getByRole('combobox', { name: '字幕大小' })).toHaveValue('large');
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    expect(onSelectPrompt).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '视频翻译', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toBeInTheDocument();
    expect(screen.getByText('项目 V1')).toBeInTheDocument();
    openSubtitleEditor();
    expect(screen.queryByRole('button', { name: '保存字幕' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '视频翻译项目产出' })).getByRole('button', { name: '返回' })).toBeInTheDocument();
    expect(screen.queryByText(/之前的版本仍可查看/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '合成视频' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成新版本' })).not.toBeInTheDocument();
  });

  it('opens translation settings in a dialog and preserves the selected language', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    openBlankWorkspace('视频翻译', '空白视频翻译');
    expect(screen.queryByRole('navigation', { name: '翻译流程' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), { target: { value: 'https://www.youtube.com/watch?v=steps-test' } });
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    const settings = screen.getByRole('dialog', { name: '翻译设置' });
    changeControl(within(settings).getByRole('combobox', { name: '翻译为' }), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('ja');
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    expect(within(screen.getByRole('form', { name: '视频翻译' })).getByRole('button', { name: '开始翻译' })).toBeEnabled();
  });

  it('preserves style and output settings when switching editor panels', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={createInMemoryCreatorService()} />);
    await translateTestVideo();
    fireEvent.click(screen.getByRole('button', { name: '自定义样式' }));
    changeControl(screen.getByRole('combobox', { name: '字幕字体' }), { target: { value: 'rounded' } });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    openTranslationPanel('视频输出');
    fireEvent.click(screen.getByRole('radio', { name: /9:16/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /竖屏主标题/ }), { target: { value: '保留标题' } });
    openTranslationPanel('字幕样式');
    fireEvent.click(screen.getByRole('button', { name: '自定义样式' }));
    expect(screen.getByRole('combobox', { name: '字幕字体' })).toHaveValue('rounded');
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    openTranslationPanel('视频输出');
    expect(screen.getByRole('radio', { name: /9:16/ })).toBeChecked();
    expect(screen.getByRole('textbox', { name: /竖屏主标题/ })).toHaveValue('保留标题');
    expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '项目 V2' })).not.toBeInTheDocument();
  });

  it('uses the selected vertical output ratio for the subtitle preview', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={createInMemoryCreatorService()} />);
    await translateTestVideo();
    openTranslationPanel('视频输出');
    fireEvent.click(screen.getByRole('radio', { name: /9:16/ }));
    openTranslationPanel('字幕样式');
    fireEvent.click(screen.getByRole('button', { name: '自定义样式' }));
    expect(screen.getByRole('region', { name: '同步视频预览' }).querySelector('.video-result-player-frame')).toHaveAttribute('data-ratio', '9:16');
  });

  it('returns from the translation editor to project outputs without leaving the project', async () => {
    const onSelectPrompt = vi.fn();
    const creatorService = createInMemoryCreatorService();
    render(
      <DashboardPage
        onSelectPrompt={onSelectPrompt}
        creatorService={creatorService}
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

    await translateTestVideo();
    expect(onSelectPrompt).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '视频翻译', level: 2 })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '保存字幕' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region', { name: '视频翻译项目产出' })).getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('tab', { name: '生成记录' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: '继续创作' })).toBeVisible();
    expect(screen.queryByRole('form', { name: '视频翻译' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开创作对话框' }));
    expect(await screen.findByRole('form', { name: '视频翻译' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: '打开 youtube.com' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: '作品' })).not.toBeInTheDocument();
  });


  it('preserves custom subtitle settings across result panels without starting video output', async () => {
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} />);
    await translateTestVideo();
    fireEvent.click(screen.getByRole('button', { name: '字幕样式' }));
    fireEvent.click(screen.getByRole('button', { name: '在下' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义样式' }));
    changeControl(screen.getByRole('combobox', { name: '字幕字体' }), { target: { value: 'rounded' } });
    changeControl(screen.getByRole('combobox', { name: '字幕大小' }), { target: { value: 'large' } });
    fireEvent.click(screen.getByRole('button', { name: '选择译文颜色' }));
    fireEvent.click(screen.getByRole('button', { name: '#FFE45C' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '#FFE45C' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    fireEvent.click(screen.getByRole('button', { name: '任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '字幕样式' }));
    expect(screen.getByRole('button', { name: '在下' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '自定义样式' }));
    expect(screen.getByRole('combobox', { name: '字幕字体' })).toHaveAttribute('data-value', 'rounded');
    expect(screen.getByRole('combobox', { name: '字幕大小' })).toHaveAttribute('data-value', 'large');
    expect(screen.getByRole('button', { name: '选择译文颜色' })).toHaveAttribute('aria-label', '选择译文颜色');
    expect(screen.getByRole('button', { name: '选择译文颜色' }).parentElement).toHaveTextContent('#FFE45C');
    expect(screen.getByRole('button', { name: '选择原文颜色' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    fireEvent.click(screen.getByRole('switch', { name: '双语字幕' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义样式' }));
    expect(screen.queryByRole('button', { name: '选择原文颜色' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择译文颜色' }).parentElement).toHaveTextContent('#FFE45C');
    expect(applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage')).toHaveLength(1);
  });


  it('keeps style changes as a draft without output or a new result version', async () => {
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} />);
    await translateTestVideo();
    fireEvent.click(screen.getByRole('button', { name: '自定义样式' }));
    changeControl(screen.getByRole('combobox', { name: '字幕字体' }), { target: { value: 'rounded' } });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(async () => expect((await service.getJob('creator_test_job_1')).job.state).toMatchObject({ subtitleStyle: { fontPreset: 'rounded' }, composeVideo: false, resultVersion: 1 }));
    expect(screen.getByRole('button', { name: '项目 V1' })).toBeVisible();
    expect(applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage').map(([, request]) => request.input.stageId)).toEqual(['subtitle']);
    expect(applyAction.mock.calls.some(([, request]) => request.action === 'commit-version')).toBe(false);
  });

  it('submits public video link analysis from the dashboard', async () => {
    const creatorService = createInMemoryCreatorService();
    const applyAction = vi.spyOn(creatorService, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={creatorService} />);
    openBlankWorkspace('视频下载', '空白视频下载');

    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=download-test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '获取' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      action: 'run-stage', input: { stageId: 'probe' }
    })));
    expect(await screen.findByRole('textbox', { name: '继续创作' })).toHaveAttribute('placeholder', '粘贴一个公开视频链接…');
    expect(screen.queryByRole('form', { name: '视频下载' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开创作对话框' }));
    expect(await screen.findByRole('form', { name: '视频下载' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '生成记录' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: '下载规格' })).not.toBeInTheDocument();
  });

  it('opens the runtime-backed stickman workspace from the dashboard', async () => {
    const creatorService = createInMemoryCreatorService();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorService={creatorService}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    fireEvent.click(screen.getByRole('button', { name: /^火柴人动画/ }));
    expect(screen.getByRole('heading', { name: '火柴人动画' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '火柴人视频制作步骤' })).toBeInTheDocument();
    const characterPresets = screen.getByRole('radiogroup', { name: '角色预设' });
    expect(await within(characterPresets).findByRole('radio', { name: '默认角色' }))
      .toHaveAttribute('aria-checked', 'true');
    expect(creatorService.listVisualAssets).toHaveBeenCalledWith('stickman-video');
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

    expect(screen.getByRole('form', { name: '视频切片' })).toBeInTheDocument();
    expect(screen.getByLabelText('上传视频或音频')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveAttribute('placeholder', '粘贴视频链接');
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=auto-clips' }
    });
    expect(screen.getByRole('img', { name: 'YouTube 视频缩略图' })).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/auto-clips/hqdefault.jpg'
    );
    expect(await screen.findByText('自动剪辑测试视频')).toBeInTheDocument();
    expect(screen.getByText('YouTube 视频 · 测试创作者')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '播放 YouTube 视频预览' }));
    expect(screen.getByTitle('YouTube 视频预览')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/auto-clips'
    );

    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeInTheDocument();

    const file = new File(['video'], 'long-interview.mp4', { type: 'video/mp4' });
    changeControl(screen.getByLabelText('上传视频或音频'), { target: { files: [file] } });
    const localPreview = await screen.findByLabelText('本地视频预览');
    expect(localPreview).toHaveAttribute('src', 'blob:auto-clips-preview');
    Object.defineProperties(localPreview, {
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 }
    });
    fireEvent.loadedMetadata(localPreview);
    expect(screen.getByText('long-interview.mp4')).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '切片设置' }));
    expect(screen.getByRole('spinbutton', { name: '切片数量' })).toHaveValue(3);
    expect(screen.getByRole('combobox', { name: '切片时长' })).toHaveValue('90-180');
    expect(screen.getByRole('button', { name: '开始切片' })).toBeEnabled();
  });

  it('defaults to three 90-180 second clips for a long video', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="auto-clips" />);

    expect(screen.getByRole('form', { name: '视频切片' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始切片' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=long-video' }
    });
    fireEvent.click(screen.getByRole('button', { name: '切片设置' }));
    expect(screen.getByRole('spinbutton', { name: '切片数量' })).toHaveValue(3);
    expect(screen.getByRole('combobox', { name: '切片时长' })).toHaveValue('90-180');
    expect(screen.getByRole('button', { name: '开始切片' })).toBeEnabled();
  });

  it('skips the legacy clip settings flow after starting auto clips', async () => {
    const creatorService = createInMemoryCreatorService();
    const applyAction = vi.spyOn(creatorService, 'applyAction');
    const onWorkspaceModeChange = vi.fn();
    render(<DashboardPage onSelectPrompt={vi.fn()} workspace="auto-clips" creatorService={creatorService} onWorkspaceModeChange={onWorkspaceModeChange} />);

    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=auto-clips-flow' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始切片' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      action: 'run-stage', input: expect.objectContaining({ stageId: 'clip' })
    })));

    await waitFor(() => expect(screen.queryByRole('navigation', { name: '视频切片流程' })).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: '设置切片目标' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一步：切片设置' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '生成记录' })).toHaveAttribute('aria-selected', 'true');
    const composer = document.querySelector('.dashboard-generation-session-composer') as HTMLElement;
    expect(within(composer).getByRole('textbox', { name: '继续创作' })).toBeVisible();
    expect(within(composer).queryByRole('form', { name: '视频切片' })).not.toBeInTheDocument();
    expect(within(composer).getByRole('button', { name: '展开创作对话框' })).toHaveClass('dashboard-generation-session-collapsed-plus');
    composer.scrollTop = 120;
    fireEvent.click(within(composer).getByRole('button', { name: '展开创作对话框' }));
    expect(await within(composer).findByRole('form', { name: '视频切片' })).toBeVisible();
    expect(composer.scrollTop).toBe(0);
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(within(composer).getByRole('button', { name: '收起创作对话框' }));
    expect(within(composer).getByRole('textbox', { name: '继续创作' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '创作' }));
    expect(await screen.findByRole('form', { name: '视频切片' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '视频链接' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '开始切片' })).toBeDisabled();
    expect(document.querySelector('fieldset.image-generation-fields')).not.toBeDisabled();
  });

  it('configures cover output in the unified composer', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '图像创作' }));
    openBlankWorkspace('封面生成', '空白封面生成');

    expect(screen.getByRole('form', { name: '封面生成' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '封面内容要求' }), {
      target: { value: '蓝色科技感，人物主体清晰，电影级光线' }
    });
    fireEvent.click(screen.getByRole('button', { name: '封面设置' }));
    const settings = screen.getByRole('dialog', { name: '封面设置' });
    fireEvent.click(within(settings).getByRole('radio', { name: '1:1' }));
    fireEvent.click(within(settings).getByRole('radio', { name: '4 个方案' }));
    expect(within(settings).getByRole('radio', { name: '1:1' })).toHaveAttribute('aria-checked', 'true');
    expect(within(settings).getByRole('radio', { name: '4 个方案' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
  });

  it('creates blank workspaces with the current runtime template version', async () => {
    const creatorService = createInMemoryCreatorService();
    const createJob = vi.spyOn(creatorService, 'createJob');
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorService={creatorService}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '图像创作' }));
    openBlankWorkspace('封面生成', '空白封面生成');
    fireEvent.change(screen.getByRole('textbox', { name: '封面内容要求' }), {
      target: { value: '验证空白封面使用当前模板版本' }
    });

    await waitFor(() => expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 'cover',
        templateVersion: 2
      })
    ));
  });

  it('automatically saves generated subtitle edits without leaving the result workspace', async () => {
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} />);
    await translateTestVideo();
    const firstSubtitle = screen.getByRole('textbox', { name: '横屏字幕 1' });
    fireEvent.change(firstSubtitle, { target: { value: 'A manually edited subtitle.' } });
    expect(screen.getByLabelText('有未保存的字幕修改')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '横屏字幕内容' })).toContainElement(firstSubtitle);
    await waitForSubtitleAutosave();
    expect(applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      action: 'edit-subtitle', input: expect.objectContaining({ baseResultVersion: 1, preserveResultVersion: true,
        cues: expect.arrayContaining([expect.objectContaining({ id: 1, text: 'A manually edited subtitle.' })]) })
    }));
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('A manually edited subtitle.');
    expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '项目 V2' })).not.toBeInTheDocument();
  });

  it('requires confirmation before retranslating edited subtitles into a new version', async () => {
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} />);
    await translateTestVideo();
    fireEvent.change(screen.getByRole('textbox', { name: '横屏字幕 2' }), { target: { value: 'Welcome back to OpenCreator.' } });
    await waitForSubtitleAutosave();
    openTranslationPanel('任务设置');
    changeControl(screen.getByRole('combobox', { name: '翻译为' }), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: '重新翻译字幕' }));
    const confirmation = screen.getByRole('group', { name: '确认生成新版本' });
    expect(confirmation).toHaveTextContent('人工修改保留在历史版本中');
    expect(applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage')).toHaveLength(1);
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认重新翻译字幕' }));
    const versionTrigger = await screen.findByRole('button', { name: '项目 V2' });
    expect(versionTrigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(versionTrigger);
    fireEvent.click(within(screen.getByRole('menu')).getByText('项目 V1').closest('button')!);
    expect(await screen.findByRole('textbox', { name: '横屏字幕 2' })).toHaveValue('Welcome back to OpenCreator.');
  });

  it('saves manual subtitle edits before composing a new version', async () => {
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} />);
    await translateTestVideo();
    fireEvent.change(screen.getByRole('textbox', { name: '横屏字幕 1' }), { target: { value: 'The manually revised opening.' } });
    expect(screen.getByRole('button', { name: '合成视频' })).toBeDisabled();
    await waitForSubtitleAutosave();
    fireEvent.click(screen.getByRole('button', { name: '合成视频' }));
    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('The manually revised opening.');
    expect(applyAction.mock.calls.filter(([, request]) => ['edit-subtitle', 'run-stage'].includes(request.action)).map(([, request]) => request.action === 'run-stage' ? request.input.stageId : request.action)).toEqual(['subtitle', 'edit-subtitle', 'render-horizontal']);
  });

  it('adds dubbing through settings and generates it in the next version', async () => {
    const tts = createTtsServices();
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    const rendered = render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} creatorServicesService={tts.service} />);
    await translateTestVideo();
    openTranslationPanel('配音');
    await waitFor(() => expect(screen.getByRole('switch', { name: '启用配音' })).toBeEnabled());
    fireEvent.click(screen.getByRole('switch', { name: '启用配音' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '配音音色' })).toHaveAttribute('data-value', 'marin'));
    fireEvent.click(screen.getByRole('button', { name: '配音并合成视频' }));
    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    expect(screen.getByText(/目标语言配音-V2.wav/)).toBeInTheDocument();
    expect(applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'run-stage', input: expect.objectContaining({ stageId: 'tts', baseResultVersion: 1, inputResultVersion: 1 }) }));
    await waitFor(() => expect(document.querySelector('audio')).toHaveAttribute('src', 'blob:preview'));
    rendered.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('returns to settings and creates a new version without replacing the old one', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    await translateTestVideo();

    fireEvent.click(screen.getByRole('button', { name: '调整任务设置' }));
    changeControl(screen.getByRole('combobox', { name: '翻译为' }), {
      target: { value: 'ja' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加素材' }));
    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=draft-source' }
    });

    expect(screen.getByText('正在基于 V1 调整')).toBeInTheDocument();
    expect(screen.getByText('原成品已保留，当前修改为配置草稿')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回 V1 成品' }));
    expect(screen.getByText('项目 V1')).toBeInTheDocument();
    expect(screen.getByText('https://www.youtube.com/watch?v=test')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '调整任务设置' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('ja');
    fireEvent.click(screen.getByRole('button', { name: '添加素材' }));
    expect(screen.getByRole('img', { name: 'YouTube 视频缩略图' })).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/draft-source/hqdefault.jpg'
    );
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('ja');
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

    expect(await screen.findByRole('button', { name: '项目 V1' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText('正在查看 V1')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '视频翻译', level: 1 }).parentElement).toHaveTextContent('https://www.youtube.com/watch?v=test');
    openSubtitleEditor();
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('Welcome to OpenCreator.');
  });

  it('reuses completed subtitles when video composition is enabled for a new version', async () => {
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} />);
    await translateTestVideo('reuse-subtitles');
    fireEvent.click(screen.getByRole('button', { name: '合成视频' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      action: 'run-stage', input: expect.objectContaining({ stageId: 'render-horizontal', workflow: true, baseResultVersion: 1, inputResultVersion: 1 })
    })));
    expect(applyAction.mock.calls.flatMap(([, request]) => request.action === 'run-stage' ? [request.input.stageId] : [])).toEqual(['subtitle', 'render-horizontal']);
    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    expect(screen.queryByText('新版本已从“横屏成片”开始，旧版本和已有前置产物会继续保留')).not.toBeInTheDocument();
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
    await translateTestVideo('source-v1');

    fireEvent.click(screen.getByRole('button', { name: '调整任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '添加素材' }));
    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=source-v2' }
    });
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

  it('keeps unchanged subtitle-only settings without rerunning a stage or creating a version', async () => {
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} />);
    await translateTestVideo('settings-only');
    fireEvent.click(screen.getByRole('button', { name: '调整任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));
    expect(await screen.findByText('当前版本没有修改，不需要生成新版本')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回 V1 成品' }));
    expect(applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage')).toHaveLength(1);
    expect(applyAction.mock.calls.some(([, request]) => request.action === 'commit-version')).toBe(false);
    expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
  });

  it('merges an autosaved subtitle edit and downstream render into one new project version', async () => {
    const service = createInMemoryCreatorService();
    const applyAction = vi.spyOn(service, 'applyAction');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={service} />);
    await translateTestVideo('single-version');
    fireEvent.change(screen.getByRole('textbox', { name: '横屏字幕 1' }), { target: { value: 'Edited before rendering.' } });
    await waitForSubtitleAutosave();
    fireEvent.click(screen.getByRole('button', { name: '合成视频' }));
    const versionTrigger = await screen.findByRole('button', { name: '项目 V2' });
    expect(applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'edit-subtitle', input: expect.objectContaining({ baseResultVersion: 1, preserveResultVersion: true }) }));
    const renderRequest = applyAction.mock.calls.find(([, request]) => request.action === 'run-stage' && request.input.stageId === 'render-horizontal')?.[1];
    expect(renderRequest?.input).toMatchObject({ baseResultVersion: 1, inputResultVersion: 1 });
    expect(renderRequest?.input).not.toHaveProperty('targetResultVersion');
    fireEvent.click(versionTrigger);
    expect(screen.getByRole('menu')).toHaveTextContent('项目 V1');
    expect(screen.getByRole('menu')).not.toHaveTextContent('项目 V3');
  });

  it('uses the full workspace instead of resizable Agent panes after a task starts', async () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    await translateTestVideo();

    expect(screen.queryByRole('separator', { name: '调整操作区和对话区宽度' })).not.toBeInTheDocument();
    expect(document.querySelector('.video-translation-collab-layout')).toHaveAttribute('data-agent-panel', 'hidden');
  });

  it('supports local video, dubbing and vertical output options', async () => {
    const tts = createTtsServices();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        creatorServicesService={tts.service}
      />
    );
    openBlankWorkspace('视频翻译', '空白视频翻译');

    const video = new File(['video'], 'demo.mp4', { type: 'video/mp4' });
    changeControl(screen.getByLabelText('上传视频、音频或 SRT 字幕'), { target: { files: [video] } });
    expect(await screen.findByLabelText('本地视频预览')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '翻译设置' }));
    expect(screen.getByRole('switch', { name: '优先使用平台字幕' })).toBeDisabled();
    await startVideoTranslation();
    openTranslationPanel('视频输出');
    expect(screen.getByRole('radio', { name: /16:9/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /双画幅/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: /9:16/ }));
    expect(screen.getByRole('textbox', { name: /竖屏主标题/ })).toBeInTheDocument();
    openTranslationPanel('配音');
    await waitFor(() => expect(screen.getByRole('switch', { name: '启用配音' })).toBeEnabled());
    fireEvent.click(screen.getByRole('switch', { name: '启用配音' }));

    expect(screen.getByRole('heading', { name: '视频翻译', level: 1 }).parentElement).toHaveTextContent('demo.mp4');
    await waitFor(() => expect(screen.getByRole('combobox', { name: '配音音色' })).toHaveAttribute('data-value', 'marin'));
    expect(tts.getTtsVoices).toHaveBeenCalledWith('openai', 'gpt-4o-mini-tts');
    expect(screen.getByRole('switch', { name: '启用配音' })).toHaveAttribute('aria-checked', 'true');
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
    openBlankWorkspace('视频翻译', '空白视频翻译');

    const video = new File(['video'], 'portrait.mp4', { type: 'video/mp4' });
    changeControl(screen.getByLabelText('上传视频、音频或 SRT 字幕'), { target: { files: [video] } });
    const preview = await screen.findByLabelText('本地视频预览');
    Object.defineProperties(preview, {
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 }
    });
    fireEvent.loadedMetadata(preview);

    await startVideoTranslation();
    openTranslationPanel('视频输出');

    expect(screen.getByRole('radio', { name: /16:9/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /双画幅/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /9:16/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /9:16/ })).toBeChecked();
  });

  it('requires a source before starting translation in the unified composer', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    openBlankWorkspace('视频翻译', '空白视频翻译');
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请先上传视频、字幕或填写一个视频链接');
    expect(screen.getByRole('alert')).toHaveClass('dashboard-translation-message', 'is-error');
    expect(screen.queryByRole('heading', { name: '拖放视频到这里' })).not.toBeInTheDocument();
  });

  it('adjusts translation settings locally instead of delegating to the Creator Agent', async () => {
    const creatorService = createInMemoryCreatorService();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        projectId="project_1"
        creatorService={creatorService}
      />
    );
    await translateTestVideo();
    expect(screen.queryByRole('textbox', { name: '告诉 Agent 你的要求' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '调整任务设置' }));

    expect(creatorService.runAgentTurn).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('zh_cn');
  });

  it('does not show the Agent review quick action in the result workspace', async () => {
    const creatorService = createInMemoryCreatorService();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        projectId="project_1"
        creatorService={creatorService}
      />
    );
    await translateTestVideo();

    expect(screen.queryByRole('button', { name: '让 Agent 检查设置' })).not.toBeInTheDocument();
    expect(creatorService.runAgentTurn).not.toHaveBeenCalled();
  });

  it('does not expose an Agent composer for retry in the result workspace', async () => {
    const creatorService = createInMemoryCreatorService();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        projectId="project_1"
        creatorService={creatorService}
      />
    );
    await translateTestVideo();

    expect(screen.queryByRole('textbox', { name: '告诉 Agent 你的要求' })).not.toBeInTheDocument();
    expect(creatorService.runAgentTurn).not.toHaveBeenCalled();
  });

  it('keeps navigation available without a back button in the unified workspace', () => {
    const onWorkspaceModeChange = vi.fn();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        onWorkspaceModeChange={onWorkspaceModeChange}
      />
    );
    openBlankWorkspace('视频翻译', '空白视频翻译');
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '快速生成' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
  });

  it('filters apps by category without a search field', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '图像创作' }));
    const directory = screen.getByRole('region', { name: '创作应用' });
    expect(within(directory).getByRole('button', { name: /^封面生成/ })).toBeInTheDocument();
    expect(within(directory).getByRole('button', { name: /^图像生成/ })).toBeInTheDocument();
    expect(directory.querySelectorAll('.dashboard-app-card')).toHaveLength(2);
    expect(within(directory).queryByRole('button', { name: /^视频翻译/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: '搜索应用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '全部' })).not.toBeInTheDocument();
    expect(within(directory).getByRole('button', { name: /^封面生成/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '音频处理' }));
    expect(within(directory).getByRole('button', { name: /^文本转语音/ })).toBeInTheDocument();
    expect(within(directory).getByRole('button', { name: /^视频转录/ })).toBeInTheDocument();
    expect(directory.querySelectorAll('.dashboard-app-card')).toHaveLength(2);
  });

  it('opens video transcription from the audio tools directory', async () => {
    const creatorService = createInMemoryCreatorService();
    const createJob = vi.spyOn(creatorService, 'createJob');
    render(<DashboardPage onSelectPrompt={vi.fn()} creatorService={creatorService} />);

    fireEvent.click(screen.getByRole('tab', { name: '音频处理' }));
    openBlankWorkspace('视频转录', '空白视频转录');
    expect(screen.getByRole('form', { name: '视频转录' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=transcription-entry' }
    });
    fireEvent.click(screen.getByRole('button', { name: '转录设置' }));
    expect(screen.getByRole('dialog', { name: '转录设置' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '源语言' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '转录设置' }));
    expect(screen.getByRole('button', { name: '开始转录' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '开始转录' }));

    await waitFor(() => expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'transcription',
      templateVersion: 1
    })));
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

    expect(screen.getByRole('form', { name: '文本转语音' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '配音文案内容' }), {
      target: { value: '这是一段需要生成语音的测试文案。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '语音设置' }));
    expect(screen.getByRole('dialog', { name: '语音设置' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '配音音色 星语' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '配音音色 星语' }));
    fireEvent.click(screen.getByRole('button', { name: '试听 · 星语' }));
    expect(await screen.findByRole('button', { name: '暂停 · 星语' })).toBeInTheDocument();
    expect(tts.previewTtsVoice).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voiceId: 'nova',
      language: 'zh-CN'
    });
    expect(play).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '暂停 · 星语' }));
    expect(pause).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog', { name: '配音音色' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('radio', { name: '温暖' }));

    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    fireEvent.click((await screen.findAllByRole('link', { name: /^打开 / }))[0]!);
    expect(await screen.findByLabelText('文本转语音试听')).toHaveAttribute('src', 'blob:smart-dubbing');
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
    fireEvent.click(screen.getByRole('button', { name: '语音设置' }));
    expect(screen.getByRole('dialog', { name: '语音设置' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '配音音色 星语' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '配音音色 星语' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    expect(await screen.findAllByText('请先在设置的配音服务中配置当前服务商的 API Key'))
      .not.toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('请先在设置的配音服务中配置当前服务商的 API Key');
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
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
      presetOrigin: null,
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
      providerRequests: [],
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
          scopeKey: null,
          inputFingerprint: null,
          sha256: null,
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
            scopeKey: null,
            inputFingerprint: null,
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
      createJob: vi.fn(async (request: { state?: Record<string, CreatorJson> }) => {
        job = { ...job, state: { ...job.state, ...request.state } };
        return { job };
      }),
      getJob: vi.fn(async () => ({ job })),
      listJobs: vi.fn(async () => ({ jobs: [job] })),
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

    openBlankWorkspace('图像生成', '空白图像生成');
    expect(await screen.findByRole('form', { name: '图像生成' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'OpenCreator' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), {
      target: { value: prompt }
    });
    expect(screen.getByRole('combobox', { name: /^模型$/ })).toHaveValue('GPT Image');
    fireEvent.click(screen.getByRole('button', { name: '图片设置' }));
    fireEvent.click(screen.getByRole('radio', { name: '3:2' }));
    fireEvent.click(screen.getByRole('radio', { name: '高清' }));

    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    fireEvent.click((await screen.findAllByRole('link', { name: /^打开 / }))[0]!);
    expect(await screen.findByRole('img', { name: '生成图片 1' })).toHaveAttribute('src', 'blob:image-13');
    expect(screen.getByRole('img', { name: '生成图片 2' })).toBeInTheDocument();
    expect(applyAction).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'generate' }
      })
    );
    expect(openArtifact).toHaveBeenCalledWith(job.id, 'image_artifact_v1_1');
    expect(openArtifact).toHaveBeenCalledWith(job.id, 'image_artifact_v1_2');
    expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue(prompt);
    const regenerate = screen.getByRole('button', { name: '重新生成' });
    await waitFor(() => expect(regenerate).toBeEnabled());
    fireEvent.click(regenerate);
    await waitFor(() => {
      expect(applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage')).toHaveLength(2);
    }, { timeout: 3000 });
    expect(await screen.findByRole('button', { name: /项目 V2/ }, { timeout: 3000 })).toBeInTheDocument();
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
    const prompt = '一辆红色跑车沿着海岸公路行驶';
    const createdAt = '2026-09-07T00:00:00.000Z';
    let job: CreatorJob = {
      id: 'creator_video_job',
      projectId: 'project_1',
      templateId: 'video-generation',
      templateVersion: 1,
      status: 'draft',
      revision: 0,
      presetOrigin: null,
      state: {
        prompt: '',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStage: null
      },
      agentThreadId: null,
      stages: [],
      artifacts: [],
      providerRequests: [],
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
        const artifact: CreatorArtifact = {
          id: 'generated_video_v1',
          jobId: job.id,
          kind: 'generated_video',
          version,
          status: 'completed',
          path: '/tmp/generated-video-v1.mp4',
          scopeKey: null,
          inputFingerprint: null,
          sha256: null,
          sourceArtifactIds: job.artifacts
            .filter(candidate => candidate.kind === 'reference_image')
            .map(candidate => candidate.id),
          metadata: {
            provider: 'veo',
            model: 'veo-3.1-generate-preview',
            videoSize: '720x1280',
            requestedDuration: 8,
            duration: 8,
            fileName: 'OpenCreator-video.mp4',
            mimeType: 'video/mp4',
            bytes: 4096,
            resultVersion: version
          },
          createdAt
        };
        job = {
          ...job,
          status: 'completed',
          revision: job.revision + 2,
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
              description: '生成视频',
              artifactRefs: { generated_video: [artifact.id] },
              changedArtifactIds: [artifact.id],
              staleArtifactIds: [],
              state: {
                prompt,
                provider: 'veo',
                size: '720x1280',
                duration: 8,
                referenceImageArtifactId: 'reference_video_1'
              }
            }]
          },
          stages: [{
            id: 'stage_video_generate_1',
            jobId: job.id,
            stageId: 'generate',
            executor: 'video',
            status: 'succeeded',
            dispatchStatus: 'finished',
            claimOwner: null,
            claimExpiresAt: null,
            attempt: 1,
            idempotencyKey: null,
            scopeKey: null,
            inputFingerprint: null,
            progress: { status: 'succeeded', phase: 'completed', percent: 100 },
            errorCode: null,
            errorMessage: null,
            startedAt: createdAt,
            finishedAt: createdAt
          }],
          artifacts: [...job.artifacts, artifact]
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
        id: 'reference_video_1',
        jobId: job.id,
        kind: 'reference_image',
        version: 1,
        status: 'completed',
        path: '/tmp/coast-reference.png',
        scopeKey: null,
        inputFingerprint: null,
        sha256: null,
        sourceArtifactIds: [],
        metadata: {
          fileName: input.file.name,
          mimeType: input.file.type,
          size: input.file.size,
          lastModified: input.file.lastModified
        },
        createdAt
      };
      job = {
        ...job,
        revision: job.revision + 1,
        state: {
          ...job.state,
          referenceImageArtifactId: artifact.id,
          referenceImageFileName: input.file.name
        },
        artifacts: [...job.artifacts, artifact]
      };
      return { job, artifact, deduplicated: false };
    });
    const openArtifact = vi.fn(async () => new Response(
      new Blob(['video'], { type: 'video/mp4' })
    ));
    const creatorService = {
      createJob: vi.fn(async () => ({ job })),
      getJob: vi.fn(async () => ({ job })),
      listJobs: vi.fn(async () => ({ jobs: [job] })),
      applyAction,
      uploadReferenceImage,
      openArtifact,
      runAgentTurn: vi.fn()
    } as unknown as CreatorWebService;
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        workspace="video-generation"
        creatorService={creatorService}
      />
    );

    const promptInput = screen.getByRole('textbox', { name: '提示词' });
    const referenceImageInput = screen.getByLabelText('上传视频参考图');
    expect(referenceImageInput.compareDocumentPosition(promptInput) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    fireEvent.change(promptInput, {
      target: { value: prompt }
    });
    const referenceImage = new File(['reference'], 'coast-reference.png', {
      type: 'image/png'
    });
    changeControl(referenceImageInput, {
      target: { files: [referenceImage] }
    });
    expect(await screen.findByRole('img', { name: '视频参考图预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除参考图' }));
    expect(screen.queryByRole('img', { name: '视频参考图预览' })).not.toBeInTheDocument();
    changeControl(referenceImageInput, {
      target: { files: [referenceImage] }
    });
    const modelSelect = screen.getByRole('combobox', { name: /^模型$/ });
    expect(modelSelect).toHaveValue('Seedance 2.5');
    fireEvent.click(modelSelect);
    fireEvent.click(screen.getByRole('button', { name: /^Veo/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Veo 3.1' }));
    expect(modelSelect).toHaveValue('Veo 3.1');
    fireEvent.click(screen.getByRole('button', { name: '视频设置' }));
    expect(screen.getByRole('radio', { name: '4 秒' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '9:16' }));
    fireEvent.click(screen.getByRole('radio', { name: '8 秒' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    const generationActions = screen.getByRole('form', { name: '视频生成' });
    const generateButton = within(generationActions).getByRole('button', { name: '开始生成' });
    expect(generationActions).toContainElement(generateButton);
    fireEvent.click(generateButton);

    fireEvent.click((await screen.findAllByRole('link', { name: /^打开 / }))[0]!);
    expect(await screen.findByLabelText('生成视频预览')).toHaveAttribute('src', 'blob:generated-video');
    expect(uploadReferenceImage).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ file: referenceImage })
    );
    expect(applyAction).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'generate' }
      })
    );
    expect(openArtifact).toHaveBeenCalledWith(job.id, 'generated_video_v1');
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
