import type { DiagnosticFileResponse } from '@opencreator/protocol';
import { redactText, redactValue } from '../security/redaction.js';

export const DIAGNOSTICS_REDACTION_WARNING =
  'Diagnostics are redacted on a best-effort basis.';

export function redactDiagnosticContent(content: string): string {
  const secretRedacted = redactText(content);
  const parsedDocument = parseJson(secretRedacted);
  if (parsedDocument.ok) {
    const secretFieldsRedacted = redactValue(parsedDocument.value);
    const redactedDocument = redactPromptFields(secretFieldsRedacted);
    const changed =
      redactedDocument.changed ||
      JSON.stringify(secretFieldsRedacted) !== JSON.stringify(parsedDocument.value);
    return changed
      ? JSON.stringify(redactedDocument.value, null, 2)
      : secretRedacted;
  }

  return secretRedacted
    .split('\n')
    .map(line => {
      const parsedLine = parseJson(line);
      if (!parsedLine.ok) return line;
      const secretFieldsRedacted = redactValue(parsedLine.value);
      const redactedLine = redactPromptFields(secretFieldsRedacted);
      const changed =
        redactedLine.changed ||
        JSON.stringify(secretFieldsRedacted) !== JSON.stringify(parsedLine.value);
      return changed ? JSON.stringify(redactedLine.value) : line;
    })
    .join('\n');
}

export function redactDiagnosticFiles(files: DiagnosticFileResponse[]): DiagnosticFileResponse[] {
  return files.map(file => ({
    name: file.name,
    content: redactDiagnosticContent(file.content)
  }));
}

function redactPromptFields(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const redacted = value.map(entry => {
      const result = redactPromptFields(entry);
      changed ||= result.changed;
      return result.value;
    });
    return { value: changed ? redacted : value, changed };
  }
  if (!isRecord(value)) return { value, changed: false };

  let changed = false;
  const entries = Object.entries(value).map(([key, entry]) => {
    if (isPromptField(key)) {
      changed = true;
      return [key, '[REDACTED]'] as const;
    }
    const result = redactPromptFields(entry);
    changed ||= result.changed;
    return [key, result.value] as const;
  });
  return {
    value: changed ? Object.fromEntries(entries) : value,
    changed
  };
}

function isPromptField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return normalized.includes('prompt') && !normalized.includes('hash');
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
