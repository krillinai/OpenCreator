import type {
  CreatorActionRequest,
  CreatorActivity,
  CreatorArtifact,
  CreatorJob,
  CreatorProviderRequest,
  CreatorStageRun
} from '@opencreator/protocol';
import type { Page, Route } from '@playwright/test';

export type FakeStickmanMutation = {
  method: string;
  path: string;
  body: unknown;
};

export type FakeStickmanSnapshot = {
  revision: number;
  status: CreatorJob['status'];
  state: CreatorJob['state'];
  stages: Array<Pick<CreatorStageRun, 'stageId' | 'scopeKey' | 'status' | 'inputFingerprint'>>;
  artifacts: Array<Pick<CreatorArtifact, 'id' | 'kind' | 'scopeKey' | 'status' | 'inputFingerprint'>>;
  providerRequests: Array<Pick<CreatorProviderRequest, 'provider' | 'scopeKey' | 'status' | 'generation'>>;
};

const jobId = 'creator_job_stickman_parity';
const createdAt = '2026-08-31T08:00:00.000Z';
const firstFingerprint = '1'.repeat(64);
const secondFingerprint = '2'.repeat(64);
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+4xF4WQAAAABJRU5ErkJggg==',
  'base64'
);

export class FakeStickmanDaemon {
  readonly jobId = jobId;
  readonly projectId: string;
  private job: CreatorJob;
  private readonly mutations: FakeStickmanMutation[] = [];
  private readonly unknown: string[] = [];
  private readonly contents = new Map<string, { body: Buffer | string; contentType: string }>([
    ['artifact-script', {
      body: JSON.stringify({
        contract: 'stickman-narration-script-v2',
        reviewStatus: 'needs_review',
        contentLocked: false,
        title: '用火柴人理解复利',
        language: 'zh-CN',
        targetDurationSeconds: 10,
        narrationBudget: { unit: 'characters', unitsPerMinute: 240, minUnits: 1, maxUnits: 100 },
        segmentCount: 2,
        totalNarrationUnits: 40,
        estimatedTotalDurationSeconds: 10,
        segments: [
          {
            id: 'segment-01',
            order: 1,
            narration: '复利让每一次增长都成为下一次增长的基础。',
            claimIds: ['claim-001'],
            sourceSpanIds: ['source-001'],
            narrationUnits: 20,
            estimatedDurationSeconds: 5
          },
          {
            id: 'segment-02',
            order: 2,
            narration: '时间越长，增长曲线与线性积累的差距越明显。',
            claimIds: ['claim-002'],
            sourceSpanIds: ['source-002'],
            narrationUnits: 20,
            estimatedDurationSeconds: 5
          }
        ]
      }),
      contentType: 'application/json; charset=utf-8'
    }]
  ]);

  constructor(projectId: string) {
    this.projectId = projectId;
    this.job = initialJob(projectId);
  }

  async attach(page: Page): Promise<void> {
    await page.route('**/.opencreator/runtime/creator/**', route => this.handle(route));
  }

  reset(): void {
    this.job = initialJob(this.projectId);
    this.mutations.length = 0;
    this.unknown.length = 0;
    for (const key of [...this.contents.keys()]) {
      if (key !== 'artifact-script') this.contents.delete(key);
    }
  }

  mutationLog(): FakeStickmanMutation[] {
    return structuredClone(this.mutations);
  }

  snapshot(): FakeStickmanSnapshot {
    return {
      revision: this.job.revision,
      status: this.job.status,
      state: structuredClone(this.job.state),
      stages: this.job.stages.map(stage => ({
        stageId: stage.stageId,
        scopeKey: stage.scopeKey,
        status: stage.status,
        inputFingerprint: stage.inputFingerprint
      })),
      artifacts: this.job.artifacts.map(artifact => ({
        id: artifact.id,
        kind: artifact.kind,
        scopeKey: artifact.scopeKey,
        status: artifact.status,
        inputFingerprint: artifact.inputFingerprint
      })),
      providerRequests: this.job.providerRequests.map(request => ({
        provider: request.provider,
        scopeKey: request.scopeKey,
        status: request.status,
        generation: request.generation
      }))
    };
  }

