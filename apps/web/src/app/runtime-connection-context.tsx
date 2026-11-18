import { createContext, useContext, type ReactNode } from 'react';
import { RefreshCw, RotateCcw, ServerOff } from 'lucide-react';
import { useLocalizedCopy } from '../i18n/useLocalizedCopy.js';
import { shouldShowRuntimeRecovery } from '../runtime/runtime-recovery.js';
import type { RuntimeRecovery } from '../runtime/use-runtime-connection.js';

export type RuntimeConnectionNoticeState = Pick<RuntimeRecovery, 'phase' | 'attempt'> & {
  status: 'connected' | 'disconnected' | 'invalid_token';
  waitingForConfig: boolean;
  restartError?: string;
  retry(): void;
  restart?(): void;
};

const RuntimeConnectionContext = createContext<RuntimeConnectionNoticeState | null>(null);

export function RuntimeConnectionProvider(props: {
  value: RuntimeConnectionNoticeState;
  children: ReactNode;
}) {
  return (
    <RuntimeConnectionContext.Provider value={props.value}>
      {props.children}
    </RuntimeConnectionContext.Provider>
  );
}

export function RuntimeConnectionNotice() {
  const state = useContext(RuntimeConnectionContext);
  const l = useLocalizedCopy();
  if (state === null || state.status === 'connected' || !shouldShowRuntimeRecovery(state)) return null;
  const restarting = state.phase === 'restarting';

  return (
    <div className="runtime-connection-notice" role="status" aria-live="polite">
      <ServerOff size={16} aria-hidden="true" />
      <span>{state.status === 'invalid_token'
        ? l('本地服务授权失效，请检查连接配置。', 'Local Runtime authorization failed. Check the connection settings.')
        : state.waitingForConfig
          ? l('正在恢复本地运行服务连接。当前内容会保留。', 'Reconnecting to the local Runtime. Your current work is preserved.')
          : l('本地运行服务连接中断，正在重试。当前内容会保留。', 'Local Runtime connection lost. Retrying without discarding your work.')}</span>
      <button type="button" onClick={state.retry} title={l('重试连接', 'Retry connection')}>
        <RefreshCw size={14} aria-hidden="true" />
        {l('重试连接', 'Retry connection')}
      </button>
      {state.restart === undefined ? null : (
        <button
          type="button"
          onClick={state.restart}
          disabled={restarting}
          title={l('重启本地服务', 'Restart local Runtime')}
        >
          <RotateCcw size={14} aria-hidden="true" />
          {restarting
            ? l('正在重启', 'Restarting')
            : l('重启本地服务', 'Restart local Runtime')}
        </button>
      )}
      {state.restartError === undefined ? null : <span role="alert">{state.restartError}</span>}
    </div>
  );
}
