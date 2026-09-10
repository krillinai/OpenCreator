import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createStickmanImageExecutor } from '../../src/creator/stickman/image-executor.js';
import { stickmanShotFingerprint } from '../../src/creator/stickman/lineage.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-images-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  return { db, repository, templates, service };
}

async function acceptCandidate() {
  return {
    width: 320,
    height: 180,
    brightnessMean: 128,
    contrastStddev: 32,
    ocrStatus: 'passed' as const,
    detectedText: []
  };
}

function shotSpecValue() {
  return {
    scriptArtifactId: 'script-1',
    audioTimingArtifactId: 'audio-timing-1',
    timingSource: 'ffprobe_cumulative_tts_duration',
    shots: [
      shot('shot-01', 'segment-01', 'success one', 'static', 0),
      shot('shot-02', 'segment-02', 'fail two', 'push-in', 4),
      shot('shot-03', 'segment-03', 'success three', 'pan-left', 8)
    ]
  } as const;
}

function shot(id: string, sourceSegmentId: string, visualDescription: string, motion: 'static' | 'push-in' | 'pan-left', startSeconds: number) {
  return {
    id,
    sourceSegmentId,
    semanticAnchor: visualDescription,
    visualDescription,
    compositionAndAction: '人物在画面中央完成动作',
    keyObjects: ['人物'],
    continuityReason: '',
    motion,
    motionReason: '服务当前语义重点',
    startSeconds,
    endSeconds: startSeconds + 4,
    durationSeconds: 4
  };
}

type TestRepository = ReturnType<typeof createCreatorRepository>;

function insertImageContracts(input: {
  repository: TestRepository;
  jobId: string;
  shotSpecId: string;
  character: { id: string; sha256: string | null };
  characterAssetId: string;
  prompts: Array<{ shotId: string; visualDescription: string; prompt: string }>;
}): void {
  const stylePath = join(tempDir, `style-contract-${input.shotSpecId}.json`);
  writeFileSync(stylePath, JSON.stringify({
    contract: 'stickman-visual-profile-v2',
    ratio: '16:9',
    character: {
      assetId: input.characterAssetId,
      revision: 1,
      identity: {
        preserve: 'oversized bald circular white head, black glasses, checkered shirt',
        prohibit: 'different hair, clothing, or eyewear'
      },
      references: [{
        role: 'identity-primary',
        sha256: input.character.sha256,
        bytes: 100,
        mimeType: 'image/png'
      }]
    },
    style: {
      assetId: 'stickman.style.minimal-ink',
      revision: 1,
      rendering: {
        medium: 'black ink line art',
        surface: 'pure white background',
        linework: 'bold hand-drawn contours',
        shading: 'restrained light gray only',
        palette: 'black, white, and gray only',
        sceneDensity: 'essential objects only',
        composition: 'one full-frame narrative moment',
        characterRendering: 'preserve the selected identity'
      },
      semanticRenderingRules: {
        color: 'translate color into grayscale contrast',
        light: 'translate light into white space',
        complexEnvironment: 'retain required spatial relationships while simplifying detail'
      },
      forbiddenDirections: ['photography', '3D', 'colored cartoon'],
      references: []
    }
  }));
  const styleContract = input.repository.insertArtifact({
    jobId: input.jobId,
    kind: 'style_contract',
    status: 'completed',
    path: stylePath,
    sourceArtifactIds: [input.character.id],
    metadata: {
      contract: 'stickman-visual-profile-v2',
      characterAssetId: input.characterAssetId,
      characterRevision: 1,
      styleAssetId: 'stickman.style.minimal-ink',
      styleRevision: 1,
      styleReferenceCount: 0
    }
  });
  const promptPath = join(tempDir, `prompt-pack-${input.shotSpecId}.json`);
  writeFileSync(promptPath, JSON.stringify({
    shotSpecArtifactId: input.shotSpecId,
    characterReferenceArtifactId: input.character.id,
    styleContractArtifactId: styleContract.id,
    prompts: input.prompts
  }));
  input.repository.insertArtifact({
    jobId: input.jobId,
    kind: 'image_prompt_pack',
    status: 'completed',
    path: promptPath,
    sourceArtifactIds: [input.shotSpecId, input.character.id, styleContract.id],
    metadata: { contract: 'stickman-visual-profile-prompt-v2' }
  });
}

