import type { RunDiagnosticsResponse } from '@clawee/protocol';

export function RunDetailPanel(props: { runId?: string; diagnostics?: RunDiagnosticsResponse }) {
  if (props.runId === undefined) {
    return (
      <div className="panel-scroll">
        <p className="empty-state">选择 run 查看详情</p>
      </div>
    );
  }

  return (
    <div className="panel-scroll">
      <h2>Run {props.runId}</h2>
      <h3>Diagnostics</h3>
      {props.diagnostics?.files.map((file) => (
        <details key={file.name}>
          <summary>{file.name}</summary>
          <pre>{file.content}</pre>
        </details>
      )) ?? <p>暂无诊断文件</p>}
    </div>
  );
}
