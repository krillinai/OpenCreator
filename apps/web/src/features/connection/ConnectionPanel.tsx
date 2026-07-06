import type { CodexStatusResponse } from '@clawee/protocol';
import { useEffect, useState } from 'react';
import type { ConnectionConfig } from '../../runtime/types.js';

export function ConnectionPanel(props: {
  status: 'connected' | 'disconnected' | 'invalid_token';
  codexStatus?: CodexStatusResponse;
  initialConfig?: ConnectionConfig | null;
  message?: string;
  onConnect?(config: ConnectionConfig): void;
}) {
  const text =
    props.status === 'connected'
      ? `已连接 ${props.codexStatus?.codexVersion ?? 'unknown'}`
      : props.status === 'invalid_token'
        ? 'Token 无效'
        : '未连接 Runtime';
  const [baseUrl, setBaseUrl] = useState(props.initialConfig?.baseUrl ?? '');
  const [token, setToken] = useState(props.initialConfig?.token ?? '');

  useEffect(() => {
    setBaseUrl(props.initialConfig?.baseUrl ?? '');
    setToken(props.initialConfig?.token ?? '');
  }, [props.initialConfig?.baseUrl, props.initialConfig?.token]);

  return (
    <div className="connection-panel" aria-label="Runtime 连接状态">
      <div className="panel-header">
        <span>{text}</span>
      </div>
      <form
        className="connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedBaseUrl = baseUrl.trim();
          const trimmedToken = token.trim();
          if (trimmedBaseUrl.length === 0 || trimmedToken.length === 0) return;
          props.onConnect?.({ baseUrl: trimmedBaseUrl, token: trimmedToken });
        }}
      >
        <label>
          <span>Runtime 地址</span>
          <input
            aria-label="Runtime 地址"
            value={baseUrl}
            placeholder="http://127.0.0.1:60764"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label>
          <span>Runtime Token</span>
          <input
            aria-label="Runtime Token"
            type="password"
            value={token}
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {props.message ? <p>{props.message}</p> : null}
        <button type="submit" disabled={baseUrl.trim().length === 0 || token.trim().length === 0}>
          连接 Runtime
        </button>
      </form>
    </div>
  );
}
