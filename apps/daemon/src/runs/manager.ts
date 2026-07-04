import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { buildCodexExecArgs } from '../codex/argv.js';
import { runCodexExec } from '../codex/runner.js';
import { normalizerVersion, normalizeCodexEvent } from '../events/normalizer.js';
import { parseJsonLine } from '../events/parser.js';
import { redactText } from '../security/redaction.js';
import { createRunRepository } from '../storage/repositories.js';
import type { CreatedRun, CreateRunInput } from './types.js';

export type RunManagerOptions = {
  db: Database.Database;
  dataDir: string;
  codexBin: string;
  codexHome: string;
};

export type RunManager = {
  createAndRun(input: CreateRunInput): Promise<CreatedRun>;
};

const EXEC_TIMEOUT_MS = 30_000;
const EXEC_INACTIVITY_TIMEOUT_MS = 30_000;

export function createRunManager(options: RunManagerOptions): RunManager {
  const runs = createRunRepository(options.db);
  const finishRun = options.db.prepare(`
    UPDATE runs
    SET public_status = @status,
        internal_status = @status,
        exit_code = @exitCode,
        signal = @signal,
        ended_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);

  return {
    async createAndRun(input: CreateRunInput): Promise<CreatedRun> {
      const id = `run_${nanoid(10)}`;
      const runDir = join(options.dataDir, 'runs', id);
      const canonicalCwd = resolve(input.cwd);
      const args = buildCodexExecArgs({
        profile: input.profile,
        cwd: input.cwd,
        sandbox: input.sandbox
      });

      mkdirSync(runDir, { recursive: true });
      runs.insertRun({
        id,
        publicStatus: 'queued',
        internalStatus: 'created',
        createdBy: 'api',
        threadId: input.threadId,
        profile: input.profile,
        cwd: input.cwd,
        canonicalCwd,
        workspaceMode: 'managed',
        sandbox: input.sandbox,
        codexVersion: 'unknown',
        codexBin: options.codexBin,
        codexHome: options.codexHome,
        normalizerVersion
      });

      writeJson(join(runDir, 'meta.json'), {
        id,
        args,
        cwd: input.cwd,
        profile: input.profile,
        sandbox: input.sandbox
      });

      try {
        const result = await runCodexExec({
          codexBin: options.codexBin,
          codexHome: options.codexHome,
          cwd: input.cwd,
          args,
          prompt: input.prompt,
          timeoutMs: EXEC_TIMEOUT_MS,
          inactivityTimeoutMs: EXEC_INACTIVITY_TIMEOUT_MS
        });
        const status = result.exitCode === 0 ? 'succeeded' : 'failed';
        writeRunOutputs(runDir, id, result.stdoutLines, result.stderr, {
          exitCode: result.exitCode,
          signal: result.signal
        });
        finishRun.run({ id, status, exitCode: result.exitCode, signal: result.signal });

        return { id, status };
      } catch (error) {
        writeRunOutputs(runDir, id, [], '', {
          error: error instanceof Error ? error.message : String(error)
        });
        finishRun.run({ id, status: 'failed', exitCode: null, signal: null });

        return {
          id,
          status: 'failed'
        };
      }
    }
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeRunOutputs(
  runDir: string,
  runId: string,
  stdoutLines: string[],
  stderr: string,
  diagnostics: unknown
): void {
  const redactedLines = stdoutLines.map((line) => redactText(line));
  writeFileSync(
    join(runDir, 'raw.redacted.ndjson'),
    redactedLines.join('\n') + (redactedLines.length > 0 ? '\n' : '')
  );
  writeFileSync(join(runDir, 'stderr.redacted.log'), redactText(stderr));

  const events = redactedLines.flatMap((line, index) => {
    const parsed = parseJsonLine(line);
    if (!parsed.ok) return [];
    return [normalizeCodexEvent({ runId, seq: index + 1, raw: parsed.value })];
  });
  writeFileSync(
    join(runDir, 'events.ndjson'),
    events.map((event) => JSON.stringify(event)).join('\n') + (events.length > 0 ? '\n' : '')
  );

  writeJson(join(runDir, 'diagnostics.json'), diagnostics);
}