  unknownRequestPaths(): string[] {
    return [...this.unknown];
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const marker = '/.opencreator/runtime';
    const path = `${url.pathname.slice(url.pathname.indexOf(marker) + marker.length)}${url.search}`;
    const pathWithoutQuery = path.split('?')[0]!;

    if (method === 'GET' && pathWithoutQuery === '/creator/templates') {
      return json(route, {
        templates: [{
          id: 'stickman-video',
          version: 2,
          renderer: 'stickman-video',
          outputs: [
            { kind: 'clean_video', required: true },
            { kind: 'narration_subtitle', required: true },
            { kind: 'delivery_manifest', required: true }
          ]
        }]
      });
    }
    if (method === 'GET' && pathWithoutQuery === '/creator/visual-assets') {
      return json(route, { assets: fakeVisualAssets() });
    }
    if (method === 'GET' && pathWithoutQuery === '/creator/yt-dlp/status') {
      return json(route, {
        ytDlp: {
          channel: 'nightly',
          source: 'bundled',
          currentVersion: '2026.08.31.120000',
          bundledVersion: '2026.08.31.120000',
          latestVersion: null,
          updateAvailable: false,
          checkDue: false,
          lastCheckedAt: null,
          lastCheckAttemptAt: null,
          installedAt: null
        }
      });
    }
    if (method === 'GET' && pathWithoutQuery === '/creator/jobs') {
      return json(route, { jobs: [this.cloneJob()] });
    }
    if (method === 'GET' && pathWithoutQuery === `/creator/jobs/${jobId}`) {
      return json(route, { job: this.cloneJob() });
    }
    if (
      method === 'GET'
      && (pathWithoutQuery === `/creator/jobs/${jobId}/agent-timeline`
        || pathWithoutQuery === `/creator/jobs/${jobId}/agent-history`)
    ) {
      return json(route, {
        session: null,
        turns: [],
        items: [],
        approvals: [],
        lastEventSequence: 0
      });
    }
    if (method === 'GET' && pathWithoutQuery === `/creator/jobs/${jobId}/events`) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        headers: { 'cache-control': 'no-cache' },
        body: ': fake-stickman-daemon\n\n'
      });
      return;
    }
    const artifactMatch = pathWithoutQuery.match(
      new RegExp(`^/creator/jobs/${jobId}/artifacts/([^/]+)/content$`)
    );
    if (method === 'GET' && artifactMatch !== null) {
      const artifactId = decodeURIComponent(artifactMatch[1]!);
      const content = this.contents.get(artifactId);
      if (content === undefined) return json(route, { code: 'artifact_not_found' }, 404);
      await route.fulfill({ status: 200, contentType: content.contentType, body: content.body });
      return;
    }
    if (method === 'POST' && pathWithoutQuery === `/creator/jobs/${jobId}/actions`) {
      const body = request.postDataJSON() as CreatorActionRequest;
      this.mutations.push({ method, path: pathWithoutQuery, body: structuredClone(body) });
      return this.applyAction(route, body);
    }
    if (method === 'POST' && pathWithoutQuery === `/creator/jobs/${jobId}/cancel`) {
      this.mutations.push({ method, path: pathWithoutQuery, body: null });
      this.job.status = 'canceled';
      this.bump('cancel', '已取消火柴人视频任务');
      return json(route, { job: this.cloneJob(), canceled: true, stage: null, stages: [] });
    }
    if (method === 'POST' && pathWithoutQuery === `/creator/jobs/${jobId}/resume`) {
      this.mutations.push({ method, path: pathWithoutQuery, body: null });
      this.job.status = 'needs_input';
      this.bump('resume', '已恢复火柴人视频任务');
      return json(route, { job: this.cloneJob(), resumed: true, stage: null, stages: [] });
    }

    this.unknown.push(`${method} ${path}`);
    await json(route, { code: 'fake_stickman_route_missing', path }, 404);
  }

  private async applyAction(route: Route, request: CreatorActionRequest): Promise<void> {
    if (request.expectedRevision !== this.job.revision) {
      return json(route, {
        code: 'creator_revision_conflict',
        message: 'Creator job revision conflict'
      }, 409);
    }
    switch (request.action) {
      case 'approve-script':
        this.approveScript();
        break;
      case 'continue-after-audio':
        this.continueAfterAudio();
        break;
      case 'continue-after-visuals':
        this.continueAfterVisuals();
        break;
      case 'regenerate-shot':
        this.regenerateShot(String(request.input.scopeKey ?? ''));
        break;
      case 'update-settings':
        this.job.state = {
          ...this.job.state,
          ...(isRecord(request.input.patch) ? request.input.patch : {})
        };
        this.bump(request.action, '已保存火柴人视频设置');
        break;
      default:
        return json(route, {
          code: 'creator_action_not_supported',
          message: `Unsupported fake action: ${request.action}`
        }, 400);
    }
    await json(route, {
      job: this.cloneJob(),
      receipt: {
        actor: request.actor ?? 'user',
        action: request.action,
        summary: this.job.activities.at(-1)?.summary ?? request.action,
        affectedArtifacts: [],
        newRevision: this.job.revision,
        createdAt: this.job.updatedAt
      }
    });
  }

  private approveScript(): void {
    const narrationOne = artifact('artifact-narration-01', 'narration_audio', 'segment-01', firstFingerprint, 'segment-01.wav');
    const narrationTwo = artifact('artifact-narration-02', 'narration_audio', 'segment-02', firstFingerprint, 'segment-02.wav');
    const timing = artifact('artifact-audio-timing', 'audio_timing', null, null, 'audio-timing.json');
    this.contents.set(narrationOne.id, { body: 'narration-one', contentType: 'audio/wav' });
    this.contents.set(narrationTwo.id, { body: 'narration-two', contentType: 'audio/wav' });
    this.contents.set(timing.id, {
      body: JSON.stringify({
        scriptArtifactId: 'artifact-script',
        timingSource: 'ffprobe_cumulative_tts_duration',
        segments: [
          { segmentId: 'segment-01', startSeconds: 0, endSeconds: 5, durationSeconds: 5, audioArtifactId: narrationOne.id, audioSha256: narrationOne.sha256 },
          { segmentId: 'segment-02', startSeconds: 5, endSeconds: 10, durationSeconds: 5, audioArtifactId: narrationTwo.id, audioSha256: narrationTwo.sha256 }
        ],
        totalDurationSeconds: 10
      }),
      contentType: 'application/json; charset=utf-8'
    });
    this.job.artifacts.push(narrationOne, narrationTwo, timing);
    this.job.stages.push(
      stage('narration', 'succeeded', 'segment-01', firstFingerprint),
      stage('narration', 'succeeded', 'segment-02', firstFingerprint),
      stage('audio-timing', 'succeeded')
    );
    this.job.status = 'running';
    this.job.state = {
      ...this.job.state,
      approvedScriptArtifactId: 'artifact-script',
      workflowTarget: 'audio_ready',
      currentStage: 'audio-timing',
      needsInput: null
    };
    this.bump('approve-script', '脚本已确认，配音与节奏已生成');
  }

  private continueAfterAudio(): void {
    const shotSpec = artifact('artifact-shot-spec', 'shot_spec', null, null, 'shot-spec.json');
    this.contents.set(shotSpec.id, {
      body: JSON.stringify({
        scriptArtifactId: 'artifact-script',
        audioTimingArtifactId: 'artifact-audio-timing',
        timingSource: 'ffprobe_cumulative_tts_duration',
        shots: [
          {
            id: 'shot-01',
            sourceSegmentId: 'segment-01',
            semanticAnchor: '每次增长成为下一次增长的基础',
            visualDescription: '人物把一枚硬币放入逐渐升高的增长曲线',
            compositionAndAction: '人物位于画面左侧，把硬币放入右侧向上延伸的增长曲线',
            keyObjects: ['硬币', '增长曲线'],
            continuityReason: '',
            motion: 'push-in',
            motionReason: '聚焦硬币进入增长曲线的关键动作',
            startSeconds: 0,
            endSeconds: 5,
            durationSeconds: 5
          },
          {
            id: 'shot-02',
            sourceSegmentId: 'segment-02',
            semanticAnchor: '时间拉大复利与线性积累的差距',
            visualDescription: '人物观察直线与指数曲线之间逐渐扩大的距离',
            compositionAndAction: '人物位于画面中央，对比两条向右延伸且差距逐渐扩大的曲线',
            keyObjects: ['直线', '指数曲线'],
            continuityReason: '承接上一镜头的增长曲线并展示长期结果',
            motion: 'pan-right',
            motionReason: '沿时间方向展示两条曲线的差距变化',
            startSeconds: 5,
            endSeconds: 10,
            durationSeconds: 5
          }
        ]
      }),
      contentType: 'application/json; charset=utf-8'
    });
    this.job.artifacts.push(shotSpec);
    const shotOne = artifact('artifact-shot-01-v1', 'shot_image', 'shot-01', firstFingerprint, 'shot-01.png');
    const shotTwo = artifact('artifact-shot-02-v1', 'shot_image', 'shot-02', firstFingerprint, 'shot-02.png');
    const validation = artifact('artifact-visual-validation', 'visual_validation', null, null, 'visual-validation.json');
    this.contents.set(shotOne.id, { body: transparentPng, contentType: 'image/png' });
    this.contents.set(shotTwo.id, { body: transparentPng, contentType: 'image/png' });
    this.contents.set(validation.id, {
      body: JSON.stringify({ valid: true, shotCount: 2 }),
      contentType: 'application/json; charset=utf-8'
    });
    this.job.artifacts.push(shotOne, shotTwo, validation);
    this.job.stages.push(
      stage('storyboard', 'succeeded'),
      stage('images', 'succeeded', 'shot-01', firstFingerprint),
      stage('images', 'succeeded', 'shot-02', firstFingerprint),
      stage('visual-validation', 'succeeded')
    );
    this.job.providerRequests = [providerRequest()];
    this.job.state = {
      ...this.job.state,
      workflowTarget: 'visuals_ready',
      currentStage: 'visual-validation',
      needsInput: null
    };
    this.bump('continue-after-audio', '配音已确认，分镜画面已生成');
  }

  private continueAfterVisuals(): void {
    this.job.state = {
      ...this.job.state,
      workflowTarget: 'delivery_ready',
      currentStage: 'timeline'
    };
    this.completeTechnicalDraft(1);
    this.bump('continue-after-visuals', '画面已确认，动画和交付文件已生成');
  }

  private regenerateShot(scopeKey: string): void {
    if (scopeKey !== 'shot-01') throw new Error(`Unexpected scope: ${scopeKey}`);
    const previous = this.job.artifacts.find(item => item.id === 'artifact-shot-01-v1');
    if (previous !== undefined) previous.status = 'stale';
    const next = artifact('artifact-shot-01-v2', 'shot_image', 'shot-01', secondFingerprint, 'shot-01-v2.png', 2);
    this.contents.set(next.id, { body: transparentPng, contentType: 'image/png' });
    this.job.artifacts.push(next);
    this.job.stages.push(stage('images', 'succeeded', 'shot-01', secondFingerprint, 2));
    for (const artifact of this.job.artifacts) {
      if (artifact.kind === 'visual_validation' || isDeliveryKind(artifact.kind)) {
        artifact.status = 'stale';
      }
    }
    const validation = artifact(
      'artifact-visual-validation-v2',
      'visual_validation',
      null,
      null,
      'visual-validation-v2.json',
      2
    );
    this.contents.set(validation.id, {
      body: JSON.stringify({ valid: true, shotCount: 2, technicalDraft: true }),
      contentType: 'application/json; charset=utf-8'
    });
    this.job.artifacts.push(validation);
    this.job.stages.push(stage('visual-validation', 'succeeded', null, null, 2));
    this.job.state = {
      ...this.job.state,
      workflowTarget: 'visuals_ready',
      currentStage: 'visual-validation',
      needsInput: null
    };
    this.bump('regenerate-shot', '镜头 01 已按精确作用域重生成');
  }

  private completeTechnicalDraft(version: number): void {
    const suffix = version === 1 ? '' : `-v${version}`;
    const deliveries = [
      artifact(`artifact-clean-video${suffix}`, 'clean_video', null, null, `stickman-video${suffix}.mp4`, version),
      artifact(`artifact-narration-subtitle${suffix}`, 'narration_subtitle', null, null, `narration${suffix}.srt`, version),
      artifact(`artifact-delivery-manifest${suffix}`, 'delivery_manifest', null, null, `delivery-manifest${suffix}.json`, version)
    ];
    for (const delivery of deliveries) {
      this.contents.set(delivery.id, delivery.kind === 'delivery_manifest'
          ? {
              body: JSON.stringify({
                packageStatus: 'technical-draft',
                placeholderAssets: deliveries.map(item => `${item.kind}:${item.id}`),
                blockingChecks: ['fake_provider', 'media_validation_unverified'],
                files: deliveries.filter(item => item.kind !== 'delivery_manifest').map(item => ({
                  name: item.metadata.fileName,
                  relativePath: String(item.metadata.fileName),
                  sourceArtifactId: item.id,
                  sha256: item.sha256,
                  bytes: 1,
                  mime: mediaType(item.kind)
                }))
              }),
              contentType: 'application/json; charset=utf-8'
            }
          : { body: `${delivery.kind}\n`, contentType: mediaType(delivery.kind) });
    }
    this.job.artifacts.push(...deliveries);
    this.job.stages.push(
      stage('timeline', 'succeeded', null, null, version),
      stage('render-clean', 'succeeded', null, null, version),
      stage('media-validation', 'succeeded', null, null, version),
      stage('package-validation', 'succeeded', null, null, version)
    );
    this.job.status = 'completed';
    const previousSnapshots = Array.isArray(this.job.state.resultSnapshots)
      ? this.job.state.resultSnapshots
      : [];
    this.job.state = {
      ...this.job.state,
      workflowTarget: 'delivery_ready',
      currentStage: 'package-validation',
      needsInput: null,
      packageStatus: 'technical-draft',
      resultSnapshots: [...previousSnapshots, {
        version,
        createdAt: '2026-08-31T08:05:00.000Z',
        action: 'stage-succeeded',
        stageId: 'package-validation',
        description: '完成视频与旁白字幕交付',
        artifactRefs: Object.fromEntries(deliveries.map(item => [item.kind, [item.id]])),
        changedArtifactIds: deliveries.map(item => item.id),
        staleArtifactIds: ['artifact-shot-01-v1'],
        state: { packageStatus: 'technical-draft' }
      }]
    };
  }

  private bump(action: string, summary: string): void {
    this.job.revision += 1;
    this.job.updatedAt = `2026-08-31T08:${String(this.job.revision).padStart(2, '0')}:00.000Z`;
    this.job.activities.push(activity(this.job.revision, action, summary));
  }

  private cloneJob(): CreatorJob {
    return structuredClone(this.job);
  }
}

