import { readCreatorResultSnapshots, type CreatorArtifact, type CreatorStageRun } from '@opencreator/protocol';
import {
  Check,
  Download,
  Eye,
  FileText,
  FileVideo,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  PersonStanding,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  Volume2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import { useCreatorSession } from './creator-session-store.js';

type ScriptManifest = {
  title: string;
  language: string;
  segments: Array<{
    id: string;
    narration: string;
    durationSeconds: number;
    sourceKeyPoint: string;
  }>;
};

type ShotSpec = {
  scriptArtifactId?: string;
  shots: Array<{
    id: string;
    sourceSegmentId: string;
    narration: string;
    imagePrompt: string;
    motion: string;
    durationSeconds: number;
  }>;
};

type DialogState =
  | { kind: 'script'; content: string }
  | { kind: 'shot'; shotId: string; narration: string; imagePrompt: string; motion: string }
  | null;

const characterPresets = [
  ['default', '默认角色', 'Default', '/dashboard/characters/default.png', '统一的极简火柴人角色，白色圆形头部，黑色线条'],
  ['tech-guy', '科技男', 'Tech Guy', '/dashboard/characters/tech-guy.png', '极简火柴人科技从业者，简洁眼镜与卫衣'],
  ['long-hair', '长发角色', 'Long Hair', '/dashboard/characters/long-hair.png', '极简长发火柴人角色，轮廓清晰'],
  ['short-hair', '短发角色', 'Short Hair', '/dashboard/characters/short-hair.png', '极简短发火柴人角色，动作利落'],
  ['student', '学生角色', 'Student', '/dashboard/characters/student.png', '极简学生火柴人角色，背包与轻快动作'],
  ['manager', '经理', 'Manager', '/dashboard/characters/manager.png', '极简经理火柴人角色，衬衫与沉稳姿态']
] as const;

const deliveryKinds = [
  'clean_video',
  'cover_image',
  'publish_copy',
  'bilingual_video',
  'bilingual_subtitle'
] as const;

export default function StickmanVideoWorkspace(props: { onBack(): void; promptHint?: string }) {
  const l = useLocalizedCopy();
  const session = useCreatorSession();
  const { job, state } = session;
  const [activeStep, setActiveStep] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(0);
  const [controlPending, setControlPending] = useState<'canceling' | 'resuming'>();

  const scriptArtifact = latestCompleted(job.artifacts, 'script_manifest');
  const shotSpecArtifact = latestCompleted(job.artifacts, 'shot_spec');
  const visualValidation = latestCompleted(job.artifacts, 'visual_validation');
  const script = useArtifactJson<ScriptManifest>(scriptArtifact?.id);
  const shotSpec = useArtifactJson<ShotSpec>(shotSpecArtifact?.id);
  const snapshots = readCreatorResultSnapshots(job.state.resultSnapshots);
  const latestSnapshot = snapshots.at(-1);
  const currentSnapshot = snapshots.find(snapshot => snapshot.version === selectedVersion)
    ?? latestSnapshot;
  const derivedStep = snapshots.length > 0
    ? 3
    : shotSpecArtifact !== undefined
      ? 2
      : scriptArtifact !== undefined
        ? 1
        : 0;
  const activeStages = job.stages.filter(stage => stage.status === 'queued' || stage.status === 'running');
  const isBusy = activeStages.length > 0;
  const review = readNeedsInput(state.needsInput);
  const selectedPresetId = typeof state.selectedPresetId === 'string' ? state.selectedPresetId : 'default';
  const sourceUrl = typeof state.sourceUrl === 'string' ? state.sourceUrl : '';
  const style = typeof state.style === 'string' ? state.style : '极简黑白线稿';
  const characterPrompt = typeof state.characterPrompt === 'string'
    ? state.characterPrompt
    : characterPresets[0][4];
  const targetDurationSeconds = typeof state.targetDurationSeconds === 'number'
    ? state.targetDurationSeconds
    : 30;
  const voice = typeof state.voice === 'string' ? state.voice : 'alloy';
  const targetLanguage = typeof state.targetLanguage === 'string' ? state.targetLanguage : 'zh-CN';

  useEffect(() => {
    setActiveStep(derivedStep);
  }, [derivedStep]);

  useEffect(() => {
    if (latestSnapshot !== undefined) setSelectedVersion(latestSnapshot.version);
  }, [latestSnapshot?.version]);

  useEffect(() => {
    if (session.error?.code === 'creator_revision_conflict') {
      setNotice(l('任务已被其他入口更新，已刷新到最新版本，请重新操作', 'The task changed elsewhere. The latest revision has been loaded; retry your action.'));
    }
  }, [l, session.error?.code]);

  const currentVideo = artifactFromSnapshot(job.artifacts, currentSnapshot?.artifactRefs.clean_video);
  const currentCover = artifactFromSnapshot(job.artifacts, currentSnapshot?.artifactRefs.cover_image);
  const videoUrl = useArtifactUrl(currentVideo?.id);
  const coverUrl = useArtifactUrl(currentCover?.id);

  async function apply(action: string, input: Record<string, unknown>) {
    session.clearError();
    setNotice('');
    try {
      await session.applyAction({ actor: 'user', action, input: input as never });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function startWorkflow() {
    if (!isPublicYoutubeUrl(sourceUrl)) {
      setNotice(l('请输入有效的公开 YouTube 链接', 'Enter a valid public YouTube URL.'));
      return;
    }
    void apply('run-stage', { stageId: 'acquire-source' });
  }

  function approve(kind: 'approve-script' | 'approve-storyboard' | 'approve-visuals', artifactId: string) {
    void apply(kind, { artifactId, revision: job.revision });
  }

  function saveDialog() {
    if (dialog?.kind === 'script' && scriptArtifact !== undefined) {
      try {
        JSON.parse(dialog.content);
      } catch {
        setNotice(l('脚本必须是合法 JSON', 'The script must be valid JSON.'));
        return;
      }
      void apply('edit-script', { artifactId: scriptArtifact.id, content: dialog.content })
        .then(() => setDialog(null));
      return;
    }
    if (dialog?.kind === 'shot' && shotSpecArtifact !== undefined) {
      void apply('edit-shot', {
        artifactId: shotSpecArtifact.id,
        scopeKey: dialog.shotId,
        patch: {
          narration: dialog.narration,
          imagePrompt: dialog.imagePrompt,
          motion: dialog.motion
        },
        revision: job.revision
      }).then(() => setDialog(null));
    }
  }

  function regenerateShot(shotId: string) {
    const stage = latestShotStage(job.stages, shotId);
    if (stage?.inputFingerprint === null || stage?.inputFingerprint === undefined) {
      setNotice(l('当前镜头尚未建立生成指纹，请先审核分镜', 'This shot has no generation fingerprint yet. Approve the storyboard first.'));
      return;
    }
    void apply('regenerate-shot', {
      scopeKey: shotId,
      inputFingerprint: stage.inputFingerprint,
      revision: job.revision
    });
  }

  async function control(kind: 'canceling' | 'resuming') {
    setControlPending(kind);
    try {
      if (kind === 'canceling') await session.cancelJob();
      else await session.resumeJob();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setControlPending(undefined);
    }
  }

  const steps = [
    l('来源与角色', 'Source and character'),
    l('脚本审核', 'Script review'),
    l('分镜与画面', 'Storyboard and visuals'),
    l('成片交付', 'Video delivery')
  ];

  return (
    <CreatorToolShell
      title={l('火柴人动画', 'Stickman video')}
      subtitle={l('从 YouTube 内容生成脚本、分镜、画面、配音与固定五项交付', 'Turn YouTube content into a script, storyboard, visuals, narration, and five verified deliverables.')}
      context={currentIssue(job, steps[derivedStep]!, l)}
      stepLabel={steps[derivedStep]}
      currentIssue={review?.message ?? undefined}
      placeholder={props.promptHint ?? l('告诉 Agent 需要调整的脚本、镜头或画面要求', 'Tell the Agent what to change in the script, shots, or visuals')}
      suggestions={[
        l('检查当前任务状态', 'Check the current task status'),
        l('优化脚本节奏', 'Improve the script pacing'),
        l('检查镜头一致性', 'Check shot consistency')
      ]}
      pageClassName="stickman-workspace-page"
      contentClassName="stickman-workspace-content"
      onCancelTask={isBusy ? () => void control('canceling') : undefined}
      onResumeTask={job.status === 'canceled' ? () => void control('resuming') : undefined}
      taskControlPending={controlPending}
      onBack={props.onBack}
    >
      <div className="stickman-tool-stack">
        <nav className="creator-tool-steps" aria-label={l('火柴人视频制作步骤', 'Stickman video steps')}>
          <ol>
            {steps.map((step, index) => (
              <li key={step} data-status={index < derivedStep ? 'complete' : index === derivedStep ? 'current' : 'pending'}>
                <button type="button" disabled={index > derivedStep} onClick={() => setActiveStep(index)}>
                  <span>{index < derivedStep ? <Check size={14} /> : index + 1}</span>
                  <strong>{step}</strong>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {notice || session.error ? (
          <div className="creator-tool-notice" role="alert">
            <span>{notice || session.error?.message}</span>
            <button type="button" onClick={() => { setNotice(''); session.clearError(); }} aria-label={l('关闭提示', 'Dismiss')}><X size={15} /></button>
          </div>
        ) : null}

        <div className="creator-task-layout stickman-step-scroll">
          <section className="creator-task-workspace">
            {activeStep === 0 ? (
              <SourceAndCharacterStep
                sourceUrl={sourceUrl}
                style={style}
                selectedPresetId={selectedPresetId}
                characterPrompt={characterPrompt}
                targetDurationSeconds={targetDurationSeconds}
                busy={isBusy}
                l={l}
                onPatch={patch => session.updateDraft({ sourceType: 'url', ratio: '16:9', ...patch }, { semantic: true })}
                onStart={startWorkflow}
              />
            ) : null}

            {activeStep === 1 ? (
              <ScriptStep
                artifact={scriptArtifact}
                script={script}
                reviewKind={review?.kind}
                busy={isBusy}
                l={l}
                onEdit={() => script !== undefined && setDialog({ kind: 'script', content: JSON.stringify(script, null, 2) })}
                onApprove={() => scriptArtifact !== undefined && approve('approve-script', scriptArtifact.id)}
              />
            ) : null}

            {activeStep === 2 ? (
              <StoryboardStep
                jobStages={job.stages}
                shotSpec={shotSpec}
                artifacts={job.artifacts}
                reviewKind={review?.kind}
                validationArtifact={visualValidation}
                l={l}
                onEdit={shot => setDialog({
                  kind: 'shot',
                  shotId: shot.id,
                  narration: shot.narration,
                  imagePrompt: shot.imagePrompt,
                  motion: shot.motion
                })}
                onRegenerate={regenerateShot}
                onApproveStoryboard={() => shotSpecArtifact !== undefined && approve('approve-storyboard', shotSpecArtifact.id)}
                onApproveVisuals={() => visualValidation !== undefined && approve('approve-visuals', visualValidation.id)}
              />
            ) : null}

            {activeStep === 3 ? (
              <ResultStep
                artifacts={job.artifacts}
                snapshot={currentSnapshot}
                videoUrl={videoUrl}
                coverUrl={coverUrl}
                version={selectedVersion || latestSnapshot?.version || 0}
                versions={snapshots.map(snapshot => ({ value: snapshot.version, description: snapshot.description }))}
                l={l}
                onVersionChange={setSelectedVersion}
                onOpen={artifact => void openArtifact(session.openArtifact, artifact)}
                onDownload={artifact => void downloadArtifact(session.openArtifact, artifact)}
              />
            ) : null}
          </section>

          <CreatorTaskSummary
            sourceIcon={FileVideo}
            sourceLabel={l('YouTube 来源', 'YouTube source')}
            sourceValue={sourceUrl || l('尚未填写', 'Not set')}
            items={[
              { label: l('角色', 'Character'), value: characterPrompt },
              { label: l('风格', 'Style'), value: style },
              { label: l('目标时长', 'Target duration'), value: `${targetDurationSeconds}s` },
              { label: l('配音', 'Narration'), value: `${targetLanguage} · ${voice}` },
              { label: l('任务状态', 'Task status'), value: jobStatusLabel(job.status, l) }
            ]}
            note={review?.message}
            noteIcon={review ? Eye : undefined}
          />
        </div>
      </div>

      {dialog !== null ? (
        <div className="stickman-prompt-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && setDialog(null)}>
          <section className="stickman-prompt-dialog" role="dialog" aria-modal="true" aria-label={dialog.kind === 'script' ? l('编辑脚本', 'Edit script') : l('编辑镜头', 'Edit shot')}>
            <header>
              <span><Pencil size={17} /></span>
              <h2>{dialog.kind === 'script' ? l('编辑脚本', 'Edit script') : l('编辑镜头', 'Edit shot')}</h2>
              <button type="button" onClick={() => setDialog(null)} aria-label={l('关闭', 'Close')}><X size={17} /></button>
            </header>
            <div className="stickman-prompt-content">
              {dialog.kind === 'script' ? (
                <textarea value={dialog.content} onChange={event => setDialog({ ...dialog, content: event.target.value })} />
              ) : (
                <>
                  <label>{l('旁白', 'Narration')}<textarea value={dialog.narration} onChange={event => setDialog({ ...dialog, narration: event.target.value })} /></label>
                  <label>{l('画面提示词', 'Visual prompt')}<textarea value={dialog.imagePrompt} onChange={event => setDialog({ ...dialog, imagePrompt: event.target.value })} /></label>
                  <label>{l('镜头运动', 'Motion')}<input value={dialog.motion} onChange={event => setDialog({ ...dialog, motion: event.target.value })} /></label>
                </>
              )}
            </div>
            <footer>
              <button type="button" onClick={() => setDialog(null)}>{l('取消', 'Cancel')}</button>
              <button className="is-primary" type="button" onClick={saveDialog}>{l('保存修改', 'Save changes')}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </CreatorToolShell>
  );
}

function SourceAndCharacterStep(props: {
  sourceUrl: string;
  style: string;
  selectedPresetId: string;
  characterPrompt: string;
  targetDurationSeconds: number;
  busy: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onPatch(patch: Record<string, string | number>): void;
  onStart(): void;
}) {
  return (
    <div className="creator-tool-panel stickman-story-panel">
      <header className="creator-tool-panel-heading"><span><Sparkles size={18} /></span><div><h2>{props.l('来源与角色', 'Source and character')}</h2><p>{props.l('生产版只接受公开 YouTube 链接，所有设置会保存到当前任务。', 'The production workflow accepts public YouTube links. Every setting is persisted to this task.')}</p></div></header>
      <label className="creator-tool-field"><span>{props.l('YouTube 链接', 'YouTube URL')}</span><input type="url" value={props.sourceUrl} placeholder="https://www.youtube.com/watch?v=..." onChange={event => props.onPatch({ sourceUrl: event.target.value })} /></label>
      <div className="stickman-character-picker">
        <div className="stickman-character-presets" role="radiogroup" aria-label={props.l('角色预设', 'Character presets')}>
          {characterPresets.map(([id, nameZh, nameEn, image, prompt]) => (
            <button type="button" role="radio" aria-checked={props.selectedPresetId === id} key={id} onClick={() => props.onPatch({ selectedPresetId: id, characterPrompt: prompt })}>
              <span className="stickman-character-preset-visual"><img src={image} alt="" /></span>
              <strong>{props.l(nameZh, nameEn)}</strong>
              {props.selectedPresetId === id ? <Check className="stickman-character-preset-check" size={15} /> : null}
            </button>
          ))}
        </div>
      </div>
      <label className="creator-tool-field"><span>{props.l('角色描述', 'Character prompt')}</span><textarea value={props.characterPrompt} onChange={event => props.onPatch({ characterPrompt: event.target.value })} /></label>
      <div className="creator-tool-form-row">
        <label className="creator-tool-field"><span>{props.l('视觉风格', 'Visual style')}</span><input value={props.style} onChange={event => props.onPatch({ style: event.target.value })} /></label>
        <label className="creator-tool-field"><span>{props.l('目标时长', 'Target duration')}</span><input type="number" min={10} max={600} value={props.targetDurationSeconds} onChange={event => props.onPatch({ targetDurationSeconds: Number(event.target.value) })} /></label>
      </div>
      <div className="stickman-wizard-actions"><button className="creator-tool-primary" type="button" disabled={props.busy} onClick={props.onStart}>{props.busy ? <LoaderCircle className="creator-collaboration-spin" size={16} /> : <Play size={16} />}{props.l('开始生成', 'Start generation')}</button></div>
    </div>
  );
}

function ScriptStep(props: {
  artifact?: CreatorArtifact;
  script?: ScriptManifest;
  reviewKind?: string;
  busy: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onEdit(): void;
  onApprove(): void;
}) {
  if (props.artifact === undefined || props.script === undefined) return <PendingPanel icon={FileText} label={props.l('脚本正在生成或等待执行', 'The script is being generated or queued.')} />;
  return (
    <div className="creator-tool-panel">
      <header className="creator-tool-panel-heading"><span><FileText size={18} /></span><div><h2>{props.script.title}</h2><p>{props.script.language} · {props.script.segments.length} {props.l('段', 'segments')}</p></div></header>
      <div className="stickman-storyboard-editor">
        {props.script.segments.map((segment, index) => <article className="stickman-storyboard-row" key={segment.id}><div className="stickman-storyboard-meta"><strong>{String(index + 1).padStart(2, '0')}</strong><small>{segment.durationSeconds}s</small></div><div className="stickman-storyboard-copy"><strong>{segment.sourceKeyPoint}</strong><p>{segment.narration}</p></div></article>)}
      </div>
      <div className="stickman-wizard-actions"><button type="button" onClick={props.onEdit}><Pencil size={15} />{props.l('编辑脚本', 'Edit script')}</button>{props.reviewKind === 'approve-script' ? <button className="creator-tool-primary" type="button" disabled={props.busy} onClick={props.onApprove}><Check size={15} />{props.l('审核通过', 'Approve script')}</button> : null}</div>
    </div>
  );
}

function StoryboardStep(props: {
  jobStages: CreatorStageRun[];
  shotSpec?: ShotSpec;
  artifacts: CreatorArtifact[];
  reviewKind?: string;
  validationArtifact?: CreatorArtifact;
  l: ReturnType<typeof useLocalizedCopy>;
  onEdit(shot: ShotSpec['shots'][number]): void;
  onRegenerate(shotId: string): void;
  onApproveStoryboard(): void;
  onApproveVisuals(): void;
}) {
  if (props.shotSpec === undefined) return <PendingPanel icon={ImageIcon} label={props.l('分镜正在生成或等待脚本审核', 'The storyboard is being generated or waiting for script approval.')} />;
  return (
    <div className="creator-tool-panel stickman-storyboard-review">
      <header className="creator-tool-panel-heading"><span><ImageIcon size={18} /></span><div><h2>{props.l('分镜与画面', 'Storyboard and visuals')}</h2><p>{props.shotSpec.shots.length} {props.l('个镜头，进度来自持久化 StageRun 与 Artifact', 'shots; progress comes from persisted StageRuns and Artifacts')}</p></div></header>
      <div className="stickman-storyboard-editor">
        {props.shotSpec.shots.map((shot, index) => {
          const stage = latestShotStage(props.jobStages, shot.id);
          const image = latestShotImage(props.artifacts, shot.id, stage?.inputFingerprint ?? null);
          return <article className="stickman-storyboard-row" key={shot.id}><div className="stickman-storyboard-meta"><strong>{String(index + 1).padStart(2, '0')}</strong><small>{shot.durationSeconds}s</small></div><ShotPreview artifact={image} status={stage?.status} l={props.l} /><div className="stickman-storyboard-copy"><strong>{shot.narration}</strong><p>{shot.imagePrompt}</p><small>{shot.motion}</small><div className="stickman-storyboard-actions"><button type="button" title={props.l('编辑镜头', 'Edit shot')} onClick={() => props.onEdit(shot)}><Pencil size={15} /></button><button type="button" title={props.l('重新生成图片', 'Regenerate image')} disabled={stage?.status === 'queued' || stage?.status === 'running'} onClick={() => props.onRegenerate(shot.id)}><RefreshCw size={15} /></button></div></div></article>;
        })}
      </div>
      <div className="stickman-wizard-actions">{props.reviewKind === 'approve-storyboard' ? <button className="creator-tool-primary" type="button" onClick={props.onApproveStoryboard}><Check size={15} />{props.l('审核分镜并生成画面', 'Approve storyboard and generate visuals')}</button> : null}{props.reviewKind === 'approve-visuals' && props.validationArtifact !== undefined ? <button className="creator-tool-primary" type="button" onClick={props.onApproveVisuals}><Eye size={15} />{props.l('确认画面并继续成片', 'Approve visuals and continue')}</button> : null}</div>
    </div>
  );
}

function ShotPreview(props: { artifact?: CreatorArtifact; status?: CreatorStageRun['status']; l: ReturnType<typeof useLocalizedCopy> }) {
  const url = useArtifactUrl(props.artifact?.id);
  return <div className="stickman-storyboard-media"><div className="stickman-storyboard-image">{url ? <img src={url} alt={props.l('镜头画面', 'Shot visual')} /> : <span>{props.status === 'running' || props.status === 'queued' ? <LoaderCircle className="creator-collaboration-spin" size={18} /> : <ImageIcon size={18} />}</span>}</div></div>;
}

function ResultStep(props: {
  artifacts: CreatorArtifact[];
  snapshot?: ReturnType<typeof readCreatorResultSnapshots>[number];
  videoUrl: string;
  coverUrl: string;
  version: number;
  versions: Array<{ value: number; description: string }>;
  l: ReturnType<typeof useLocalizedCopy>;
  onVersionChange(version: number): void;
  onOpen(artifact: CreatorArtifact): void;
  onDownload(artifact: CreatorArtifact): void;
}) {
  if (props.snapshot === undefined) return <PendingPanel icon={FileVideo} label={props.l('最终交付尚未完成', 'Final delivery is not complete yet.')} />;
  return <div className="stickman-video-result"><header className="stickman-result-toolbar"><div><h2>{props.l('固定五项交付', 'Five verified deliverables')}</h2><p>{props.snapshot.description}</p></div><CreatorResultVersionMenu version={props.version} versions={props.versions} onVersionChange={props.onVersionChange} /></header>{props.videoUrl ? <div><video controls src={props.videoUrl} poster={props.coverUrl || undefined} /><span><Play size={22} /></span></div> : null}<section><div className="creator-result-files">{deliveryKinds.map(kind => { const artifact = artifactFromSnapshot(props.artifacts, props.snapshot!.artifactRefs[kind]); return <article key={kind} data-ready={artifact !== undefined}><span>{deliveryIcon(kind)}</span><div><strong>{deliveryLabel(kind, props.l)}</strong><small>{artifact?.metadata.fileName as string ?? props.l('文件不可用', 'File unavailable')}</small></div><button type="button" disabled={artifact === undefined} title={props.l('打开', 'Open')} onClick={() => artifact && props.onOpen(artifact)}><Eye size={15} /></button><button type="button" disabled={artifact === undefined} title={props.l('下载', 'Download')} onClick={() => artifact && props.onDownload(artifact)}><Download size={15} /></button></article>; })}</div></section></div>;
}

function PendingPanel(props: { icon: typeof FileText; label: string }) {
  const Icon = props.icon;
  return <div className="creator-tool-panel creator-workspace-loading" aria-live="polite"><Icon size={20} /><p>{props.label}</p></div>;
}

function useArtifactJson<T>(artifactId?: string): T | undefined {
  const session = useCreatorSession();
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let canceled = false;
    setValue(undefined);
    if (artifactId === undefined) return () => { canceled = true; };
    void session.openArtifactJson<T>(artifactId).then(next => {
      if (!canceled) setValue(next);
    }).catch(() => undefined);
    return () => { canceled = true; };
  }, [artifactId, session.openArtifactJson]);
  return value;
}

function useArtifactUrl(artifactId?: string): string {
  const session = useCreatorSession();
  const [url, setUrl] = useState('');
  useEffect(() => {
    let objectUrl = '';
    let canceled = false;
    setUrl('');
    if (artifactId === undefined) return () => { canceled = true; };
    void session.openArtifact(artifactId).then(async response => {
      if (!response.ok) return;
      objectUrl = URL.createObjectURL(await response.blob());
      if (!canceled) setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { canceled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artifactId, session.openArtifact]);
  return url;
}

function latestCompleted(artifacts: CreatorArtifact[], kind: string): CreatorArtifact | undefined {
  return [...artifacts].reverse().find(artifact => artifact.kind === kind && artifact.status === 'completed');
}

function latestShotStage(stages: CreatorStageRun[], scopeKey: string): CreatorStageRun | undefined {
  return [...stages].reverse().find(stage => stage.stageId === 'images' && stage.scopeKey === scopeKey);
}

function latestShotImage(artifacts: CreatorArtifact[], scopeKey: string, fingerprint: string | null): CreatorArtifact | undefined {
  return [...artifacts].reverse().find(artifact => artifact.kind === 'shot_image' && artifact.status === 'completed' && artifact.scopeKey === scopeKey && (fingerprint === null || artifact.inputFingerprint === fingerprint));
}

function artifactFromSnapshot(artifacts: CreatorArtifact[], ids?: string[]): CreatorArtifact | undefined {
  return [...(ids ?? [])].reverse().flatMap(id => artifacts.find(artifact => artifact.id === id) ?? []).at(0);
}

function readNeedsInput(value: unknown): { code: string; kind?: string; message?: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'string') return null;
  return { code: record.code, ...(typeof record.kind === 'string' ? { kind: record.kind } : {}), ...(typeof record.message === 'string' ? { message: record.message } : {}) };
}

function currentIssue(job: { status: string; stages: CreatorStageRun[] }, step: string, l: ReturnType<typeof useLocalizedCopy>): string {
  const active = [...job.stages].reverse().find(stage => stage.status === 'running' || stage.status === 'queued');
  if (active) return l(`正在执行：${active.stageId}`, `Running: ${active.stageId}`);
  return job.status === 'needs_input' ? l(`等待操作：${step}`, `Action required: ${step}`) : step;
}

function jobStatusLabel(status: string, l: ReturnType<typeof useLocalizedCopy>): string {
  const labels: Record<string, [string, string]> = { draft: ['草稿', 'Draft'], running: ['执行中', 'Running'], needs_input: ['等待操作', 'Action required'], failed: ['失败', 'Failed'], canceled: ['已终止', 'Canceled'], completed: ['已完成', 'Completed'] };
  const value = labels[status] ?? [status, status];
  return l(value[0], value[1]);
}

function deliveryLabel(kind: typeof deliveryKinds[number], l: ReturnType<typeof useLocalizedCopy>): string {
  const labels = { clean_video: ['纯净视频', 'Clean video'], cover_image: ['YouTube 封面', 'YouTube cover'], publish_copy: ['发布文案', 'Publish copy'], bilingual_video: ['双语视频', 'Bilingual video'], bilingual_subtitle: ['双语字幕', 'Bilingual subtitles'] } as const;
  const [zh, en] = labels[kind];
  return l(zh, en);
}

function deliveryIcon(kind: typeof deliveryKinds[number]) {
  if (kind === 'cover_image') return <ImageIcon size={17} />;
  if (kind === 'publish_copy' || kind === 'bilingual_subtitle') return <FileText size={17} />;
  return <FileVideo size={17} />;
}

async function openArtifact(open: (id: string) => Promise<Response>, artifact: CreatorArtifact) {
  const response = await open(artifact.id);
  if (!response.ok) return;
  const url = URL.createObjectURL(await response.blob());
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadArtifact(open: (id: string) => Promise<Response>, artifact: CreatorArtifact) {
  const response = await open(artifact.id);
  if (!response.ok) return;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = typeof artifact.metadata.fileName === 'string' ? artifact.metadata.fileName : artifact.kind;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isPublicYoutubeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'youtu.be' || host.endsWith('youtube.com');
  } catch {
    return false;
  }
}
