import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import type { CreatorExecutor } from '../../src/creator/executor.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createStickmanContentExecutor } from '../../src/creator/stickman/content-executor.js';
import { createStickmanVisualAssetRegistry } from '../../src/creator/stickman/visual-assets.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { createStickmanVideoWorkflow } from '../../src/creator/templates/stickman-video-actions.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

type CompletionRequest = {
  stageId: string;
  prompt: string;
  signal: AbortSignal;
};

type CompletionOverride = (input: CompletionRequest) => unknown | Promise<unknown>;

function setup(options: {
  segmentCount?: number;
  narrationUnits?: number;
  narrationDurationSeconds?: number;
  completionOverride?: CompletionOverride;
} = {}) {
  const narrationUnits = options.narrationUnits ?? 40;
  const segmentCount = options.segmentCount ?? Math.ceil(narrationUnits / 18);
  const narrationDurationSeconds = options.narrationDurationSeconds ?? 2.25;
  tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-workflow-'));
  const runtimeRoot = join(tempDir, 'stickman-runtime');
  mkdirSync(join(runtimeRoot, 'characters'), { recursive: true });
  const imageFixture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69m8WQAAAABJRU5ErkJggg==',
    'base64'
  );
  writeFileSync(join(runtimeRoot, 'characters', 'default.png'), imageFixture);
  writeFileSync(join(runtimeRoot, 'characters', 'student.png'), imageFixture);
  const visualAssets = createStickmanVisualAssetRegistry({
    root: runtimeRoot,
    catalogPath: fileURLToPath(new URL(
      '../../../../resources/stickman/visual-assets/catalog.json',
      import.meta.url
    ))
  });

  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const receipts = createCreatorAgentRepository(db);
  const dispatcher = createCreatorCommandDispatcher({ service, repository, receipts });
  const completionRequests: CompletionRequest[] = [];

  const content = createStickmanContentExecutor({
    configStore: { read: async () => createDefaultCreatorServicesConfig() },
    visualAssets,
    async completeJson(request) {
      completionRequests.push(request);
      const overridden = await options.completionOverride?.(request);
      if (overridden !== undefined) return overridden;
      if (request.stageId === 'source-brief') {
        return {
          title: '测试来源',
          summary: '忠实的来源摘要',
          audience: '普通观众',
          claims: [{
            id: 'claim-001',
            text: '来源中的完整内容',
            sourceSpanIds: ['source-001']
          }]
        };
      }
      if (request.stageId === 'content-plan') {
        return {
          title: '测试视频',
          audience: '普通观众',
          objective: '忠实讲清来源内容',
          retainedClaimIds: ['claim-001'],
          discardedClaimIds: [],
          sections: [{
            id: 'section-01',
            title: '完整内容',
            claimIds: ['claim-001']
          }]
        };
      }
      if (request.stageId === 'script') {
        return generatedScript(segmentCount, narrationUnits);
      }
      if (request.stageId === 'storyboard') {
        return generatedStoryboard(segmentCount);
      }
      return { title: '标题', description: '简介', tags: ['知识'] };
    }
  });

  const audio: CreatorExecutor = {
    id: 'stickman-audio',
    async run({ stageRun, inputArtifacts, workdir }) {
      if (stageRun.stageId === 'narration') {
        const path = join(workdir, `${stageRun.scopeKey}.wav`);
        writeFileSync(path, `audio:${stageRun.scopeKey}`);
        return {
          outputs: [{
            kind: 'narration_audio',
            status: 'completed',
            path,
            scopeKey: stageRun.scopeKey,
            inputFingerprint: stageRun.inputFingerprint,
            metadata: { duration: narrationDurationSeconds, timingSource: 'ffprobe' }
          }]
        };
      }
      const scriptArtifact = inputArtifacts.find(artifact => artifact.kind === 'script_manifest')!;
      const narration = inputArtifacts.filter(artifact => artifact.kind === 'narration_audio');
      const script = JSON.parse(readFileSync(scriptArtifact.path!, 'utf8')) as {
        segments: Array<{ id: string }>;
      };
      let cursor = 0;
      const segments = script.segments.map(segment => {
        const audioArtifact = narration.find(artifact => artifact.scopeKey === segment.id)!;
        const startSeconds = cursor;
        cursor += narrationDurationSeconds;
        return {
          segmentId: segment.id,
          startSeconds,
          endSeconds: cursor,
          durationSeconds: narrationDurationSeconds,
          audioArtifactId: audioArtifact.id,
          audioSha256: audioArtifact.sha256
        };
      });
      const path = join(workdir, 'audio-timing.json');
      writeFileSync(path, JSON.stringify({
        scriptArtifactId: scriptArtifact.id,
        timingSource: 'ffprobe_cumulative_tts_duration',
        segments,
        totalDurationSeconds: cursor
      }));
      return { outputs: [{ kind: 'audio_timing', status: 'completed', path }] };
    }
  };

  const runner = createCreatorStageRunner({
    repository,
    templates,
    executors: [content, audio],
    workRoot: join(tempDir, 'jobs')
  });
  const workflow = createStickmanVideoWorkflow({ creator: service, dispatcher });
  return {
    db,
    repository,
    service,
    dispatcher,
    runner,
    workflow,
    completionRequests
  };
}

