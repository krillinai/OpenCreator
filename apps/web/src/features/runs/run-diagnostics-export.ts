import type { RunDiagnosticsResponse } from '@opencreator/protocol';

export function downloadRunDiagnosticsBundle(diagnostics: RunDiagnosticsResponse): void {
  const bundle = serializeRunDiagnosticsBundle(diagnostics);
  const blob = new Blob([bundle], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${safeFilename(diagnostics.runId)}-diagnostics.redacted.json`;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function serializeRunDiagnosticsBundle(
  diagnostics: RunDiagnosticsResponse
): string {
  return JSON.stringify({
    format: 'opencreator-run-diagnostics',
    version: 1,
    exportedAt: new Date().toISOString(),
    runId: diagnostics.runId,
    warnings: diagnostics.warnings,
    codexStatusSnapshot: diagnostics.codexStatusSnapshot,
    scheduleTrace: diagnostics.scheduleTrace,
    files: diagnostics.files
  }, null, 2);
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}
