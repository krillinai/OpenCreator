import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import {
  Captions,
  CirclePlay,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  ListChecks,
  Music2,
  PackageOpen,
  Search,
  Trash2,
  Video,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { ApiClientError } from '../../runtime/client.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import { CreateProjectDropdown } from './CreateProjectDropdown.js';
import type { OpenCreatorProject } from './project-model.js';
import type { CreatorProjectType } from './project-types.js';
import { IssueList } from '../issues/IssuePresenter.js';
import { usePageIssueState } from '../issues/page-issue-state.js';
import './projects-page.css';

const projectCategories = ['全部', '视频创作', '图像设计', '文案创作'] as const;
type ProjectCategory = typeof projectCategories[number];
const outputCategories = ['全部', '视频', '图片', '音频', '字幕', '文档'] as const;
type OutputCategory = typeof outputCategories[number];
type ProjectsView = 'projects' | 'outputs';
type ProjectOutputKind = Exclude<OutputCategory, '全部'>;

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

const projectArtifactKinds = new Set([
  'source_video',
  'source_subtitle',
  'target_subtitle',
  'bilingual_subtitle',
  'dubbed_audio',
  'horizontal_video',
  'vertical_video',
  'auto_clip_video',
  'clean_video',
  'bilingual_video',
  'cover_image',
  'generated_image',
  'publish_copy',
  'script_manifest',
  'shot_image',
  'clip_candidates'
]);
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
  service?: Pick<CreatorWebService, 'openProjectCover'>
    & Partial<Pick<CreatorWebService, 'openArtifact'>>
    | null;
  onCreateProject?(projectType: CreatorProjectType): boolean | void | Promise<boolean | void>;
  createProjectError?: string;
  onOpenJob(job: CreatorJob): void;
  onDeleteJob?(jobId: string, options: { deleteFiles: boolean }): Promise<void>;
}) {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const [view, setView] = useState<ProjectsView>('projects');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('全部');
  const [outputCategory, setOutputCategory] = useState<OutputCategory>('全部');
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<CreatorProject>();
  const [batchMode, setBatchMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [batchPendingDeletion, setBatchPendingDeletion] = useState(false);
  const [deleteProjectFiles, setDeleteProjectFiles] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string>();
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchDeletedCount, setBatchDeletedCount] = useState(0);
  const [downloadingOutputId, setDownloadingOutputId] = useState<string>();
  const pageIssues = usePageIssueState('projects');
  const lastDownloadOutputRef = useRef<ProjectOutput>();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  useEffect(() => {
    if (props.error === undefined) pageIssues.resolveOperation('projects.load');
    else pageIssues.captureOperationFailure(
      'projects.load',
      new Error(props.error),
      l('无法加载最近项目，请稍后重试。', 'Unable to load recent projects. Try again later.')
    );
  }, [l, pageIssues.captureOperationFailure, pageIssues.resolveOperation, props.error]);
  useEffect(() => {
    if (props.createProjectError === undefined) pageIssues.resolveOperation('projects.create');
    else pageIssues.captureOperationFailure(
      'projects.create',
      new Error(props.createProjectError),
      l('新建项目失败，请重试。', 'Could not create the project. Try again.')
    );
  }, [l, pageIssues.captureOperationFailure, pageIssues.resolveOperation, props.createProjectError]);
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
  const selectedProjectCount = selectedProjectIds.size;
  const allVisibleProjectsSelected = visibleProjects.length > 0
    && visibleProjects.every(project => selectedProjectIds.has(project.job.id));
  const deleting = deletingProjectId !== undefined || batchDeleting;

  function selectView(nextView: ProjectsView) {
    setView(nextView);
    setQuery('');
  }

  useEffect(() => {
    const availableProjectIds = new Set(projects.map(project => project.job.id));
    setSelectedProjectIds(current => {
      const next = new Set([...current].filter(projectId => availableProjectIds.has(projectId)));
      return next.size === current.size ? current : next;
    });
  }, [projects]);

  const toggleProjectSelection = (projectId: string) => {
    if (batchDeleting) return;
    setSelectedProjectIds(current => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const leaveBatchMode = () => {
    if (batchDeleting) return;
    setBatchMode(false);
    setBatchPendingDeletion(false);
    setSelectedProjectIds(new Set());
    setDeleteProjectFiles(false);
  };

  async function downloadOutput(output: ProjectOutput) {
    if (props.service?.openArtifact === undefined || downloadingOutputId !== undefined) return;
    setDownloadingOutputId(output.id);
    lastDownloadOutputRef.current = output;
    try {
      const response = await props.service.openArtifact(output.job.id, output.id);
      if (!response.ok) throw new Error('Artifact download failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = output.name;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      pageIssues.resolveOperation('projects.download-output');
    } catch (cause) {
      pageIssues.captureOperationFailure('projects.download-output', cause, l('文件下载失败，请重试。', 'Unable to download the file. Please try again.'), { retryable: true });
    } finally {
      setDownloadingOutputId(undefined);
    }
  }

  return (
    <main className="opencreator-scroll-page projects-page">
      <div className="opencreator-page-content projects-page-inner">
        <header className="projects-page-header">
          <div>
            <h1>{l('我的项目', 'My Projects')}</h1>
            <p>{view === 'projects'
              ? l('继续最近的创作项目，保留完整设置、进度和历史', 'Continue recent creator projects with their settings, progress, and history')
              : l('集中查看所有创作项目产生的真实文件', 'Review real files generated across creator projects')}</p>
          </div>
          <div className="projects-header-actions">
            {props.onCreateProject ? (
              <CreateProjectDropdown
                onCreate={props.onCreateProject}
              />
            ) : null}
          </div>
        </header>
        <IssueList
          issues={pageIssues.issues}
          actions={{ retryOperations: {
            'projects.download-output': () => {
              const output = lastDownloadOutputRef.current;
              return output === undefined ? undefined : downloadOutput(output);
            }
          } }}
          onDismiss={pageIssues.dismissIssue}
        />

        <div className="projects-primary-row">
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

        <section className="projects-library" aria-label={view === 'projects' ? l('项目列表', 'Project list') : l('产出列表', 'Output list')}>
          <div className="projects-library-heading">
            <div className="projects-library-summary">
              {(view === 'projects' ? category : outputCategory) === '全部' ? null : (
                <h2>{view === 'projects'
                  ? localizeProjectCategory(category, l)
                  : localizeOutputCategory(outputCategory, l)}</h2>
              )}
              <span>{view === 'projects'
                ? `${visibleProjects.length} ${l('个项目', 'projects')}`
                : `${visibleOutputs.length} ${l('个产出', 'outputs')}`}</span>
            </div>
            {view === 'projects' && props.onDeleteJob !== undefined && projects.length > 0 ? (
              batchMode ? (
                <div className="projects-batch-actions">
                  <span className="projects-selected-count">
                    {l(`已选择 ${selectedProjectCount} 个`, `${selectedProjectCount} selected`)}
                  </span>
                  <button
                    type="button"
                    className="projects-batch-button"
                    disabled={visibleProjects.length === 0 || batchDeleting}
                    onClick={() => {
                      setSelectedProjectIds(current => {
                        const next = new Set(current);
                        visibleProjects.forEach(project => {
                          if (allVisibleProjectsSelected) next.delete(project.job.id);
                          else next.add(project.job.id);
                        });
                        return next;
                      });
                    }}
                  >
                    <ListChecks size={15} strokeWidth={1.8} aria-hidden="true" />
                    {allVisibleProjectsSelected
                      ? l('取消选择当前结果', 'Deselect results')
                      : l('全选当前结果', 'Select all results')}
                  </button>
                  <button
                    type="button"
                    className="projects-batch-button"
                    disabled={batchDeleting}
                    onClick={leaveBatchMode}
                  >
                    <X size={15} strokeWidth={1.8} aria-hidden="true" />
                    {l('取消', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    className="projects-batch-button is-destructive"
                    disabled={selectedProjectCount === 0 || batchDeleting}
                  onClick={() => {
                    setBatchDeletedCount(0);
                    setDeleteProjectFiles(false);
                    setBatchPendingDeletion(true);
                    }}
                  >
                    <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
                    {l(`删除已选 (${selectedProjectCount})`, `Delete selected (${selectedProjectCount})`)}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="projects-batch-button"
                  onClick={() => {
                    setBatchMode(true);
                  }}
                >
                  <ListChecks size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('批量管理', 'Batch manage')}
                </button>
              )
            ) : null}
          </div>

          {props.error !== undefined ? (
            <div className="projects-empty" role="status">
              <FolderKanban size={28} strokeWidth={1.5} aria-hidden="true" />
              <strong>{l('当前没有可显示的项目', 'No projects to display')}</strong>
            </div>
          ) : props.loading && projects.length === 0 ? (
            <div className="projects-empty" role="status" aria-busy="true">
              <FolderKanban size={28} strokeWidth={1.5} aria-hidden="true" />
              <strong>{l('正在加载最近项目', 'Loading recent projects')}</strong>
            </div>
          ) : view === 'projects' ? visibleProjects.length > 0 ? (
            <div className="projects-card-grid" role="list" aria-label={l('项目列表', 'Project list')}>
              {visibleProjects.map(project => {
                const selected = selectedProjectIds.has(project.job.id);
                return (
                <article
                  className={`project-card${batchMode ? ' is-managing' : ''}${selected ? ' is-selected' : ''}`}
                  role="listitem"
                  key={project.job.id}
                >
                  <button
                    type="button"
                    className="project-card-open"
                    aria-label={`${batchMode
                      ? l('选择项目', 'Select project')
                      : l('打开项目', 'Open project')} ${project.title}`}
                    aria-pressed={batchMode ? selected : undefined}
                    disabled={batchDeleting}
                    onClick={() => {
                      if (batchMode) toggleProjectSelection(project.job.id);
                      else props.onOpenJob(project.job);
                    }}
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
                      <span>{formatProjectTime(
                        project.job.updatedAt,
                        language === 'zh-CN' ? 'zh-CN' : 'en-US'
                      )}</span>
                    </span>
                  </button>
                  {batchMode ? (
                    <input
                      type="checkbox"
                      className="project-card-checkbox"
                      aria-label={`${l('选择项目', 'Select project')} ${project.title}`}
                      checked={selected}
                      disabled={batchDeleting}
                      onChange={() => toggleProjectSelection(project.job.id)}
                    />
                  ) : props.onDeleteJob !== undefined ? (
                    <button
                      type="button"
                      className="project-card-menu"
                      aria-label={`${l('删除项目', 'Delete project')} ${project.title}`}
                      title={l('删除项目', 'Delete project')}
                      disabled={deletingProjectId === project.job.id}
                      onClick={() => {
                        setDeleteProjectFiles(false);
                        setProjectPendingDeletion(project);
                      }}
                    >
                      <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  ) : null}
                </article>
                );
              })}
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
          ) : visibleOutputs.length > 0 ? (
            <div className="project-output-grid" role="list" aria-label={l('产出列表', 'Output list')}>
              {visibleOutputs.map(output => (
                <article className="project-output-card" role="listitem" key={output.id}>
                  <button
                    type="button"
                    className="project-output-open"
                    aria-label={`${l('下载产出', 'Download output')} ${output.name}`}
                    aria-busy={downloadingOutputId === output.id}
                    disabled={downloadingOutputId !== undefined}
                    onClick={() => void downloadOutput(output)}
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
                        <span className="project-output-play" aria-hidden="true">
                          <CirclePlay size={28} strokeWidth={1.6} />
                        </span>
                      ) : null}
                      <small>{output.format}</small>
                    </span>
                    <span className="project-output-copy">
                      <span className="project-output-kind">
                        {outputKindIcon(output.kind, 13)}
                        {localizeOutputCategory(output.kind, l)}
                      </span>
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
      <ConfirmDialog
        open={projectPendingDeletion !== undefined || batchPendingDeletion}
        title={batchPendingDeletion
          ? l('批量删除项目', 'Delete projects')
          : l('删除项目', 'Delete project')}
        description={(
          <span className="project-delete-description">
            <span>
              {batchPendingDeletion
                ? l(
                    `确认永久删除已选择的 ${selectedProjectCount} 个项目？项目记录及创作历史将无法恢复。`,
                    `Permanently delete the ${selectedProjectCount} selected projects? Their project records and creation history cannot be restored.`
                  )
                : projectPendingDeletion === undefined
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
                disabled={deleting}
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
            {batchPendingDeletion && batchDeletedCount > 0 ? (
              <span role="status">{l(`已删除 ${batchDeletedCount} 个项目`, `Deleted ${batchDeletedCount} projects`)}</span>
            ) : null}
          </span>
        )}
        confirmLabel={batchPendingDeletion
          ? l(`删除 ${selectedProjectCount} 个项目`, `Delete ${selectedProjectCount} projects`)
          : l('删除', 'Delete')}
        destructive
        busy={deleting}
        onCancel={() => {
          setBatchDeletedCount(0);
          setDeleteProjectFiles(false);
          setProjectPendingDeletion(undefined);
          setBatchPendingDeletion(false);
        }}
        onConfirm={() => {
          if (batchPendingDeletion) {
            if (batchDeleting || selectedProjectCount === 0 || props.onDeleteJob === undefined) return;
            const deleteJob = props.onDeleteJob;
            const selectedProjects = projects.filter(project => selectedProjectIds.has(project.job.id));
            setBatchDeleting(true);
            setBatchDeletedCount(0);
            void (async () => {
              const failedProjectIds = new Set<string>();
              for (const project of selectedProjects) {
                try {
                  await deleteJob(project.job.id, { deleteFiles: deleteProjectFiles });
                } catch (error) {
                  failedProjectIds.add(project.job.id);
                  pageIssues.captureOperationFailure('projects.delete', error,
                    error instanceof ApiClientError && error.code === 'creator_job_has_active_run'
                      ? l('项目仍在运行，请先停止任务后再删除。', 'This project is still running. Stop it before deleting.')
                      : l('项目删除失败，请重试。', 'Unable to delete the project. Please try again.'));
                }
              }

              setBatchDeletedCount(selectedProjects.length - failedProjectIds.size);
              setSelectedProjectIds(failedProjectIds);
              if (failedProjectIds.size === 0) {
                pageIssues.resolveOperation('projects.delete');
                setBatchPendingDeletion(false);
                setBatchMode(false);
                setDeleteProjectFiles(false);
                return;
              }
            })().finally(() => setBatchDeleting(false));
            return;
          }
          if (
            projectPendingDeletion === undefined
            || deletingProjectId !== undefined
            || props.onDeleteJob === undefined
          ) return;
          const projectId = projectPendingDeletion.job.id;
          setDeletingProjectId(projectId);
          void props.onDeleteJob(projectId, { deleteFiles: deleteProjectFiles })
            .then(() => {
              pageIssues.resolveOperation('projects.delete');
              setDeleteProjectFiles(false);
              setProjectPendingDeletion(undefined);
            })
            .catch(error => {
              pageIssues.captureOperationFailure('projects.delete', error,
                error instanceof ApiClientError && error.code === 'creator_job_has_active_run'
                  ? l('项目仍在运行，请先停止任务后再删除。', 'This project is still running. Stop it before deleting.')
                  : l('项目删除失败，请重试。', 'Unable to delete the project. Please try again.'));
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
      : job.templateId === 'xiaohongshu-post' || job.templateId === 'short-video-script'
        ? '文案创作'
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
  if (templateId === 'xiaohongshu-post') {
    return {
      topic: [''],
      audience: [''],
      style: ['experience'],
      length: ['medium'],
      extraRequirements: [''],
      currentStage: [null]
    };
  }
  if (templateId === 'short-video-script') {
    return {
      topic: [''],
      audience: [''],
      platform: ['douyin'],
      targetDurationSeconds: [60],
      tone: ['natural'],
      extraRequirements: [''],
      currentStage: [null]
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
  if (templateId === 'xiaohongshu-post') return l('小红书帖子', 'Xiaohongshu post');
  if (templateId === 'short-video-script') return l('短视频脚本', 'Short video script');
  return undefined;
}

function localizeProjectCategory(category: ProjectCategory, l: LocalizeCopy): string {
  if (category === '全部') return l(category, 'All');
  if (category === '图像设计') return l(category, 'Image Design');
  if (category === '文案创作') return l(category, 'Copywriting');
  return l(category, 'Video Creation');
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
    generated_image: l('生成图片', 'Generated image'),
    clean_video: l('火柴人纯净视频', 'Stickman clean video'),
    bilingual_video: l('火柴人双语视频', 'Stickman bilingual video'),
    publish_copy: l('发布文案', 'Publish copy'),
    shot_image: l('火柴人镜头画面', 'Stickman shot visual')
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

function localizeOutputCategory(category: OutputCategory, l: LocalizeCopy): string {
  if (category === '全部') return l(category, 'All');
  if (category === '视频') return l(category, 'Videos');
  if (category === '图片') return l(category, 'Images');
  if (category === '音频') return l(category, 'Audio');
  if (category === '字幕') return l(category, 'Subtitles');
  return l(category, 'Documents');
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
  if (templateId === 'short-video-script') return '/skill-market/examples/gpt-image-2-info-poster.png';
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

function formatProjectTime(value: string, language: 'zh-CN' | 'en-US' | 'sv-SE'): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return language === 'zh-CN' ? '最近更新' : language === 'sv-SE' ? 'Nyligen uppdaterad' : 'Recently updated';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return language === 'zh-CN' ? '刚刚更新' : language === 'sv-SE' ? 'Uppdaterades nyss' : 'Updated just now';
  if (minutes < 60) return language === 'zh-CN' ? `${minutes} 分钟前` : language === 'sv-SE' ? `för ${minutes} min sedan` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return language === 'zh-CN' ? `${hours} 小时前` : language === 'sv-SE' ? `för ${hours} tim sedan` : `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return language === 'zh-CN' ? `${days} 天前` : language === 'sv-SE' ? `för ${days} dagar sedan` : `${days} days ago`;
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(timestamp);
}
