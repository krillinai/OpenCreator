import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CreatorJob, CreatorJson } from '@opencreator/protocol';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import {
  ArrowUpRight,
  Clapperboard,
  Download,
  Image,
  ImagePlus,
  Languages,
  Mic2,
  Search,
  ServerOff,
  Sparkles,
  UserRound,
  WandSparkles,
  type LucideIcon
} from 'lucide-react';
import './dashboard.css';
import AutoClipWorkspace from './AutoClipWorkspace.js';
import CoverGeneratorWorkspace from './CoverGeneratorWorkspace.js';
import DigitalAvatarWorkspace from './DigitalAvatarWorkspace.js';
import ImageGenerationWorkspace from './ImageGenerationWorkspace.js';
import SmartDubbingWorkspace from './SmartDubbingWorkspace.js';
import StickmanVideoWorkspace from './StickmanVideoWorkspace.js';
import VideoDownloadWorkspace from './VideoDownloadWorkspace.js';
import VideoTranslationWorkspace from './VideoTranslationWorkspace.js';
import VideoGenerationWorkspace from './VideoGenerationWorkspace.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import type {
  CreatorRuntimeWorkspace,
  CreatorSkillLaunch,
  CreatorWorkspace
} from './creator-workspace.js';
import {
  creatorTemplateForWorkspace,
  isVisibleCreatorWorkspace
} from './creator-workspace.js';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { VideoGenerationService } from '../../services/video-generation-service.js';

type DashboardCategory = '视频创作' | '图像创作' | '音频处理' | '视频编辑' | '数字人';

type DashboardEntry = {
  title: string;
  description: string;
  prompt: string;
  category: DashboardCategory;
  icon: LucideIcon;
  badge?: 'NEW' | 'HOT';
  workspace?: CreatorWorkspace;
};

type FeaturedEntry = Pick<DashboardEntry, 'title' | 'prompt'> & {
  image: string;
  accent: 'warm' | 'cyan' | 'neutral';
  workspace?: CreatorWorkspace;
};

const featuredTools: FeaturedEntry[] = [
  {
    title: '视频翻译配音',
    image: '/dashboard/templates/video-translation-example.png',
    prompt: '帮我把这段视频翻译成目标语言，保留原片语气，并生成匹配的字幕和配音。',
    accent: 'cyan',
    workspace: 'video-translation'
  },
  {
    title: '封面生成',
    image: '/dashboard/templates/peter-openclaw-cover.png',
    prompt: '根据我的内容主题生成一张封面，请先规划标题层级、主体画面、构图和视觉风格。',
    accent: 'warm',
    workspace: 'cover-generator'
  },
  {
    title: '图像生成',
    image: '/dashboard/templates/image-generation-cover.png',
    prompt: '根据我的创意生成一组图片，请先确认画面主体、风格、构图和使用场景。',
    accent: 'neutral',
    workspace: 'image-generation'
  }
];

const creatorTools: DashboardEntry[] = [
  {
    title: '视频翻译',
    description: '字幕、配音与口型同步',
    prompt: '帮我把这段视频翻译成目标语言，保留原片语气，并生成匹配的字幕和配音。',
    category: '视频编辑',
    icon: Languages,
    badge: 'HOT',
    workspace: 'video-translation'
  },
  {
    title: '火柴人动画',
    description: '角色、分镜与完整动画',
    prompt: '根据我的创意生成一支动画短片，请先帮我完善故事、角色和分镜。',
    category: '视频创作',
    icon: Sparkles,
    workspace: 'stickman-video'
  },
  {
    title: '视频下载',
    description: '支持YouTube，Bilibili等',
    prompt: '帮我下载这个视频链接，支持 YouTube、Bilibili 等平台，并保存为可用的视频文件。',
    category: '视频编辑',
    icon: Download,
    workspace: 'video-download'
  },
  {
    title: '自动剪辑',
    description: '语义识别与高光切片',
    prompt: '帮我剪辑这些视频素材，请梳理叙事节奏，给出剪辑方案并生成成片。',
    category: '视频编辑',
    icon: Clapperboard,
    workspace: 'auto-clips'
  },
  {
    title: '封面生成',
    description: '生成视频与内容封面',
    prompt: '根据我的内容主题生成一张封面，请先规划标题层级、主体画面、构图和视觉风格。',
    category: '图像创作',
    icon: ImagePlus,
    workspace: 'cover-generator'
  },
  {
    title: '智能配音',
    description: '自然音色与情绪表达',
    prompt: '帮我为这段内容制作配音，请根据使用场景优化文本、语速、停顿和情绪。',
    category: '音频处理',
    icon: Mic2,
    workspace: 'smart-dubbing'
  },
  {
    title: '视频生成',
    description: '从创意生成完整视频',
    prompt: '根据我的创意和素材生成一支完整的 AI 视频，请先帮我梳理画面风格、镜头和节奏。',
    category: '视频创作',
    icon: WandSparkles,
    workspace: 'video-generation'
  },
  {
    title: '数字人口播',
    description: '快速制作专业口播',
    prompt: '帮我制作一支数字人口播视频，请先优化文案，再规划人物、声音和画面。',
    category: '数字人',
    icon: UserRound,
    workspace: 'digital-avatar'
  },
  {
    title: '图像生成',
    description: '生成创意图片与视觉素材',
    prompt: '根据我的创意生成一组图片，请先确认画面主体、风格、构图和使用场景。',
    category: '图像创作',
    icon: Image,
    workspace: 'image-generation'
  },
];

