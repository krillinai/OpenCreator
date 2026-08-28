import type {
  CreatorActivity,
  CreatorAgentItem,
  CreatorAgentTurn,
  CreatorJob,
  CreatorStageRun
} from '@opencreator/protocol';
import {
  Bot,
  CheckCircle2,
  CircleDot,
  CircleStop,
  LoaderCircle,
  MessageSquareText,
  Play,
  ServerOff,
  Sparkles,
  XCircle
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownRenderer } from '../../components/markdown/MarkdownRenderer.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import ToolAgentComposer, { type ToolAgentPermission } from './ToolAgentComposer.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

export type VideoTranslationAgentQuickAction = {
  id: string;
  label: string;
  kind: 'action' | 'agent';
  prompt?: string;
  onAction?(): void;
  disabled?: boolean;
};

type SyncEvent = {
  id: string;
  actor: CreatorActivity['actor'];
  action: string;
  label: string;
  fields: string[];
  count: number;
  createdAt: string;
  stageId?: string;
};

type CollaborationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: CreatorAgentTurn['status'] | CreatorAgentItem['status'];
  createdAt: string;
  source: 'agent';
};

type CollaborationTimelineItem =
  | {
      id: string;
      kind: 'message';
      createdAt: string;
      message: CollaborationMessage;
    }
  | {
      id: string;
      kind: 'activity';
      createdAt: string;
      event: SyncEvent;
    }
  | {
      id: string;
      kind: 'stage';
      createdAt: string;
      stage: CreatorStageRun;
      actor: CreatorActivity['actor'];
    };

