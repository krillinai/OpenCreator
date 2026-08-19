import type {
  AttachmentResponse,
  RunContextItem,
  RunContextResponse,
  RunDiagnosticsResponse
} from '@opencreator/protocol';
import { AlertTriangle, Download, Image, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { downloadRunDiagnosticsBundle } from './run-diagnostics-export.js';

function stringifyDiagnosticValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return '[Unserializable value]';
  }
}

export function RunDetailPanel(props: {
  runId?: string;
  diagnostics?: RunDiagnosticsResponse;
  attachments?: AttachmentResponse[];
  context?: RunContextResponse;
  onExport?(diagnostics: RunDiagnosticsResponse): void | Promise<void>;
}) {
  const [confirmingExport, setConfirmingExport] = useState(false);
  const [exportError, setExportError] = useState<string>();

  if (props.runId === undefined) {
    return (
      <div className="panel-scroll">
        <p className="empty-state">选择 run 查看详情</p>
      </div>
    );
  }

  if (props.diagnostics === undefined) {
    return (
      <div className="run-detail">
        <div className="settings-state">正在加载运行详情...</div>
      </div>
    );
  }

  const diagnosticFiles = props.diagnostics?.files ?? [];
  const warnings = props.diagnostics?.warnings ?? [];
  const codexStatusSnapshot = props.diagnostics?.codexStatusSnapshot;
  const codexDiagnostics = codexStatusSnapshot?.diagnostics ?? [];

  async function exportDiagnostics() {
    if (props.diagnostics === undefined) return;
    setExportError(undefined);
    try {
      await (props.onExport ?? downloadRunDiagnosticsBundle)(props.diagnostics);
      setConfirmingExport(false);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : '诊断包导出失败');
    }
  }

  return (
    <div className="run-detail">
      <div className="run-detail-card">
        <header className="run-detail__header">
          <div>
            <h2>Run {props.runId}</h2>
            <p>诊断文件由 daemon 脱敏后返回。</p>
          </div>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => setConfirmingExport(true)}
          >
            <Download aria-hidden="true" size={15} />
            <span>导出脱敏诊断包</span>
          </button>
        </header>
        {exportError ? <p className="settings-error" role="alert">{exportError}</p> : null}
        {confirmingExport ? (
          <section className="run-diagnostics-confirm" role="region" aria-label="确认导出诊断">
            <ShieldCheck aria-hidden="true" size={18} />
            <div>
              <strong>确认导出 daemon 已脱敏的诊断内容</strong>
              <p>导出包只包含当前诊断响应，不包含原始 Prompt、Token 或 Secret。</p>
            </div>
            <div>
              <button className="settings-text-button" type="button" onClick={() => setConfirmingExport(false)}>
                取消
              </button>
              <button className="settings-primary-button" type="button" onClick={() => void exportDiagnostics()}>
                <Download aria-hidden="true" size={15} />
                确认导出
              </button>
            </div>
          </section>
        ) : null}
        {(props.attachments?.length ?? 0) > 0 ? (
          <section>
            <h3>附件</h3>
            <ul className="run-detail-attachments">
              {props.attachments?.map(attachment => (
                <li key={attachment.id}>
                  <Image aria-hidden="true" size={15} />
                  <span>
                    <strong>{attachment.fileName}</strong>
                    <small>{attachment.mime} · {formatAttachmentSize(attachment.size)}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="run-context">
          <h3>本次使用的上下文</h3>
          {props.context === undefined ? (
            <p>正在加载上下文...</p>
          ) : props.context.items.length === 0 ? (
            <p>本次运行未使用长期记忆或摘要</p>
          ) : (
            <ul>
              {props.context.items.map(item => (
                <RunContextListItem key={`${item.kind}:${item.sourceId}`} item={item} />
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3>Diagnostics</h3>
          {diagnosticFiles.length === 0 ? (
            <p>暂无诊断文件</p>
          ) : (
            diagnosticFiles.map((file) => (
              <details key={file.name}>
                <summary>{file.name}</summary>
                <pre>{file.content}</pre>
              </details>
            ))
          )}
        </section>
        <section>
          <h3>Warnings</h3>
          {warnings.length === 0 ? (
            <p>暂无诊断警告</p>
          ) : (
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>
                  <AlertTriangle aria-hidden="true" size={14} />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {codexStatusSnapshot ? (
          <section>
            <h3>Codex Status</h3>
            <dl>
              <dt>Version</dt>
              <dd>{codexStatusSnapshot.codexVersion}</dd>
              <dt>Binary</dt>
              <dd>{codexStatusSnapshot.codexBin}</dd>
              <dt>Home</dt>
              <dd>{codexStatusSnapshot.codexHome}</dd>
              <dt>Home writable</dt>
              <dd>{String(codexStatusSnapshot.codexHomeWritable)}</dd>
              <dt>Diagnostics</dt>
              <dd>
                {codexDiagnostics.length === 0 ? (
                  '暂无 Codex 诊断'
                ) : (
                  <ul>
                    {codexDiagnostics.map((diagnostic) => (
                      <li key={diagnostic}>{diagnostic}</li>
                    ))}
                  </ul>
                )}
              </dd>
              <dt>Capabilities</dt>
              <dd>
                <pre>{stringifyDiagnosticValue(codexStatusSnapshot.capabilities)}</pre>
              </dd>
            </dl>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function RunContextListItem(props: { item: RunContextItem }) {
  const label = props.item.kind === 'summary'
    ? `会话摘要 v${props.item.summaryVersion ?? 1}`
    : `${memoryScopeLabel(props.item.scope)}记忆`;
  return (
    <li className="run-context__item">
      <div>
        <strong>{label}</strong>
        {props.item.scopeKey ? <code>{props.item.scopeKey}</code> : null}
      </div>
      <p>{props.item.content}</p>
    </li>
  );
}

function memoryScopeLabel(scope: RunContextItem['scope']): string {
  if (scope === 'project') return '项目';
  if (scope === 'thread') return '线程';
  return '全局';
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
