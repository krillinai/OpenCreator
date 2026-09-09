import {
  createDefaultCreatorServicesConfig,
  type CreatorJob,
  type CreatorStageRun
} from '@opencreator/protocol';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoverAnalysisExecutor } from '../../src/creator/cover/executor.js';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator cover executor', () => {
  it('passes the configured proxy to yt-dlp and reports network retries', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-cover-executor-'));
    const scriptPath = join(tempDir, 'fake-yt-dlp.mjs');
    const argsPath = join(tempDir, 'args.json');
    await writeFile(scriptPath, `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.COVER_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
process.stderr.write('WARNING: [youtube] [Errno 60] Operation timed out. Retrying (1/3)...\\n');
process.stderr.write('WARNING: [youtube] [Errno 60] Operation timed out. Retrying (2/3)...\\n');
process.stderr.write('ERROR: [youtube] Unable to download API page: [Errno 60] Operation timed out\\n');
process.exit(1);
`);
    const config = createDefaultCreatorServicesConfig();
    config.proxy = 'http://127.0.0.1:7897';
    config.llm.apiKey = 'text-key';
    const reportProgress = vi.fn();
    const executor = createCoverAnalysisExecutor({
      configStore: { read: async () => config },
      ytDlpPath: process.execPath,
      ytDlpPrefixArgs: [scriptPath],
      ytDlpEnv: { COVER_ARGS_PATH: argsPath }
    });

    await expect(executor.run(stageInput(tempDir, reportProgress)))
      .rejects.toMatchObject({ code: 'network_unavailable' });

    expect(JSON.parse(await readFile(argsPath, 'utf8'))).toEqual([
      '--proxy',
      'http://127.0.0.1:7897',
      '--dump-single-json',
      '--no-playlist',
      'https://www.youtube.com/watch?v=cover-test'
    ]);
    expect(reportProgress).toHaveBeenCalledWith({
      phase: 'reading_source',
      percent: null,
      retryAttempt: null,
      retryTotal: null
    });
    expect(reportProgress).toHaveBeenCalledWith({
      phase: 'reading_source_retry',
      percent: null,
      retryAttempt: 2,
      retryTotal: 3
    });
  });
});

function stageInput(
  workdir: string,
  reportProgress: CreatorExecutorInput['reportProgress']
): CreatorExecutorInput {
  const createdAt = '2026-09-02T00:00:00.000Z';
  const job: CreatorJob = {
    id: 'cover_job',
    projectId: 'project_1',
    templateId: 'cover',
    templateVersion: 2,
    status: 'running',
    revision: 1,
    presetOrigin: null,
    state: {
      sourceType: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=cover-test',
      prompt: ''
    },
    agentThreadId: null,
    stages: [],
    artifacts: [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
  const stageRun: CreatorStageRun = {
    id: 'cover_stage',
    jobId: job.id,
    stageId: 'analyze-source',
    executor: 'cover-analysis',
    status: 'running',
    dispatchStatus: 'claimed',
    claimOwner: 'test',
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: 'cover-analysis-test',
    progress: { workflow: true },
    errorCode: null,
    errorMessage: null,
    startedAt: createdAt,
    finishedAt: null
  };
  return {
    stageRun,
    job,
    inputArtifacts: [],
    workdir,
    signal: new AbortController().signal,
    reportProgress
  };
}
