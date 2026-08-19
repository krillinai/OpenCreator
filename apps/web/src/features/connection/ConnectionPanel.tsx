import type { CodexStatusResponse } from '@opencreator/protocol';

export function ConnectionPanel(props: {
  status: 'connected' | 'disconnected' | 'invalid_token';
  codexStatus?: CodexStatusResponse;
  message?: string;
  onRetry?(): void;
}) {
  const title =
    props.status === 'connected'
      ? `已连接 ${props.codexStatus?.codexVersion ?? 'unknown'}`
      : props.status === 'invalid_token'
        ? 'Runtime 授权未就绪'
        : '正在等待本机 Runtime';
  const message =
    props.status === 'connected'
      ? props.codexStatus?.codexHome
      : props.status === 'invalid_token'
        ? '本机 Runtime 握手失败，请重新检测。'
        : props.message !== undefined && props.message !== title
          ? props.message
          : '应用会自动接入本机 Codex Runtime，无需手动配置。';

  return (
    <div className="connection-panel" aria-label="Runtime 连接状态">
      <div className="panel-header">
        <div className="connection-status">
          <span className={`connection-status-dot ${props.status}`} aria-hidden="true" />
          <span>{title}</span>
        </div>
      </div>
      <div className="connection-summary">
        {message ? <p>{message}</p> : null}
        <button type="button" onClick={props.onRetry}>
          重新检测
        </button>
      </div>
    </div>
  );
}
