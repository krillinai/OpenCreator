import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import { ArrowLeft, ArrowUpRight, CircleAlert, Download, FileText, Image as ImageIcon, LoaderCircle, Music2, PackageOpen, Trash2, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { ProjectCoverImage, projectCover, youtubeThumbnailUrls } from '../projects/ProjectsPage.js';
import { generationHistoryTypeForWorkspace, type GenerationHistoryType } from './generation-history-type.js';
import { creatorWorkspaceForTemplate } from './creator-workspace.js';
import './DashboardGenerationHistory.css';

export type { GenerationHistoryType } from './generation-history-type.js';

const outputKinds = new Set([
  'source_video', 'source_audio', 'source_subtitle', 'target_subtitle', 'bilingual_subtitle',
  'dubbed_audio', 'horizontal_video', 'vertical_video', 'auto_clip_video', 'clean_video',
  'bilingual_video', 'cover_image', 'generated_image', 'generated_video', 'short_video_script',
  'xiaohongshu_post', 'publish_copy', 'script_manifest', 'shot_image', 'clip_candidates'
]);
const pageSize = 12;

const historyTypes: Array<{ value: GenerationHistoryType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'image' },
  { value: 'video', label: 'video' },
  { value: 'text', label: 'text' },
  { value: 'audio', label: 'audio' }
];

type HistoryOutput = {
  artifact: CreatorArtifact;
  job: CreatorJob;
  name: string;
  title: string;
  type: string;
  kind: 'video' | 'image' | 'audio' | 'subtitle' | 'document';
};