describe('stickman video workflow', () => {
  it('queues KrillinAI directly for a YouTube source without a download stage', async () => {
    const { db, service, repository, workflow } = setup();
    try {
      const job = service.createJob({
        projectId: 'p1',
        templateId: 'stickman-video',
        state: {
          sourceType: 'url',
          sourceUrl: 'https://www.youtube.com/watch?v=demo'
        }
      });
      repository.updateJob({
        id: job.id,
        status: 'running',
        revision: job.revision,
        state: job.state
      });

      await workflow.reconcile(service.getJob(job.id)!);

      expect(service.getJob(job.id)!.stages).toMatchObject([{
        stageId: 'source-transcript',
        executor: 'krillinai',
        status: 'queued'
      }]);
      expect(service.getJob(job.id)!.stages.some(stage => stage.stageId === 'acquire-source'))
        .toBe(false);
    } finally {
      db.close();
    }
  });

  it('builds claims, a complete claim partition, and one narration script for a 30-second task', async () => {
    const context = setup({ narrationUnits: 120 });
    const { db, service, dispatcher, runner, workflow, completionRequests } = context;
    try {
      const job = service.createJob({
        projectId: 'p1',
        templateId: 'stickman-video',
        state: {
          sourceType: 'text',
          sourceText: '这是一段由用户直接输入的完整来源文本。',
          characterAsset: { assetId: 'stickman.character.student', revision: 1 },
          styleAsset: { assetId: 'stickman.style.paper-pencil', revision: 1 },
          targetDurationSeconds: 30,
          targetLanguage: 'zh-CN'
        }
      });
      let queued = dispatcher.dispatch(job.id, {
        action: 'run-stage',
        expectedRevision: job.revision,
        idempotencyKey: 'stickman-claim-pipeline',
        input: { stageId: 'ingest-text' }
      }, 'user').commandReceipt.stageRunId!;

      for (const expectedStage of ['ingest-text', 'source-brief', 'content-plan', 'script']) {
        const completed = await runner.runStageRun(queued);
        expect(completed).toMatchObject({
          stageId: expectedStage,
          status: 'succeeded',
          progress: { phase: 'completed', percent: 100 }
        });
        await workflow.handleStageChanged(completed);
        if (expectedStage !== 'script') {
          queued = service.getJob(job.id)!.stages.find(stage => stage.status === 'queued')!.id;
        }
      }

      const completed = service.getJob(job.id)!;
      expect(completed.stages.map(stage => stage.stageId)).toEqual([
        'ingest-text', 'source-brief', 'content-plan', 'script'
      ]);
      expect(completed).toMatchObject({
        status: 'needs_input',
        state: { needsInput: { kind: 'approve-script' } }
      });
      const brief = readArtifact(completed, 'source_brief') as {
        claims: Array<{ id: string; sourceSpanIds: string[] }>;
      };
      const plan = readArtifact(completed, 'content_plan') as {
        retainedClaimIds: string[];
        discardedClaimIds: string[];
        narrationBudget: { minUnits: number; maxUnits: number };
      };
      const script = readArtifact(completed, 'script_manifest') as {
        reviewStatus: string;
        contentLocked: boolean;
        totalNarrationUnits: number;
        estimatedTotalDurationSeconds: number;
        segments: Array<{
          narration: string;
          claimIds: string[];
          sourceSpanIds: string[];
          estimatedDurationSeconds: number;
        }>;
      };

      expect(brief.claims).toMatchObject([{
        id: 'claim-001',
        sourceSpanIds: ['source-001']
      }]);
      expect(plan).toMatchObject({
        retainedClaimIds: ['claim-001'],
        discardedClaimIds: [],
        narrationBudget: { minUnits: 108, maxUnits: 132 }
      });
      expect(script).toMatchObject({
        reviewStatus: 'needs_review',
        contentLocked: false,
        totalNarrationUnits: 120,
        estimatedTotalDurationSeconds: 30
      });
      expect(script.segments[0]).toMatchObject({
        claimIds: ['claim-001'],
        sourceSpanIds: ['source-001']
      });
      expect(script.segments[0]!.narration).not.toContain('火柴人');
      expect(script.segments.every(segment => segment.estimatedDurationSeconds <= 4.5)).toBe(true);

      const scriptRequests = completionRequests.filter(request => request.stageId === 'script');
      expect(scriptRequests).toHaveLength(1);
      expect(scriptRequests[0]!.prompt).toContain('只生成可直接用于配音的旁白单元');
      expect(scriptRequests[0]!.prompt).toContain('不要生成画面、镜头、生图或制作说明');
      expect(scriptRequests[0]!.prompt).not.toContain('纸面铅笔手绘');
      expect(scriptRequests[0]!.prompt).not.toContain('student');
    } finally {
      await runner.close();
      db.close();
    }
  });

  it('regenerates the complete script with validation evidence instead of patching individual narration', async () => {
    let scriptCalls = 0;
    const context = setup({
      narrationUnits: 120,
      completionOverride({ stageId }) {
        if (stageId !== 'script') return undefined;
        scriptCalls += 1;
        return scriptCalls === 1
          ? generatedScript(1, 12)
          : generatedScript(7, 120);
      }
    });
    const { db, service, dispatcher, runner, workflow, completionRequests } = context;
    try {
      const job = service.createJob({
        projectId: 'p1',
        templateId: 'stickman-video',
        state: {
          sourceType: 'text',
          sourceText: '完整来源内容。',
          targetDurationSeconds: 30,
          targetLanguage: 'zh-CN'
        }
      });
      await runContentPipeline({ service, dispatcher, runner, workflow, jobId: job.id });
      const script = readArtifact(service.getJob(job.id)!, 'script_manifest') as {
        totalNarrationUnits: number;
      };

      expect(scriptCalls).toBe(2);
      expect(script.totalNarrationUnits).toBe(120);
      const secondPrompt = completionRequests.filter(request => request.stageId === 'script')[1]!.prompt;
      expect(secondPrompt).toContain('上一份完整草稿');
      expect(secondPrompt).toContain('旁白总字符数');
      expect(secondPrompt).toContain('重新生成整份脚本');
      expect(completionRequests.some(request => (
        request.stageId === 'script-narration'
        || request.stageId === 'script-visuals'
        || request.stageId === 'semantic-review'
      ))).toBe(false);
    } finally {
      await runner.close();
      db.close();
    }
  });

  it('rejects a content plan that silently drops a source claim', async () => {
    const context = setup({
      completionOverride({ stageId }) {
        if (stageId === 'source-brief') {
          return {
            title: '两项来源',
            summary: '包含两项内容',
            audience: '普通观众',
            claims: [
              { id: 'claim-001', text: '第一项内容', sourceSpanIds: ['source-001'] },
              { id: 'claim-002', text: '第二项内容', sourceSpanIds: ['source-002'] }
            ]
          };
        }
        if (stageId === 'content-plan') {
          return {
            title: '错误计划',
            audience: '普通观众',
            objective: '测试遗漏',
            retainedClaimIds: ['claim-001'],
            discardedClaimIds: [],
            sections: [{ id: 'section-01', title: '第一项', claimIds: ['claim-001'] }]
          };
        }
        return undefined;
      }
    });
    const { db, service, dispatcher, runner, workflow } = context;
    try {
      const job = service.createJob({
        projectId: 'p1',
        templateId: 'stickman-video',
        state: {
          sourceType: 'text',
          sourceText: '第一项内容。第二项内容。',
          targetDurationSeconds: 30
        }
      });
      let queued = dispatcher.dispatch(job.id, {
        action: 'run-stage',
        expectedRevision: job.revision,
        idempotencyKey: 'stickman-missing-claim',
        input: { stageId: 'ingest-text' }
      }, 'user').commandReceipt.stageRunId!;
      for (const expectedStage of ['ingest-text', 'source-brief']) {
        const completed = await runner.runStageRun(queued);
        expect(completed.status).toBe('succeeded');
        await workflow.handleStageChanged(completed);
        queued = service.getJob(job.id)!.stages.find(stage => stage.status === 'queued')!.id;
        expect(completed.stageId).toBe(expectedStage);
      }

      expect(await runner.runStageRun(queued)).toMatchObject({
        stageId: 'content-plan',
        status: 'failed',
        errorCode: 'creator_content_plan_claim_partition_invalid'
      });
      expect(service.getJob(job.id)!.artifacts.some(artifact => (
        artifact.kind === 'script_manifest' && artifact.status === 'completed'
      ))).toBe(false);
    } finally {
      await runner.close();
      db.close();
    }
  });

  it('stops after real audio timing and only derives shots after the user continues', async () => {
    const context = setup({
      segmentCount: 3,
      narrationUnits: 40,
      narrationDurationSeconds: 5.6
    });
    const { db, service, dispatcher, runner, workflow } = context;
    try {
      const job = service.createJob({
        projectId: 'p1',
        templateId: 'stickman-video',
        state: {
          sourceType: 'text',
          sourceText: '这是一段完整来源内容。',
          targetDurationSeconds: 10,
          targetLanguage: 'zh-CN',
          ttsProvider: 'openai',
          ttsModel: 'gpt-4o-mini-tts',
          voiceCode: 'alloy'
        }
      });
      await runContentPipeline({ service, dispatcher, runner, workflow, jobId: job.id });
      const reviewJob = service.getJob(job.id)!;
      const draft = reviewJob.artifacts.find(artifact => (
        artifact.kind === 'script_manifest' && artifact.status === 'completed'
      ))!;
      const approved = service.applyAction(job.id, {
        actor: 'user',
        action: 'approve-script',
        expectedRevision: reviewJob.revision,
        input: { artifactId: draft.id, revision: reviewJob.revision }
      });
      await workflow.handleAction(approved.job, 'approve-script');

      const lockedJob = service.getJob(job.id)!;
      const lockedArtifact = lockedJob.artifacts.find(artifact => (
        artifact.kind === 'script_manifest' && artifact.status === 'completed'
      ))!;
      const locked = JSON.parse(readFileSync(lockedArtifact.path!, 'utf8')) as {
        reviewStatus: string;
        contentLocked: boolean;
      };
      expect(lockedArtifact.id).not.toBe(draft.id);
      expect(lockedArtifact.sourceArtifactIds).toContain(draft.id);
      expect(locked).toMatchObject({ reviewStatus: 'approved', contentLocked: true });
      expect(lockedJob.state.approvedScriptArtifactId).toBe(lockedArtifact.id);
      expect(lockedJob.artifacts.find(artifact => artifact.id === draft.id)?.status).toBe('stale');

      for (const expectedScope of ['segment-01', 'segment-02', 'segment-03']) {
        const narrationStage = service.getJob(job.id)!.stages.find(stage => (
          stage.stageId === 'narration' && stage.status === 'queued'
        ))!;
        expect(narrationStage.scopeKey).toBe(expectedScope);
        const completed = await runner.runStageRun(narrationStage.id);
        expect(completed.status).toBe('succeeded');
        await workflow.handleStageChanged(completed);
      }
      const pendingTiming = service.getJob(job.id)!.stages.find(stage => stage.status === 'queued')!;
      expect(pendingTiming.stageId).toBe('audio-timing');
      const completedTiming = await runner.runStageRun(pendingTiming.id);
      expect(completedTiming.status).toBe('succeeded');
      await workflow.handleStageChanged(completedTiming);

      const audioReadyJob = service.getJob(job.id)!;
      expect(audioReadyJob.state.workflowTarget).toBe('audio_ready');
      expect(audioReadyJob.stages.some(stage => stage.stageId === 'storyboard')).toBe(false);
      await expect(workflow.validateStage(audioReadyJob, 'storyboard')).rejects.toMatchObject({
        code: 'creator_workflow_gate_required'
      });

      const audioTimingArtifact = audioReadyJob.artifacts.find(artifact => (
        artifact.kind === 'audio_timing' && artifact.status === 'completed'
      ))!;
      const continued = service.applyAction(job.id, {
        actor: 'user',
        action: 'continue-after-audio',
        expectedRevision: audioReadyJob.revision,
        input: { artifactId: audioTimingArtifact.id, revision: audioReadyJob.revision }
      });
      await workflow.handleAction(continued.job, 'continue-after-audio');
      const pendingStoryboard = service.getJob(job.id)!.stages.find(stage => stage.status === 'queued')!;
      expect(pendingStoryboard.stageId).toBe('storyboard');
      const completedStoryboard = await runner.runStageRun(pendingStoryboard.id);
      expect(completedStoryboard.status).toBe('succeeded');
      await workflow.handleStageChanged(completedStoryboard);

      const shotSpec = readArtifact(service.getJob(job.id)!, 'shot_spec') as {
        scriptArtifactId: string;
        shots: Array<{
          sourceSegmentId: string;
          visualDescription: string;
          startSeconds: number;
          endSeconds: number;
        }>;
      };
      expect(shotSpec.scriptArtifactId).toBe(lockedArtifact.id);
      expect(shotSpec.shots).toHaveLength(3);
      expect(shotSpec.shots[0]).toMatchObject({
        sourceSegmentId: 'segment-01',
        visualDescription: '人物在清晰场景中忠实表现第1段来源含义',
        startSeconds: 0,
        endSeconds: 5.6
      });
      expect(service.getJob(job.id)!.stages.some(stage => (
        stage.stageId === 'style-assets' && stage.status === 'queued'
      ))).toBe(true);
      expect(service.getJob(job.id)!.stages.some(stage => stage.stageId === 'semantic-review')).toBe(false);
    } finally {
      await runner.close();
      db.close();
    }
  });

  it('uses the selected reference image as the sole character authority in image prompts', async () => {
    const context = setup();
    const { db, repository, service, runner } = context;
    try {
      const job = service.createJob({
        projectId: 'p1',
        templateId: 'stickman-video',
        state: {
          characterAsset: { assetId: 'stickman.character.student', revision: 1 },
          styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 }
        }
      });
      const shotSpecPath = join(tempDir, 'identity-shot-spec.json');
      writeFileSync(shotSpecPath, JSON.stringify({
        scriptArtifactId: 'script-1',
        audioTimingArtifactId: 'audio-timing-1',
        timingSource: 'ffprobe_cumulative_tts_duration',
        shots: [{
          id: 'shot-01',
          sourceSegmentId: 'segment-01',
          semanticAnchor: '女孩开始阅读',
          visualDescription: '女孩在书桌前打开一本书',
          compositionAndAction: '女孩坐在画面中央，双手打开桌上的书',
          keyObjects: ['书桌', '书'],
          continuityReason: '',
          motion: 'static',
          motionReason: '静态构图清楚展示阅读动作',
          startSeconds: 0,
          endSeconds: 4,
          durationSeconds: 4
        }]
      }));
      repository.insertArtifact({
        jobId: job.id,
        kind: 'shot_spec',
        status: 'completed',
        path: shotSpecPath,
        sourceArtifactIds: [],
        metadata: {}
      });
      const assetsStage = await runner.run(job.id, 'style-assets');
      expect(assetsStage.status).toBe('succeeded');
      const stage = await runner.run(job.id, 'prompt-pack');
      expect(stage.status).toBe('succeeded');
      const completedJob = service.getJob(job.id)!;
      const promptPackArtifact = completedJob.artifacts.find(artifact => (
        artifact.kind === 'image_prompt_pack' && artifact.status === 'completed'
      ));
      expect(promptPackArtifact?.metadata.contract).toBe('stickman-visual-profile-prompt-v2');
      const promptPack = readArtifact(completedJob, 'image_prompt_pack') as {
        prompts: Array<{ prompt: string }>;
      };
      const prompt = promptPack.prompts[0]!.prompt;
      expect(prompt).toContain('CHARACTER IDENTITY source of truth');
      expect(prompt).toContain('oversized circular white head, chin-length straight bob haircut');
      expect(prompt).toContain('short-sleeve sailor-collar school uniform');
      expect(prompt).toContain('Forbidden identity changes: eyeglasses, hoodies, jackets');
      expect(prompt).toContain('Palette: strict monochrome black, white, and light gray only');
      expect(prompt).toContain('Only pose, facial expression, camera framing, and interaction with scene objects may change');
      expect(prompt).not.toContain('Character:');
      expect(prompt).not.toContain('背包与轻快动作');
      expect(prompt).toContain('Concrete scene: 女孩在书桌前打开一本书');
      expect(prompt).toContain('Composition and action: 女孩坐在画面中央，双手打开桌上的书');
      expect(prompt).toContain('Required objects: 书桌; 书');
    } finally {
      await runner.close();
      db.close();
    }
  });

  it('continues all missing shots after an ordinary failure with a monotonic generation', async () => {
    const context = setup({ segmentCount: 2, narrationUnits: 20 });
    const { db, repository, service, runner, workflow } = context;
    try {
      const job = service.createJob({
        projectId: 'p1',
        templateId: 'stickman-video',
        state: {
          sourceType: 'text',
          sourceText: '这是用于验证镜头重新生成调度的完整来源文本。',
          targetDurationSeconds: 5,
          targetLanguage: 'zh-CN'
        }
      });
      await runContentPipeline({
        service,
        dispatcher: context.dispatcher,
        runner,
        workflow,
        jobId: job.id
      });
      const reviewJob = service.getJob(job.id)!;
      const script = reviewJob.artifacts.find(artifact => (
        artifact.kind === 'script_manifest' && artifact.status === 'completed'
      ))!;
      const approved = service.applyAction(job.id, {
        actor: 'user',
        action: 'approve-script',
        expectedRevision: reviewJob.revision,
        input: { artifactId: script.id, revision: reviewJob.revision }
      });
      await workflow.handleAction(approved.job, 'approve-script');

      for (const expectedScope of ['segment-01', 'segment-02']) {
        const stage = service.getJob(job.id)!.stages.find(candidate => (
          candidate.stageId === 'narration' && candidate.status === 'queued'
        ))!;
        expect(stage.scopeKey).toBe(expectedScope);
        const completed = await runner.runStageRun(stage.id);
        await workflow.handleStageChanged(completed);
      }
      for (const expectedStage of ['audio-timing', 'storyboard']) {
        const stage = service.getJob(job.id)!.stages.find(candidate => candidate.status === 'queued')!;
        expect(stage.stageId).toBe(expectedStage);
        const completed = await runner.runStageRun(stage.id);
        await workflow.handleStageChanged(completed);
        if (expectedStage === 'audio-timing') {
          const ready = service.getJob(job.id)!;
          const timing = ready.artifacts.find(artifact => (
            artifact.kind === 'audio_timing' && artifact.status === 'completed'
          ))!;
          const continued = service.applyAction(job.id, {
            actor: 'user',
            action: 'continue-after-audio',
            expectedRevision: ready.revision,
            input: { artifactId: timing.id, revision: ready.revision }
          });
          await workflow.handleAction(continued.job, 'continue-after-audio');
        }
      }
      for (const expectedStage of ['style-assets', 'prompt-pack']) {
        const stage = service.getJob(job.id)!.stages.find(candidate => candidate.status === 'queued')!;
        expect(stage.stageId).toBe(expectedStage);
        const completed = await runner.runStageRun(stage.id);
        await workflow.handleStageChanged(completed);
      }

      const firstImageStage = service.getJob(job.id)!.stages.find(stage => (
        stage.stageId === 'images' && stage.scopeKey === 'shot-01' && stage.status === 'queued'
      ))!;
      repository.insertArtifact({
        jobId: job.id,
        kind: 'shot_image',
        status: 'completed',
        path: null,
        scopeKey: 'shot-01',
        inputFingerprint: firstImageStage.inputFingerprint,
        sourceArtifactIds: [],
        metadata: {}
      });
      repository.updateStageRun({ id: firstImageStage.id, status: 'succeeded' });
      await workflow.handleStageChanged(repository.getStageRun(firstImageStage.id)!);

      const failedStage = service.getJob(job.id)!.stages.find(stage => (
        stage.stageId === 'images' && stage.scopeKey === 'shot-02' && stage.status === 'queued'
      ))!;
      repository.updateStageRun({
        id: failedStage.id,
        status: 'failed',
        errorCode: 'creator_stage_failed',
        errorMessage: 'Image generation failed'
      });
      const waiting = service.setNeedsInput(job.id, {
        code: 'creator_stage_failed',
        message: 'Image generation failed',
        resumeStageId: 'images'
      });
      const replacementPreviousShot = repository.insertArtifact({
        jobId: job.id,
        kind: 'shot_image',
        status: 'completed',
        path: null,
        scopeKey: 'shot-01',
        inputFingerprint: firstImageStage.inputFingerprint,
        sha256: 'f'.repeat(64),
        sourceArtifactIds: [],
        metadata: {}
      });

      const continued = service.applyAction(job.id, {
        actor: 'user',
        action: 'generate-missing-shots',
        expectedRevision: waiting.revision,
        input: { revision: waiting.revision }
      });
      expect(continued.job).toMatchObject({
        status: 'running',
        state: { workflowTarget: 'visuals_ready', currentStage: 'images' }
      });
      expect(continued.job.state).not.toHaveProperty('needsInput');

      await workflow.handleAction(continued.job, 'generate-missing-shots');

      const latest = service.getJob(job.id)!;
      const shotRuns = latest.stages.filter(stage => (
        stage.stageId === 'images' && stage.scopeKey === 'shot-02'
      ));
      expect(shotRuns).toHaveLength(2);
      expect(shotRuns.at(-1)).toMatchObject({
        status: 'queued',
        idempotencyKey: expect.stringMatching(/:2:stage$/)
      });
      expect(shotRuns.at(-1)!.inputFingerprint).not.toBe(failedStage.inputFingerprint);
      expect(latest.artifacts.find(artifact => artifact.id === replacementPreviousShot.id)?.status)
        .toBe('completed');
    } finally {
      await runner.close();
      db.close();
    }
  });

  it('keeps animation blocked until the current visuals are explicitly continued', async () => {
    const context = setup();
    const { db, repository, service, workflow } = context;
    try {
      const job = service.createJob({
        projectId: 'p1',
        templateId: 'stickman-video',
        state: {
          currentStage: 'visual-validation',
          workflowTarget: 'visuals_ready'
        }
      });
      const script = repository.insertArtifact({
        jobId: job.id,
        kind: 'script_manifest',
        status: 'completed',
        path: null,
        sourceArtifactIds: [],
        metadata: {}
      });
      repository.insertArtifact({
        jobId: job.id,
        kind: 'shot_spec',
        status: 'completed',
        path: null,
        sourceArtifactIds: [],
        metadata: {}
      });
      const validation = repository.insertArtifact({
        jobId: job.id,
        kind: 'visual_validation',
        status: 'completed',
        path: null,
        sourceArtifactIds: [],
        metadata: {}
      });
      const beforeSettings = service.getJob(job.id)!;
      const ready = service.applyAction(job.id, {
        actor: 'user',
        action: 'update-settings',
        expectedRevision: beforeSettings.revision,
        input: { patch: { approvedScriptArtifactId: script.id } }
      }).job;

      await expect(workflow.validateStage(ready, 'timeline')).rejects.toMatchObject({
        code: 'creator_workflow_gate_required'
      });
      const continued = service.applyAction(job.id, {
        actor: 'user',
        action: 'continue-after-visuals',
        expectedRevision: ready.revision,
        input: { artifactId: validation.id, revision: ready.revision }
      });
      expect(continued.job.state).toMatchObject({
        workflowTarget: 'delivery_ready',
        currentStage: 'timeline'
      });
    } finally {
      db.close();
    }
  });
});

