import type {
  DiagnosticFileResponse,
  ScheduleRunTrace
} from '@opencreator/protocol';
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
  schedules?: {
    getRunTrace(runId: string): ScheduleRunTrace | undefined;
  };
  runId: string;
  includeRawRedacted?: boolean;
};

export type CollectRunDiagnosticsResult = {
  runId: string;
  files: DiagnosticFileResponse[];
  warnings: string[];
  scheduleTrace?: ScheduleRunTrace;
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
  const { dataDir, runs, schedules, runId, includeRawRedacted = false } = input;
  if (!runIdPattern.test(runId)) {
    throw new DiagnosticsError('VALIDATION_FAILED', 'run id is invalid');
  }

  if (!runs.getRun(runId)) {
    throw new DiagnosticsError('RUN_NOT_FOUND', 'Run not found');
  }

  const warnings = [DIAGNOSTICS_REDACTION_WARNING];
  const scheduleTrace = schedules?.getRunTrace(runId);
  const runsDir = resolve(dataDir, 'runs');
  const runDir = resolve(runsDir, runId);
  if (!isPathInside(runsDir, runDir)) {
    warnings.push('Run diagnostics directory was skipped because it is unsafe.');
    return buildResult(runId, [], warnings, scheduleTrace);
  }

  let realRunDir: string;
  try {
    const runsDirStat = lstatSync(runsDir);
    if (!runsDirStat.isDirectory() || runsDirStat.isSymbolicLink()) {
      warnings.push('Run diagnostics root was skipped because it is unsafe.');
      return buildResult(runId, [], warnings, scheduleTrace);
    }

    const runDirStat = lstatSync(runDir);
    if (!runDirStat.isDirectory() || runDirStat.isSymbolicLink()) {
      warnings.push('Run diagnostics directory was skipped because it is unsafe.');
      return buildResult(runId, [], warnings, scheduleTrace);
    }

    const realRunsDir = realpathSync(runsDir);
    realRunDir = realpathSync(runDir);
    if (!isPathInside(realRunsDir, realRunDir)) {
      warnings.push('Run diagnostics directory was skipped because it is unsafe.');
      return buildResult(runId, [], warnings, scheduleTrace);
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      warnings.push('Run diagnostics directory is missing.');
      return buildResult(runId, [], warnings, scheduleTrace);
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

      files.push({ name, content: readFileSync(realFilePath, 'utf8') });
    } catch (error) {
      if (isMissingPathError(error)) {
        warnings.push(`Diagnostic file ${name} is missing.`);
        continue;
      }
      throw error;
    }
  }

  appendLogWriterWarnings(files, warnings);
  return buildResult(
    runId,
    redactDiagnosticFiles(files),
    warnings,
    scheduleTrace
  );
}

function buildResult(
  runId: string,
  files: DiagnosticFileResponse[],
  warnings: string[],
  scheduleTrace: ScheduleRunTrace | undefined
): CollectRunDiagnosticsResult {
  return scheduleTrace === undefined
    ? { runId, files, warnings }
    : { runId, files, warnings, scheduleTrace };
}

function appendLogWriterWarnings(
  files: DiagnosticFileResponse[],
  warnings: string[]
): void {
  const diagnostics = files.find(file => file.name === 'diagnostics.json');
  if (diagnostics === undefined) return;

  try {
    const parsed = JSON.parse(diagnostics.content) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.logWriter)) return;
    const failureCount = parsed.logWriter.failureCount;
    if (typeof failureCount === 'number' && failureCount > 0) {
      warnings.push(`Run log writer recorded ${failureCount} failed writes.`);
    }
    const backpressureRejects = parsed.logWriter.backpressureRejects;
    if (typeof backpressureRejects === 'number' && backpressureRejects > 0) {
      warnings.push(
        `Run log writer rejected ${backpressureRejects} writes because the queue limit was exceeded.`
      );
    }
  } catch {
    // The diagnostics file remains available to the caller even when it is not valid JSON.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.includes(`..${sep}`));
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
