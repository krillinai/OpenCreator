import {
  createDefaultCreatorServicesConfig,
  type CreatorJson,
  type CreatorServicesConfig
} from '@opencreator/protocol';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCoverWorkflow } from '../../src/creator/templates/cover-actions.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('cover workflow', () => {
  it('checks only image configuration for prompt-only generation', async () => {
    const fixture = setup({ prompt: 'A clear product thumbnail' });
    fixture.config.image.openai.apiKey = 'image-key';

    await expect(fixture.workflow.validateStage(
      fixture.service.getJob(fixture.jobId)!,
      'generate'
    )).resolves.toBeUndefined();
    expect(fixture.readConfig).toHaveBeenCalledTimes(1);
    fixture.db.close();
  });

  it('requires the text model only when YouTube analysis is used', async () => {
    const fixture = setup({
      sourceType: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=cover-test'
    });

    await expect(fixture.workflow.validateStage(
      fixture.service.getJob(fixture.jobId)!,
      'analyze-source'
    )).rejects.toMatchObject({ code: 'creator_llm_config_missing' });
    expect(fixture.service.getJob(fixture.jobId)).toMatchObject({
      status: 'needs_input',
      state: {
        needsInput: {
          code: 'creator_llm_config_missing',
          resumeStageId: 'analyze-source',
          deepLink: '#/settings?tab=ai-services&section=text'
        }
      }
    });
    fixture.db.close();
  });

  it('starts the requested stage after missing image configuration is saved', async () => {
    const fixture = setup({ prompt: 'A clear product thumbnail' });
    await expect(fixture.workflow.validateStage(
      fixture.service.getJob(fixture.jobId)!,
      'generate'
    )).rejects.toMatchObject({ code: 'creator_image_config_missing' });

    fixture.config.image.openai.apiKey = 'image-key';
    await fixture.workflow.resumeConfiguredJobs();

    expect(fixture.service.getJob(fixture.jobId)).toMatchObject({
      status: 'running',
      state: { currentStage: 'generate' },
      stages: [{
        stageId: 'generate',
        status: 'queued',
        progress: { workflow: true }
      }]
    });
    fixture.db.close();
  });

  it('continues from successful YouTube analysis exactly once', async () => {
    const fixture = setup({
      sourceType: 'youtube',
      sourceUrl: 'https://youtu.be/cover-workflow',
      prompt: 'Keep the presenter as the main subject'
    });
    fixture.config.llm.apiKey = 'llm-key';
    fixture.config.image.openai.apiKey = 'image-key';
    const analysisId = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'start-cover-analysis',
      input: { stageId: 'analyze-source', workflow: true }
    }, 'user').commandReceipt.stageRunId!;
    fixture.repository.updateStageRun({ id: analysisId, status: 'succeeded' });
    const completed = fixture.repository.getStageRun(analysisId)!;

    await fixture.workflow.handleStageChanged(completed);
    await fixture.workflow.handleStageChanged(completed);

    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId))
      .toEqual(['analyze-source', 'generate']);
    fixture.db.close();
  });

  it('rejects reference images for providers without edit capability', async () => {
    const fixture = setup({
      prompt: 'A clear product thumbnail',
      provider: 'jimeng'
    });
    fixture.config.image.jimeng.apiKey = 'jimeng-key';
    const reference = fixture.repository.insertArtifact({
      jobId: fixture.jobId,
      kind: 'reference_image',
      status: 'completed',
      path: join(tempDir, 'reference.png'),
      sourceArtifactIds: [],
      metadata: {}
    });
    fixture.service.applyAction(fixture.jobId, {
      action: 'update-settings',
      expectedRevision: 0,
      input: { patch: { referenceImageArtifactId: reference.id } }
    });

    await expect(fixture.workflow.validateStage(
      fixture.service.getJob(fixture.jobId)!,
      'generate'
    )).rejects.toMatchObject({ code: 'unsupported_capability' });
    fixture.db.close();
  });
});

function setup(state: Record<string, CreatorJson>) {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-cover-workflow-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const service = createCreatorService({
    repository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  const job = service.createJob({
    projectId: 'project-cover-workflow',
    templateId: 'cover',
    state
  });
  const dispatcher = createCreatorCommandDispatcher({
    service,
    repository,
    receipts: createCreatorAgentRepository(db)
  });
  const config = createDefaultCreatorServicesConfig();
  const readConfig = vi.fn(async (): Promise<CreatorServicesConfig> => config);
  const workflow = createCoverWorkflow({
    creator: service,
    dispatcher,
    configStore: { read: readConfig }
  });
  return {
    db,
    repository,
    service,
    dispatcher,
    config,
    readConfig,
    workflow,
    jobId: job.id
  };
}