const categories = ['全部', '视频编辑', '图像创作', '音频处理'] as const;
type CategoryFilter = typeof categories[number];

const CREATOR_JOB_LOAD_TIMEOUT_MS = 15_000;
const CREATOR_JOB_CREATE_ATTEMPT_TIMEOUT_MS = 4_000;
const CREATOR_JOB_CREATE_ATTEMPTS = 3;
const CREATOR_JOB_CREATE_RECOVERY_TIMEOUT_MS = 30_000;
const CREATOR_JOB_CREATION_STORAGE_PREFIX = 'opencreator.creator.pending-job:';

export default function DashboardPage(props: {
  onSelectPrompt(prompt: string): void;
  onBackToHome?(): void;
  onWorkspaceModeChange?(active: boolean): void;
  skillLaunch?: CreatorSkillLaunch;
  creatorServicesService?: CreatorServicesSettingsService | null;
  videoGenerationService?: VideoGenerationService;
  videoMetadataService?: VideoMetadataService;
  workspace?: CreatorWorkspace;
  jobId?: string;
  projectId?: string;
  creatorService?: CreatorWebService | null;
  runtimeDependencies?: RuntimeDependenciesController;
  onJobCreated?(job: CreatorJob): void;
  onOpenRuntimeComponents?(): void;
  onWorkspaceNavigate?(
    workspace: CreatorWorkspace | null,
    jobId?: string,
    options?: { replace?: boolean }
  ): void;
}) {
  const { language, t } = useAppLanguage();
  const [activeWorkspace, setActiveWorkspace] = useState<CreatorWorkspace | null>(
    () => props.skillLaunch?.workspace ?? props.workspace ?? null
  );
  const [activePromptHint, setActivePromptHint] = useState(
    () => props.skillLaunch?.promptHint
  );
  const [activeJobId, setActiveJobId] = useState(props.jobId);
  const [workspaceOrigin, setWorkspaceOrigin] = useState<'home' | 'dashboard'>(
    () => props.skillLaunch === undefined ? 'dashboard' : 'home'
  );
  const [category, setCategory] = useState<CategoryFilter>('全部');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const localize = (value: string) => language === 'en-US'
    ? englishDashboardLabels[value] ?? value
    : value;
  const visibleTools = useMemo(() => creatorTools.filter(tool => {
    if (tool.workspace === undefined || !isVisibleCreatorWorkspace(tool.workspace)) return false;
    const matchesCategory = category === '全部' || tool.category === category;
    const matchesQuery = normalizedQuery.length === 0
      || `${localize(tool.title)} ${localize(tool.description)} ${localize(tool.category)}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  }), [category, language, normalizedQuery]);

  useEffect(() => {
    props.onWorkspaceModeChange?.(activeWorkspace !== null);
    return () => props.onWorkspaceModeChange?.(false);
  }, [activeWorkspace, props.onWorkspaceModeChange]);

  useEffect(() => {
    if (props.skillLaunch?.workspace !== undefined) {
      setWorkspaceOrigin('home');
      setActiveWorkspace(props.skillLaunch.workspace);
      setActivePromptHint(props.skillLaunch.promptHint);
      return;
    }
    setWorkspaceOrigin('dashboard');
    setActiveWorkspace(props.workspace ?? null);
  }, [props.skillLaunch?.promptHint, props.skillLaunch?.workspace, props.workspace]);

  useEffect(() => {
    setActiveJobId(props.jobId);
  }, [props.jobId]);

  const closeWorkspace = () => {
    setActiveWorkspace(null);
    setActivePromptHint(undefined);
    setActiveJobId(undefined);
    if (workspaceOrigin === 'home') {
      props.onBackToHome?.();
    } else {
      props.onWorkspaceNavigate?.(null);
    }
  };

  const openWorkspace = (workspace: CreatorWorkspace) => {
    setWorkspaceOrigin('dashboard');
    setActivePromptHint(undefined);
    setActiveJobId(undefined);
    setActiveWorkspace(workspace);
    props.onWorkspaceNavigate?.(workspace);
  };

  const handleJobCreated = (workspace: CreatorRuntimeWorkspace, job: CreatorJob) => {
    setActiveJobId(job.id);
    props.onJobCreated?.(job);
    props.onWorkspaceNavigate?.(workspace, job.id, { replace: true });
  };

  const renderCreatorWorkspace = (workspace: CreatorRuntimeWorkspace, content: ReactNode) => {
    if (!props.projectId || !props.creatorService) {
      return (
        <CreatorRuntimeBlocker
          reason={props.creatorService ? 'project' : 'runtime'}
          onBack={closeWorkspace}
        />
      );
    }
    return (
      <CreatorWorkspaceSession
        projectId={props.projectId}
        service={props.creatorService}
        templateId={creatorTemplateForWorkspace(workspace)}
        jobId={activeJobId}
        onJobCreated={job => handleJobCreated(workspace, job)}
        onBack={closeWorkspace}
      >
        {content}
      </CreatorWorkspaceSession>
    );
  };

  if (activeWorkspace === 'video-translation') {
    return renderCreatorWorkspace('video-translation', (
      <VideoTranslationWorkspace
        promptHint={activePromptHint}
        videoMetadataService={props.videoMetadataService}
        creatorServicesService={props.creatorServicesService}
        onBack={closeWorkspace}
      />
    ));
  }

  if (activeWorkspace === 'video-download') {
    return renderCreatorWorkspace('video-download', (
      <VideoDownloadWorkspace
        promptHint={activePromptHint}
        runtimeDependencies={props.runtimeDependencies}
        onOpenRuntimeComponents={props.onOpenRuntimeComponents}
        onBack={closeWorkspace}
      />
    ));
  }

  if (activeWorkspace === 'smart-dubbing') {
    return renderCreatorWorkspace('smart-dubbing', (
      <SmartDubbingWorkspace
        promptHint={activePromptHint}
        creatorServicesService={props.creatorServicesService}
        onBack={closeWorkspace}
      />
    ));
  }

  if (activeWorkspace === 'image-generation') {
    return renderCreatorWorkspace('image-generation', (
      <ImageGenerationWorkspace
        promptHint={activePromptHint}
        onBack={closeWorkspace}
      />
    ));
  }

  if (activeWorkspace === 'video-generation') {
    return (
      <VideoGenerationWorkspace
        promptHint={activePromptHint}
        service={props.videoGenerationService}
        onBack={closeWorkspace}
      />
    );
  }

  if (activeWorkspace === 'digital-avatar') {
    return (
      <DigitalAvatarWorkspace
        promptHint={activePromptHint}
        onBack={closeWorkspace}
      />
    );
  }

  if (activeWorkspace === 'stickman-video') {
    return renderCreatorWorkspace('stickman-video', (
      <StickmanVideoWorkspace
        promptHint={activePromptHint}
        onBack={closeWorkspace}
      />
    ));
  }

  if (activeWorkspace === 'auto-clips') {
    return renderCreatorWorkspace('auto-clips', (
      <AutoClipWorkspace
        promptHint={activePromptHint}
        videoMetadataService={props.videoMetadataService}
        onBack={closeWorkspace}
      />
    ));
  }

  if (activeWorkspace === 'cover-generator') {
    return renderCreatorWorkspace('cover-generator', (
      <CoverGeneratorWorkspace
        promptHint={activePromptHint}
        onBack={closeWorkspace}
      />
    ));
  }

  return (
    <main className="creator-tools-page">
      <div className="creator-tools-page-inner">
        <header className="creator-tools-page-header">
          <h1>{t('dashboard.title')}</h1>
        </header>

        <section className="dashboard-featured" aria-labelledby="dashboard-featured-title">
          <h2 id="dashboard-featured-title">{t('dashboard.featured')}</h2>
          <div className="dashboard-featured-grid">
            {featuredTools.map(tool => (
              <button
                className="dashboard-featured-card"
                data-accent={tool.accent}
                type="button"
                key={tool.title}
                onClick={() => tool.workspace
                  ? openWorkspace(tool.workspace)
                  : props.onSelectPrompt(tool.prompt)}
                aria-label={t('dashboard.openTool', { title: localize(tool.title) })}
              >
                <img src={tool.image} alt="" />
                <span className="dashboard-featured-scrim" aria-hidden="true" />
                <span className="dashboard-featured-copy">
                  <strong>{localize(tool.title)}</strong>
                  <span>{t('dashboard.start')} <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden="true" /></span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-directory" aria-label={t('dashboard.apps')}>
          <div className="dashboard-directory-controls">
            <div className="dashboard-category-tabs" role="tablist" aria-label={t('dashboard.categories')}>
              {categories.map(item => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={category === item}
                  key={item}
                  onClick={() => setCategory(item)}
                >
                  {localize(item)}
                </button>
              ))}
            </div>
            <label className="dashboard-search">
              <Search size={16} strokeWidth={1.8} aria-hidden="true" />
              <input
                type="search"
                aria-label={t('dashboard.search')}
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('dashboard.search')}
              />
            </label>
          </div>

          {visibleTools.length > 0 ? (
            <div className="dashboard-app-grid">
              {visibleTools.map(({ title, description, prompt, icon: Icon, badge, workspace }) => (
                <button
                  className="dashboard-app-card"
                  type="button"
                  key={title}
                  onClick={() => workspace ? openWorkspace(workspace) : props.onSelectPrompt(prompt)}
                >
                  <span className="dashboard-app-icon">
                    <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <span className="dashboard-app-copy">
                    <span className="dashboard-app-title">
                      <strong>{localize(title)}</strong>
                      {badge ? <small>{badge}</small> : null}
                    </span>
                    <span>{localize(description)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty" role="status">
              <Search size={20} strokeWidth={1.6} aria-hidden="true" />
              <p>{t('dashboard.empty')}</p>
              <button type="button" onClick={() => { setQuery(''); setCategory('全部'); }}>
                {t('dashboard.showAll')}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function CreatorRuntimeBlocker(props: {
  reason: 'runtime' | 'project';
  onBack(): void;
}) {
  const l = useLocalizedCopy();
  const runtimeMissing = props.reason === 'runtime';
  return (
    <main className="creator-workspace-page creator-runtime-blocker-page">
      <section className="creator-runtime-blocker" role="alert">
        <span aria-hidden="true"><ServerOff size={24} strokeWidth={1.7} /></span>
        <div>
          <h1>{runtimeMissing
            ? l('本地创作服务未连接', 'Local creator service is disconnected')
            : l('请先选择一个项目', 'Select a project first')}</h1>
          <p>{runtimeMissing
            ? l('视频翻译等创作工具必须连接真实 Runtime，当前不会生成替代结果。', 'Creator tools require the real Runtime. Substitute results will not be generated.')
            : l('创作任务和产出需要保存到项目中，选择项目后再进入工具。', 'Creator jobs and outputs must belong to a project.')}</p>
        </div>
        <button type="button" onClick={props.onBack}>{l('返回工作台', 'Back to Dashboard')}</button>
      </section>
    </main>
  );
}

function CreatorWorkspaceSession(props: {
  projectId: string;
  service: CreatorWebService;
  templateId: string;
  jobId?: string;
  children: ReactNode;
  onJobCreated(job: CreatorJob): void;
  onBack(): void;
}) {
  const l = useLocalizedCopy();
  const [job, setJob] = useState<CreatorJob | undefined>(() => props.jobId === undefined
    ? createPendingCreatorJob(props.projectId, props.templateId)
    : undefined);
  const [error, setError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const jobRef = useRef(job);
  const mountedRef = useRef(false);
  const onJobCreatedRef = useRef(props.onJobCreated);
  const creationRequestsRef = useRef(new Map<string, Promise<CreatorJob>>());
  const announcedCreatedJobIdsRef = useRef(new Set<string>());
  const creationIdentityRef = useRef<{ scope: string; key: string }>();
  const createdJobIdRef = useRef<string>();
  const previousRouteJobIdRef = useRef(props.jobId);
  jobRef.current = job;
  onJobCreatedRef.current = props.onJobCreated;

  const creationScope = `${props.projectId}:${props.templateId}`;
  const startedAnotherNewSession = props.jobId === undefined
    && previousRouteJobIdRef.current !== undefined;
  if (
    props.jobId === undefined
    && (creationIdentityRef.current?.scope !== creationScope || startedAnotherNewSession)
  ) {
    creationIdentityRef.current = {
      scope: creationScope,
      key: readOrCreateCreatorJobCreationKey(props.projectId, props.templateId)
    };
    createdJobIdRef.current = undefined;
  }
  previousRouteJobIdRef.current = props.jobId;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const ensureJob = useCallback(async (state: Record<string, CreatorJson>): Promise<CreatorJob> => {
    const currentJob = jobRef.current;
    if (currentJob !== undefined && !isPendingCreatorJob(currentJob)) return currentJob;

    const creationKey = creationIdentityRef.current?.key
      ?? readOrCreateCreatorJobCreationKey(props.projectId, props.templateId);
    const requestKey = `create:${creationKey}`;
    let request = creationRequestsRef.current.get(requestKey);
    if (request === undefined) {
      request = createCreatorJobWithRecovery(props.service, {
        projectId: props.projectId,
        templateId: props.templateId,
        creationKey,
        state
      });
      creationRequestsRef.current.set(requestKey, request);
      void request.catch(() => {
        if (creationRequestsRef.current.get(requestKey) === request) {
          creationRequestsRef.current.delete(requestKey);
        }
      });
    }

    const next = await request;
    if (next.projectId !== props.projectId) {
      throw new Error('Creator job does not belong to the active project');
    }
    if (next.templateId !== props.templateId) {
      throw new Error('Creator job does not match the active template');
    }
    if (!mountedRef.current) return next;
    createdJobIdRef.current = next.id;
    jobRef.current = next;
    setJob(next);
    if (!announcedCreatedJobIdsRef.current.has(next.id)) {
      announcedCreatedJobIdsRef.current.add(next.id);
      clearCreatorJobCreationKey(props.projectId, props.templateId, creationKey);
      onJobCreatedRef.current(next);
    }
    return next;
  }, [props.projectId, props.service, props.templateId]);

  useEffect(() => {
    let canceled = false;
    if (props.jobId === undefined) {
      setError(undefined);
      setJob(current => (
        current !== undefined
        && isPendingCreatorJob(current)
        && current.projectId === props.projectId
        && current.templateId === props.templateId
          ? current
          : createPendingCreatorJob(props.projectId, props.templateId)
      ));
      return () => { canceled = true; };
    }

    if (props.jobId !== createdJobIdRef.current) createdJobIdRef.current = undefined;
    const request = props.service.getJob(props.jobId).then(response => response.job);
    setError(undefined);
    setJob(current => current?.id === props.jobId ? current : undefined);
    const timeout = window.setTimeout(() => {
      if (canceled) return;
      setError(l('恢复创作项目超时，请重试', 'Restoring the creator project timed out. Try again.'));
    }, CREATOR_JOB_LOAD_TIMEOUT_MS);
    void request.then(next => {
      if (next.projectId !== props.projectId) {
        throw new Error('该创作项目不属于当前工作目录');
      }
      if (next.templateId !== props.templateId) {
        throw new Error('该创作项目与当前模板不匹配');
      }
      if (canceled) return;
      window.clearTimeout(timeout);
      setError(undefined);
      setJob(next);
    }).catch(reason => {
      if (canceled) return;
      window.clearTimeout(timeout);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      canceled = true;
      window.clearTimeout(timeout);
    };
  }, [l, loadAttempt, props.jobId, props.projectId, props.service, props.templateId]);

  if (error) {
    return (
      <main className="creator-workspace-loading" role="alert">
        <p>{error}</p>
        <div className="creator-workspace-loading-actions">
          <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)}>
            {l('重试', 'Retry')}
          </button>
          <button type="button" onClick={props.onBack}>{l('返回工作台', 'Back to Dashboard')}</button>
        </div>
      </main>
    );
  }
  if (!job) {
    return (
      <main className="creator-workspace-loading" aria-busy="true">
        {l('正在恢复创作项目', 'Restoring creator project')}
      </main>
    );
  }
  const creationKey = creationIdentityRef.current?.key;
  const providerKey = isPendingCreatorJob(job) || createdJobIdRef.current === job.id
    ? `create:${creationKey ?? creationScope}`
    : `job:${job.id}`;
  return (
    <CreatorSessionProvider
      key={providerKey}
      initialJob={job}
      service={props.service}
      ensureJob={ensureJob}
    >
      {props.children}
    </CreatorSessionProvider>
  );
}

function createPendingCreatorJob(projectId: string, templateId: string): CreatorJob {
  const now = new Date().toISOString();
  return {
    id: `pending:${projectId}:${templateId}`,
    projectId,
    templateId,
    templateVersion: 1,
    status: 'draft',
    revision: 0,
    state: {},
    agentThreadId: null,
    stages: [],
    artifacts: [],
    activities: [],
    createdAt: now,
    updatedAt: now
  };
}

function isPendingCreatorJob(job: CreatorJob): boolean {
  return job.id.startsWith('pending:');
}

export async function createCreatorJobWithRecovery(
  service: CreatorWebService,
  request: Parameters<CreatorWebService['createJob']>[0]
): Promise<CreatorJob> {
  let lastError: unknown;
  const inFlightRequests: Promise<CreatorJob>[] = [];
  for (let attempt = 0; attempt < CREATOR_JOB_CREATE_ATTEMPTS; attempt += 1) {
    const requestWork = service.createJob(request).then(
      response => response.job,
      error => {
        lastError = error;
        throw error;
      }
    );
    inFlightRequests.push(requestWork);
    try {
      return await withTimeout(
        firstSuccessfulCreatorJob(inFlightRequests, () => lastError),
        CREATOR_JOB_CREATE_ATTEMPT_TIMEOUT_MS
      );
    } catch (error) {
      lastError = error;
      if (attempt + 1 < CREATOR_JOB_CREATE_ATTEMPTS) {
        await waitForRetry(250 * (attempt + 1));
      }
    }
  }
  try {
    return await withTimeout(
      firstSuccessfulCreatorJob(inFlightRequests, () => lastError),
      CREATOR_JOB_CREATE_RECOVERY_TIMEOUT_MS
    );
  } catch (error) {
    throw lastError ?? error;
  }
}

function firstSuccessfulCreatorJob(
  requests: Promise<CreatorJob>[],
  readLastError: () => unknown
): Promise<CreatorJob> {
  return Promise.any(requests).catch(error => {
    throw readLastError() ?? error;
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error('Creator job creation request timed out')),
      timeoutMs
    );
    promise.then(
      value => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, delayMs));
}

function readOrCreateCreatorJobCreationKey(projectId: string, templateId: string): string {
  const storageKey = creatorJobCreationStorageKey(projectId, templateId);
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
  } catch {
    // Continue with an in-memory key when session storage is unavailable.
  }
  const key = `creator_create_${createCreationKeySuffix()}`;
  try {
    window.sessionStorage.setItem(storageKey, key);
  } catch {
    // The caller still keeps the generated key in component memory.
  }
  return key;
}

function clearCreatorJobCreationKey(
  projectId: string,
  templateId: string,
  expectedKey?: string
): void {
  const storageKey = creatorJobCreationStorageKey(projectId, templateId);
  try {
    if (
      expectedKey === undefined
      || window.sessionStorage.getItem(storageKey) === expectedKey
    ) {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Session storage is only a recovery aid.
  }
}

function creatorJobCreationStorageKey(projectId: string, templateId: string): string {
  return `${CREATOR_JOB_CREATION_STORAGE_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(templateId)}`;
}

function createCreationKeySuffix(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

const englishDashboardLabels: Record<string, string> = {
  全部: 'All',
  视频创作: 'Video Creation',
  图像创作: 'Image Creation',
  音频处理: 'Audio',
  视频编辑: 'Video Editing',
  数字人: 'Avatars',
  火柴人动画: 'Stick Figure Animation',
  视频翻译配音: 'Translate & Dub Video',
  数字人口播: 'Digital Avatar',
  视频翻译: 'Video Translation',
  '字幕、配音与口型同步': 'Subtitles, dubbing, and lip sync',
  视频生成: 'Video Generation',
  从创意生成完整视频: 'Generate complete videos from an idea',
  快速制作专业口播: 'Create professional presenter videos quickly',
  '角色、分镜与完整动画': 'Characters, storyboards, and animation',
  自动剪辑: 'Auto Clips',
  语义识别与高光切片: 'Semantic detection and highlight clips',
  智能配音: 'AI Dubbing',
  自然音色与情绪表达: 'Natural voices with expressive delivery',
  图像生成: 'Image Generation',
  生成创意图片与视觉素材: 'Generate images and visual assets',
  封面生成: 'Thumbnail Generator',
  生成视频与内容封面: 'Create thumbnails for videos and content',
  视频下载: 'Video Downloader',
  '支持YouTube，Bilibili等': 'Supports YouTube, Bilibili, and more',
};