function initialJob(projectId: string): CreatorJob {
  return {
    id: jobId,
    projectId,
    templateId: 'stickman-video',
    templateVersion: 2,
    status: 'needs_input',
    revision: 3,
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=OpenCreatorStickmanE2E',
      characterAsset: { assetId: 'stickman.character.default', revision: 1 },
      styleAsset: { assetId: 'stickman.style.paper-pencil', revision: 1 },
      ratio: '16:9',
      targetDurationSeconds: 20,
      targetLanguage: 'zh-CN',
      ttsProvider: 'openai',
      ttsModel: 'gpt-4o-mini-tts',
      voiceCode: 'marin',
      voiceName: 'Marin',
      workflowTarget: 'script_ready',
      currentStage: null,
      needsInput: review('approve-script', 'artifact-script', '请审核脚本后继续')
    },
    agentThreadId: null,
    stages: [
      stage('acquire-source', 'succeeded'),
      stage('source-transcript', 'succeeded'),
      stage('source-brief', 'succeeded'),
      stage('content-plan', 'succeeded'),
      stage('script', 'succeeded')
    ],
    artifacts: [artifact('artifact-script', 'script_manifest', null, null, 'script-manifest.json')],
    providerRequests: [],
    activities: [
      activity(1, 'update-settings', '已保存来源、角色与视觉风格'),
      activity(2, 'run-stage', '已开始执行火柴人视频生产'),
      activity(3, 'stage-succeeded', '脚本生成完成，等待审核')
    ],
    createdAt,
    updatedAt: '2026-08-31T08:03:00.000Z'
  };
}

