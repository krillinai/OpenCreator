import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentContextBuilder } from '../../src/creator/agent/context-builder.js';
import { CreatorExecutorError } from '../../src/creator/executor.js';
import { createCreatorIssueService } from '../../src/creator/issues.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

describe('creator download error propagation', () => {
  it('puts a safe yt-dlp cause in the issue and Agent context', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'creator-download-error-'));
    const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
    const repository = createCreatorRepository(db);
    const templates = createDefaultCreatorTemplateRegistry();
    const service = createCreatorService({ repository, templates });
    const issueService = createCreatorIssueService(repository);
    const cause = 'yt-dlp proxy connection was refused. Check the proxy address and whether the proxy service is running.';
    const runner = createCreatorStageRunner({
      repository,
      templates,
      issueService,
      workRoot: join(tempDir, 'work'),
      executors: [{
        id: 'download',
        async run() {
          throw new CreatorExecutorError('network_unavailable', cause, {}, {
            kind: 'connection-refused', provider: 'yt-dlp'
          });
        }
      }]
    });

    try {
      const job = service.createJob({
        projectId: 'project-download-error',
        templateId: 'video-download',
        state: { sourceUrl: 'https://www.youtube.com/watch?v=demo' }
      });
      const stage = await runner.run(job.id, 'probe');
      const failedJob = service.getJob(job.id)!;
      const issue = failedJob.issues?.find(candidate => candidate.stageRunId === stage.id);
      const context = createAgentContextBuilder({ templates }).build(failedJob);

      expect(stage).toMatchObject({ status: 'failed', errorCode: 'network_unavailable', errorMessage: cause });
      expect(issue).toMatchObject({
        code: 'network_unavailable',
        fallbackMessage: cause,
        publicFacts: { kind: 'connection-refused', provider: 'yt-dlp' }
      });
      expect(context.stages).toEqual(expect.arrayContaining([
        expect.objectContaining({ stageId: 'probe', errorMessage: cause })
      ]));
      expect(context.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ fallbackMessage: cause })
      ]));
    } finally {
      await runner.close();
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
