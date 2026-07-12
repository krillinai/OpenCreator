import type { RunDiagnosticsResponse } from '@clawee/protocol';
import { AlertTriangle, Download, ShieldCheck } from 'lucide-react';
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
