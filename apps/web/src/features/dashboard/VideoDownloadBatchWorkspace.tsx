import type { CreatorJob } from '@opencreator/protocol';
import { CheckCircle2, FileVideo, Link2, LoaderCircle, Plus, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useGenerationAccess } from './DashboardGenerationAccess.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import {
  CreatorSessionProvider,
  useCreatorSession,
  type CreatorSessionContextValue
} from './creator-session-store.js';
import VideoDownloadWorkspace from './VideoDownloadWorkspace.js';
import SupportedVideoSources from './SupportedVideoSources.js';
import VideoDownloadThumbnail from './VideoDownloadThumbnail.js';
import {
  DOWNLOAD_BATCH_HIDDEN,
  DOWNLOAD_BATCH_PARENT,
  downloadSourceForJob,
  downloadSourceIdentity,
  hiddenDownloadJobIds,
  parseDownloadLink,
  type DownloadSource
} from './video-download-batch.js';

export type VideoDownloadBatchView = {
  jobs: CreatorJob[];
  hasSelectedSource: boolean;
  toolbarActions: ReactNode;
  editor: ReactNode;
  sourceList: ReactNode;
  resolveSession(jobId: string): CreatorSessionContextValue | undefined;
};

const ROOT = 'root';

export default function VideoDownloadBatchWorkspace(props: ComponentProps<typeof VideoDownloadWorkspace> & {
  service: CreatorWebService;
}) {
  const root = useCreatorSession();
  const l = useLocalizedCopy();
  const requireGenerationAccess = useGenerationAccess();
  const [jobs, setJobs] = useState<CreatorJob[]>([]);
  const [selectedId, setSelectedId] = useState(ROOT);
  const [editorOpen, setEditorOpen] = useState(() => downloadSourceForJob({ ...root.job, state: root.state }) === undefined
    || !root.job.artifacts.some(artifact => artifact.kind === 'download_probe' && artifact.status === 'completed'));
  const [linksText, setLinksText] = useState('');
  const [linkTouched, setLinkTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [error, setError] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [retryingIds, setRetryingIds] = useState<ReadonlySet<string>>(() => new Set());
  const retryingIdsRef = useRef(new Set<string>());
  const sessionsRef = useRef(new Map<string, CreatorSessionContextValue>());
  const rootRef = useRef(root);
  const jobsRef = useRef(jobs);
  const busyRef = useRef(false);
  const needsProbeRef = useRef(new Set<string>());
  const startedProbeRef = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  rootRef.current = root;
  jobsRef.current = jobs;

  const rootSource = downloadSourceForJob({ ...root.job, state: root.state });
  const hiddenIds = hiddenDownloadJobIds({ ...root.job, state: root.state });
  const allJobs = [root.job, ...jobs];
  const hasAnalyzedVideo = allJobs.some(job => job.artifacts.some(artifact => artifact.kind === 'download_probe' && artifact.status === 'completed'));
  const sources = [rootSource, ...jobs.map(downloadSourceForJob)]
    .filter((source): source is DownloadSource => source !== undefined && !hiddenIds.includes(source.id));
  const activeJobId = selectedId === ROOT ? root.job.id : selectedId;
  const parsedLink = parseDownloadLink(linksText);
  const validLink = parsedLink.error === undefined;
  const inputError = error || (linkTouched && linksText.trim() && parsedLink.error ? linkError(parsedLink.error) : '');

  useEffect(() => {
    if (editorOpen) inputRef.current?.focus();
  }, [editorOpen]);

  useEffect(() => {
    if (root.job.id.startsWith('pending:') || props.service.listJobs === undefined) return;
    let canceled = false;
    setLoading(true);
    void props.service.listJobs(root.job.projectId).then(response => {
      if (canceled) return;
      const members = response.jobs.filter(job => job.templateId === 'video-download'
        && job.projectId === root.job.projectId && job.state[DOWNLOAD_BATCH_PARENT] === root.job.id);
      setJobs(current => {
        const merged = new Map(current.map(job => [job.id, job]));
        for (const job of members) if ((merged.get(job.id)?.revision ?? -1) <= job.revision) merged.set(job.id, job);
        return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
      setRestoreError('');
    }).catch(cause => {
      if (!canceled) setRestoreError(errorMessage(cause, l('链接列表加载失败，请重试', 'Could not load links. Try again.')));
    }).finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [root.job.id, root.job.projectId, props.service, restoreAttempt]);

  useEffect(() => {
    if (sources.some(source => source.id === activeJobId)) return;
    if (sources.length > 0) setSelectedId(sources[0]!.id === root.job.id ? ROOT : sources[0]!.id);
    else if (selectedId !== ROOT) setSelectedId(ROOT);
  }, [activeJobId, root.job.id, selectedId, sources.map(source => source.id).join(':')]);

  const registerSession = useCallback((session: CreatorSessionContextValue) => {
    sessionsRef.current.set(session.job.id, session);
    setJobs(current => {
      const previous = current.find(job => job.id === session.job.id);
      if (previous === undefined || previous === session.job || previous.revision > session.job.revision) return current;
      const next = current.map(job => job.id === session.job.id ? session.job : job);
      jobsRef.current = next;
      return next;
    });
    if (!needsProbeRef.current.has(session.job.id) || startedProbeRef.current.has(session.job.id)) return;
    startedProbeRef.current.add(session.job.id);
    void session.applyAction({ actor: 'user', action: 'run-stage', input: { stageId: 'probe' } })
      .catch(cause => setJobErrors(current => ({ ...current, [session.job.id]: errorMessage(cause, l('解析未完成', 'Analysis did not complete')) })))
      .finally(() => { needsProbeRef.current.delete(session.job.id); });
  }, [l]);

  const unregisterSession = useCallback((jobId: string) => { sessionsRef.current.delete(jobId); }, []);

  function resolveSession(jobId: string) {
    return rootRef.current.job.id === jobId ? rootRef.current : sessionsRef.current.get(jobId);
  }

  async function unhide(jobId: string) {
    const hidden = hiddenDownloadJobIds({ ...rootRef.current.job, state: rootRef.current.state });
    if (!hidden.includes(jobId)) return;
    rootRef.current.updateDraft({ [DOWNLOAD_BATCH_HIDDEN]: hidden.filter(id => id !== jobId) });
    await rootRef.current.flush();
  }

  function linkError(error: 'multiple' | 'invalid') {
    return error === 'multiple'
      ? l('每次只能添加一个链接', 'Add one link at a time.')
      : l('请输入支持的公开视频链接', 'Enter a supported public video URL.');
  }

  async function addLink() {
    if (busyRef.current || loading) return;
    if (!requireGenerationAccess()) return;
    const parsed = parseDownloadLink(linksText);
    if (parsed.error) {
      setError(linkError(parsed.error));
      return;
    }
    const url = parsed.url;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      let rootJob = { ...rootRef.current.job, state: rootRef.current.state };
      let parentId = rootJob.id;
      let selected: string;
      const currentRoot = rootRef.current;
      const existing = [downloadSourceForJob(rootJob), ...jobsRef.current.map(downloadSourceForJob)]
        .find(source => source !== undefined && downloadSourceIdentity(source.url) === downloadSourceIdentity(url));
      if (existing !== undefined) {
        const isRoot = existing.id === rootJob.id;
        if (isRoot && parentId.startsWith('pending:')) {
          rootJob = await currentRoot.applyAction({ actor: 'user', action: 'update-settings', input: { patch: { sourceUrl: url }, activityMode: 'draft' } });
          parentId = rootJob.id;
          void currentRoot.applyAction({ actor: 'user', action: 'run-stage', input: { stageId: 'probe' } })
            .catch(cause => setJobErrors(current => ({ ...current, [parentId]: errorMessage(cause, l('解析未完成', 'Analysis did not complete')) })));
        }
        await unhide(existing.id);
        selected = isRoot ? ROOT : existing.id;
      } else if (typeof rootJob.state.sourceUrl !== 'string' || !rootJob.state.sourceUrl.trim()) {
        currentRoot.updateDraft({ sourceUrl: url, selectedOptionId: null }, { semantic: true });
        rootJob = await currentRoot.applyAction({ actor: 'user', action: 'update-settings', input: { patch: { sourceUrl: url }, activityMode: 'draft' } });
        parentId = rootJob.id;
        void currentRoot.applyAction({ actor: 'user', action: 'run-stage', input: { stageId: 'probe' } })
          .catch(cause => setJobErrors(current => ({ ...current, [parentId]: errorMessage(cause, l('解析未完成', 'Analysis did not complete')) })));
        selected = ROOT;
      } else {
        if (parentId.startsWith('pending:')) {
          rootJob = await currentRoot.applyAction({ actor: 'user', action: 'update-settings', input: { patch: { sourceUrl: rootJob.state.sourceUrl }, activityMode: 'draft' } });
          parentId = rootJob.id;
        }
        const { job } = await props.service.createJob({
          projectId: currentRoot.job.projectId, templateId: 'video-download', templateVersion: 2,
          creationKey: `download-link:${parentId}:${downloadSourceIdentity(url)}`,
          state: { sourceUrl: url, [DOWNLOAD_BATCH_PARENT]: parentId }
        });
        if (job.projectId !== currentRoot.job.projectId || job.templateId !== 'video-download'
          || job.state[DOWNLOAD_BATCH_PARENT] !== parentId) throw new Error('Download task does not belong to this link list');
        if (!job.stages.some(stage => stage.stageId === 'probe')) needsProbeRef.current.add(job.id);
        jobsRef.current = [...jobsRef.current.filter(member => member.id !== job.id), job];
        setJobs(jobsRef.current);
        selected = job.id;
      }
      setSelectedId(selected);
      setLinksText('');
      setEditorOpen(false);
    } catch (cause) {
      setError(errorMessage(cause, l('添加链接未完成，请重试', 'Could not add the link. Try again.')));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function retrySource(source: DownloadSource) {
    const session = resolveSession(source.id);
    if (session === undefined || retryingIdsRef.current.has(source.id)
      || session.job.stages.some(stage => stage.status === 'queued' || stage.status === 'running')) return;
    retryingIdsRef.current.add(source.id);
    setRetryingIds(new Set(retryingIdsRef.current));
    setJobErrors(current => { const next = { ...current }; delete next[source.id]; return next; });
    try {
      session.clearError();
      const latest = session.job.stages.at(-1);
      if ((latest?.status === 'canceled' || latest?.status === 'interrupted') && latest.progress.downloadControl !== 'canceled'
        && source.job.artifacts.some(artifact => artifact.kind === 'download_probe')) {
        await session.resumeJob();
      } else if (latest?.status === 'failed' && latest.stageId === 'download'
        && typeof latest.progress.optionId === 'string'
        && (latest.progress.mediaType === 'video' || latest.progress.mediaType === 'audio')) {
        await session.applyAction({ actor: 'user', action: 'run-stage', input: {
          stageId: 'download', optionId: latest.progress.optionId,
          mediaType: latest.progress.mediaType, sourceUrl: latest.progress.sourceUrl ?? source.url
        } });
      } else {
        await session.applyAction({ actor: 'user', action: 'run-stage', input: { stageId: 'probe' } });
      }
    } catch (cause) {
      setJobErrors(current => ({ ...current, [source.id]: errorMessage(cause, l('解析未完成，请重试', 'Analysis did not complete. Try again.')) }));
    } finally {
      retryingIdsRef.current.delete(source.id);
      setRetryingIds(new Set(retryingIdsRef.current));
    }
  }

  async function removeSource(source: DownloadSource) {
    if (busyRef.current || retryingIdsRef.current.has(source.id) || source.status === 'analyzing' || source.status === 'downloading') return;
    busyRef.current = true;
    setBusy(true);
    try {
      const hidden = hiddenDownloadJobIds({ ...rootRef.current.job, state: rootRef.current.state });
      rootRef.current.updateDraft({ [DOWNLOAD_BATCH_HIDDEN]: [...new Set([...hidden, source.id])] });
      await rootRef.current.flush();
      if (activeJobId === source.id) {
        const next = sources.find(member => member.id !== source.id);
        setSelectedId(next === undefined || next.id === root.job.id ? ROOT : next.id);
        if (next === undefined) setEditorOpen(true);
      }
    } catch (cause) {
      setError(errorMessage(cause, l('移除链接未完成，请重试', 'Could not remove the link. Try again.')));
    } finally { busyRef.current = false; setBusy(false); }
  }

  const sourceList = sources.length === 0 ? null : (
    <ul className="video-download-source-list" aria-label={l('视频链接列表', 'Video links')}>
      {sources.map(source => {
        const active = source.status === 'analyzing' || source.status === 'downloading' || retryingIds.has(source.id);
        const failed = source.status === 'failed' || jobErrors[source.id] !== undefined;
        const status = failed ? l('失败', 'Failed') : {
          waiting: l('待解析', 'Waiting'), analyzing: l('解析中', 'Analyzing'), ready: l('可下载', 'Ready'),
          downloading: l('下载中', 'Downloading'), completed: l('已完成', 'Completed'), failed: l('失败', 'Failed'), canceled: l('已停止', 'Stopped')
        }[source.status];
        return <li key={source.id} data-selected={source.id === activeJobId}>
          <button className="video-download-source-select" type="button" aria-pressed={source.id === activeJobId}
            onClick={() => setSelectedId(source.id === root.job.id ? ROOT : source.id)} title={jobErrors[source.id] ?? source.url}>
            {source.thumbnail ? <VideoDownloadThumbnail key={source.thumbnailArtifactId} src={source.thumbnail} alt=""
              load={source.thumbnailArtifactId ? () => props.service.openDownloadThumbnail(source.id, source.thumbnailArtifactId!) : undefined} /> : <FileVideo size={24} aria-hidden="true" />}
            <span><strong>{source.title}</strong><small>{status}</small></span>
          </button>
          {failed || source.status === 'waiting' || source.status === 'canceled' ? <button className="video-download-source-action" type="button"
            disabled={busy || active} onClick={() => void retrySource(source)} aria-label={`${l('重试', 'Retry')} ${source.title}`} title={l('重试', 'Retry')}>
            <RefreshCw size={15} aria-hidden="true" />
          </button> : null}
          <button className="video-download-source-action" type="button" disabled={busy || active}
            onClick={() => void removeSource(source)} aria-label={`${l('移除链接', 'Remove link')} ${source.title}`} title={l('移除链接', 'Remove link')}>
            <X size={15} aria-hidden="true" />
          </button>
        </li>;
      })}
    </ul>
  );
  const editor = <>
    {editorOpen ? <form className="video-download-add-form" onSubmit={event => { event.preventDefault(); void addLink(); }}>
      {sources.length === 0 ? <SupportedVideoSources label={l('支持的视频来源', 'Supported video sources')} /> : null}
      <label htmlFor="video-download-add-links">{l('视频链接', 'Video URL')}</label>
      <div className="video-download-link-input" data-valid={validLink || undefined}>
        <Link2 className="video-download-link-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
        <input id="video-download-add-links" ref={inputRef} value={linksText} disabled={busy} type="text" inputMode="url"
          aria-invalid={inputError && parsedLink.error ? true : undefined}
          aria-describedby={inputError ? 'video-download-link-error' : validLink ? 'video-download-link-valid' : undefined}
          onChange={event => { setLinksText(event.target.value); setError(''); setLinkTouched(false); }}
          onBlur={() => setLinkTouched(true)}
          onPaste={event => {
            const pasted = event.clipboardData.getData('text');
            const input = event.currentTarget;
            const combined = linksText.slice(0, input.selectionStart ?? 0) + pasted + linksText.slice(input.selectionEnd ?? linksText.length);
            const parsed = parseDownloadLink(combined);
            if (parsed.error === 'multiple' || /[\r\n]/.test(pasted)) {
              event.preventDefault();
              if (parsed.error) setError(linkError(parsed.error));
              else { setLinksText(parsed.url); setError(''); setLinkTouched(false); }
            }
          }}
          placeholder={l('粘贴一个视频链接', 'Paste a video URL')} />
        {validLink ? <span id="video-download-link-valid" className="video-download-link-valid" role="status"
          aria-label={l('链接格式有效', 'Valid link format', 'Giltigt länkformat')} title={l('链接格式有效', 'Valid link format', 'Giltigt länkformat')}><CheckCircle2 size={18} aria-hidden="true" /></span> : null}
        {linksText.length > 0 ? <button className="video-download-clear-link" type="button" disabled={busy}
          aria-label={l('清空链接', 'Clear link', 'Rensa länk')} title={l('清空链接', 'Clear link', 'Rensa länk')}
          onClick={() => { setLinksText(''); setError(''); setLinkTouched(false); inputRef.current?.focus(); }}><X size={16} aria-hidden="true" /></button> : null}
      </div>
      <div className="video-download-add-form-actions">{hasAnalyzedVideo ? <button type="button" disabled={busy} onClick={() => { setEditorOpen(false); setError(''); }}>{l('取消', 'Cancel')}</button> : null}
        <button type="submit" disabled={busy || loading || !validLink}>{busy ? <LoaderCircle size={15} className="smart-dubbing-spinner" /> : <Plus size={15} />}{l('获取', 'Fetch', 'Hämta')}</button></div>
    </form> : null}
    {loading ? <p className="creator-tool-notice" role="status">{l('正在加载链接列表', 'Loading links')}</p> : null}
    {inputError ? <div id="video-download-link-error" className="video-download-batch-error" role="alert">{inputError}</div> : null}
    {restoreError ? <div className="video-download-batch-error" role="alert">{restoreError}<button type="button" onClick={() => setRestoreAttempt(value => value + 1)}><RefreshCw size={15} />{l('重试', 'Retry')}</button></div> : null}
  </>;
  const batch: VideoDownloadBatchView = {
    jobs: allJobs, hasSelectedSource: sources.some(source => source.id === activeJobId), sourceList, editor,
    resolveSession,
    toolbarActions: hasAnalyzedVideo ? <button type="button" className="video-download-add-button" disabled={busy} onClick={() => setEditorOpen(value => !value)} aria-expanded={editorOpen} aria-controls={editorOpen ? 'video-download-add-links' : undefined}><Plus size={16} aria-hidden="true" />{l('添加链接', 'Add link')}</button> : null
  };
  const workspace = <VideoDownloadWorkspace {...props} batch={batch} />;
  return <>
    {selectedId === ROOT ? workspace : null}
    {jobs.map(job => <CreatorSessionProvider key={job.id} initialJob={job} service={props.service}>
      <DownloadJobObserver onSession={registerSession} onUnmount={unregisterSession} />
      {selectedId === job.id ? workspace : null}
    </CreatorSessionProvider>)}
  </>;
}

function DownloadJobObserver(props: { onSession(session: CreatorSessionContextValue): void; onUnmount(jobId: string): void }) {
  const session = useCreatorSession();
  useEffect(() => { props.onSession(session); }, [session, props.onSession]);
  useEffect(() => () => props.onUnmount(session.job.id), [session.job.id, props.onUnmount]);
  return null;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
