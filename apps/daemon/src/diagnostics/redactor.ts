import type { DiagnosticFileResponse } from '@clawee/protocol';
import { redactText } from '../security/redaction.js';

export const DIAGNOSTICS_REDACTION_WARNING =
  'Diagnostics are redacted on a best-effort basis.';

export function redactDiagnosticContent(content: string): string {
  return redactText(content);
}

export function redactDiagnosticFiles(files: DiagnosticFileResponse[]): DiagnosticFileResponse[] {
  return files.map(file => ({
    name: file.name,
    content: redactDiagnosticContent(file.content)
  }));
}