function generatedScript(segmentCount: number, totalUnits: number) {
  const baseUnits = Math.floor(totalUnits / segmentCount);
  let remainder = totalUnits % segmentCount;
  return {
    title: '忠实来源脚本',
    segments: Array.from({ length: segmentCount }, (_, index) => {
      const units = baseUnits + (remainder-- > 0 ? 1 : 0);
      return {
        narration: narrationWithUnits(index + 1, units),
        claimIds: ['claim-001'],
        sourceSpanIds: ['source-001']
      };
    })
  };
}

function generatedStoryboard(segmentCount: number) {
  return {
    shots: Array.from({ length: segmentCount }, (_, index) => ({
      sourceSegmentId: `segment-${String(index + 1).padStart(2, '0')}`,
      semanticAnchor: `第 ${index + 1} 段来源的唯一含义`,
      visualDescription: `人物在清晰场景中忠实表现第${index + 1}段来源含义`,
      compositionAndAction: '人物位于画面中央，以清晰动作表达当前含义',
      keyObjects: ['当前事件所需物体'],
      continuityReason: index === 0 ? '' : '延续上一段事件顺序',
      motion: 'static',
      motionReason: '静态构图足以清楚表达当前含义'
    }))
  };
}

function narrationWithUnits(index: number, units: number): string {
  const seed = Array.from(`第${index}段忠实讲述来源中的完整内容并保持人物关系和事件顺序`)
    .filter(character => /[\p{L}\p{N}]/u.test(character));
  const output: string[] = [];
  while (output.length < units) output.push(...seed);
  return `${output.slice(0, units).join('')}。`;
}

