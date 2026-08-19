import type {
  CodexAvailabilityProbe,
  CodexStatusResponse
} from '@opencreator/protocol';
import { AlertTriangle, CheckCircle2, HardDrive, SquareTerminal } from 'lucide-react';

export type DiagnosticsSettingsViewProps = {
  connected: boolean;
  runtimeVersion?: string;
  codexStatus?: CodexStatusResponse;
};

export function DiagnosticsSettingsView(props: DiagnosticsSettingsViewProps) {
  const status = props.codexStatus;
  const diagnostics = status?.diagnostics ?? [];

  return (
    <section className="settings-section settings-management diagnostics-settings" aria-labelledby="settings-diagnostics-title">
      <header className="settings-management__header">
        <div>
          <h1 id="settings-diagnostics-title">诊断</h1>
          <p>查看本地 Runtime、Codex 路径、能力矩阵和当前告警。</p>
        </div>
      </header>

      {!props.connected ? (
        <p className="settings-notice">本地服务未连接，诊断状态可能已过期。</p>
      ) : null}

      <div className="diagnostics-overview">
        <section>
          <SquareTerminal aria-hidden="true" size={18} />
          <span>Runtime</span>
          <strong>{props.connected ? '已连接' : '等待连接'}</strong>
          <small>{props.runtimeVersion ?? '版本未知'}</small>
        </section>
        <section>
          <HardDrive aria-hidden="true" size={18} />
          <span>Codex Home</span>
          <strong>{status?.codexHomeWritable ? '可写' : status ? '只读' : '等待连接'}</strong>
          <small>{status?.codexHomeMode ?? '未知模式'}</small>
        </section>
      </div>

      <section className="diagnostics-block" aria-labelledby="diagnostics-runtime-title">
        <h2 id="diagnostics-runtime-title">版本与运行目录</h2>
        <dl>
          <dt>Runtime 版本</dt>
          <dd>{props.runtimeVersion ?? '未知'}</dd>
          <dt>Codex CLI 版本</dt>
          <dd>{status?.codexVersion ?? '未知'}</dd>
          <dt>Codex CLI 路径</dt>
          <dd><code>{status?.codexBin ?? '未连接'}</code></dd>
          <dt>CODEX_HOME</dt>
          <dd><code>{status?.codexHome ?? '未连接'}</code></dd>
          <dt>配置来源</dt>
          <dd>{status ? `${status.codexHomeMode} · ${status.codexHomeSource}` : '未知'}</dd>
          <dt>后台可用性验证</dt>
          <dd>{availabilityProbeLabel(status?.availabilityProbe?.status)}</dd>
        </dl>
      </section>

      <section className="diagnostics-block" aria-labelledby="diagnostics-capabilities-title">
        <h2 id="diagnostics-capabilities-title">Capabilities</h2>
        <pre>{stringify(status?.capabilities ?? {})}</pre>
      </section>

      <section className="diagnostics-block" aria-labelledby="diagnostics-warnings-title">
        <h2 id="diagnostics-warnings-title">日志告警</h2>
        {diagnostics.length === 0 ? (
          <div className="diagnostics-empty">
            <CheckCircle2 aria-hidden="true" size={17} />
            当前没有诊断告警
          </div>
        ) : (
          <ul className="diagnostics-warning-list">
            {diagnostics.map(diagnostic => (
              <li key={diagnostic}>
                <AlertTriangle aria-hidden="true" size={16} />
                <span>{diagnostic}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return '[无法序列化 Capabilities]';
  }
}

function availabilityProbeLabel(
  status: CodexAvailabilityProbe['status'] | undefined
): string {
  switch (status) {
    case 'pending':
      return '检查中';
    case 'succeeded':
      return '可正常调用';
    case 'failed':
      return '调用失败，请查看告警';
    case 'skipped':
      return '本次已跳过';
    default:
      return '未知';
  }
}
