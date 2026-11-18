import { createContext, useContext } from 'react';
import { useLocalizedCopy } from '../i18n/useLocalizedCopy.js';
import type { CreatorConnectionState } from './creator-sse.js';
import type { RuntimeRecovery } from './use-runtime-connection.js';
import './runtime-recovery.css';

export const RuntimeRecoveryContext = createContext<RuntimeRecovery | null>(null);

const visibleRecoveryAttempt = 4;

export function useRuntimeRecovery() {
  return useContext(RuntimeRecoveryContext);
}

export function shouldShowRuntimeRecovery({ phase, attempt }: Pick<RuntimeRecovery, 'phase' | 'attempt'>) {
  return phase === 'failed' || phase === 'restarting' || (phase === 'reconnecting' && attempt >= visibleRecoveryAttempt);
}

export function RuntimeRecoveryNotice(props: {
  session?: CreatorConnectionState;
  onRetrySession?: () => Promise<void>;
  blocking?: boolean;
  diagnostics?: boolean;
}) {
  const recovery = useRuntimeRecovery();
  const l = useLocalizedCopy();
  const runtimeUnavailable = recovery !== null && recovery.phase !== 'connected';
  const sessionUnavailable = props.session !== undefined && props.session.status !== 'connected';
  const showRuntimeRecovery = recovery !== null && shouldShowRuntimeRecovery(recovery);
  const showSessionRecovery = props.session?.status === 'failed'
    || (props.session?.status === 'reconnecting' && props.session.attempt >= visibleRecoveryAttempt);
  const showBlockingRecovery = props.blocking && (runtimeUnavailable || sessionUnavailable);
  if (!props.diagnostics && !showRuntimeRecovery && !showSessionRecovery && !showBlockingRecovery) return null;

  const codexError = recovery?.state.status === 'connected' ? recovery.state.codexStatusError : undefined;
  const message = runtimeUnavailable
    ? recovery.phase === 'failed'
      ? l('本地服务恢复失败，请重连或查看诊断。', 'Runtime recovery failed. Reconnect or check diagnostics.')
      : recovery.phase === 'restarting'
        ? l('正在重启本地服务…', 'Restarting the local Runtime…')
        : l('本地服务暂未连接，正在自动重连…', 'The local Runtime is unavailable. Reconnecting automatically…')
    : sessionUnavailable
      ? props.session?.status === 'failed'
        ? l('服务已连接，但项目会话恢复失败。', 'Runtime is connected, but the project session could not be restored.')
        : l('正在恢复项目会话与任务状态…', 'Restoring the project session and task status…')
      : codexError !== undefined
        ? l('本地服务已连接，Codex 状态暂时不可用，正在重新检查。', 'Runtime is connected. Codex status is temporarily unavailable and will be checked again.')
        : l('本地服务已连接。', 'The local Runtime is connected.');
  const attempt = runtimeUnavailable ? recovery?.attempt : props.session?.attempt;
  const retry = async () => {
    await recovery?.retry();
    await props.onRetrySession?.();
  };
  return (
    <section className="runtime-recovery-notice" role="status" aria-label={l('连接恢复', 'Connection recovery')}>
      <p>{message}</p>
      {runtimeUnavailable || sessionUnavailable ? <small>{l('保留当前草稿；恢复只同步状态，不会重复启动任务。', 'Your draft is retained. Recovery only synchronizes state; it does not restart tasks.')}{attempt ? ` · ${l('重试', 'Attempt')} ${attempt}` : ''}</small> : null}
      {props.diagnostics && recovery?.message ? <small>{recovery.message}</small> : null}
      {props.diagnostics && props.session?.error instanceof Error ? <small>{props.session.error.message}</small> : null}
      <div>
        {recovery !== null || props.onRetrySession !== undefined ? (
          <button type="button" disabled={recovery?.phase === 'restarting'} onClick={() => void retry().catch(() => undefined)}>
            {l('重新连接', 'Reconnect')}
          </button>
        ) : null}
        {recovery?.restart !== undefined && (runtimeUnavailable || sessionUnavailable || props.diagnostics) ? (
          <button type="button" disabled={recovery.phase === 'restarting'} onClick={() => {
            if (window.confirm(l('重启本地服务可能中断运行中的任务。草稿会保留，但任务不会自动重新提交。是否继续？', 'Restarting the Runtime may interrupt active tasks. Drafts are retained, but tasks will not be resubmitted. Continue?'))) {
              void recovery.restart!();
            }
          }}>{l('重启本地服务', 'Restart local Runtime')}</button>
        ) : null}
      </div>
    </section>
  );
}