function fakeVisualAssets() {
  return [{
    id: 'stickman.character.default',
    revision: 1,
    templateId: 'stickman-video',
    kind: 'character',
    source: 'builtin',
    status: 'ready',
    name: { zhCN: '默认角色', en: 'Default' },
    description: { zhCN: '通用火柴人角色', en: 'General stick-figure character' },
    previewUrl: null,
    referenceCount: 1,
    recommended: true,
    tags: ['neutral']
  }, {
    id: 'stickman.style.paper-pencil',
    revision: 1,
    templateId: 'stickman-video',
    kind: 'style',
    source: 'builtin',
    status: 'ready',
    name: { zhCN: '纸面铅笔手绘', en: 'Pencil sketch on paper' },
    description: { zhCN: '纸面、铅笔轮廓与石墨排线', en: 'Paper, pencil contours, and graphite hatching' },
    previewUrl: null,
    referenceCount: 0,
    recommended: true,
    tags: ['pencil'],
    styleAttributes: {
      medium: { zhCN: '石墨铅笔', en: 'Graphite pencil' },
      palette: { zhCN: '纸白、黑、灰', en: 'Paper white, black, gray' },
      sceneDensity: { zhCN: '中等', en: 'Medium' },
      swatch: {
        background: '#f5f3ed',
        foreground: '#252525',
        accent: '#8a8a86',
        texture: 'paper'
      }
    }
  }];
}

