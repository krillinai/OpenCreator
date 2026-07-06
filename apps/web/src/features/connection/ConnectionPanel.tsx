import type { CodexStatusResponse } from '@clawee/protocol';

export function ConnectionPanel(props: {
  status: 'connected' | 'disconnected' | 'invalid_token';
  codexStatus?: CodexStatusResponse;
}) {
  const text =
    props.status === 'connected'
      ? `已连接 ${props.codexStatus?.codexVersion ?? 'unknown'}`
      : props.status === 'invalid_token'
        ? 'Token 无效'
        : '未连接 Runtime';

  return (
    <div className="panel-header" aria-label="Runtime 连接状态">
      <span>{text}</span>
    </div>
  );
}