async function runContentPipeline(input: {
  service: ReturnType<typeof createCreatorService>;
  dispatcher: ReturnType<typeof createCreatorCommandDispatcher>;
  runner: ReturnType<typeof createCreatorStageRunner>;
  workflow: ReturnType<typeof createStickmanVideoWorkflow>;
  jobId: string;
}) {
  const initial = input.service.getJob(input.jobId)!;
  let queued = input.dispatcher.dispatch(input.jobId, {
    action: 'run-stage',
    expectedRevision: initial.revision,
    idempotencyKey: `stickman-content-${input.jobId}`,
    input: { stageId: 'ingest-text' }
  }, 'user').commandReceipt.stageRunId!;

  for (const expectedStage of ['ingest-text', 'source-brief', 'content-plan', 'script']) {
    const completed = await input.runner.runStageRun(queued);
    expect(completed).toMatchObject({ stageId: expectedStage, status: 'succeeded' });
    await input.workflow.handleStageChanged(completed);
    if (expectedStage !== 'script') {
      queued = input.service.getJob(input.jobId)!.stages.find(stage => stage.status === 'queued')!.id;
    }
  }
}

function readArtifact(job: NonNullable<ReturnType<ReturnType<typeof createCreatorService>['getJob']>>, kind: string): unknown {
  const artifact = [...job.artifacts].reverse().find(item => (
    item.kind === kind && item.status === 'completed'
  ));
  if (artifact?.path === null || artifact === undefined) throw new Error(`Missing artifact: ${kind}`);
  return JSON.parse(readFileSync(artifact.path, 'utf8')) as unknown;
}