function stage(
  stageId: string,
  status: CreatorStageRun['status'],
  scopeKey: string | null = null,
  inputFingerprint: string | null = null,
  attempt = 1
): CreatorStageRun {
  return {
    id: `stage-${stageId}-${scopeKey ?? 'global'}-${attempt}`,
    jobId,
    stageId,
    executor: stageId === 'images' ? 'stickman-image' : `stickman-${stageId}`,
    status,
    dispatchStatus: 'finished',
    claimOwner: null,
    claimExpiresAt: null,
    attempt,
    idempotencyKey: `fake:${stageId}:${scopeKey ?? 'global'}:${attempt}`,
    scopeKey,
    inputFingerprint,
    progress: scopeKey === null ? { phase: 'completed' } : { phase: 'completed', percent: 100 },
    errorCode: null,
    errorMessage: null,
    startedAt: createdAt,
    finishedAt: '2026-08-31T08:01:00.000Z'
  };
}

function artifact(
  id: string,
  kind: string,
  scopeKey: string | null,
  inputFingerprint: string | null,
  fileName: string,
  version = 1
): CreatorArtifact {
  return {
    id,
    jobId,
    kind,
    version,
    status: 'completed',
    path: `/fake-stickman/${fileName}`,
    scopeKey,
    inputFingerprint,
    sha256: version === 1 ? 'a'.repeat(64) : 'b'.repeat(64),
    sourceArtifactIds: [],
    metadata: {
      fileName,
      placeholder: true,
      technicalDraft: true
    },
    createdAt: version === 1 ? createdAt : '2026-08-31T08:04:00.000Z'
  };
}