export default function DashboardGenerationHistory(props: {
  projectId: string;
  service: Pick<CreatorWebService, 'listJobs' | 'openArtifact'>
    & Partial<Pick<CreatorWebService, 'deleteJob' | 'openProjectCover'>>;
  onBackCreation(): void;
  onOpenJob(job: CreatorJob): void;
  initialType?: GenerationHistoryType;
  initialVisibleCount?: number;
  onViewChange?(view: { type: GenerationHistoryType; visibleCount: number }): void;
}) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const [jobs, setJobs] = useState<CreatorJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [type, setType] = useState<GenerationHistoryType>(props.initialType ?? 'all');
  const [visibleCount, setVisibleCount] = useState(props.initialVisibleCount ?? pageSize);
  const [downloadingId, setDownloadingId] = useState<string>();
  const [jobPendingDeletion, setJobPendingDeletion] = useState<CreatorJob>();
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await props.service.listJobs(props.projectId);
      setJobs(response.jobs);
      setError('');
    } catch {
      setError(l('生成记录加载失败，请稍后重试。', 'Could not load generation history. Try again later.'));
    } finally {
      setLoading(false);
    }
  }, [l, props.projectId, props.service]);

  useEffect(() => {
    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    props.onViewChange?.({ type, visibleCount });
  }, [type, visibleCount, props.onViewChange]);

  const outputs = useMemo(() => jobs
    .flatMap(job => job.artifacts
      .filter(artifact => artifact.path !== null && artifact.status !== 'stale' && outputKinds.has(artifact.kind))
      .map(artifact => ({ artifact, job, name: artifactName(artifact, l), title: resultTitle(job, l), type: workflowLabel(job.templateId, l), kind: artifactKind(artifact.kind) })))
    .filter(output => type === 'all' || (type === 'text'
      ? output.kind === 'subtitle' || output.kind === 'document'
      : output.kind === type))
    .sort((left, right) => right.artifact.createdAt.localeCompare(left.artifact.createdAt)),
  [jobs, l, type]);
  const groups = useMemo(() => {
    const result: Array<{ date: string; items: HistoryOutput[] }> = [];
    for (const output of outputs) {
      const date = output.artifact.createdAt.slice(0, 10);
      const group = result.at(-1);
      if (group?.date === date) group.items.push(output);
      else result.push({ date, items: [output] });
    }
    return result;
  }, [outputs]);
  const processJobs = jobs.filter(job => (
    (type === 'all' || generationHistoryTypeForWorkspace(creatorWorkspaceForTemplate(job.templateId)) === type)
    && processStageForJob(job) !== undefined
  ));
  const processGroups = useMemo(() => {
    const result: Array<{ date: string; jobs: CreatorJob[] }> = [];
    for (const job of processJobs) {
      const stage = processStageForJob(job)!;
      const date = (stage.startedAt ?? job.createdAt).slice(0, 10);
      const group = result.at(-1);
      if (group?.date === date) group.jobs.push(job);
      else result.push({ date, jobs: [job] });
    }
    return result;
  }, [processJobs]);
  const visibleGroups = groups.map(group => {
    const start = outputs.indexOf(group.items[0]!);
    return { ...group, items: group.items.slice(0, Math.max(0, visibleCount - start)) };
  }).filter(group => group.items.length > 0);

  async function download(output: HistoryOutput) {
    if (downloadingId !== undefined) return;
    setDownloadingId(output.artifact.id);
    try {
      const response = await props.service.openArtifact(output.job.id, output.artifact.id);
      if (!response.ok) throw new Error('download_failed');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = output.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError(l('文件下载失败，请重试。', 'Could not download the file. Try again.'));
    } finally {
      setDownloadingId(undefined);
    }
  }

  async function downloadJob(job: CreatorJob) {
    const artifact = downloadableArtifact(job);
    if (!artifact) return;
    await download({ artifact, job, name: artifactName(artifact, l), title: resultTitle(job, l), type: workflowLabel(job.templateId, l), kind: artifactKind(artifact.kind) });
  }

  function requestDeletion(job: CreatorJob) {
    setDeleteFiles(false);
    setJobPendingDeletion(job);
  }

  async function confirmDeletion() {
    if (!jobPendingDeletion || !props.service.deleteJob || deleting) return;
    setDeleting(true);
    try {
      await props.service.deleteJob(jobPendingDeletion.id, { deleteFiles });
      setJobs(current => current.filter(job => job.id !== jobPendingDeletion.id));
      setJobPendingDeletion(undefined);
      setDeleteFiles(false);
    } catch {
      setError(l('项目删除失败，请稍后重试。运行中的项目需要先停止任务。', 'Could not delete the project. Stop any running task and try again.'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="opencreator-scroll-page dashboard-generation-history-page">
      <div className="opencreator-page-content dashboard-generation-history-content">
        <header className="dashboard-generation-history-header">
          <div className="dashboard-generation-view-tabs" role="tablist" aria-label={l('创作视图', 'Creation view')}>
            <button type="button" role="tab" aria-selected="false" onClick={props.onBackCreation}><ArrowLeft size={15} />{l('创作', 'Create')}</button>
            <button type="button" role="tab" aria-selected="true"><PackageOpen size={15} />{l('生成记录', 'Generation history')}</button>
          </div>
        </header>
        <div className="dashboard-generation-history-types" role="group" aria-label={l('生成类型', 'Generation type')}>
          {historyTypes.map(item => <button
            type="button"
            key={item.value}
            aria-pressed={type === item.value}
            onClick={() => { setType(item.value); setVisibleCount(pageSize); }}
          >{item.label}</button>)}
        </div>

        {processGroups.length > 0 ? <section className="dashboard-generation-running" aria-label={l('生成项目', 'Generation projects')}>
          {processGroups.map(group => <section className="dashboard-generation-history-date" key={group.date}>
            <h2>{formatDate(group.date, language)}</h2>
            <div className="dashboard-generation-history-grid">
              {group.jobs.map(job => {
                const stage = processStageForJob(job)!;
                const failed = stage.status === 'failed';
                const pending = !failed && (job.status === 'draft' || job.status === 'needs_input');
                const openable = failed || pending;
                const percent = typeof stage.progress.percent === 'number' ? Math.round(stage.progress.percent) : 0;
                const message = pending
                  ? job.templateId === 'video-download'
                    ? l('请选择下载格式并继续创作', 'Choose a download format to continue')
                    : l('继续配置这个创作项目', 'Continue configuring this project')
                  : failed
                    ? stage.errorMessage ?? (typeof stage.progress.message === 'string' ? stage.progress.message : stage.stageId)
                    : typeof stage.progress.message === 'string' ? stage.progress.message : stage.stageId;
                const title = resultTitle(job, l);
                const statusLabel = failed ? l('生成失败', 'Generation failed') : pending ? l('待配置', 'Pending setup') : l('正在生成', 'Generating');
                const downloadable = downloadableArtifact(job);
                return <article
                  className={`dashboard-generation-result-card dashboard-generation-running-card${failed ? ' is-failed' : ''}`}
                  key={job.id}
                  role={openable ? 'link' : 'status'}
                  tabIndex={openable ? 0 : undefined}
                  aria-label={`${statusLabel} ${title}`}
                  onClick={event => {
                    if (!openable || (event.target as HTMLElement).closest('button, video')) return;
                    props.onOpenJob(job);
                  }}
                  onKeyDown={event => {
                    if (!openable || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    props.onOpenJob(job);
                  }}
                >
                  <div className="dashboard-generation-result-media">
                    <ProjectCoverImage job={job} youtubeCovers={projectPreviewUrls(job)} fallback={projectCover(job.templateId)} service={props.service.openProjectCover ? props.service as Pick<CreatorWebService, 'openProjectCover'> : undefined} />
                    <span className="dashboard-generation-job-status">{failed ? <CircleAlert size={20} /> : pending ? <PackageOpen size={20} /> : <LoaderCircle size={20} className="smart-dubbing-spinner" />}</span>
                    <span className="dashboard-generation-running-percent">{pending ? statusLabel : `${percent}%`}</span>
                    {downloadable ? <button type="button" className="dashboard-generation-result-download" disabled={downloadingId !== undefined} aria-busy={downloadingId === downloadable.id} aria-label={`${l('下载', 'Download')} ${artifactName(downloadable, l)}`} title={l('下载', 'Download')} onClick={event => { event.stopPropagation(); void downloadJob(job); }}>
                      {downloadingId === downloadable.id ? <LoaderCircle size={16} className="smart-dubbing-spinner" /> : <Download size={16} />}
                    </button> : null}
                    {props.service.deleteJob ? <button type="button" className="dashboard-generation-result-delete" aria-label={`${l('删除项目', 'Delete project')} ${title}`} title={l('删除项目', 'Delete project')} onClick={event => { event.stopPropagation(); requestDeletion(job); }}><Trash2 size={16} /></button> : null}
                    <button type="button" className="dashboard-generation-result-open" aria-label={`${l('打开', 'Open')} ${title}`} title={l('打开项目', 'Open project')} onClick={event => { event.stopPropagation(); props.onOpenJob(job); }}><ArrowUpRight size={16} /></button>
                  </div>
                  <div className="dashboard-generation-result-copy">
                    <strong title={title}>{title}</strong>
                    <small>{workflowLabel(job.templateId, l)} · {message}</small>
                  </div>
                </article>;
              })}
            </div>
          </section>)}
        </section> : null}
        {error ? <p className="dashboard-generation-history-error" role="alert">{error}<button type="button" onClick={() => void load()}>{l('重试', 'Retry')}</button></p> : null}
        {loading && outputs.length === 0 && processJobs.length === 0 ? <div className="dashboard-generation-history-empty" role="status"><LoaderCircle className="smart-dubbing-spinner" size={24} />{l('正在加载生成记录', 'Loading generation history')}</div> : null}
        {!loading && outputs.length === 0 && processJobs.length === 0 ? <div className="dashboard-generation-history-empty"><PackageOpen size={28} /><strong>{l('还没有生成记录', 'No generation history yet')}</strong><p>{l('完成一次创作后，结果会显示在这里。', 'Your results will appear here after you create something.')}</p></div> : null}

        {visibleGroups.map(group => <section className="dashboard-generation-history-date" key={group.date}>
          <h2>{formatDate(group.date, language)}</h2>
          <div className="dashboard-generation-history-grid">
            {group.items.map(output => {
              const openable = [
                'video-translation', 'transcription', 'video-download', 'cover', 'cover-generator',
                'image-generation', 'video-generation', 'smart-dubbing', 'short-video-script', 'auto-clip'
              ].includes(output.job.templateId);
              return <article
                className="dashboard-generation-result-card"
                key={output.artifact.id}
                role={openable ? 'link' : undefined}
                tabIndex={openable ? 0 : undefined}
                aria-label={openable ? `${l('打开', 'Open')} ${output.title}` : undefined}
                onClick={event => {
                  if (!openable || (event.target as HTMLElement).closest('button, video')) return;
                  props.onOpenJob(output.job);
                }}
                onKeyDown={event => {
                  if (!openable || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  props.onOpenJob(output.job);
                }}
              >
                <GenerationArtifactMedia output={output} service={props.service} onOpen={openable ? () => props.onOpenJob(output.job) : undefined} />
                <div className="dashboard-generation-result-copy">
                  <strong title={output.title}>{output.title}</strong>
                  <small>{output.type} · {output.name} · V{output.artifact.version} · {formatDateTime(output.artifact.createdAt, language)}</small>
                </div>
                <button type="button" className="dashboard-generation-result-download" disabled={downloadingId !== undefined} aria-busy={downloadingId === output.artifact.id} onClick={() => void download(output)} aria-label={`${l('下载', 'Download')} ${output.name}`} title={l('下载', 'Download')}>
                  {downloadingId === output.artifact.id ? <LoaderCircle size={16} className="smart-dubbing-spinner" /> : <Download size={16} />}
                </button>
                {props.service.deleteJob ? <button type="button" className="dashboard-generation-result-delete" aria-label={`${l('删除项目', 'Delete project')} ${output.title}`} title={l('删除项目', 'Delete project')} onClick={event => { event.stopPropagation(); requestDeletion(output.job); }}><Trash2 size={16} /></button> : null}
              </article>;
            })}
          </div>
        </section>)}
        {visibleCount < outputs.length ? <button type="button" className="dashboard-generation-history-more" onClick={() => setVisibleCount(count => count + pageSize)}>{l('加载更多', 'Load more')}</button> : null}
      </div>
      <ConfirmDialog
        open={jobPendingDeletion !== undefined}
        title={l('删除项目', 'Delete project')}
        description={<span className="dashboard-generation-delete-description">
          <span>{jobPendingDeletion ? l(`确认永久删除“${resultTitle(jobPendingDeletion, l)}”？项目记录及创作历史将无法恢复。`, `Permanently delete "${resultTitle(jobPendingDeletion, l)}"? Its project record and creation history cannot be restored.`) : ''}</span>
          <label className="dashboard-generation-delete-files"><input type="checkbox" aria-label={l('同时删除项目文件', 'Also delete project files')} checked={deleteFiles} disabled={deleting} onChange={event => setDeleteFiles(event.target.checked)} /><span>{l('同时删除上传素材、生成结果和缓存文件', 'Also delete uploads, generated results, and cached files')}</span></label>
        </span>}
        confirmLabel={l('删除', 'Delete')}
        destructive
        busy={deleting}
        onCancel={() => { if (!deleting) { setJobPendingDeletion(undefined); setDeleteFiles(false); } }}
        onConfirm={() => void confirmDeletion()}
      />
    </main>
  );
}

function GenerationArtifactMedia(props: {
  output: HistoryOutput;
  service: Pick<CreatorWebService, 'openArtifact'>;
  onOpen?(): void;
}) {
  const l = useLocalizedCopy();
  const { output } = props;
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [controls, setControls] = useState(false);
  useEffect(() => {
    if (output.kind !== 'video' && output.kind !== 'image') return;
    let active = true;
    let objectUrl: string | undefined;
    setFailed(false);
    void props.service.openArtifact(output.job.id, output.artifact.id)
      .then(async response => {
        if (!response.ok) throw new Error('preview_failed');
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      setUrl(undefined);
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [output.artifact.id, output.job.id, output.kind, props.service]);

  return <div className="dashboard-generation-result-media" data-kind={output.kind}
    onMouseEnter={() => setControls(true)} onMouseLeave={() => setControls(false)}>
    {output.kind === 'video' && url ? <video src={url} controls={controls} preload="metadata" aria-label={output.name} /> : null}
    {output.kind === 'image' && url ? <img src={url} alt={output.name} /> : null}
    {props.onOpen && url ? <button type="button" tabIndex={-1} className="dashboard-generation-result-media-open"
      aria-label={`${l('打开项目编辑区', 'Open project editor')} · ${output.title}`}
      onClick={event => { event.stopPropagation(); props.onOpen?.(); }} /> : null}
    {(output.kind !== 'video' && output.kind !== 'image') || failed ? <span>{artifactIcon(output.kind, 30)}</span> : null}
    {output.kind === 'video' && !url ? <span className="dashboard-generation-result-play"><Video size={28} /></span> : null}
    {(output.kind === 'video' || output.kind === 'image') && !url && !failed ? <span className="dashboard-generation-result-loading"><LoaderCircle size={22} className="smart-dubbing-spinner" /></span> : null}
  </div>;
}

function processStageForJob(job: CreatorJob): CreatorJob['stages'][number] | undefined {
  const activeStage = job.stages.filter(stage => stage.status === 'queued' || stage.status === 'running' || stage.status === 'failed').at(-1);
  if (activeStage) return activeStage;
  if (job.status !== 'draft' && job.status !== 'needs_input') return undefined;
  return job.stages.at(-1) ?? {
    id: `${job.id}_pending`, jobId: job.id, stageId: 'setup', executor: 'creator', status: 'queued', dispatchStatus: 'queued',
    claimOwner: null, claimExpiresAt: null, attempt: 0, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
    progress: { phase: 'pending', percent: 0 }, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null
  };
}

function downloadableArtifact(job: CreatorJob): CreatorArtifact | undefined {
  return job.artifacts.filter(artifact => artifact.path !== null && artifact.status !== 'stale' && outputKinds.has(artifact.kind)).at(-1);
}

function projectPreviewUrls(job: CreatorJob): string[] {
  const thumbnail = readString(job.artifacts.find(artifact => artifact.kind === 'download_probe')?.metadata.thumbnailUrl);
  return [...new Set([...(thumbnail ? [thumbnail] : []), ...youtubeThumbnailUrls(readString(job.state.sourceUrl))])];
}

function artifactKind(kind: string): HistoryOutput['kind'] {
  if (/subtitle|caption/i.test(kind)) return 'subtitle';
  if (/script|publish_copy|clip_candidates|xiaohongshu_post/i.test(kind)) return 'document';
  if (/video/i.test(kind)) return 'video';
  if (/image|cover|storyboard/i.test(kind)) return 'image';
  if (/audio|narration|voice/i.test(kind)) return 'audio';
  return 'document';
}

function artifactName(artifact: CreatorArtifact, l: LocalizeCopy): string {
  const fileName = artifact.metadata.fileName;
  if (typeof fileName === 'string' && fileName.trim()) return fileName.trim();
  const pathName = artifact.path?.split(/[\\/]/).at(-1);
  return pathName || l('生成文件', 'Generated file');
}

function artifactIcon(kind: HistoryOutput['kind'], size: number) {
  if (kind === 'video') return <Video size={size} />;
  if (kind === 'image') return <ImageIcon size={size} />;
  if (kind === 'audio') return <Music2 size={size} />;
  return <FileText size={size} />;
}

function resultTitle(job: CreatorJob, l: LocalizeCopy): string {
  const probeTitle = job.artifacts.find(artifact => artifact.kind === 'download_probe')?.metadata.title;
  if (typeof probeTitle === 'string' && probeTitle.trim()) return shorten(probeTitle, 72);
  for (const key of ['projectName', 'title', 'topic', 'sourceFileName', 'prompt']) {
    const value = readString(job.state[key]);
    if (value) return shorten(value, 72);
  }
  const sourceUrl = readString(job.state.sourceUrl);
  if (sourceUrl) {
    try { return new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch { return sourceUrl; }
  }
  return workflowLabel(job.templateId, l);
}

function workflowLabel(templateId: string, l: LocalizeCopy): string {
  const labels: Record<string, string> = {
    'video-translation': l('视频翻译', 'Video Translation'),
    transcription: l('视频转录', 'Video Transcription'),
    'video-download': l('视频下载', 'Video Download'),
    'video-generation': l('视频生成', 'Video Generation'),
    'image-generation': l('图像生成', 'Image Generation'),
    cover: l('封面生成', 'Cover Generator'),
    'short-video-script': l('短视频脚本', 'Short Video Script'),
    'xiaohongshu-post': l('小红书文案', 'Xiaohongshu Post'),
    'smart-dubbing': l('文本转语音', 'Text to Speech'),
    'auto-clip': l('视频切片', 'Video Clips'),
    'stickman-video': l('火柴人动画', 'Stick Figure Animation')
  };
  return labels[templateId] ?? l('创作', 'Creation');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shorten(value: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function formatDate(value: string, language: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat(language, { year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp) : value;
}

function formatDateTime(value: string, language: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp) : value;
}
