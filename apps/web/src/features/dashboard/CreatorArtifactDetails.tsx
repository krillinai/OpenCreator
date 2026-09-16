import { readCreatorResultSnapshots, type CreatorArtifact, type CreatorJob } from '@opencreator/protocol';
import { useEffect, useRef, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { creatorPanelAdapterFor } from './creator-panel-adapters.js';
import { useOptionalCreatorSession } from './creator-session-store.js';
import './creator-artifact-details.css';

export default function CreatorArtifactDetails() {
  const session = useOptionalCreatorSession();
  const l = useLocalizedCopy();
  const [open, setOpen] = useState(false);
  const [artifactId, setArtifactId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [texts, setTexts] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const job = session?.job;
  const snapshots = readCreatorResultSnapshots(job?.state.resultSnapshots);
  const current = snapshots.find(snapshot => snapshot.version === job?.state.resultVersion)
    ?? snapshots.at(-1);
  const artifact = job?.artifacts.find(item => item.id === artifactId)
    ?? job?.artifacts.find(item => current?.artifactRefs[item.kind]?.includes(item.id))
    ?? job?.artifacts.at(-1);
  const versions = job?.artifacts.filter(item => (
    item.kind === artifact?.kind && item.scopeKey === artifact.scopeKey
  )) ?? [];
  const comparison = versions.find(item => item.id === compareId && item.id !== artifact?.id);
  const origin = snapshots.find(snapshot => snapshot.changedArtifactIds.includes(artifact?.id ?? ''));
  const projects = snapshots.filter(snapshot => snapshot.artifactRefs[artifact?.kind ?? '']?.includes(artifact?.id ?? ''));
  const [projectVersion, setProjectVersion] = useState<number>();
  const selectedProject = projects.find(snapshot => snapshot.version === projectVersion)
    ?? projects.at(-1);
  const isCurrent = artifact !== undefined && current?.artifactRefs[artifact.kind]?.includes(artifact.id);
  const stale = artifact?.status === 'stale' || current?.staleArtifactIds.includes(artifact?.id ?? '') === true;
  const busy = job?.status === 'running' || job?.stages.some(stage => ['queued', 'running'].includes(stage.status));
  // ponytail: positional comparison; insertions shift later highlights. Add alignment only if needed.
  const textLines = texts?.map(text => text.split('\n'));

  useEffect(() => {
    setTexts(null);
    setError('');
    if (!open || !artifact || !comparison || !session || !isText(artifact) || !isText(comparison)) return;
    let active = true;
    void Promise.all([artifact, comparison].map(async item => {
      const response = await session.openArtifact(item.id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 200_000) throw new Error(l('文本超过 20 万字符，请下载后对比', 'Text exceeds 200,000 characters. Download it to compare.'));
      return text;
    })).then(values => { if (active) setTexts(values); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [open, artifact?.id, comparison?.id, session?.openArtifact, l]);

  if (!job || !artifact || !session) return null;
  const adapter = creatorPanelAdapterFor(job.templateId);
  const label = (item: CreatorArtifact) => `${fileName(item)} · V${item.version}`;

  async function adopt() {
    if (!session || !selectedProject || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      await session.applyAction({ action: 'select-result-version', input: { version: selectedProject.version } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function download(item: CreatorArtifact) {
    if (!session) return;
    setError('');
    try {
      const response = await session.openArtifact(item.id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName(item);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <details className="creator-artifact-details" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{l('产物版本与来源', 'Artifact versions and sources')}</summary>
      {open ? <section aria-label={l('产物详情', 'Artifact details')}>
        <label>{l('浏览产物（不改变项目选择）', 'Browse artifacts (keeps project selection)')}
          <select value={artifact.id} onChange={event => { setArtifactId(event.target.value); setCompareId(''); setProjectVersion(undefined); }}>
            {[...job.artifacts].reverse().map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
          </select>
        </label>
        <dl>
          <dt>{l('类型 / 产物版本', 'Type / artifact version')}</dt><dd>{artifact.kind} · V{artifact.version}</dd>
          <dt>{l('创建时间', 'Created')}</dt><dd><time dateTime={artifact.createdAt}>{new Date(artifact.createdAt).toLocaleString()}</time></dd>
          <dt>{l('状态', 'Status')}</dt><dd>{stale ? l('已过期，非当前有效结果', 'Stale, not a current valid result') : artifact.status === 'completed' ? l('已完成', 'Completed') : artifact.status === 'draft' ? l('草稿', 'Draft') : l('技术预览', 'Technical preview')}</dd>
          <dt>{l('当前采用', 'Current selection')}</dt><dd>{current ? l(`项目 V${current.version}`, `Project V${current.version}`) : l('无项目快照', 'No project snapshot')}{isCurrent ? l(' · 包含此产物', ' · includes this artifact') : l(' · 未采用此产物', ' · does not include this artifact')}</dd>
          <dt>{l('生成来源', 'Generated by')}</dt><dd>{origin
            ? <>{l(`项目 V${origin.version}`, `Project V${origin.version}`)} · {origin.description || origin.action}{origin.stageId ? ` · ${adapter.stageLabel(origin.stageId, l)}` : ''} <small>({origin.action})</small></>
            : l('未记录生成快照；无法确定 Action / Stage', 'No generation snapshot recorded; Action / Stage unknown')}</dd>
        </dl>
        {stale ? <p role="status">{staleReason(job, artifact, l)}</p> : null}
        <h3>{l('上游来源', 'Upstream sources')}</h3>
        {artifact.sourceArtifactIds.length ? <ul>{artifact.sourceArtifactIds.map(id => {
          const source = job.artifacts.find(item => item.id === id);
          return <li key={id}>{source
            ? <button type="button" onClick={() => { setArtifactId(id); setCompareId(''); setProjectVersion(undefined); }}>{label(source)}{source.status === 'stale' ? l('（已过期）', ' (stale)') : ''}</button>
            : l(`来源记录缺失：${id}`, `Source record missing: ${id}`)}</li>;
        })}</ul> : <p>{l('未记录上游产物', 'No upstream artifacts recorded')}</p>}
        <label>{l('包含此产物的项目版本', 'Project versions containing this artifact')}
          <select value={selectedProject?.version ?? ''} disabled={!projects.length} onChange={event => setProjectVersion(Number(event.target.value))}>
            {!projects.length ? <option value="">{l('无快照，只可浏览和下载', 'No snapshot; browse and download only')}</option> : null}
            {projects.map(snapshot => <option key={snapshot.version} value={snapshot.version}>V{snapshot.version} · {snapshot.description}</option>)}
          </select>
        </label>
        <p>{l('采用整个项目结果版本；保留所有历史文件与过期状态，不更改生成设置。', 'Selects the whole project result version. Keeps history, stale status, and generation settings.')}</p>
        <button type="button" disabled={!selectedProject || selectedProject.version === current?.version || busy || pending} onClick={() => void adopt()}>{pending ? l('保存中…', 'Saving…') : l('采用项目版本', 'Use project version')}</button>
        {busy ? <p>{l('请等待当前阶段完成后切换', 'Wait for the active stage before switching')}</p> : null}
        <h3>{l('历史版本对比', 'Compare versions')}</h3>
        <label>{l('对比版本', 'Comparison version')}
          <select value={comparison?.id ?? ''} onChange={event => setCompareId(event.target.value)}>
            <option value="">{l('选择同类型历史产物', 'Choose a previous artifact of this type')}</option>
            {versions.filter(item => item.id !== artifact.id).map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
          </select>
        </label>
        <div className="creator-artifact-comparison">
          {[artifact, ...(comparison ? [comparison] : [])].map((item, index) => <div key={item.id}>
            <strong>{label(item)}</strong>
            <button type="button" disabled={!item.path} onClick={() => void download(item)}>{l('下载', 'Download')} V{item.version}</button>
            {!isText(item) ? <ArtifactMediaPreview artifact={item} /> : null}
            {textLines && comparison ? <pre aria-label={l(`版本 ${item.version} 文本`, `Version ${item.version} text`)}>{textLines[index]!.slice(0, 2000).map((line, lineIndex) => {
              const other = textLines[1 - index]!;
              return <span className={line === other[lineIndex] ? '' : 'is-changed'} key={lineIndex}>{lineIndex + 1} {line}{'\n'}</span>;
            })}</pre> : null}
          </div>)}
        </div>
        {comparison ? <p>{isText(artifact) && isText(comparison)
          ? l('按行号并排高亮不同文本，最多显示 2000 行；完整内容请下载。', 'Highlights differences at the same line number, up to 2,000 lines. Download for full content.')
          : l('媒体版本可并排预览或下载，不进行内容比较。', 'Preview or download media versions side by side; no content comparison.')}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </section> : null}
    </details>
  );
}

function ArtifactMediaPreview({ artifact }: { artifact: CreatorArtifact }) {
  const session = useOptionalCreatorSession();
  const l = useLocalizedCopy();
  const [requested, setRequested] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const extension = fileName(artifact).split('.').at(-1)?.toLowerCase() ?? '';
  const kind = /^(png|jpe?g|webp|gif|avif)$/.test(extension) ? 'image'
    : /^(mp3|wav|m4a|ogg|flac)$/.test(extension) ? 'audio'
    : /^(mp4|webm|mov)$/.test(extension) ? 'video' : null;
  useEffect(() => {
    if (!requested || !session) return;
    let active = true;
    let objectUrl = '';
    void session.openArtifact(artifact.id).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [requested, artifact.id, session?.openArtifact]);
  if (!kind || !artifact.path) return null;
  return <>
    <button type="button" disabled={requested} onClick={() => setRequested(true)}>{l('预览', 'Preview')} V{artifact.version}</button>
    {url && kind === 'image' ? <img src={url} alt={fileName(artifact)} /> : null}
    {url && kind === 'audio' ? <audio src={url} controls aria-label={fileName(artifact)} /> : null}
    {url && kind === 'video' ? <video src={url} controls aria-label={fileName(artifact)} /> : null}
    {error ? <p role="alert">{error}</p> : null}
  </>;
}

function fileName(artifact: CreatorArtifact): string {
  return typeof artifact.metadata.fileName === 'string'
    ? artifact.metadata.fileName
    : artifact.path?.split(/[\\/]/).at(-1) || artifact.kind;
}

function isText(artifact: CreatorArtifact): boolean {
  return /\.(txt|md|srt|vtt|json|csv)$/i.test(fileName(artifact))
    || (typeof artifact.metadata.mimeType === 'string' && artifact.metadata.mimeType.startsWith('text/'));
}

function staleReason(job: CreatorJob, artifact: CreatorArtifact, l: (zh: string, en: string) => string): string {
  const sources = artifact.sourceArtifactIds.map(id => job.artifacts.find(item => item.id === id));
  if (sources.some(source => source === undefined)) return l('部分上游来源记录已缺失。', 'Some upstream source records are missing.');
  if (sources.some(source => source?.status === 'stale')) return l('上游产物已被标记为过期。', 'An upstream artifact is marked stale.');
  const snapshot = readCreatorResultSnapshots(job.state.resultSnapshots).find(item => item.staleArtifactIds.includes(artifact.id));
  if (snapshot) return l(`项目 V${snapshot.version} 已将此结果标记为过期：${snapshot.description}`, `Project V${snapshot.version} marked this result stale: ${snapshot.description}`);
  return l('已有记录将此结果标记为过期，未记录具体原因。', 'This result is marked stale; no specific reason was recorded.');
}