function providerRequest(): CreatorProviderRequest {
  return {
    id: 'provider-request-shot-01',
    jobId,
    provider: 'openai',
    stageRunId: 'stage-images-shot-01-1',
    scopeKey: 'shot-01',
    requestKey: 'fake-provider-request',
    requestHash: 'c'.repeat(64),
    remoteTaskId: 'fake-provider-task',
    billingSideEffect: true,
    status: 'succeeded',
    resultArtifactId: 'artifact-shot-01-v1',
    generation: 1,
    resubmissionOf: null,
    createdAt,
    updatedAt: createdAt
  };
}

function activity(revision: number, action: string, summary: string): CreatorActivity {
  return {
    id: `activity-${revision}-${action}`,
    jobId,
    revision,
    actor: 'user',
    action,
    summary,
    details: {},
    createdAt: `2026-08-31T08:${String(revision).padStart(2, '0')}:00.000Z`
  };
}

function review(kind: string, artifactId: string, message: string) {
  return {
    code: 'creator_review_required',
    kind,
    artifactId,
    message
  };
}

function mediaType(kind: string): string {
  if (kind.includes('video')) return 'video/mp4';
  if (kind.includes('subtitle')) return 'application/x-subrip; charset=utf-8';
  if (kind.includes('manifest')) return 'application/json; charset=utf-8';
  return 'text/markdown; charset=utf-8';
}

function isDeliveryKind(kind: string): boolean {
  return [
    'clean_video',
    'narration_subtitle',
    'delivery_manifest'
  ].includes(kind);
}

function isRecord(value: unknown): value is Record<string, never> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body)
  });
}
