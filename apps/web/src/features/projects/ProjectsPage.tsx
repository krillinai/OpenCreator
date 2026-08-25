import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import {
  Captions,
  CirclePlay,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Music2,
  PackageOpen,
  Search,
  Video
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import type { OpenCreatorProject } from './project-model.js';
import './projects-page.css';

const projectCategories = ['全部', '视频创作', '图像设计'] as const;
type ProjectCategory = typeof projectCategories[number];
const outputCategories = ['全部', '视频', '图片', '音频', '字幕', '文档'] as const;
type OutputCategory = typeof outputCategories[number];
type ProjectsView = 'projects' | 'outputs';
type ProjectOutputKind = Exclude<OutputCategory, '全部'>;

const projectArtifactKinds = new Set([
  'source_video',
  'source_subtitle',
  'target_subtitle',
  'bilingual_subtitle',
  'dubbed_audio',
  'horizontal_video',
  'vertical_video',
  'auto_clip_video',
  'cover_image',
  'stickman_video',
  'script_manifest',
  'storyboard_image',
  'clip_candidates'
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

type ProjectOutput = {
  id: string;
  job: CreatorJob;
  projectName: string;
  name: string;
  kind: ProjectOutputKind;
  format: string;
  detail: string;
  cover: string;
  youtubeCovers: string[];
  updatedAt: string;
};

export default function ProjectsPage(props: {
  jobs: CreatorJob[];
  workspaces: OpenCreatorProject[];
  loading?: boolean;
  error?: string;
  service?: Pick<CreatorWebService, 'openProjectCover'> | null;
  onOpenJob(job: CreatorJob): void;
}) {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const [view, setView] = useState<ProjectsView>('projects');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('全部');
  const [outputCategory, setOutputCategory] = useState<OutputCategory>('全部');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const projects = useMemo(
    () => props.jobs
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
  const outputs = useMemo(
    () => projects.flatMap(project => createProjectOutputs(project, l)),
    [l, projects]
  );
  const visibleOutputs = useMemo(() => outputs
    .filter(output => outputCategory === '全部' || output.kind === outputCategory)
    .filter(output => normalizedQuery.length === 0 || `${output.name} ${output.projectName} ${output.format}`
      .toLocaleLowerCase()
      .includes(normalizedQuery))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  [normalizedQuery, outputCategory, outputs]);

  function selectView(nextView: ProjectsView) {
    setView(nextView);
    setQuery('');
  }

  return (
    <main className="projects-page">
      <div className="projects-page-inner">
        <header className="projects-page-header">
          <div>
            <h1>{l('我的项目', 'My Projects')}</h1>
            <p>{view === 'projects'
              ? l('继续最近的创作项目，保留完整设置、进度和历史', 'Continue recent creator projects with their settings, progress, and history')
              : l('集中查看所有创作项目产生的真实文件', 'Review real files generated across creator projects')}</p>
          </div>
          <label className="projects-search">
            <Search size={17} strokeWidth={1.8} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              aria-label={view === 'projects' ? l('搜索项目', 'Search projects') : l('搜索产出', 'Search outputs')}
              placeholder={view === 'projects' ? l('搜索项目', 'Search projects') : l('搜索产出', 'Search outputs')}
            />
          </label>
        </header>

        <div className="projects-dimension-tabs" role="tablist" aria-label={l('内容维度', 'Content view')}>
          <button type="button" role="tab" aria-selected={view === 'projects'} onClick={() => selectView('projects')}>
            <FolderKanban size={16} strokeWidth={1.8} aria-hidden="true" />
            {l('项目', 'Projects')}
          </button>
          <button type="button" role="tab" aria-selected={view === 'outputs'} onClick={() => selectView('outputs')}>
            <PackageOpen size={16} strokeWidth={1.8} aria-hidden="true" />
            {l('产出中心', 'Output Center')}
          </button>
        </div>

        <div className={`projects-category-tabs${view === 'outputs' ? ' is-output' : ''}`} role="tablist" aria-label={view === 'projects' ? l('项目分类', 'Project categories') : l('产出分类', 'Output categories')}>
          {(view === 'projects' ? projectCategories : outputCategories).map(item => (
            <button
              type="button"
              role="tab"
              key={item}
              aria-selected={view === 'projects' ? category === item : outputCategory === item}
              onClick={() => view === 'projects'
                ? setCategory(item as ProjectCategory)
                : setOutputCategory(item as OutputCategory)}
            >
              {view === 'projects'
                ? localizeProjectCategory(item as ProjectCategory, l)
                : localizeOutputCategory(item as OutputCategory, l)}
            </button>
          ))}
        </div>

        <section className="projects-library" aria-labelledby="projects-library-title">
          <div className="projects-library-heading">
            <h2 id="projects-library-title">
              {view === 'projects'
                ? category === '全部' ? l('最近项目', 'Recent projects') : localizeProjectCategory(category, l)
                : outputCategory === '全部' ? l('全部产出', 'All outputs') : localizeOutputCategory(outputCategory, l)}
            </h2>
            <span>{view === 'projects'
              ? `${visibleProjects.length} ${l('个项目', 'projects')}`
              : `${visibleOutputs.length} ${l('个产出', 'outputs')}`}</span>
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
          ) : view === 'projects' ? visibleProjects.length > 0 ? (
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
                      <span>{project.workspaceName} · {formatProjectTime(project.job.updatedAt, language)}</span>
                    </span>
                  </button>
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
                ? l('从工作台选择模板后会新建项目，并自动显示在这里。', 'Choose a template in Workbench to create a project. It will appear here automatically.')
                : normalizedQuery.length > 0
                  ? l('换个名称重新搜索。', 'Try searching with another name.')
                  : l('完成对应类型的创作后，项目会显示在这里。', 'Projects of this type will appear here after you create them.')}</p>
            </div>
          ) : visibleOutputs.length > 0 ? (
            <div className="project-output-grid" role="list" aria-label={l('产出列表', 'Output list')}>
              {visibleOutputs.map(output => (
                <article className="project-output-card" role="listitem" key={output.id}>
                  <button
                    type="button"
                    className="project-output-open"
                    aria-label={`${l('在项目中打开产出', 'Open output in project')} ${output.name}`}
                    onClick={() => props.onOpenJob(output.job)}
                  >
                    <span className="project-output-preview" data-kind={output.kind}>
                      {output.kind === '视频' || output.kind === '图片' ? (
                        <ProjectCoverImage
                          job={output.job}
                          youtubeCovers={output.youtubeCovers}
                          fallback={output.cover}
                          service={props.service}
                        />
                      ) : (
                        <span className="project-output-file-icon" aria-hidden="true">
                          {outputKindIcon(output.kind, 28)}
                        </span>
                      )}
                      {output.kind === '视频' ? (
                        <span className="project-output-play" aria-hidden="true"><CirclePlay size={28} strokeWidth={1.6} /></span>
                      ) : null}
                      <small>{output.format}</small>
                    </span>
                    <span className="project-output-copy">
                      <span className="project-output-kind">{outputKindIcon(output.kind, 13)}{localizeOutputCategory(output.kind, l)}</span>
                      <strong>{output.name}</strong>
                      <span>{output.projectName}</span>
                      <small>{output.detail} · {formatProjectTime(output.updatedAt, language)}</small>
                    </span>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="projects-empty" role="status">
              <PackageOpen size={28} strokeWidth={1.5} aria-hidden="true" />
              <strong>{normalizedQuery.length > 0
                ? l('没有找到匹配的产出', 'No matching outputs')
                : outputCategory === '全部'
                  ? l('还没有产出', 'No outputs yet')
                  : l('这个分类还没有产出', 'No outputs in this category')}</strong>
              <p>{normalizedQuery.length > 0
                ? l('换个名称重新搜索。', 'Try searching with another name.')
                : l('创作项目生成真实文件后，会集中显示在这里。', 'Files generated by creator projects will appear here.')}</p>
            </div>
          )}
        </section>
      </div>
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
    category: job.templateId === 'cover' ? '图像设计' : '视频创作',
    workspaceName: workspaces.find(workspace => workspace.id === job.projectId)?.name
      ?? l('未知工作目录', 'Unknown workspace'),
    cover: projectCover(job.templateId),
    youtubeCovers: youtubeThumbnailUrls(readString(job.state.sourceUrl))
  };
}

function creatorProjectTitle(job: CreatorJob, type: string): string {
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
  if (templateId === 'stickman-video') return l('火柴人视频', 'Stick figure video');
  return undefined;
}

function localizeProjectCategory(category: ProjectCategory, l: LocalizeCopy): string {
  if (category === '全部') return l(category, 'All');
  if (category === '图像设计') return l(category, 'Image Design');
  return l(category, 'Video Creation');
}

function localizeOutputCategory(category: OutputCategory, l: LocalizeCopy): string {
  if (category === '全部') return l(category, 'All');
  if (category === '视频') return l(category, 'Videos');
  if (category === '图片') return l(category, 'Images');
  if (category === '音频') return l(category, 'Audio');
  if (category === '字幕') return l(category, 'Subtitles');
  return l(category, 'Documents');
}

function localizeJobStatus(status: CreatorJob['status'], l: LocalizeCopy): string {
  if (status === 'completed') return l('已完成', 'Completed');
  if (status === 'running') return l('进行中', 'Running');
  if (status === 'failed') return l('失败', 'Failed');
  if (status === 'needs_input') return l('等待输入', 'Needs input');
  return l('草稿', 'Draft');
}

function outputKindIcon(kind: ProjectOutputKind, size: number) {
  if (kind === '视频') return <Video size={size} strokeWidth={1.8} aria-hidden="true" />;
  if (kind === '图片') return <ImageIcon size={size} strokeWidth={1.8} aria-hidden="true" />;
  if (kind === '音频') return <Music2 size={size} strokeWidth={1.8} aria-hidden="true" />;
  if (kind === '字幕') return <Captions size={size} strokeWidth={1.8} aria-hidden="true" />;
  return <FileText size={size} strokeWidth={1.8} aria-hidden="true" />;
}

function createProjectOutputs(project: CreatorProject, l: LocalizeCopy): ProjectOutput[] {
  return project.job.artifacts
    .filter(artifact => (
      artifact.path !== null
      && artifact.status !== 'stale'
      && projectArtifactKinds.has(artifact.kind)
    ))
    .map(artifact => ({
      id: artifact.id,
      job: project.job,
      projectName: project.title,
      name: artifactName(artifact, l),
      kind: artifactKind(artifact.kind),
      format: artifactFormat(artifact),
      detail: artifact.status === 'technical_preview'
        ? l(`技术预览 · V${artifact.version}`, `Technical preview · V${artifact.version}`)
        : `V${artifact.version}`,
      cover: project.cover,
      youtubeCovers: project.youtubeCovers,
      updatedAt: artifact.createdAt
    }));
}

function artifactName(artifact: CreatorArtifact, l: LocalizeCopy): string {
  const fileName = artifact.metadata.fileName;
  if (typeof fileName === 'string' && fileName.trim().length > 0) return fileName;
  const pathName = artifact.path?.split(/[\\/]/).at(-1);
  if (pathName !== undefined && pathName.length > 0) return pathName;
  const labels: Record<string, string> = {
    source_video: l('原始视频', 'Source video'),
    target_subtitle: l('目标语言字幕', 'Translated subtitles'),
    source_subtitle: l('原文字幕', 'Source subtitles'),
    bilingual_subtitle: l('双语字幕', 'Bilingual subtitles'),
    dubbed_audio: l('配音音轨', 'Dubbed audio'),
    horizontal_video: l('横屏成片', 'Landscape video'),
    vertical_video: l('竖屏成片', 'Portrait video'),
    auto_clip_video: l('剪辑成片', 'Edited video'),
    cover_image: l('封面图片', 'Thumbnail'),
    stickman_video: l('火柴人成片', 'Stick figure video')
  };
  return labels[artifact.kind] ?? artifact.kind;
}

function artifactKind(kind: string): ProjectOutputKind {
  if (/video/i.test(kind)) return '视频';
  if (/image|cover|storyboard/i.test(kind)) return '图片';
  if (/audio|narration|voice/i.test(kind)) return '音频';
  if (/subtitle|caption/i.test(kind)) return '字幕';
  return '文档';
}

function artifactFormat(artifact: CreatorArtifact): string {
  const fileName = typeof artifact.metadata.fileName === 'string'
    ? artifact.metadata.fileName
    : artifact.path?.split(/[\\/]/).at(-1);
  const extension = fileName?.split('.').at(-1);
  return extension === undefined || extension === fileName ? 'FILE' : extension.toUpperCase();
}

function projectCover(templateId: string): string {
  if (templateId === 'video-translation') return '/workbench/templates/video-translation-example.png';
  if (templateId === 'cover') return '/workbench/templates/video-localization.jpg';
  if (templateId === 'stickman-video') return '/workbench/templates/ai-video-insane.jpg';
  if (templateId === 'auto-clip') return '/workbench/templates/animated-story.jpg';
  return '/workbench/templates/digital-presenter.jpg';
}

function ProjectCoverImage(props: {
  job: CreatorJob;
  youtubeCovers: string[];
  fallback: string;
  service?: Pick<CreatorWebService, 'openProjectCover'> | null;
}) {
  const requestedRuntimeCover = useRef(false);
  const [youtubeIndex, setYoutubeIndex] = useState(0);
  const [runtimeCover, setRuntimeCover] = useState<string>();

  useEffect(() => {
    if (
      youtubeIndex < props.youtubeCovers.length
      || requestedRuntimeCover.current
      || props.service === null
      || props.service === undefined
    ) return;
    requestedRuntimeCover.current = true;
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
  }, [props.job.id, props.service, props.youtubeCovers.length, youtubeIndex]);

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
