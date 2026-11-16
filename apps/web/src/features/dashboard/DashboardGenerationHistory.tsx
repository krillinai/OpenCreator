import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import { ArrowLeft, ArrowUpRight, CircleAlert, Download, FileText, Image as ImageIcon, LoaderCircle, Music2, PackageOpen, Play, Trash2, Video, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { isMeaningfulCreatorJob, ProjectCoverImage, projectCover, youtubeThumbnailUrls } from '../projects/ProjectsPage.js';
import { isYtDlpCaptionTimeout, isYtDlpPreviewTimeout } from '../issues/issue-catalog.js';
import { generationHistoryTypeForWorkspace, type GenerationHistoryType } from './generation-history-type.js';
import { creatorWorkspaceForTemplate } from './creator-workspace.js';
import { creatorPanelAdapterFor } from './creator-panel-adapters.js';
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

type HistoryEntry =
  | { kind: 'process'; job: CreatorJob; createdAt: string }
  | { kind: 'output'; output: HistoryOutput; createdAt: string };

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
  const [previewOutput, setPreviewOutput] = useState<HistoryOutput>();
  const previewTriggerRef = useRef<HTMLElement | null>(null);
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
    .flatMap(job => {
      const artifacts = job.artifacts.filter(artifact => artifact.path !== null
        && artifact.status !== 'stale' && outputKinds.has(artifact.kind));
      const visibleArtifacts = job.templateId === 'video-translation'
        ? processStageForJob(job) !== undefined ? [] : [translationHistoryArtifact(artifacts)].filter((artifact): artifact is CreatorArtifact => artifact !== undefined)
        : artifacts;
      return visibleArtifacts.map(artifact => ({ artifact, job, name: artifactName(artifact, l), title: resultTitle(job, l), type: workflowLabel(job.templateId, l), kind: artifactKind(artifact.kind) }));
    })
    .filter(output => type === 'all'
      || generationHistoryTypeForWorkspace(creatorWorkspaceForTemplate(output.job.templateId)) === type)
    .sort((left, right) => historyOutputTime(right).localeCompare(historyOutputTime(left))),
  [jobs, l, type]);
  const processJobs = jobs.filter(job => (
    (type === 'all' || generationHistoryTypeForWorkspace(creatorWorkspaceForTemplate(job.templateId)) === type)
    && isMeaningfulCreatorJob(job)
    && processStageForJob(job) !== undefined
  ));
  const historyGroups = useMemo(() => {
    const entries: HistoryEntry[] = [
      ...processJobs.map(job => ({
        kind: 'process' as const, job, createdAt: processStageForJob(job)?.startedAt ?? job.createdAt
      })),
      ...outputs.slice(0, visibleCount).map(output => ({
        kind: 'output' as const, output, createdAt: historyOutputTime(output)
      }))
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const result: Array<{ date: string; items: HistoryEntry[] }> = [];
    for (const entry of entries) {
      const date = entry.createdAt.slice(0, 10);
      const group = result.at(-1);
      if (group?.date === date) group.items.push(entry);
      else result.push({ date, items: [entry] });
    }
    return result;
  }, [outputs, processJobs, visibleCount]);

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

  const closePreview = useCallback(() => {
    const trigger = previewTriggerRef.current;
    setPreviewOutput(undefined);
    window.setTimeout(() => trigger?.focus(), 0);
  }, []);

  function openOutput(output: HistoryOutput, trigger: HTMLElement) {
    if (isPreviewableOutput(output)) {
      previewTriggerRef.current = trigger;
      setPreviewOutput(output);
    } else {
      props.onOpenJob(output.job);
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

        {historyGroups.map(group => <section className="dashboard-generation-history-date" key={group.date}>
            <h2>{formatDate(group.date, language)}</h2>
            <div className="dashboard-generation-history-grid">
              {group.items.map(item => {
                if (item.kind === 'process') {
                const job = item.job;
                const stage = processStageForJob(job)!;
                const failed = stage.status === 'failed';
                const pending = !failed && (job.status === 'draft' || job.status === 'needs_input');
                const openable = failed || pending || (job.templateId === 'video-download'
                  && (stage.status === 'queued' || stage.status === 'running'));
                const percent = job.templateId === 'image-generation'
                  ? creatorPanelAdapterFor(job.templateId).readStageProgress(stage, l).percent
                  : typeof stage.progress.percent === 'number' ? Math.round(stage.progress.percent) : 0;
                const translationTimeout = failed ? videoTranslationTimeoutMessage(job, stage, l) : undefined;
                const message = pending
                  ? job.templateId === 'video-download'
                    ? l('请选择下载格式并继续创作', 'Choose a download format to continue')
                    : l('继续配置这个创作项目', 'Continue configuring this project')
                  : failed
                    ? translationTimeout ?? stage.errorMessage ?? (typeof stage.progress.message === 'string' ? stage.progress.message : stage.stageId)
                    : typeof stage.progress.message === 'string' ? stage.progress.message
                      : job.templateId === 'image-generation' && stage.progress.phase === 'generating_candidates'
                        ? l('正在生成图片', 'Generating image', 'Skapar bild') : stage.stageId;
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
                    if (!openable || (job.templateId === 'video-download' && event.target !== event.currentTarget)
                      || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    props.onOpenJob(job);
                  }}
                >
                  <div className="dashboard-generation-result-media">
                    {job.templateId === 'video-generation'
                      ? <VideoGenerationHistoryCover job={job} service={props.service} />
                      : <ProjectCoverImage job={job} youtubeCovers={projectPreviewUrls(job)} fallback={projectCover(job.templateId)} service={props.service.openProjectCover ? props.service as Pick<CreatorWebService, 'openProjectCover'> : undefined} />}
                    <span className="dashboard-generation-job-status">{failed ? <CircleAlert size={20} /> : pending ? <PackageOpen size={20} /> : <LoaderCircle size={20} className="smart-dubbing-spinner" />}</span>
                    <span className="dashboard-generation-running-percent">{failed || pending || percent === null ? statusLabel : `${percent}%`}</span>
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
                }
              const output = item.output;
              const openable = [
                'video-translation', 'transcription', 'video-download', 'cover', 'cover-generator',
                'image-generation', 'video-generation', 'smart-dubbing', 'short-video-script', 'auto-clip'
              ].includes(output.job.templateId);
              const previewable = isPreviewableOutput(output);
              return <article
                className="dashboard-generation-result-card"
                key={output.artifact.id}
                role={previewable ? 'button' : openable ? 'link' : undefined}
                tabIndex={previewable || openable ? 0 : undefined}
                aria-label={previewable ? `${l('预览', 'Preview')} ${output.title}` : openable ? `${l('打开', 'Open')} ${output.title}` : undefined}
                onClick={event => {
                  if ((!previewable && !openable) || (event.target as HTMLElement).closest('button')) return;
                  openOutput(output, event.currentTarget);
                }}
                onKeyDown={event => {
                  if ((!previewable && !openable) || event.target !== event.currentTarget
                    || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  openOutput(output, event.currentTarget);
                }}
              >
                <GenerationArtifactMedia output={output} service={props.service} />
                <div className="dashboard-generation-result-copy">
                  <strong title={output.title}>{output.title}</strong>
                  <small>{output.type} · {output.name} · V{output.artifact.version} · {formatDateTime(historyOutputTime(output), language)}</small>
                </div>
                <button type="button" className="dashboard-generation-result-download" disabled={downloadingId !== undefined} aria-busy={downloadingId === output.artifact.id} onClick={() => void download(output)} aria-label={`${l('下载', 'Download')} ${output.name}`} title={l('下载', 'Download')}>
                  {downloadingId === output.artifact.id ? <LoaderCircle size={16} className="smart-dubbing-spinner" /> : <Download size={16} />}
                </button>
                {props.service.deleteJob ? <button type="button" className="dashboard-generation-result-delete" aria-label={`${l('删除项目', 'Delete project')} ${output.title}`} title={l('删除项目', 'Delete project')} onClick={event => { event.stopPropagation(); requestDeletion(output.job); }}><Trash2 size={16} /></button> : null}
              </article>;
              })}
          </div>
        </section>)}
        {error ? <p className="dashboard-generation-history-error" role="alert">{error}<button type="button" onClick={() => void load()}>{l('重试', 'Retry')}</button></p> : null}
        {loading && outputs.length === 0 && processJobs.length === 0 ? <div className="dashboard-generation-history-empty" role="status"><LoaderCircle className="smart-dubbing-spinner" size={24} />{l('正在加载生成记录', 'Loading generation history')}</div> : null}
        {!loading && !error && outputs.length === 0 && processJobs.length === 0 ? <div className="dashboard-generation-history-empty"><PackageOpen size={28} /><strong>{l('还没有生成记录', 'No generation history yet')}</strong><p>{l('完成一次创作后，结果会显示在这里。', 'Your results will appear here after you create something.')}</p></div> : null}
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
      {previewOutput ? <HistoryMediaPreviewDialog
        output={previewOutput}
        service={props.service}
        downloading={downloadingId === previewOutput.artifact.id}
        onDownload={() => void download(previewOutput)}
        onClose={closePreview}
      /> : null}
    </main>
  );
}

function GenerationArtifactMedia(props: {
  output: HistoryOutput;
  service: Pick<CreatorWebService, 'openArtifact'> & Partial<Pick<CreatorWebService, 'openProjectCover'>>;
}) {
  const { output } = props;
  const subtitlePreview = output.kind === 'subtitle' && output.job.templateId === 'video-translation';
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
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

  return <div className="dashboard-generation-result-media" data-kind={output.kind}>
    {output.kind === 'video' && url ? <video src={url} preload="metadata" aria-label={output.name} /> : null}
    {output.kind === 'image' && url ? <img src={url} alt={output.name} /> : null}
    {subtitlePreview ? <ProjectCoverImage job={output.job} youtubeCovers={projectPreviewUrls(output.job)} fallback={projectCover(output.job.templateId)} service={props.service.openProjectCover ? props.service as Pick<CreatorWebService, 'openProjectCover'> : undefined} /> : null}
    {((output.kind !== 'video' && output.kind !== 'image' && !subtitlePreview) || failed) ? <span>{artifactIcon(output.kind, 30)}</span> : null}
    {output.kind === 'video' && isPreviewableOutput(output) ? <span className="dashboard-generation-result-play"><Play size={24} fill="currentColor" /></span> : null}
    {(output.kind === 'video' || output.kind === 'image') && !url && !failed ? <span className="dashboard-generation-result-loading"><LoaderCircle size={22} className="smart-dubbing-spinner" /></span> : null}
  </div>;
}

function HistoryMediaPreviewDialog(props: {
  output: HistoryOutput;
  service: Pick<CreatorWebService, 'openArtifact'>;
  downloading: boolean;
  onDownload(): void;
  onClose(): void;
}) {
  const l = useLocalizedCopy();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [url, setUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setLoading(true);
    setFailed(false);
    void props.service.openArtifact(props.output.job.id, props.output.artifact.id)
      .then(async response => {
        if (!response.ok) throw new Error('preview_failed');
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.output.artifact.id, props.output.job.id, props.service, retryCount]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
      } else if (event.key === 'Tab') {
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), video[controls]') ?? [])];
        if (focusable.length === 0) return;
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        focusable[(index + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onClose]);

  return createPortal(
    <div className="dashboard-generation-preview-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <section ref={dialogRef} className="dashboard-generation-preview" role="dialog" aria-modal="true"
        aria-label={`${l('预览', 'Preview')} ${props.output.title}`}>
        <header>
          <strong>{props.output.title}</strong>
          <div>
            <button type="button" disabled={props.downloading} onClick={props.onDownload}
              aria-label={`${l('下载', 'Download')} ${props.output.name}`} title={l('下载', 'Download')}>
              {props.downloading ? <LoaderCircle size={18} className="smart-dubbing-spinner" /> : <Download size={18} />}
            </button>
            <button ref={closeRef} type="button" onClick={props.onClose}
              aria-label={l('关闭预览', 'Close preview')} title={l('关闭预览', 'Close preview')}>
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="dashboard-generation-preview-media">
          {loading ? <p role="status"><LoaderCircle size={20} className="smart-dubbing-spinner" />{l('正在加载预览', 'Loading preview')}</p> : null}
          {failed ? <p role="alert">{l('文件预览加载失败，请稍后重试。', 'The file preview failed to load. Try again later.')}
            <button type="button" onClick={() => setRetryCount(count => count + 1)}>{l('重试', 'Retry')}</button>
          </p> : null}
          {url && props.output.kind === 'video' ? <video src={url} controls autoPlay playsInline tabIndex={0} aria-label={props.output.name} /> : null}
          {url && props.output.kind === 'image' ? <img src={url} alt={props.output.name} /> : null}
        </div>
      </section>
    </div>,
    document.body
  );
}

function isPreviewableOutput(output: HistoryOutput): boolean {
  return output.kind === 'image' || (output.kind === 'video' && output.job.templateId !== 'video-translation');
}

function processStageForJob(job: CreatorJob): CreatorJob['stages'][number] | undefined {
  const activeStage = job.stages.filter(stage => stage.status === 'queued' || stage.status === 'running' || stage.status === 'failed').at(-1);
  if (job.status === 'completed' && activeStage?.status === 'failed') return undefined;
  if (activeStage) return activeStage;
  if (job.status !== 'draft' && job.status !== 'needs_input') return undefined;
  return job.stages.at(-1) ?? {
    id: `${job.id}_pending`, jobId: job.id, stageId: 'setup', executor: 'creator', status: 'queued', dispatchStatus: 'queued',
    claimOwner: null, claimExpiresAt: null, attempt: 0, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
    progress: { phase: 'pending', percent: 0 }, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null
  };
}

function videoTranslationTimeoutMessage(job: CreatorJob, selected: CreatorJob['stages'][number], l: LocalizeCopy): string | undefined {
  if (job.templateId !== 'video-translation' || !['subtitle', 'preview-source-video'].includes(selected.stageId)) return undefined;
  const subtitle = [...job.stages].reverse().find(stage => stage.stageId === 'subtitle');
  const preview = [...job.stages].reverse().find(stage => stage.stageId === 'preview-source-video');
  const captionsTimedOut = subtitle?.status === 'failed'
    && isYtDlpCaptionTimeout(subtitle.errorCode, subtitle.errorMessage);
  const previewTimedOut = preview?.status === 'failed'
    && isYtDlpPreviewTimeout(preview.errorCode, preview.errorMessage);
  if (captionsTimedOut && previewTimedOut) return l(
    '视频平台连接超时，字幕读取和原视频预览未完成',
    'The video platform connection timed out; captions and source video preview could not be prepared.',
    'Anslutningen till videoplattformen tog för lång tid; undertexter och förhandsvisning kunde inte förberedas.'
  );
  if (captionsTimedOut && selected.stageId === 'subtitle') return l(
    '视频平台连接超时，字幕读取未完成',
    'The video platform connection timed out; captions could not be read.',
    'Anslutningen till videoplattformen tog för lång tid; undertexterna kunde inte läsas.'
  );
  if (previewTimedOut && selected.stageId === 'preview-source-video') return l(
    '视频平台连接超时，原视频预览未完成',
    'The video platform connection timed out; source video preview could not be prepared.',
    'Anslutningen till videoplattformen tog för lång tid; förhandsvisningen kunde inte förberedas.'
  );
  return undefined;
}

function downloadableArtifact(job: CreatorJob): CreatorArtifact | undefined {
  return job.artifacts.filter(artifact => artifact.path !== null && artifact.status !== 'stale' && outputKinds.has(artifact.kind)).at(-1);
}

function translationHistoryArtifact(artifacts: CreatorArtifact[]): CreatorArtifact | undefined {
  const priority = ['horizontal_video', 'vertical_video', 'bilingual_video', 'clean_video',
    'target_subtitle', 'bilingual_subtitle', 'dubbed_audio'];
  const results = artifacts.filter(artifact => priority.includes(artifact.kind));
  const candidates = results.length > 0
    ? results.filter(artifact => artifact.version === Math.max(...results.map(result => result.version)))
    : artifacts;
  return [...candidates].sort((left, right) => {
    const leftPriority = priority.indexOf(left.kind);
    const rightPriority = priority.indexOf(right.kind);
    return (leftPriority < 0 ? priority.length : leftPriority) - (rightPriority < 0 ? priority.length : rightPriority)
      || right.createdAt.localeCompare(left.createdAt);
  })[0];
}

function historyOutputTime(output: HistoryOutput): string {
  return output.job.templateId === 'video-translation' ? output.job.updatedAt : output.artifact.createdAt;
}

function projectPreviewUrls(job: CreatorJob): string[] {
  const thumbnail = readString(job.artifacts.find(artifact => artifact.kind === 'download_probe')?.metadata.thumbnailUrl);
  return [...new Set([...(thumbnail ? [thumbnail] : []), ...youtubeThumbnailUrls(readString(job.state.sourceUrl))])];
}

function VideoGenerationHistoryCover(props: {
  job: CreatorJob;
  service: Pick<CreatorWebService, 'openArtifact'> & Partial<Pick<CreatorWebService, 'openProjectCover'>>;
}) {
  const referenceId = props.job.state.referenceImageArtifactId;
  const reference = typeof referenceId === 'string' ? props.job.artifacts.find(artifact => (
    artifact.id === referenceId && artifact.kind === 'reference_image'
    && artifact.path !== null && artifact.status !== 'stale'
  )) : undefined;
  const [cover, setCover] = useState<{ artifactId: string; url: string }>();
  const [failedId, setFailedId] = useState<string>();

  useEffect(() => {
    if (!reference || failedId === reference.id) return;
    let active = true;
    let objectUrl: string | undefined;
    void props.service.openArtifact(props.job.id, reference.id)
      .then(async response => {
        if (!response.ok) throw new Error('reference_cover_unavailable');
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setCover({ artifactId: reference.id, url: objectUrl });
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (active) setFailedId(reference.id); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [failedId, props.job.id, props.service, reference?.id]);

  if (reference && cover?.artifactId === reference.id && failedId !== reference.id) {
    return <img src={cover.url} alt="" onError={() => setFailedId(reference.id)} />;
  }
  return <ProjectCoverImage
    job={props.job}
    youtubeCovers={projectPreviewUrls(props.job)}
    fallback={projectCover(props.job.templateId)}
    service={props.service.openProjectCover ? props.service as Pick<CreatorWebService, 'openProjectCover'> : undefined}
  />;
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
