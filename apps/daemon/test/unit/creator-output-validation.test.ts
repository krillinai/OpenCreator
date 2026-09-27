import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createCreatorIssueService } from '../../src/creator/issues.js';
import {
  validateCreatorStageOutputs,
  validateTranslationOutputLanguage
} from '../../src/creator/output-validation.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator output validation', () => {
  it('rejects unchanged English for a Chinese target and accepts Chinese mixed with proper nouns', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-output-validation-'));
    const english = subtitle('OpenCreator keeps the original English subtitle unchanged.');
    const chinese = subtitle('OpenCreator 可以保留 YouTube 等专有名词，同时输出正确的中文翻译。');
    const shortChinese = subtitle('你好 OpenAI');

    await expect(validate(english)).resolves.toMatchObject([{
      code: 'creator_translation_output_language_mismatch',
      severity: 'blocking'
    }]);
    await expect(validate(chinese)).resolves.toEqual([]);
    await expect(validate(shortChinese)).resolves.toEqual([]);
  });

  it('rejects empty unreadable and non-file completed outputs before template validation', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-output-files-'));
    const emptyPath = join(tempDir, 'empty.mp4');
    const directoryPath = join(tempDir, 'directory-output');
    writeFileSync(emptyPath, '');
    mkdirSync(directoryPath);

    const findings = await validateCreatorStageOutputs({
      job: { state: {} } as never,
      stage: { outputValidators: [] } as never,
      stageRun: {} as never,
      inputArtifacts: [],
      candidateOutputs: [
        { kind: 'empty_video', status: 'completed', path: emptyPath },
        { kind: 'missing_video', status: 'completed', path: join(tempDir, 'missing.mp4') },
        { kind: 'directory_video', status: 'completed', path: directoryPath },
        { kind: 'remote_reference', status: 'completed', path: null }
      ]
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'creator_output_file_empty' }),
      expect.objectContaining({ code: 'creator_output_file_unreadable' })
    ]));
    expect(findings).toHaveLength(3);
  });

  it('blocks invalid English output before artifact commit and resolves the same issue after a valid retry', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-output-runner-'));
    const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
    const repository = createCreatorRepository(db);
    const templates = createDefaultCreatorTemplateRegistry();
    const service = createCreatorService({ repository, templates });
    const issueService = createCreatorIssueService(repository);
    const job = service.createJob({
      projectId: 'project-output-validation',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=output-validation',
        sourceLanguage: 'en',
        targetLanguage: 'zh_cn'
      }
    });
    const dispatcher = createCreatorCommandDispatcher({
      service,
      repository,
      receipts: createCreatorAgentRepository(db)
    });
    let outputText = 'This remains the original English subtitle and must not be accepted.';
    const outputPath = join(tempDir, 'target.srt');
    const runner = createCreatorStageRunner({
      repository,
      templates,
      issueService,
      executors: [{
        id: 'krillinai',
        async run() {
          writeFileSync(outputPath, srt(outputText));
          return {
            outputs: [{ kind: 'target_subtitle', status: 'completed' as const, path: outputPath }]
          };
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const first = dispatcher.dispatch(job.id, {
      action: 'run-stage',
      expectedRevision: job.revision,
      idempotencyKey: 'invalid-output',
      input: { stageId: 'subtitle' }
    }, 'user').commandReceipt.stageRunId!;

    const failed = await runner.runStageRun(first);
    const afterFailure = service.getJob(job.id)!;
    const issue = afterFailure.issues?.find(candidate => (
      candidate.code === 'creator_translation_output_language_mismatch'
    ));
    expect(failed).toMatchObject({
      status: 'failed',
      dispatchStatus: 'finished',
      errorCode: 'creator_translation_output_language_mismatch'
    });
    expect(afterFailure.status).toBe('needs_input');
    expect(afterFailure.artifacts).toHaveLength(0);
    expect(afterFailure.state).not.toHaveProperty('resultSnapshots');
    expect(issue).toMatchObject({ status: 'open', source: 'output-validator' });

    outputText = '这是正确的中文翻译，同时保留 OpenCreator 这个专有名词。';
    const beforeRetry = service.getJob(job.id)!;
    const second = dispatcher.dispatch(job.id, {
      action: 'run-stage',
      expectedRevision: beforeRetry.revision,
      idempotencyKey: 'valid-output',
      input: { stageId: 'subtitle' }
    }, 'user').commandReceipt.stageRunId!;
    issueService.beginResolution({
      jobId: job.id,
      issueId: issue!.id,
      resolutionAttemptId: second,
      associationKind: 'stage-run',
      associationId: second,
      stageRunId: second
    });

    const succeeded = await runner.runStageRun(second);
    const afterRetry = service.getJob(job.id)!;
    expect(succeeded.status).toBe('succeeded');
    expect(afterRetry.artifacts).toHaveLength(1);
    expect(afterRetry.issues?.find(candidate => candidate.id === issue!.id)?.status).toBe('resolved');
    await runner.close();
    db.close();
  });
});

async function validate(text: string) {
  const targetPath = join(tempDir, `${Math.random().toString(16).slice(2)}.srt`);
  writeFileSync(targetPath, text);
  return validateTranslationOutputLanguage({
    job: { state: { sourceLanguage: 'en', targetLanguage: 'zh_cn' } } as never,
    stage: {} as never,
    stageRun: {} as never,
    inputArtifacts: [],
    candidateOutputs: [{ kind: 'target_subtitle', status: 'completed', path: targetPath }]
  });
}

function subtitle(text: string): string {
  return srt(text);
}

function srt(text: string): string {
  return `1\n00:00:00,000 --> 00:00:02,000\n${text}\n`;
}
