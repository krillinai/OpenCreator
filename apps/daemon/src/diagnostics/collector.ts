import type { DiagnosticFileResponse } from '@clawee/protocol';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  DIAGNOSTICS_REDACTION_WARNING,
  redactDiagnosticFiles
} from './redactor.js';
import type { RunRepository } from '../storage/repositories.js';

export type DiagnosticsErrorCode = 'VALIDATION_FAILED' | 'RUN_NOT_FOUND';

export class DiagnosticsError extends Error {
  constructor(
    public readonly code: DiagnosticsErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DiagnosticsError';
  }
}

export type CollectRunDiagnosticsInput = {
  dataDir: string;
  runs: Pick<RunRepository, 'getRun'>;
  runId: string;
  includeRawRedacted?: boolean;
};

export type CollectRunDiagnosticsResult = {
  runId: string;
  files: DiagnosticFileResponse[];
  warnings: string[];
};

const defaultDiagnosticFiles = [
  'meta.json',
  'events.ndjson',
  'stderr.redacted.log',
  'diagnostics.json'
];
const rawRedactedFile = 'raw.redacted.ndjson';
const runIdPattern = /^run_[A-Za-z0-9_-]+$/;

export function collectRunDiagnostics(
  input: CollectRunDiagnosticsInput
): CollectRunDiagnosticsResult {
  const { dataDir, runs, runId, includeRawRedacted = false } = input;
  if (!runIdPattern.test(runId)) {
    throw new DiagnosticsError('VALIDATION_FAILED', 'run id is invalid');
  }

  if (!runs.getRun(runId)) {
    throw new DiagnosticsError('RUN_NOT_FOUND', 'Run not found');
  }

  const warnings = [DIAGNOSTICS_REDACTION_WARNING];
  const runsDir = resolve(dataDir, 'runs');
  const runDir = resolve(runsDir, runId);
  if (!isPathInside(runsDir, runDir)) {
    warnings.push('Run diagnostics directory was skipped because it is unsafe.');
    return { runId, files: [], warnings };
  }

  let realRunDir: string;
  try {
    const runDirStat = lstatSync(runDir);
    if (!runDirStat.isDirectory() || runDirStat.isSymbolicLink()) {
      warnings.push('Run diagnostics directory was skipped because it is unsafe.');
      return { runId, files: [], warnings };
    }

    const realRunsDir = realpathSync(runsDir);
    realRunDir = realpathSync(runDir);
    if (!isPathInside(realRunsDir, realRunDir)) {
      warnings.push('Run diagnostics directory was skipped because it is unsafe.');
      return { runId, files: [], warnings };
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      warnings.push('Run diagnostics directory is missing.');
      return { runId, files: [], warnings };
    }
    throw error;
  }

  const requestedFiles = includeRawRedacted
    ? [...defaultDiagnosticFiles, rawRedactedFile]
    : defaultDiagnosticFiles;
  const files: DiagnosticFileResponse[] = [];

  for (const name of requestedFiles) {
    const filePath = resolve(runDir, name);
    try {
      const fileStat = lstatSync(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
        warnings.push(`Diagnostic file ${name} was skipped because it is unsafe.`);
        continue;
      }

      const realFilePath = realpathSync(filePath);
      if (!isPathInside(realRunDir, realFilePath)) {
        warnings.push(`Diagnostic file ${name} was skipped because it is unsafe.`);
        continue;
      }

      files.push({ name, content: readFileSync(filePath, 'utf8') });
    } catch (error) {
      if (isMissingPathError(error)) {
        warnings.push(`Diagnostic file ${name} is missing.`);
        continue;
      }
      throw error;
    }
  }

  return { runId, files: redactDiagnosticFiles(files), warnings };
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !path.includes(`..${sep}`));
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
