import type { RunDiagnosticsResponse } from '@clawee/protocol';

function stringifyDiagnosticValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return '[Unserializable value]';
  }
}

export function RunDetailPanel(props: { runId?: string; diagnostics?: RunDiagnosticsResponse }) {
  if (props.runId === undefined) {
    return (
      <div className="panel-scroll">
        <p className="empty-state">选择 run 查看详情</p>
      </div>
    );
  }

  const diagnosticFiles = props.diagnostics?.files ?? [];
  const warnings = props.diagnostics?.warnings ?? [];
  const codexStatusSnapshot = props.diagnostics?.codexStatusSnapshot;
  const codexDiagnostics = codexStatusSnapshot?.diagnostics ?? [];

  return (
    <div className="panel-scroll run-detail">
      <div className="run-detail-card">
        <h2>Run {props.runId}</h2>
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
                <li key={warning}>{warning}</li>
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