export default function VideoTranslationAgentPanel(props: {
  stepLabel: string;
  contextSummary: string;
  promptHint?: string;
  currentIssue?: string;
  quickActions?: VideoTranslationAgentQuickAction[];
  onCancelTask?(): void;
  onResumeTask?(): void;
  taskControlPending?: 'canceling' | 'resuming';
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [permission, setPermission] = useState<ToolAgentPermission>('full-access');
  const sendingRef = useRef(false);
  const permissionSessionRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const agentTurns = useMemo(() => session?.turns.filter(turn => (
    (turn.role === 'user' || turn.role === 'assistant')
    && (turn.content.trim().length > 0 || ['queued', 'running', 'waiting_approval'].includes(turn.status))
  )) ?? [], [session?.turns]);
  const conversationMessages = useMemo(
    () => buildCollaborationMessages(agentTurns, session?.items ?? []),
    [agentTurns, session?.items]
  );
  const syncEvents = useMemo(
    () => buildSyncEvents(session?.job.activities ?? [], l),
    [l, session?.job.activities]
  );
  const timelineItems = useMemo(
    () => buildCollaborationTimeline(session?.job, conversationMessages, syncEvents),
    [conversationMessages, session?.job, syncEvents]
  );
  const pendingApprovals = useMemo(
    () => session?.approvals.filter(approval => approval.status === 'pending') ?? [],
    [session?.approvals]
  );
  const hasActiveStage = useMemo(
    () => latestStageRuns(session?.job.stages ?? []).some(stage => (
      stage.status === 'queued' || stage.status === 'running'
    )),
    [session?.job.stages]
  );
  const activeTaskStage = useMemo(
    () => [...(session?.job.stages ?? [])].reverse().find(stage => (
      stage.status === 'queued' || stage.status === 'running'
    )),
    [session?.job.stages]
  );
  const latestTaskStage = session?.job.stages.at(-1);
  const resumableTaskStage = activeTaskStage === undefined
    && (latestTaskStage?.status === 'canceled' || latestTaskStage?.status === 'interrupted')
    ? latestTaskStage
    : undefined;
  const showAgentWorking = (sending || session?.agentBusy === true)
    && !hasActiveStage
    && pendingApprovals.length === 0;

  useEffect(() => {
    const sessionId = session?.agentSession?.id;
    if (sessionId === undefined || permissionSessionRef.current === sessionId) return;
    permissionSessionRef.current = sessionId;
    const sandbox = session?.agentSession?.sandbox;
    if (sandbox === 'danger-full-access') setPermission('full-access');
    if (sandbox === 'workspace-write') setPermission('approval');
  }, [session?.agentSession?.id, session?.agentSession?.sandbox]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [
    conversationMessages.at(-1)?.content,
    conversationMessages.at(-1)?.status,
    session?.job.updatedAt,
    timelineItems.at(-1)?.id,
    pendingApprovals.length,
    session?.agentBusy,
    showAgentWorking
  ]);

  async function send(message: string) {
    const content = message.trim();
    if (!content || session === null || sendingRef.current) return;
    sendingRef.current = true;
    session.clearError();
    setSubmitError('');
    setInput('');
    setSending(true);
    try {
      if (session.agentBusy) await session.steerAgentTurn(content);
      else await session.runAgentTurn(
        content,
        permission === 'full-access' ? 'danger-full-access' : 'workspace-write'
      );
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : String(cause));
      session.clearError();
      setInput(current => current.trim().length > 0 ? current : content);
      throw cause;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function runQuickAction(action: VideoTranslationAgentQuickAction) {
    if (action.kind === 'action') {
      action.onAction?.();
      return;
    }
    if (action.prompt) void send(action.prompt).catch(() => undefined);
  }

  return (
    <aside className="video-translation-agent" aria-label="OpenCreator">
      <header className="video-translation-agent-header">
        <span aria-hidden="true"><Bot size={17} strokeWidth={1.8} /></span>
        <div>
          <h2>OpenCreator</h2>
          <p>{l('正在协助：', 'Helping with: ')}{props.stepLabel}</p>
        </div>
        {session?.agentBusy ? (
          <button
            type="button"
            onClick={() => void session.interruptAgentTurn().catch(() => undefined)}
            aria-label={l('停止 Agent 对话', 'Stop Agent conversation')}
            title={l('停止 Agent 对话', 'Stop Agent conversation')}
          >
            <CircleStop size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="video-translation-agent-context">
        <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <small>{l('当前任务', 'Current task')}</small>
          <strong>{props.currentIssue ?? props.contextSummary}</strong>
        </span>
      </div>

      {session === null ? (
        <div className="video-translation-agent-unavailable" role="alert">
          <ServerOff size={16} aria-hidden="true" />
          <p>{l('Creator Runtime 未连接，Agent 不会生成替代回复。', 'Creator Runtime is disconnected. The Agent will not generate substitute responses.')}</p>
        </div>
      ) : (
        <>
          <div
            ref={messageListRef}
            className="video-translation-agent-messages"
            role="log"
            aria-label={l('协作时间线', 'Collaboration timeline')}
            aria-live="polite"
          >
            {timelineItems.length === 0 ? (
              <div className="video-translation-agent-empty">
                <MessageSquareText size={16} strokeWidth={1.7} aria-hidden="true" />
                <span>{l('尚无协作记录', 'No collaboration activity yet')}</span>
              </div>
            ) : timelineItems.map(item => {
              if (item.kind === 'message') {
                return <CollaborationMessageView key={item.id} message={item.message} />;
              }
              if (item.kind === 'activity') {
                return <CollaborationActivityView key={item.id} event={item.event} />;
              }
              return (
                <CollaborationStageView
                  key={item.id}
                  stage={item.stage}
                  actor={item.actor}
                  onCancel={item.stage.id === activeTaskStage?.id
                    ? props.onCancelTask
                    : undefined}
                  onResume={item.stage.id === resumableTaskStage?.id
                    ? props.onResumeTask
                    : undefined}
                  controlPending={props.taskControlPending}
                />
              );
            })}

            {showAgentWorking ? (
              <div
                className="video-translation-agent-working"
                role="status"
                aria-label={l('Agent 正在工作', 'Agent is working')}
              >
                <span aria-hidden="true"><Bot size={13} strokeWidth={1.8} /></span>
                <LoaderCircle
                  className="video-translation-agent-spin"
                  size={16}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </div>
            ) : null}

            {pendingApprovals.map(approval => (
              <article className="video-translation-agent-approval" data-status={approval.status} key={approval.id}>
                <strong>{approval.title}</strong>
                <p>{approval.summary}</p>
                <div>
                  <button type="button" onClick={() => void session.respondAgentApproval(approval.id, 'approved', approval.processGeneration).catch(() => undefined)}>
                    {l('批准', 'Approve')}
                  </button>
                  <button type="button" onClick={() => void session.respondAgentApproval(approval.id, 'rejected', approval.processGeneration).catch(() => undefined)}>
                    {l('拒绝', 'Reject')}
                  </button>
                </div>
              </article>
            ))}
          </div>

          {(props.quickActions?.length ?? 0) > 0 ? (
            <div className="video-translation-agent-suggestions" aria-label={l('快捷操作', 'Quick actions')}>
              {props.quickActions!.map(action => (
                <button
                  type="button"
                  data-kind={action.kind}
                  key={action.id}
                  disabled={action.disabled}
                  onClick={() => runQuickAction(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          {submitError ? (
            <div className="video-translation-agent-submit-error" role="alert">
              <XCircle size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          ) : null}

          <ToolAgentComposer
            value={input}
            onChange={setInput}
            onSubmit={() => void send(input).catch(() => undefined)}
            showAttachments={false}
            showPermission
            showModel={false}
            permission={permission}
            permissionDisabled={session.agentBusy}
            onPermissionChange={setPermission}
            submitting={sending}
            ariaLabel={l('告诉 Agent 你的要求', 'Tell the Agent your requirements')}
            placeholder={session.agentBusy
              ? l('补充当前任务的要求', 'Add guidance to the active task')
              : props.promptHint ?? l('询问状态，或描述要调整的语言、字幕、配音和成片要求', 'Ask about status or describe language, subtitle, dubbing, and video changes')}
          />
        </>
      )}
    </aside>
  );
}

function CollaborationMessageView(props: { message: CollaborationMessage }) {
  const l = useLocalizedCopy();
  const { message } = props;
  return (
    <article
      className="video-translation-agent-message"
      data-role={message.role}
      data-source={message.source}
      data-status={message.status}
    >
      {message.role === 'assistant' ? (
        <header>
          <span aria-hidden="true"><Bot size={13} strokeWidth={1.8} /></span>
          <strong>OpenCreator</strong>
          <small>{l('Agent 回复', 'Agent reply')}</small>
        </header>
      ) : null}
      <div className="video-translation-agent-bubble">
        <MarkdownRenderer
          text={message.content}
          variant={message.role === 'user' ? 'user' : 'assistant'}
        />
      </div>
    </article>
  );
}

function CollaborationActivityView(props: { event: SyncEvent }) {
  const l = useLocalizedCopy();
  const { event } = props;
  return (
    <article className="video-translation-agent-activity" data-actor={event.actor}>
      <span aria-hidden="true"><CircleDot size={13} strokeWidth={1.8} /></span>
      <div>
        <header>
          <strong>{actorLabel(event.actor, l)}</strong>
          {event.count > 1 ? <small>{event.count} {l('次修改', 'changes')}</small> : null}
        </header>
        <p>{event.label}</p>
        {event.fields.length > 0 ? <small>{event.fields.join('、')}</small> : null}
      </div>
    </article>
  );
}

function CollaborationStageView(props: {
  stage: CreatorStageRun;
  actor: CreatorActivity['actor'];
  onCancel?(): void;
  onResume?(): void;
  controlPending?: 'canceling' | 'resuming';
}) {
  const l = useLocalizedCopy();
  const { stage, actor } = props;
  const label = stageLabel(stage.stageId, l);
  const percent = stageProgressPercent(stage);
  const hasProgress = percent !== null;
  return (
    <article className="video-translation-agent-stage" data-status={stage.status}>
      <header>
        <span aria-hidden="true">{stageStatusIcon(stage)}</span>
        <div className="video-translation-agent-stage-copy">
          <small>{actorLabel(actor, l)} · {label}</small>
          <strong>{stageProgressText(stage, l)}</strong>
        </div>
        <div className="video-translation-agent-stage-controls">
          {hasProgress ? <b>{percent}%</b> : null}
          {props.onCancel !== undefined ? (
            <button
              type="button"
              data-intent="danger"
              disabled={props.controlPending !== undefined || stage.progress.cancelRequested === true}
              onClick={props.onCancel}
              aria-label={l(`终止${label}`, `Stop ${label}`)}
              title={l('终止当前阶段', 'Stop current stage')}
            >
              <CircleStop size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : props.onResume !== undefined ? (
            <button
              type="button"
              disabled={props.controlPending !== undefined}
              onClick={props.onResume}
              aria-label={l(`继续${label}`, `Resume ${label}`)}
              title={l('从当前阶段重新开始', 'Restart from current stage')}
            >
              <Play size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      {hasProgress ? (
        <div
          className="video-translation-agent-stage-progress"
          role="progressbar"
          aria-label={l(`${label}进度`, `${label} progress`)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={stageProgressAriaText(stage, percent, l)}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </article>
  );
}

function buildCollaborationMessages(
  agentTurns: CreatorAgentTurn[],
  items: CreatorAgentItem[]
): CollaborationMessage[] {
  const assistantItemsByTurn = new Map<string, CreatorAgentItem[]>();
  for (const item of items) {
    if (item.kind !== 'assistant_message' || !item.text?.trim().length) continue;
    const visible = assistantItemsByTurn.get(item.turnId) ?? [];
    visible.push(item);
    assistantItemsByTurn.set(item.turnId, visible);
  }
  const messages: CollaborationMessage[] = [];
  for (const turn of agentTurns) {
    if (turn.role === 'user') {
      messages.push({
        id: `agent:${turn.id}`,
        role: 'user',
        content: turn.content,
        status: turn.status,
        createdAt: turn.createdAt,
        source: 'agent'
      });
      continue;
    }
    const visibleItems = assistantItemsByTurn.get(turn.id) ?? [];
    if (visibleItems.length > 0) {
      for (const item of visibleItems) {
        messages.push({
          id: `agent-item:${item.id}`,
          role: 'assistant',
          content: stripInternalRevision(item.text ?? ''),
          status: item.status,
          createdAt: item.createdAt,
          source: 'agent'
        });
      }
      continue;
    }
    messages.push({
      id: `agent:${turn.id}`,
      role: 'assistant',
      content: stripInternalRevision(turn.content),
      status: turn.status,
      createdAt: turn.createdAt,
      source: 'agent'
    });
  }
  return messages
    .filter(message => message.content.trim().length > 0)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(-40);
}

function buildCollaborationTimeline(
  job: CreatorJob | undefined,
  messages: CollaborationMessage[],
  events: SyncEvent[]
): CollaborationTimelineItem[] {
  const stages = latestStageRuns(job?.stages ?? []);
  const representedStageIds = new Set(stages.map(stage => stage.stageId));
  const items: CollaborationTimelineItem[] = messages.map(message => ({
    id: message.id,
    kind: 'message',
    createdAt: message.createdAt,
    message
  }));
  for (const event of events) {
    if (
      event.action === 'run-stage'
      && event.stageId !== undefined
      && representedStageIds.has(event.stageId)
    ) continue;
    items.push({
      id: `activity:${event.id}`,
      kind: 'activity',
      createdAt: event.createdAt,
      event
    });
  }
  for (const stage of stages) {
    items.push({
      id: `stage:${stage.stageId}`,
      kind: 'stage',
      createdAt: stage.startedAt ?? job?.updatedAt ?? '',
      stage,
      actor: stageActor(stage, job?.activities ?? [])
    });
  }
  return items
    .sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt)
      || timelineItemOrder(left) - timelineItemOrder(right)
      || left.id.localeCompare(right.id)
    ))
    .slice(-60);
}

function timelineItemOrder(item: CollaborationTimelineItem): number {
  if (item.kind === 'message') return item.message.role === 'user' ? 0 : 3;
  if (item.kind === 'activity') return 1;
  return 2;
}

function buildSyncEvents(
  activities: CreatorActivity[],
  l: ReturnType<typeof useLocalizedCopy>
): SyncEvent[] {
  const result: SyncEvent[] = [];
  for (const activity of activities) {
    const normalized = normalizeActivity(activity, l);
    if (normalized === null) continue;
    const previous = result.at(-1);
    if (
      previous !== undefined
      && previous.actor === activity.actor
      && previous.label === normalized.label
      && previous.action.startsWith('update-settings')
      && activity.action.startsWith('update-settings')
    ) {
      previous.id = activity.id;
      previous.count += 1;
      previous.fields = [...new Set([...previous.fields, ...normalized.fields])];
      previous.createdAt = activity.createdAt;
      continue;
    }
    result.push({
      id: activity.id,
      actor: activity.actor,
      action: activity.action,
      label: normalized.label,
      fields: normalized.fields,
      count: 1,
      createdAt: activity.createdAt,
      ...(activity.action === 'run-stage'
        ? { stageId: stageIdFromActivity(activity) ?? undefined }
        : {})
    });
  }
  return result;
}

function normalizeActivity(
  activity: CreatorActivity,
  l: ReturnType<typeof useLocalizedCopy>
): { label: string; fields: string[] } | null {
  if (activity.action === 'create-job') return null;
  if (activity.action.startsWith('update-settings')) {
    const objectId = typeof activity.details.objectId === 'string'
      ? activity.details.objectId
      : '';
    const fields = objectId
      .split(',')
      .map(field => creativeFieldLabel(field, l))
      .filter((field): field is string => field !== null);
    if (fields.length === 0) return null;
    return { label: l('更新了创作设置', 'Updated creative settings'), fields };
  }
  if (activity.action === 'edit-subtitle') {
    return { label: l('保存了字幕修改', 'Saved subtitle changes'), fields: [] };
  }
  if (activity.action === 'run-stage') {
    const stageId = stageIdFromActivity(activity);
    if (stageId === 'subtitle') {
      return { label: l('开始生成字幕', 'Started subtitle generation'), fields: [] };
    }
    if (stageId === 'tts') {
      return { label: l('开始生成配音', 'Started dubbing generation'), fields: [] };
    }
    if (stageId === 'render-horizontal') {
      return { label: l('开始生成横屏成片', 'Started landscape rendering'), fields: [] };
    }
    if (stageId === 'render-vertical') {
      return { label: l('开始生成竖屏成片', 'Started portrait rendering'), fields: [] };
    }
    return { label: activity.summary, fields: [] };
  }
  if (activity.action === 'undo-action') {
    return { label: l('撤销了上一次修改', 'Undid the previous change'), fields: [] };
  }
  if (activity.actor === 'system' && activity.summary.trim().length > 0) {
    return { label: activity.summary, fields: [] };
  }
  return null;
}

function creativeFieldLabel(
  field: string,
  l: ReturnType<typeof useLocalizedCopy>
): string | null {
  const labels: Record<string, string> = {
    sourceLanguage: l('源语言', 'Source language'),
    targetLanguage: l('目标语言', 'Target language'),
    bilingual: l('双语字幕', 'Bilingual subtitles'),
    subtitlePosition: l('字幕位置', 'Subtitle position'),
    subtitleStyle: l('字幕样式', 'Subtitle style'),
    preferPlatformCaptions: l('平台字幕优先', 'Prefer platform captions'),
    dubbing: l('配音', 'Dubbing'),
    voiceCode: l('音色', 'Voice'),
    composeVideo: l('成片输出', 'Video output'),
    videoFormat: l('成片比例', 'Video format'),
    verticalTitle: l('竖屏标题', 'Portrait title'),
    verticalSubtitle: l('竖屏字幕', 'Portrait subtitles'),
    voiceSampleName: l('声音样本', 'Voice sample'),
    subtitleCues: l('字幕内容', 'Subtitle content')
  };
  return labels[field] ?? null;
}

function actorLabel(
  actor: CreatorActivity['actor'],
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (actor === 'agent') return 'Agent';
  if (actor === 'system') return l('系统', 'System');
  return l('工作台', 'Workbench');
}

function stageIdFromActivity(activity: CreatorActivity): string | null {
  if (activity.summary.includes('render-horizontal')) return 'render-horizontal';
  if (activity.summary.includes('render-vertical')) return 'render-vertical';
  if (activity.summary.includes('subtitle')) return 'subtitle';
  if (activity.summary.includes('tts')) return 'tts';
  return null;
}

function latestStageRuns(stages: CreatorStageRun[]): CreatorStageRun[] {
  const latestByStage = new Map<string, CreatorStageRun>();
  for (const stage of stages) {
    latestByStage.set(stage.stageId, stage);
  }
  return [...latestByStage.values()].sort((left, right) => (
    (left.startedAt ?? '').localeCompare(right.startedAt ?? '')
    || left.stageId.localeCompare(right.stageId)
  ));
}

function stageActor(
  stage: CreatorStageRun,
  activities: CreatorActivity[]
): CreatorActivity['actor'] {
  const startedAt = stage.startedAt ?? '\uffff';
  return activities
    .filter(activity => (
      activity.action === 'run-stage'
      && stageIdFromActivity(activity) === stage.stageId
      && activity.createdAt <= startedAt
    ))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1)?.actor ?? 'system';
}

function stageLabel(
  stageId: string,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (stageId === 'subtitle') return l('字幕翻译', 'Subtitle translation');
  if (stageId === 'tts') return l('配音生成', 'Dubbing');
  if (stageId === 'render-horizontal') return l('横屏成片', 'Landscape render');
  if (stageId === 'render-vertical') return l('竖屏成片', 'Portrait render');
  return l('创作任务', 'Creator task');
}

function stageProgressText(
  stage: CreatorStageRun,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (stage.progress.cancelRequested === true && (
    stage.status === 'queued' || stage.status === 'running'
  )) return l('正在终止当前阶段', 'Stopping current stage');
  if (stage.status === 'queued') return l('等待执行', 'Queued');
  if (stage.status === 'succeeded') return l('已完成，结果已同步到工作台', 'Completed and synced to Workbench');
  if (stage.status === 'failed') return stage.errorMessage ?? l('执行失败', 'Failed');
  if (stage.status === 'interrupted') return l('已中断，可继续', 'Interrupted. Ready to resume');
  if (stage.status === 'canceled') return l('已终止，可继续', 'Stopped. Ready to resume');
  const payload = stageProgressPayload(stage);
  if (typeof payload?.message === 'string' && payload.message.trim().length > 0) {
    return payload.message.trim();
  }
  const phase = typeof stage.progress.phase === 'string'
    ? stage.progress.phase
    : typeof payload?.phase === 'string'
      ? payload.phase
      : null;
  const phaseLabels: Record<string, string> = {
    validating: l('检查任务设置', 'Checking task settings'),
    preparing_source: l('准备视频来源', 'Preparing the video source'),
    reading_platform_captions: l('获取平台字幕', 'Fetching platform captions'),
    processing_platform_captions: l('解析平台字幕', 'Processing platform captions'),
    translating_subtitles: l('翻译字幕', 'Translating subtitles'),
    collecting_subtitles: l('生成双语字幕', 'Generating bilingual subtitles'),
    preparing_original_media: l('准备原始视频', 'Preparing the original video'),
    preparing_audio: l('准备音频转录', 'Preparing audio transcription'),
    transcribing_audio: l('转录并翻译音频', 'Transcribing and translating audio'),
    collecting_outputs: l('整理输出文件', 'Collecting outputs'),
    generating_voice: l('生成配音', 'Generating dubbing'),
    rendering_video: l('渲染视频', 'Rendering video')
  };
  return phase === null
    ? l('执行中', 'Running')
    : phaseLabels[phase] ?? phase;
}

function stageProgressPercent(stage: CreatorStageRun): number | null {
  const payload = stageProgressPayload(stage);
  const value = typeof stage.progress.percent === 'number'
    ? stage.progress.percent
    : typeof payload?.percent === 'number'
      ? payload.percent
      : null;
  return value === null || !Number.isFinite(value)
    ? null
    : Math.max(0, Math.min(100, Math.round(value)));
}

function stageProgressAriaText(
  stage: CreatorStageRun,
  percent: number,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (stage.status === 'failed') return l(`失败前进度 ${percent}%`, `Progress before failure: ${percent}%`);
  if (stage.status === 'succeeded') return l(`已完成 ${percent}%`, `Completed: ${percent}%`);
  if (stage.status === 'canceled' || stage.status === 'interrupted') {
    return l(`终止前进度 ${percent}%`, `Progress before stopping: ${percent}%`);
  }
  return `${percent}%`;
}

function stageProgressPayload(stage: CreatorStageRun): Record<string, unknown> | null {
  const payload = stage.progress.krillinEventPayload;
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
}

function stageStatusIcon(stage: CreatorStageRun) {
  if (stage.status === 'failed') return <XCircle size={15} strokeWidth={1.8} />;
  if (stage.status === 'running' || stage.status === 'queued') {
    return <LoaderCircle className="video-translation-agent-spin" size={15} strokeWidth={1.8} />;
  }
  if (stage.status === 'canceled' || stage.status === 'interrupted') {
    return <CircleStop size={14} strokeWidth={1.8} />;
  }
  return <CheckCircle2 size={15} strokeWidth={1.8} />;
}

function stripInternalRevision(content: string): string {
  return content
    .replace(/[^\n。！？!?]*\brevision\b[^\n。！？!?]*[。！？!?]?/gi, '')
    .replace(/^\s*[-*]\s*(?:当前\s*)?revision\s*[：:]\s*`?\d+`?\s*$/gim, '')
    .replace(/(?:任务未做修改[，,]\s*)?revision\s+仍为\s*`?\d+`?[。.]?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