describe('stickman scoped images', () => {
  it('submits the selected character and previous linked shot with the current prompt contract', async () => {
    const { db, repository, templates, service } = setup();
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'stickman-video',
      state: {
        characterAsset: { assetId: 'stickman.character.tech-guy', revision: 1 },
        styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 },
        characterPrompt: '恶意覆盖角色描述',
      }
    });
    const shotSpecPath = join(tempDir, 'fixed-character-shot.json');
    writeFileSync(shotSpecPath, JSON.stringify({
      scriptArtifactId: 'script-1',
      audioTimingArtifactId: 'audio-timing-1',
      timingSource: 'ffprobe_cumulative_tts_duration',
      shots: [{
        id: 'shot-01',
        sourceSegmentId: 'segment-01',
        semanticAnchor: '讲解重点',
        visualDescription: '站在白板旁讲解',
        compositionAndAction: '人物站在白板左侧并指向图形',
        keyObjects: ['白板'],
        continuityReason: '',
        motion: 'static',
        motionReason: '保持讲解稳定',
        startSeconds: 0,
        endSeconds: 4,
        durationSeconds: 4
      }, {
        id: 'shot-02',
        sourceSegmentId: 'segment-02',
        semanticAnchor: 'continue the same scene',
        visualDescription: 'show the same object from a closer camera',
        compositionAndAction: 'move the camera closer while preserving the scene',
        keyObjects: ['same object'],
        continuityReason: 'continue the object and location established in the previous shot',
        motion: 'push-in',
        motionReason: 'focus on the recurring object',
        startSeconds: 4,
        endSeconds: 8,
        durationSeconds: 4
      }]
    }));
    repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_spec',
      status: 'completed',
      path: shotSpecPath,
      sha256: 'a'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const character = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: { r: 17, g: 17, b: 17, alpha: 0.25 }
      }
    }).png().toBuffer();
    const characterPath = join(tempDir, 'tech-guy.png');
    writeFileSync(characterPath, character);
    const characterArtifact = repository.insertArtifact({
      jobId: job.id,
      kind: 'character_reference',
      status: 'completed',
      path: characterPath,
      sha256: createHash('sha256').update(character).digest('hex'),
      sourceArtifactIds: [],
      metadata: {
        assetId: 'stickman.character.tech-guy',
        revision: 1,
        mimeType: 'image/png'
      }
    });
    insertImageContracts({
      repository,
      jobId: job.id,
      shotSpecId: service.getJob(job.id)!.artifacts.find(artifact => artifact.kind === 'shot_spec')!.id,
      character: characterArtifact,
      characterAssetId: 'stickman.character.tech-guy',
      prompts: [{
        shotId: 'shot-02',
        visualDescription: '站在白板旁讲解',
        prompt: 'compiled visual profile prompt for 站在白板旁讲解'
      }]
    });
    const previousShot = await sharp({
      create: { width: 320, height: 180, channels: 4, background: '#777777' }
    }).png().toBuffer();
    const previousShotPath = join(tempDir, 'shot-01.png');
    writeFileSync(previousShotPath, previousShot);
    const previousShotArtifact = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_image',
      status: 'completed',
      path: previousShotPath,
      sha256: createHash('sha256').update(previousShot).digest('hex'),
      sourceArtifactIds: [],
      scopeKey: 'shot-01',
      inputFingerprint: '0'.repeat(64),
      metadata: { mimeType: 'image/png' }
    });
    const stage = repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'queued',
      scopeKey: 'shot-02',
      inputFingerprint: '1'.repeat(64)
    });
    const image = await sharp({
      create: { width: 320, height: 180, channels: 4, background: '#ffffff' }
    }).png().toBuffer();
    let submittedPrompt = '';
    let submittedReferences: Buffer[] = [];
    let candidateValidations = 0;
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      executors: [createStickmanImageExecutor({
        configStore: { read: async () => createDefaultCreatorServicesConfig() },
        ledger: new CreatorProviderRequestLedger(repository),
        async validateCandidate() {
          candidateValidations += 1;
          if (candidateValidations === 1) throw new Error('visible text detected');
          return acceptCandidate();
        },
        async generate(request, _config, options) {
          submittedPrompt = request.prompt;
          submittedReferences = options?.referenceImages?.map(reference => reference.content) ?? [];
          return {
            model: 'test-image',
            contents: [{ mime: 'image/png' as const, content: image }]
          };
        }
      })]
    });

    const completed = await runner.runStageRun(stage.id);
    expect(completed.status).toBe('succeeded');
    expect(submittedPrompt).toContain('compiled visual profile prompt for 站在白板旁讲解');
    expect(submittedPrompt).not.toContain('恶意覆盖角色描述');
    expect(submittedReferences).toHaveLength(2);
    expect(createHash('sha256').update(submittedReferences[0]!).digest('hex'))
      .toBe(createHash('sha256').update(character).digest('hex'));
    expect(createHash('sha256').update(submittedReferences[1]!).digest('hex'))
      .toBe(createHash('sha256').update(previousShot).digest('hex'));
    expect(await sharp(submittedReferences[0]!).metadata()).toMatchObject({
      format: 'png',
      channels: 4,
      hasAlpha: true
    });
    expect(submittedPrompt).toContain('Regenerate from scratch');
    expect(service.getJob(job.id)!.providerRequests).toHaveLength(2);
    const imageArtifact = service.getJob(job.id)!.artifacts.find(artifact => (
      artifact.kind === 'shot_image' && artifact.scopeKey === 'shot-02'
    ));
    expect(imageArtifact?.metadata).toMatchObject({
      candidateAttempt: 2,
      candidateFailures: ['visible text detected'],
      characterReferenceSha256: createHash('sha256').update(character).digest('hex'),
      characterReferenceMime: 'image/png',
      referenceImages: [{
        role: 'character_identity',
        sha256: createHash('sha256').update(submittedReferences[0]!).digest('hex'),
        mimeType: 'image/png',
        artifactId: characterArtifact.id
      }, {
        role: 'previous_shot',
        sha256: createHash('sha256').update(submittedReferences[1]!).digest('hex'),
        mimeType: 'image/png',
        artifactId: previousShotArtifact.id
      }],
      previousShotArtifactId: previousShotArtifact.id,
      previousShotSha256: createHash('sha256').update(previousShot).digest('hex'),
      characterAssetId: 'stickman.character.tech-guy',
      styleAssetId: 'stickman.style.minimal-ink',
      referenceImagePreparation: 'original-bytes-v2',
      imagePromptContract: 'stickman-visual-profile-prompt-v2'
    });
    expect(imageArtifact?.sourceArtifactIds).toContain(previousShotArtifact.id);

    const retryStage = repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'queued',
      scopeKey: 'shot-02',
      inputFingerprint: '1'.repeat(64)
    });
    const retried = await runner.runStageRun(retryStage.id);
    expect(retried.status).toBe('succeeded');
    const candidateOneRequests = service.getJob(job.id)!.providerRequests.filter(request => (
      request.requestKey.endsWith(':candidate:1')
    ));
    expect(candidateOneRequests).toMatchObject([
      { generation: 1, status: 'succeeded' },
      { generation: 2, status: 'succeeded', resubmissionOf: candidateOneRequests[0]!.id }
    ]);
    await runner.close();
    db.close();
  });

  it('normalizes the configured provider output to the 16:9 video canvas', async () => {
    const { db, repository, templates, service } = setup();
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'stickman-video',
      state: { styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 } }
    });
    const shotSpecPath = join(tempDir, 'invalid-ratio-shot.json');
    writeFileSync(shotSpecPath, JSON.stringify({
      scriptArtifactId: 'script-1',
      audioTimingArtifactId: 'audio-timing-1',
      timingSource: 'ffprobe_cumulative_tts_duration',
      shots: [{
        id: 'shot-01',
        sourceSegmentId: 'segment-01',
        semanticAnchor: '16:9 scene',
        visualDescription: '16:9 scene',
        compositionAndAction: '人物居中',
        keyObjects: ['人物'],
        continuityReason: '',
        motion: 'static',
        motionReason: '静态说明',
        startSeconds: 0,
        endSeconds: 4,
        durationSeconds: 4
      }]
    }));
    const shotSpecArtifact = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_spec',
      status: 'completed',
      path: shotSpecPath,
      sha256: 'a'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const referencePath = join(tempDir, 'default.png');
    const reference = await sharp({
      create: { width: 100, height: 100, channels: 4, background: '#333333' }
    }).png().toBuffer();
    writeFileSync(referencePath, reference);
    const characterArtifact = repository.insertArtifact({
      jobId: job.id,
      kind: 'character_reference',
      status: 'completed',
      path: referencePath,
      sha256: createHash('sha256').update(reference).digest('hex'),
      sourceArtifactIds: [],
      metadata: { assetId: 'stickman.character.default', revision: 1, mimeType: 'image/png' }
    });
    insertImageContracts({
      repository,
      jobId: job.id,
      shotSpecId: shotSpecArtifact.id,
      character: characterArtifact,
      characterAssetId: 'stickman.character.default',
      prompts: [{ shotId: 'shot-01', visualDescription: '16:9 scene', prompt: '16:9 scene' }]
    });
    const stage = repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'queued',
      scopeKey: 'shot-01',
      inputFingerprint: '1'.repeat(64)
    });
    const invalidImage = await sharp({
      create: { width: 300, height: 200, channels: 4, background: '#ffffff' }
    }).png().toBuffer();
    let attempts = 0;
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      executors: [createStickmanImageExecutor({
        configStore: { read: async () => createDefaultCreatorServicesConfig() },
        ledger: new CreatorProviderRequestLedger(repository),
        validateCandidate: acceptCandidate,
        async generate() {
          attempts += 1;
          return {
            model: 'test-image',
            contents: [{ mime: 'image/png' as const, content: invalidImage }]
          };
        }
      })]
    });

    const completed = await runner.runStageRun(stage.id);
    expect(completed.status).toBe('succeeded');
    const generated = service.getJob(job.id)!.artifacts.find(artifact => artifact.kind === 'shot_image');
    expect(await sharp(generated!.path!).metadata()).toMatchObject({ width: 1280, height: 720 });
    expect(attempts).toBe(1);
    expect(service.getJob(job.id)!.providerRequests).toHaveLength(1);
    await runner.close();
    db.close();
  });

  it('keeps successful shot artifacts when another scope fails', async () => {
    const { db, repository, templates, service } = setup();
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'stickman-video',
      state: { styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 } }
    });
    const shotSpecPath = join(tempDir, 'shot-spec.json');
    writeFileSync(shotSpecPath, JSON.stringify(shotSpecValue()));
    repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_spec',
      status: 'completed',
      path: shotSpecPath,
      sha256: 'a'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const reference = await sharp({
      create: { width: 100, height: 100, channels: 4, background: '#222222' }
    }).png().toBuffer();
    const referencePath = join(tempDir, 'default.png');
    writeFileSync(referencePath, reference);
    const characterArtifact = repository.insertArtifact({
      jobId: job.id,
      kind: 'character_reference',
      status: 'completed',
      path: referencePath,
      sha256: createHash('sha256').update(reference).digest('hex'),
      sourceArtifactIds: [],
      metadata: { assetId: 'stickman.character.default', revision: 1, mimeType: 'image/png' }
    });
    insertImageContracts({
      repository,
      jobId: job.id,
      shotSpecId: service.getJob(job.id)!.artifacts.find(artifact => artifact.kind === 'shot_spec')!.id,
      character: characterArtifact,
      characterAssetId: 'stickman.character.default',
      prompts: shotSpecValue().shots.map(shot => ({
        shotId: shot.id,
        visualDescription: shot.visualDescription,
        prompt: shot.visualDescription
      }))
    });
    const runs = shotSpecValue().shots.map((shot, index) => repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'queued',
      scopeKey: shot.id,
      inputFingerprint: String(index + 1).repeat(64)
    }));
    const config = createDefaultCreatorServicesConfig();
    const validImage = await sharp({
      create: { width: 320, height: 180, channels: 4, background: '#fefefe' }
    }).png().toBuffer();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      maxConcurrency: 3,
      executors: [createStickmanImageExecutor({
        configStore: { read: async () => config },
        ledger: new CreatorProviderRequestLedger(repository),
        validateCandidate: acceptCandidate,
        async generate(request) {
          if (request.prompt.includes('fail two')) throw new Error('injected provider failure');
          return {
            model: 'test-image',
            contents: [{ mime: 'image/png', content: validImage }]
          };
        }
      })]
    });

    const results = await Promise.all(runs.map(run => runner.runStageRun(run.id)));
    const completed = service.getJob(job.id)!;

    expect(results.map(run => run.status).sort()).toEqual(['failed', 'succeeded', 'succeeded']);
    expect(completed.artifacts
      .filter(artifact => artifact.kind === 'shot_image')
      .sort((left, right) => (left.scopeKey ?? '').localeCompare(right.scopeKey ?? ''))).toMatchObject([
      { scopeKey: 'shot-01', status: 'completed', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { scopeKey: 'shot-03', status: 'completed', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }
    ]);
    expect(completed).toMatchObject({
      status: 'needs_input',
      state: { needsInput: { scopeKey: 'shot-02' } }
    });
    expect(completed.providerRequests).toHaveLength(3);
    await runner.close();
    db.close();
  });

  it('regenerates one shot and stales only its transitive dependents', () => {
    const { db, repository, service } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const shotSpecPath = join(tempDir, 'shot-spec.json');
    writeFileSync(shotSpecPath, JSON.stringify(shotSpecValue()));
    const shotSpec = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_spec',
      status: 'completed',
      path: shotSpecPath,
      sha256: 'a'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const images = ['shot-01', 'shot-02', 'shot-03'].map((scopeKey, index) => repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_image',
      status: 'completed',
      path: null,
      scopeKey,
      inputFingerprint: String(index + 1).repeat(64),
      sha256: String.fromCharCode(98 + index).repeat(64),
      sourceArtifactIds: [shotSpec.id],
      metadata: {}
    }));
    const validation = repository.insertArtifact({ jobId: job.id, kind: 'visual_validation', status: 'completed', path: null, sourceArtifactIds: images.map(image => image.id), metadata: {} });
    const timeline = repository.insertArtifact({ jobId: job.id, kind: 'timeline_manifest', status: 'completed', path: null, sourceArtifactIds: [validation.id, ...images.map(image => image.id)], metadata: {} });
    const clean = repository.insertArtifact({ jobId: job.id, kind: 'clean_video', status: 'completed', path: null, sourceArtifactIds: [timeline.id], metadata: {} });

    const response = service.applyAction(job.id, {
      actor: 'user',
      action: 'edit-shot',
      expectedRevision: 0,
      input: {
        artifactId: shotSpec.id,
        scopeKey: 'shot-02',
        patch: { visualDescription: 'updated shot two' },
        revision: 0
      }
    });

    expect(response.job.artifacts.find(item => item.id === images[0]!.id)?.status).toBe('completed');
    expect(response.job.artifacts.find(item => item.id === images[2]!.id)?.status).toBe('completed');
    expect(response.job.artifacts.find(item => item.id === images[1]!.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(item => item.id === validation.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(item => item.id === timeline.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(item => item.id === clean.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(item => item.id === images[0]!.id)?.sha256).toBe('b'.repeat(64));
    expect(response.job.artifacts.find(item => item.id === images[2]!.id)?.sha256).toBe('d'.repeat(64));
    db.close();
  });

  it('cleans historical duplicate images before retrying visual validation', () => {
    const { db, repository, service } = setup();
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'stickman-video',
      state: { currentStage: 'visual-validation', workflowTarget: 'visuals_ready' }
    });
    repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'succeeded',
      scopeKey: 'shot-03',
      inputFingerprint: 'a'.repeat(64)
    });
    const oldImage = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_image',
      status: 'completed',
      path: null,
      scopeKey: 'shot-03',
      inputFingerprint: 'a'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'succeeded',
      scopeKey: 'shot-03',
      inputFingerprint: 'b'.repeat(64)
    });
    const currentImage = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_image',
      status: 'completed',
      path: null,
      scopeKey: 'shot-03',
      inputFingerprint: 'b'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const oldValidation = repository.insertArtifact({
      jobId: job.id,
      kind: 'visual_validation',
      status: 'completed',
      path: null,
      sourceArtifactIds: [oldImage.id],
      metadata: {}
    });
    repository.updateJob({
      id: job.id,
      status: 'failed',
      revision: job.revision,
      state: job.state
    });
    const failedJob = service.getJob(job.id)!;

    const response = service.applyAction(job.id, {
      actor: 'user',
      action: 'generate-missing-shots',
      expectedRevision: failedJob.revision,
      input: { revision: failedJob.revision }
    });

    expect(response.job.artifacts.find(artifact => artifact.id === oldImage.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(artifact => artifact.id === currentImage.id)?.status).toBe('completed');
    expect(response.job.artifacts.find(artifact => artifact.id === oldValidation.id)?.status).toBe('stale');
    expect(response.job).toMatchObject({
      status: 'running',
      state: { currentStage: 'images', workflowTarget: 'visuals_ready' }
    });
    db.close();
  });

  it('invalidates only visual descendants when the selected asset revision changes', () => {
    const { db, repository, service } = setup();
    const created = service.createJob({
      projectId: 'p1',
      templateId: 'stickman-video',
      state: {
        characterAsset: { assetId: 'stickman.character.default', revision: 1 },
        styleAsset: { assetId: 'stickman.style.paper-pencil', revision: 1 }
      }
    });
    const script = repository.insertArtifact({ jobId: created.id, kind: 'script_manifest', status: 'completed', path: null, sourceArtifactIds: [], metadata: {} });
    const audio = repository.insertArtifact({ jobId: created.id, kind: 'narration_audio', status: 'completed', path: null, sourceArtifactIds: [script.id], metadata: {} });
    const shotSpec = repository.insertArtifact({ jobId: created.id, kind: 'shot_spec', status: 'completed', path: null, sha256: '1'.repeat(64), sourceArtifactIds: [script.id, audio.id], metadata: {} });
    const character = repository.insertArtifact({ jobId: created.id, kind: 'character_reference', status: 'completed', path: null, sha256: '2'.repeat(64), sourceArtifactIds: [shotSpec.id], metadata: {} });
    const contract = repository.insertArtifact({ jobId: created.id, kind: 'style_contract', status: 'completed', path: null, sha256: '3'.repeat(64), sourceArtifactIds: [shotSpec.id], metadata: {} });
    const prompt = repository.insertArtifact({ jobId: created.id, kind: 'image_prompt_pack', status: 'completed', path: null, sha256: '4'.repeat(64), sourceArtifactIds: [shotSpec.id, character.id, contract.id], metadata: {} });
    const image = repository.insertArtifact({ jobId: created.id, kind: 'shot_image', status: 'completed', path: null, sha256: '5'.repeat(64), scopeKey: 'shot-01', inputFingerprint: '6'.repeat(64), sourceArtifactIds: [prompt.id, character.id, contract.id], metadata: {} });
    const validation = repository.insertArtifact({ jobId: created.id, kind: 'visual_validation', status: 'completed', path: null, sourceArtifactIds: [image.id], metadata: {} });
    const timeline = repository.insertArtifact({ jobId: created.id, kind: 'timeline_manifest', status: 'completed', path: null, sourceArtifactIds: [validation.id, audio.id], metadata: {} });

    const before = service.getJob(created.id)!;
    const fingerprint = stickmanShotFingerprint({
      shot: shotSpecValue().shots[0],
      job: before,
      shotSpec,
      characterReference: character,
      styleContract: contract,
      promptPack: prompt,
      settings: { provider: 'openai', model: 'gpt-image-1', quality: 'medium' }
    });
    const response = service.applyAction(created.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: created.revision,
      input: {
        patch: { styleAsset: { assetId: 'stickman.style.paper-pencil', revision: 2 } },
        activityMode: 'semantic',
        objectId: 'styleAsset'
      }
    });

    for (const artifact of [script, audio, shotSpec]) {
      expect(response.job.artifacts.find(candidate => candidate.id === artifact.id)?.status)
        .toBe('completed');
    }
    for (const artifact of [character, contract, prompt, image, validation, timeline]) {
      expect(response.job.artifacts.find(candidate => candidate.id === artifact.id)?.status)
        .toBe('stale');
    }
    expect(response.job.state.styleAsset).toEqual({
      assetId: 'stickman.style.paper-pencil',
      revision: 2
    });
    expect(stickmanShotFingerprint({
      shot: shotSpecValue().shots[0],
      job: response.job,
      shotSpec,
      characterReference: character,
      styleContract: contract,
      promptPack: prompt,
      settings: { provider: 'openai', model: 'gpt-image-1', quality: 'medium' }
    })).not.toBe(fingerprint);
    expect(stickmanShotFingerprint({
      shot: shotSpecValue().shots[0],
      job: before,
      shotSpec,
      characterReference: character,
      styleContract: { ...contract, sha256: '9'.repeat(64) },
      promptPack: prompt,
      settings: { provider: 'openai', model: 'gpt-image-1', quality: 'medium' }
    })).not.toBe(fingerprint);
    expect(stickmanShotFingerprint({
      shot: shotSpecValue().shots[0],
      job: before,
      shotSpec,
      characterReference: character,
      styleContract: contract,
      promptPack: prompt,
      previousShotImage: { ...image, sha256: '8'.repeat(64) },
      settings: { provider: 'openai', model: 'gpt-image-1', quality: 'medium' }
    })).not.toBe(fingerprint);
    db.close();
  });
});
