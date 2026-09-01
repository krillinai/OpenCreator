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
        title: '用火柴人理解复利',
        language: 'zh-CN',
        segments: [
          {
            id: 'segment-01',
            narration: '复利让每一次增长都成为下一次增长的基础。',
            durationSeconds: 5,
            sourceKeyPoint: '复利的核心定义'
          },
          {
            id: 'segment-02',
            narration: '时间越长，增长曲线与线性积累的差距越明显。',
            durationSeconds: 5,
            sourceKeyPoint: '时间的放大作用'
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
            { kind: 'cover_image', required: true },
            { kind: 'publish_copy', required: true },
            { kind: 'bilingual_video', required: true },
            { kind: 'bilingual_subtitle', required: true }
          ]
        }]
      });
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
      case 'approve-storyboard':
        this.approveStoryboard();
        break;
      case 'regenerate-shot':
        this.regenerateShot(String(request.input.scopeKey ?? ''));
        break;
      case 'approve-visuals':
        this.approveVisuals();
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
    const shotSpec = artifact('artifact-shot-spec', 'shot_spec', null, null, 'shot-spec.json');
    this.contents.set(shotSpec.id, {
      body: JSON.stringify({
        scriptArtifactId: 'artifact-script',
        shots: [
          {
            id: 'shot-01',
            sourceSegmentId: 'segment-01',
            narration: '复利让每一次增长都成为下一次增长的基础。',
            imagePrompt: '白底黑线火柴人把一枚硬币放进增长曲线',
            motion: 'push-in',
            durationSeconds: 5
          },
          {
            id: 'shot-02',
            sourceSegmentId: 'segment-02',
            narration: '时间越长，增长曲线与线性积累的差距越明显。',
            imagePrompt: '火柴人对比直线与指数曲线，画面简洁',
            motion: 'pan-right',
            durationSeconds: 5
          }
        ]
      }),
      contentType: 'application/json; charset=utf-8'
    });
    this.job.artifacts.push(shotSpec);
    this.job.stages.push(stage('storyboard', 'succeeded'));
    this.job.status = 'needs_input';
    this.job.state = {
      ...this.job.state,
      approvedScriptArtifactId: 'artifact-script',
      needsInput: review('approve-storyboard', shotSpec.id, '请审核分镜后生成画面')
    };
    this.bump('approve-script', '脚本审核通过，已生成 2 个分镜');
  }

  private approveStoryboard(): void {
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
      stage('images', 'succeeded', 'shot-01', firstFingerprint),
      stage('images', 'succeeded', 'shot-02', firstFingerprint),
      stage('visual-validation', 'succeeded')
    );
    this.job.providerRequests = [providerRequest()];
    this.job.status = 'needs_input';
    this.job.state = {
      ...this.job.state,
      approvedShotSpecArtifactId: 'artifact-shot-spec',
      needsInput: review('approve-visuals', validation.id, '请确认画面后继续成片')
    };
    this.bump('approve-storyboard', '分镜审核通过，2 个镜头画面已生成');
  }

  private regenerateShot(scopeKey: string): void {
    if (scopeKey !== 'shot-01') throw new Error(`Unexpected scope: ${scopeKey}`);
    const previous = this.job.artifacts.find(item => item.id === 'artifact-shot-01-v1');
    if (previous !== undefined) previous.status = 'stale';
    const next = artifact('artifact-shot-01-v2', 'shot_image', 'shot-01', secondFingerprint, 'shot-01-v2.png', 2);
    this.contents.set(next.id, { body: transparentPng, contentType: 'image/png' });
    this.job.artifacts.push(next);
    this.job.stages.push(stage('images', 'succeeded', 'shot-01', secondFingerprint, 2));
    this.job.state = {
      ...this.job.state,
      needsInput: review('approve-visuals', 'artifact-visual-validation', '镜头 01 已重生成，请确认画面')
    };
    this.bump('regenerate-shot', '镜头 01 已按精确作用域重生成');
  }

  private approveVisuals(): void {
    const deliveries = [
      artifact('artifact-clean-video', 'clean_video', null, null, 'stickman-clean.mp4'),
      artifact('artifact-cover', 'cover_image', null, null, 'youtube-cover.png'),
      artifact('artifact-copy', 'publish_copy', null, null, 'publish-copy-youtube.md'),
      artifact('artifact-bilingual-video', 'bilingual_video', null, null, 'stickman-bilingual.mp4'),
      artifact('artifact-bilingual-subtitle', 'bilingual_subtitle', null, null, 'stickman-bilingual.srt'),
      artifact('artifact-delivery-manifest', 'delivery_manifest', null, null, 'delivery-manifest.json')
    ];
    for (const delivery of deliveries) {
      this.contents.set(delivery.id, delivery.kind === 'cover_image'
        ? { body: transparentPng, contentType: 'image/png' }
        : { body: `${delivery.kind}\n`, contentType: mediaType(delivery.kind) });
    }
    this.job.artifacts.push(...deliveries);
    this.job.stages.push(
      stage('timeline', 'succeeded'),
      stage('render-clean', 'succeeded'),
      stage('cover', 'succeeded'),
      stage('subtitles', 'succeeded'),
      stage('publish-copy', 'succeeded'),
      stage('bilingual-render', 'succeeded'),
      stage('package-validation', 'succeeded')
    );
    this.job.status = 'completed';
    this.job.state = {
      ...this.job.state,
      approvedVisualValidationArtifactId: 'artifact-visual-validation',
      needsInput: null,
      resultSnapshots: [{
        version: 1,
        createdAt: '2026-08-31T08:05:00.000Z',
        action: 'stage-succeeded',
        stageId: 'package-validation',
        description: '完成固定五项交付',
        artifactRefs: Object.fromEntries(deliveries.map(item => [item.kind, [item.id]])),
        changedArtifactIds: deliveries.map(item => item.id),
        staleArtifactIds: ['artifact-shot-01-v1'],
        state: { validated: true }
      }]
    };
    this.bump('approve-visuals', '画面审核通过，固定五项交付已完成');
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
      selectedPresetId: 'default',
      characterPrompt: '统一的极简火柴人角色，白色圆形头部，黑色线条',
      style: '极简黑白线稿',
      ratio: '16:9',
      targetDurationSeconds: 20,
      targetLanguage: 'zh-CN',
      voice: 'alloy',
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
      ...(kind === 'cover_image' ? { width: 1280, height: 720 } : {})
    },
    createdAt: version === 1 ? createdAt : '2026-08-31T08:04:00.000Z'
  };
}

function providerRequest(): CreatorProviderRequest {
  return {
    id: 'provider-request-unknown',
    jobId,
    provider: 'openai',
    stageRunId: 'stage-cover-global-0',
    scopeKey: null,
    requestKey: 'fake-provider-request',
    requestHash: 'c'.repeat(64),
    remoteTaskId: null,
    billingSideEffect: true,
    status: 'unknown_remote_acceptance',
    resultArtifactId: null,
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
