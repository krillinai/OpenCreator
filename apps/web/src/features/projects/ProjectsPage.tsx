import type { CreatorJob } from '@opencreator/protocol';
import {
  FolderKanban,
  Search,
  Trash2
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { ApiClientError } from '../../runtime/client.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import type { OpenCreatorProject } from './project-model.js';
import './projects-page.css';

const projectCategories = ['全部', '视频创作', '图像设计'] as const;
type ProjectCategory = typeof projectCategories[number];
const projectCoverArtifactKinds = new Set([
  'cover_image',
  'generated_image',
  'source_video',
  'horizontal_video',
  'vertical_video',
  'dubbed_video',
  'auto_clip_video',
  'stickman_video',
  'clip_video',
  'generated_video'
]);

type CreatorProject = {
  job: CreatorJob;
  title: string;
  type: string;
  category: Exclude<ProjectCategory, '全部'>;
  workspaceName: string;
  cover: string;
  youtubeCovers: string[];
};

export default function ProjectsPage(props: {
  jobs: CreatorJob[];
  workspaces: OpenCreatorProject[];
  loading?: boolean;
  error?: string;
  service?: Pick<CreatorWebService, 'openProjectCover'> | null;
  onOpenJob(job: CreatorJob): void;
  onDeleteJob?(jobId: string, options: { deleteFiles: boolean }): Promise<void>;
}) {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('全部');
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<CreatorProject>();
  const [deleteProjectFiles, setDeleteProjectFiles] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const projects = useMemo(
    () => props.jobs
      .filter(isMeaningfulCreatorJob)
      .map(job => createCreatorProject(job, props.workspaces, l))
      .filter((project): project is CreatorProject => project !== undefined),
    [l, props.jobs, props.workspaces]
  );
  const visibleProjects = useMemo(() => projects
    .filter(project => category === '全部' || project.category === category)
    .filter(project => normalizedQuery.length === 0 || [
      project.title,
      project.type,
      project.workspaceName,
      readString(project.job.state.sourceUrl)
    ].join(' ').toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => right.job.updatedAt.localeCompare(left.job.updatedAt)),
  [category, normalizedQuery, projects]);

  return (
    <main className="projects-page">
      <div className="projects-page-inner">
        <header className="projects-page-header">
          <div>
            <h1>{l('我的项目', 'My Projects')}</h1>
            <p>{l('继续最近的创作项目，保留完整设置、进度和历史', 'Continue recent creator projects with their settings, progress, and history')}</p>
          </div>
          <label className="projects-search">
            <Search size={17} strokeWidth={1.8} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              aria-label={l('搜索项目', 'Search projects')}
              placeholder={l('搜索项目', 'Search projects')}
            />
          </label>
        </header>

        <div className="projects-category-tabs" role="tablist" aria-label={l('项目分类', 'Project categories')}>
          {projectCategories.map(item => (
            <button
              type="button"
              role="tab"
              key={item}
              aria-selected={category === item}
              onClick={() => setCategory(item)}
            >
              {localizeProjectCategory(item, l)}
            </button>
          ))}
        </div>

        <section className="projects-library" aria-label={l('项目列表', 'Project list')}>
          <div className={`projects-library-heading${category === '全部' ? ' is-count-only' : ''}`}>
            {category === '全部' ? null : (
              <h2>{localizeProjectCategory(category, l)}</h2>
            )}
            <span>{`${visibleProjects.length} ${l('个项目', 'projects')}`}</span>
          </div>

          {props.error !== undefined ? (
            <div className="projects-empty" role="alert">
              <FolderKanban size={28} strokeWidth={1.5} aria-hidden="true" />
              <strong>{l('无法加载最近项目', 'Unable to load recent projects')}</strong>
              <p>{props.error}</p>
            </div>
          ) : props.loading && projects.length === 0 ? (
            <div className="projects-empty" role="status" aria-busy="true">
              <FolderKanban size={28} strokeWidth={1.5} aria-hidden="true" />
              <strong>{l('正在加载最近项目', 'Loading recent projects')}</strong>
            </div>
          ) : visibleProjects.length > 0 ? (
            <div className="projects-card-grid" role="list" aria-label={l('项目列表', 'Project list')}>
              {visibleProjects.map(project => (
                <article className="project-card" role="listitem" key={project.job.id}>
                  <button
                    type="button"
                    className="project-card-open"
                    aria-label={`${l('打开项目', 'Open project')} ${project.title}`}
                    onClick={() => props.onOpenJob(project.job)}
                  >
                    <span className="project-card-cover">
                      <ProjectCoverImage
                        job={project.job}
                        youtubeCovers={project.youtubeCovers}
                        fallback={project.cover}
                        service={props.service}
                      />
                      <small>{localizeJobStatus(project.job.status, l)}</small>
                    </span>
                    <span className="project-card-copy">
                      <small>{project.type}</small>
                      <strong>{project.title}</strong>
                      <span>{formatProjectTime(project.job.updatedAt, language)}</span>
                    </span>
                  </button>
                  {props.onDeleteJob !== undefined ? (
                    <button
                      type="button"
                      className="project-card-menu"
                      aria-label={`${l('删除项目', 'Delete project')} ${project.title}`}
                      title={l('删除项目', 'Delete project')}
                      disabled={deletingProjectId === project.job.id}
                      onClick={() => {
                        setDeleteError(undefined);
                        setDeleteProjectFiles(false);
                        setProjectPendingDeletion(project);
                      }}
                    >
                      <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="projects-empty" role="status">
              <FolderKanban size={28} strokeWidth={1.5} aria-hidden="true" />
              <strong>{projects.length === 0
                ? l('还没有创作项目', 'No creator projects yet')
                : normalizedQuery.length > 0
                  ? l('没有找到匹配的项目', 'No matching projects')
                  : l('这个分类还没有项目', 'No projects in this category')}</strong>
              <p>{projects.length === 0
                ? l('开始编辑或执行创作后，项目会显示在这里。', 'Projects appear here after you start editing or run a creator action.')
                : normalizedQuery.length > 0
                  ? l('换个名称重新搜索。', 'Try searching with another name.')
                  : l('完成对应类型的创作后，项目会显示在这里。', 'Projects of this type will appear here after you create them.')}</p>
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={projectPendingDeletion !== undefined}
        title={l('删除项目', 'Delete project')}
        description={(
          <span className="project-delete-description">
            <span>
              {projectPendingDeletion === undefined
                ? l('项目记录及创作历史将无法恢复。', 'The project record and creation history cannot be restored.')
                : l(
                    `确认永久删除“${projectPendingDeletion.title}”？项目记录及创作历史将无法恢复。`,
                    `Permanently delete "${projectPendingDeletion.title}"? Its project record and creation history cannot be restored.`
                  )}
            </span>
            <label className="project-delete-files-option">
              <input
                type="checkbox"
                aria-label={l('同时删除项目文件', 'Also delete project files')}
                checked={deleteProjectFiles}
                disabled={deletingProjectId !== undefined}
                onChange={event => setDeleteProjectFiles(event.target.checked)}
              />
              <span>
                <strong>{l('同时删除项目文件', 'Also delete project files')}</strong>
                <small>{l(
                  '包括上传素材、生成结果和缓存文件。',
                  'Includes uploads, generated results, and cached files.'
                )}</small>
              </span>
            </label>
            {deleteError === undefined ? null : (
              <span className="project-delete-error" role="alert">{deleteError}</span>
            )}
          </span>
        )}
        confirmLabel={l('删除', 'Delete')}
        destructive
        busy={deletingProjectId !== undefined}
        onCancel={() => {
          setDeleteError(undefined);
          setDeleteProjectFiles(false);
          setProjectPendingDeletion(undefined);
        }}
        onConfirm={() => {
          if (
            projectPendingDeletion === undefined
            || deletingProjectId !== undefined
            || props.onDeleteJob === undefined
          ) return;
          const projectId = projectPendingDeletion.job.id;
          setDeletingProjectId(projectId);
          setDeleteError(undefined);
          void props.onDeleteJob(projectId, { deleteFiles: deleteProjectFiles })
            .then(() => {
              setDeleteProjectFiles(false);
              setProjectPendingDeletion(undefined);
            })
            .catch(error => {
              setDeleteError(
                error instanceof ApiClientError && error.code === 'creator_job_has_active_run'
                  ? l('项目仍在运行，请先停止任务后再删除。', 'This project is still running. Stop it before deleting.')
                  : l('删除项目失败，请重试。', 'Unable to delete the project. Please try again.')
              );
            })
            .finally(() => setDeletingProjectId(undefined));
        }}
      />
    </main>
  );
}

function createCreatorProject(
  job: CreatorJob,
  workspaces: OpenCreatorProject[],
  l: LocalizeCopy
): CreatorProject | undefined {
  const type = templateLabel(job.templateId, l);
  if (type === undefined) return undefined;
  return {
    job,
    type,
    title: creatorProjectTitle(job, type),
    category: job.templateId === 'cover' || job.templateId === 'image-generation'
      ? '图像设计'
      : '视频创作',
    workspaceName: workspaces.find(workspace => workspace.id === job.projectId)?.name
      ?? l('未知工作目录', 'Unknown workspace'),
    cover: projectCover(job.templateId),
    youtubeCovers: youtubeThumbnailUrls(readString(job.state.sourceUrl))
  };
}

export function isMeaningfulCreatorJob(job: CreatorJob): boolean {
  if (job.status !== 'draft') return true;
  if (job.agentThreadId !== null) return true;
  if (job.stages.length > 0 || job.artifacts.length > 0) return true;
  if (job.activities.some(activity => (
    activity.action !== 'create-job'
    && !activity.action.startsWith('update-settings')
  ))) {
    return true;
  }
  return hasMeaningfulDraftState(job.templateId, job.state);
}

function hasMeaningfulDraftState(templateId: string, state: CreatorJob['state']): boolean {
  const ignoredFields = templateId === 'video-translation' && state.dubbing !== true
    ? new Set(['ttsProvider', 'ttsModel', 'voiceCode', 'voiceName'])
    : undefined;
  if (templateId === 'video-translation') {
    const sourceLanguage = typeof state.sourceLanguage === 'string' ? state.sourceLanguage : 'en';
    const targetLanguage = typeof state.targetLanguage === 'string' ? state.targetLanguage : 'zh_cn';
    const usesDefaultLanguagePair = (
      (sourceLanguage === 'en' && targetLanguage === 'zh_cn')
      || (sourceLanguage === 'zh_cn' && targetLanguage === 'en')
    );
    if (!usesDefaultLanguagePair) return true;
  }
  const defaults = creatorDraftDefaults(templateId);
  return Object.entries(state).some(([field, value]) => {
    if (ignoredFields?.has(field)) return false;
    const alternatives = defaults[field];
    if (alternatives !== undefined) {
      return !alternatives.some(candidate => sameJson(candidate, value));
    }
    return hasJsonContent(value);
  });
}

function creatorDraftDefaults(templateId: string): Record<string, unknown[]> {
  if (templateId === 'cover') {
    return {
      prompt: [
        '',
        '面向创作者的 AI 视频工作流，主体清晰，高对比标题，专业但有冲击力',
        'An AI video workflow for creators, with a clear subject, high-contrast title, and a professional, bold look'
      ],
      sourceType: ['prompt'],
      ratio: ['16:9'],
      sourceUrl: [''],
      candidateCount: [2, 4],
      quality: ['medium'],
      referenceImageArtifactId: [null],
      currentStep: [0],
      furthestStep: [0],
      workspacePhase: ['configure'],
      resultVersion: [null],
      resultTab: ['options'],
      draftBaseVersion: [null],
      currentStage: [null]
    };
  }
  if (templateId === 'video-download') {
    return {
      sourceUrl: [''],
      downloadFormat: ['mp4'],
      selectedQuality: ['1080p']
    };
  }
  if (templateId === 'image-generation') {
    return {
      prompt: [''],
      provider: ['openai'],
      size: ['1024x1024'],
      quality: ['medium'],
      candidateCount: [2],
      referenceImageArtifactId: [null],
      currentStep: [0],
      furthestStep: [0],
      resultVersion: [null],
      currentStage: [null]
    };
  }
  if (templateId === 'video-generation') {
    return {
      prompt: [''],
      provider: ['seedance'],
      size: ['1280x720'],
      duration: [5],
      referenceImageArtifactId: [null],
      currentStep: [0],
      furthestStep: [0],
      resultVersion: [null],
      currentStage: [null]
    };
  }
  if (templateId === 'auto-clip') {
    return {
      sourceUrl: [''],
      focus: ['balanced'],
      duration: ['30-60'],
      clipCount: [10],
      sourceOrientation: ['landscape'],
      selectedCandidateIds: [['1', '2', '3']]
    };
  }
  if (templateId === 'stickman-video') {
    return {
      topic: [
        '一个火柴人在城市天台追逐被风吹起的创意手稿，最后成功抓住。',
        'A stick figure chases a creative manuscript blown across a city rooftop and catches it at the last moment.'
      ],
      characterPrompt: [
        '黑色线条、白色圆形头部、红色围巾，动作灵活',
        'Black lines, a round white head, a red scarf, and agile movement'
      ],
      ratio: ['16:9'],
      style: ['手绘线稿'],
      targetDurationSeconds: [30]
    };
  }
  if (templateId === 'video-translation') {
    return {
      sourceType: ['url'],
      sourceUrl: [''],
      sourceLanguage: ['en', 'zh_cn'],
      targetLanguage: ['zh_cn', 'en'],
      bilingual: [true],
      subtitlePosition: ['top'],
      preferPlatformCaptions: [true],
      subtitleFont: ['system'],
      subtitleSize: ['medium'],
      subtitleColor: ['#FFFFFF'],
      dubbing: [false],
      composeVideo: [false],
      videoFormat: ['horizontal'],
      subtitleCues: [[]],
      currentStage: [null],
      sourceOrientation: ['landscape'],
      verticalTitle: [''],
      verticalSubtitle: [''],
      currentStep: [0],
      furthestStep: [0],
      workspacePhase: ['configure'],
      resultVersion: [null],
      latestResultVersion: [null],
      resultTab: ['video'],
      resultVersions: [[]],
      draftBaseVersion: [null]
    };
  }
  return {};
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasJsonContent(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function creatorProjectTitle(job: CreatorJob, type: string): string {
  if (job.presetOrigin?.title.trim()) return shorten(job.presetOrigin.title, 54);
  const probeTitle = job.artifacts
    .find(artifact => artifact.kind === 'download_probe' && artifact.status !== 'stale')
    ?.metadata.title;
  if (typeof probeTitle === 'string' && probeTitle.trim().length > 0) return probeTitle.trim();
  for (const key of ['projectName', 'title', 'topic', 'sourceFileName', 'prompt']) {
    const value = readString(job.state[key]);
    if (value.length > 0) return shorten(value, 54);
  }
  const sourceUrl = readString(job.state.sourceUrl);
  if (sourceUrl.length > 0) return sourceLabel(sourceUrl);
  const timestamp = Date.parse(job.createdAt);
  const created = Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(timestamp)
    : job.id.slice(-8);
  return `${type} · ${created}`;
}

function sourceLabel(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    const videoId = url.searchParams.get('v') ?? url.pathname.split('/').filter(Boolean).at(-1);
    return shorten(videoId === undefined ? host : `${host} · ${videoId}`, 54);
  } catch {
    return shorten(value.split(/[\\/]/).at(-1) ?? value, 54);
  }
}

function shorten(value: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function templateLabel(templateId: string, l: LocalizeCopy): string | undefined {
  if (templateId === 'video-translation') return l('视频翻译', 'Video translation');
  if (templateId === 'video-download') return l('视频下载', 'Video download');
  if (templateId === 'auto-clip') return l('自动剪辑', 'Auto clips');
  if (templateId === 'cover') return l('封面生成', 'Thumbnail generation');
  if (templateId === 'image-generation') return l('图像生成', 'Image generation');
  if (templateId === 'video-generation') return l('视频生成', 'Video generation');
  if (templateId === 'stickman-video') return l('火柴人视频', 'Stick figure video');
  return undefined;
}

function localizeProjectCategory(category: ProjectCategory, l: LocalizeCopy): string {
  if (category === '全部') return l(category, 'All');
  if (category === '图像设计') return l(category, 'Image Design');
  return l(category, 'Video Creation');
}

function localizeJobStatus(status: CreatorJob['status'], l: LocalizeCopy): string {
  if (status === 'completed') return l('已完成', 'Completed');
  if (status === 'running') return l('进行中', 'Running');
  if (status === 'failed') return l('失败', 'Failed');
  if (status === 'needs_input') return l('等待输入', 'Needs input');
  return l('草稿', 'Draft');
}

function projectCover(templateId: string): string {
  if (templateId === 'video-translation') {
    return '/dashboard/templates/video-translation-project-cover.png';
  }
  if (templateId === 'video-download') {
    return '/dashboard/templates/video-download-project-cover.png';
  }
  if (templateId === 'cover') return '/dashboard/templates/image-generation-project-cover.png';
  if (templateId === 'image-generation') return '/dashboard/templates/image-generation-project-cover.png';
  if (templateId === 'video-generation') return '/dashboard/templates/animated-story.jpg';
  if (templateId === 'stickman-video') return '/dashboard/templates/ai-video-insane.jpg';
  if (templateId === 'auto-clip') return '/dashboard/templates/animated-story.jpg';
  return '/dashboard/templates/digital-presenter.jpg';
}

function ProjectCoverImage(props: {
  job: CreatorJob;
  youtubeCovers: string[];
  fallback: string;
  service?: Pick<CreatorWebService, 'openProjectCover'> | null;
}) {
  const [youtubeIndex, setYoutubeIndex] = useState(0);
  const [runtimeCover, setRuntimeCover] = useState<string>();
  const runtimeCoverCandidateKey = props.job.artifacts
    .filter(artifact => (
      projectCoverArtifactKinds.has(artifact.kind)
      && artifact.path !== null
      && artifact.status !== 'stale'
    ))
    .map(artifact => `${artifact.id}:${artifact.version}:${artifact.createdAt}`)
    .join('|');

  useEffect(() => {
    if (
      youtubeIndex < props.youtubeCovers.length
      || runtimeCoverCandidateKey.length === 0
      || props.service === null
      || props.service === undefined
    ) return;
    let active = true;
    let objectUrl: string | undefined;
    void props.service.openProjectCover(props.job.id)
      .then(response => response.blob())
      .then(blob => {
        if (!active || blob.size === 0) return;
        objectUrl = URL.createObjectURL(blob);
        setRuntimeCover(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [
    props.job.id,
    props.service,
    props.youtubeCovers.length,
    runtimeCoverCandidateKey,
    youtubeIndex
  ]);

  const youtubeCover = props.youtubeCovers[youtubeIndex];
  const source = youtubeCover ?? runtimeCover ?? props.fallback;
  return (
    <img
      src={source}
      alt=""
      onError={() => {
        if (youtubeCover !== undefined) {
          setYoutubeIndex(index => index + 1);
          return;
        }
        if (runtimeCover !== undefined) setRuntimeCover(undefined);
      }}
    />
  );
}

export function youtubeThumbnailUrls(value: string): string[] {
  if (value.length === 0) return [];
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');
    let videoId: string | undefined;
    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0];
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      videoId = url.searchParams.get('v') ?? undefined;
      if (videoId === undefined) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (['shorts', 'embed', 'live'].includes(parts[0] ?? '')) videoId = parts[1];
      }
    }
    if (videoId === undefined || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return [];
    const encoded = encodeURIComponent(videoId);
    return [
      `https://i.ytimg.com/vi/${encoded}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${encoded}/hqdefault.jpg`
    ];
  } catch {
    return [];
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatProjectTime(value: string, language: 'zh-CN' | 'en-US'): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return language === 'en-US' ? 'Recently updated' : '最近更新';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return language === 'en-US' ? 'Updated just now' : '刚刚更新';
  if (minutes < 60) return language === 'en-US' ? `${minutes} min ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return language === 'en-US' ? `${hours} hr ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return language === 'en-US' ? `${days} days ago` : `${days} 天前`;
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(timestamp);
}
