import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { CreatorArtifact, CreatorJob, CreatorServicesConfig } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { parseCreatorServicesConfig } from '../../src/creator-services/config-store.js';

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const enabled = process.env.OPENCREATOR_RUN_REAL_STICKMAN_E2E === '1';
const configPath = process.env.OPENCREATOR_STICKMAN_E2E_CONFIG;
const youtubeUrl = process.env.OPENCREATOR_STICKMAN_E2E_YOUTUBE_URL;
const krillinRuntimeRoot = resolve(
  process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT
    ?? join(repoRoot, 'apps', 'desktop', '.pack', 'creator-runtime', 'krillinai')
);
const stickmanRuntimeRoot = resolve(
  process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT
    ?? join(repoRoot, 'apps', 'desktop', '.pack', 'stickman-runtime')
);
const execFileAsync = promisify(execFile);
let server: FastifyInstance | undefined;
let previousCreatorRuntimeRoot: string | undefined;
let previousStickmanRuntimeRoot: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  restoreEnvironment('OPENCREATOR_CREATOR_RUNTIME_ROOT', previousCreatorRuntimeRoot);
  restoreEnvironment('OPENCREATOR_STICKMAN_RUNTIME_ROOT', previousStickmanRuntimeRoot);
});

describe('stickman real provider pipeline', () => {
  it.skipIf(!enabled)(
    '通过公开 Creator API 生成并验证固定五项真实交付',
    async () => {
      if (configPath === undefined || youtubeUrl === undefined) {
        throw new Error(
          '真实火柴人 E2E 需要 OPENCREATOR_STICKMAN_E2E_CONFIG '
          + '和 OPENCREATOR_STICKMAN_E2E_YOUTUBE_URL'
        );
      }
      for (const path of [configPath, krillinRuntimeRoot, stickmanRuntimeRoot]) {
        if (!existsSync(path)) throw new Error(`真实火柴人 E2E 依赖不存在：${path}`);
      }

      const config = readPrivateConfig(configPath);
      const evidenceRoot = createEvidenceRoot();
      previousCreatorRuntimeRoot = process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT;
      previousStickmanRuntimeRoot = process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT;
      process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT = krillinRuntimeRoot;
      process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT = stickmanRuntimeRoot;
      server = await buildServer({
        token: 'stickman-real-e2e',
        dataDir: join(evidenceRoot, 'runtime'),
        codexHome: join(evidenceRoot, 'codex-home'),
        creatorServicesConfigStore: inMemoryConfigStore(config),
        codexProviderCredentialStore: {
          async readApiKey() { return undefined; },
          async writeApiKey() {}
        }
      });

      const created = await request('POST', '/creator/jobs', {
        projectId: 'project_stickman_real_e2e',
        templateId: 'stickman-video',
        state: {
          sourceType: 'url',
          sourceUrl: youtubeUrl,
          selectedPresetId: 'default',
          characterPrompt: '统一的极简火柴人角色，白色圆形头部，黑色线条',
          style: '极简黑白线稿，知识解释动画',
          ratio: '16:9',
          targetDurationSeconds: 20,
          targetLanguage: 'zh-CN',
          voice: defaultVoice(config),
          provider: config.image.provider,
          quality: 'medium'
        }
      });
      expect(created.statusCode).toBe(201);
      const jobId = created.json().job.id as string;

      const started = await request('POST', `/creator/jobs/${jobId}/actions`, {
        action: 'run-stage',
        expectedRevision: 0,
        input: { stageId: 'acquire-source' }
      });
      expect(started.statusCode).toBe(200);

      const scriptGate = await waitForReview(jobId, 'approve-script');
      await approve(jobId, scriptGate, 'approve-script');
      const storyboardGate = await waitForReview(jobId, 'approve-storyboard');
      await approve(jobId, storyboardGate, 'approve-storyboard');
      const visualGate = await waitForReview(jobId, 'approve-visuals');
      await approve(jobId, visualGate, 'approve-visuals');
      const completed = await waitForJob(jobId, job => job.status === 'completed', 45 * 60_000);

      const deliveryKinds = [
        'clean_video',
        'cover_image',
        'publish_copy',
        'bilingual_video',
        'bilingual_subtitle'
      ] as const;
      const deliveries = deliveryKinds.map(kind => requireDelivery(completed, kind));
      for (const artifact of deliveries) {
        expect(artifact.path, `${artifact.kind} 路径`).toBeTruthy();
        expect(statSync(artifact.path!).size, `${artifact.kind} 文件大小`).toBeGreaterThan(0);
        expect(hashFile(artifact.path!), `${artifact.kind} Artifact 哈希`).toBe(artifact.sha256);
      }

      const cover = requireDelivery(completed, 'cover_image');
      expect(await sharp(cover.path!).metadata()).toMatchObject({
        format: 'png',
        width: 1280,
        height: 720
      });
      const ffprobePath = findRuntimeExecutable(krillinRuntimeRoot, /(?:^|\/)ffprobe(?:\.exe)?$/i);
      for (const kind of ['clean_video', 'bilingual_video'] as const) {
        const video = requireDelivery(completed, kind);
        const probe = JSON.parse((await execFileAsync(ffprobePath, [
          '-v', 'error',
          '-show_entries', 'stream=codec_type,width,height:format=duration',
          '-of', 'json',
          video.path!
        ], { windowsHide: true })).stdout) as {
          streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
          format?: { duration?: string };
        };
        expect(probe.streams).toEqual(expect.arrayContaining([
          expect.objectContaining({ codec_type: 'video', width: 1280, height: 720 }),
          expect.objectContaining({ codec_type: 'audio' })
        ]));
        expect(Number(probe.format?.duration ?? 0)).toBeGreaterThan(0);
      }
      const subtitle = readFileSync(
        requireDelivery(completed, 'bilingual_subtitle').path!,
        'utf8'
      );
      expect(subtitle).toMatch(/\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} --> /);
      expect(subtitle.split(/\r?\n/).filter(line => line.trim().length > 0).length)
        .toBeGreaterThanOrEqual(4);
      const publishCopy = readFileSync(requireDelivery(completed, 'publish_copy').path!, 'utf8');
      expect(publishCopy).toMatch(/^#\s+\S+/m);
      expect(publishCopy).toMatch(/^##\s+Tags\s*$/mi);

      const manifestArtifact = requireDelivery(completed, 'delivery_manifest');
      const manifest = JSON.parse(readFileSync(manifestArtifact.path!, 'utf8')) as {
        files: Array<{
          name: string;
          relativePath: string;
          sha256: string;
          bytes: number;
          sourceArtifactId: string;
        }>;
      };
      expect(manifest.files).toHaveLength(5);
      for (const file of manifest.files) {
        const delivery = deliveries.find(item => item.id === file.sourceArtifactId);
        expect(delivery, `Manifest 来源 ${file.sourceArtifactId}`).toBeDefined();
        expect(file.sha256).toBe(delivery!.sha256);
        expect(file.bytes).toBe(statSync(delivery!.path!).size);
      }

      const summary = {
        jobId,
        evidenceRoot,
        providerRequestCount: completed.providerRequests.length,
        billingRequestCount: completed.providerRequests.filter(item => item.billingSideEffect).length,
        deliveries: Object.fromEntries(deliveries.map(item => [item.kind, {
          path: item.path,
          sha256: item.sha256,
          bytes: statSync(item.path!).size
        }])),
        manifest: {
          path: manifestArtifact.path,
          sha256: manifestArtifact.sha256,
          files: manifest.files
        }
      };
      writeFileSync(
        join(evidenceRoot, 'stickman-real-pipeline-summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
        'utf8'
      );
      console.info(
        `真实火柴人流水线证据：${evidenceRoot}；Provider 请求 ${summary.providerRequestCount} 次，`
        + `计费请求 ${summary.billingRequestCount} 次`
      );
    },
    50 * 60_000
  );
});

function readPrivateConfig(path: string): CreatorServicesConfig {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const candidate = isRecord(parsed) && 'config' in parsed ? parsed.config : parsed;
  const config = parseCreatorServicesConfig(candidate);
  config.llm.source = 'custom';
  return config;
}

function inMemoryConfigStore(config: CreatorServicesConfig) {
  let current = structuredClone(config);
  return {
    async read() { return structuredClone(current); },
    async write(next: CreatorServicesConfig) {
      current = structuredClone(next);
      return structuredClone(current);
    },
    async reset() {
      current = structuredClone(config);
      return structuredClone(current);
    }
  };
}

function defaultVoice(config: CreatorServicesConfig): string {
  if (config.tts.provider === 'edge-tts') return 'zh-CN-XiaoxiaoNeural';
  return config.tts[config.tts.provider].defaultVoiceId;
}

async function approve(
  jobId: string,
  job: CreatorJob,
  action: 'approve-script' | 'approve-storyboard' | 'approve-visuals'
): Promise<void> {
  const needsInput = readNeedsInput(job);
  const response = await request('POST', `/creator/jobs/${jobId}/actions`, {
    action,
    expectedRevision: job.revision,
    input: {
      artifactId: needsInput.artifactId,
      revision: job.revision
    }
  });
  expect(response.statusCode).toBe(200);
}

async function waitForReview(
  jobId: string,
  kind: 'approve-script' | 'approve-storyboard' | 'approve-visuals'
): Promise<CreatorJob> {
  return waitForJob(jobId, job => (
    job.status === 'needs_input' && readNeedsInput(job).kind === kind
  ), 30 * 60_000);
}

async function waitForJob(
  jobId: string,
  predicate: (job: CreatorJob) => boolean,
  timeoutMs: number
): Promise<CreatorJob> {
  const deadline = Date.now() + timeoutMs;
  let latest: CreatorJob | undefined;
  while (Date.now() < deadline) {
    const response = await request('GET', `/creator/jobs/${jobId}`);
    expect(response.statusCode).toBe(200);
    latest = response.json().job as CreatorJob;
    if (predicate(latest)) return latest;
    if (latest.status === 'failed' || latest.status === 'canceled') {
      const stage = latest.stages.at(-1);
      throw new Error(
        `真实火柴人流水线提前终止：${latest.status} ${stage?.stageId ?? ''} `
        + `${stage?.errorCode ?? ''} ${stage?.errorMessage ?? ''}`
      );
    }
    const needsInput = latest.state.needsInput;
    if (
      latest.status === 'needs_input'
      && isRecord(needsInput)
      && needsInput.code === 'creator_provider_resolution_required'
    ) {
      throw new Error(`真实 Provider 接受状态未知，需要人工处置：${JSON.stringify(needsInput)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `等待真实火柴人流水线超时：${jobId} ${latest?.status ?? 'unknown'} `
    + `${latest?.stages.at(-1)?.stageId ?? ''}`
  );
}

function readNeedsInput(job: CreatorJob): { kind: string; artifactId: string } {
  const value = job.state.needsInput;
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.artifactId !== 'string') {
    return { kind: '', artifactId: '' };
  }
  return { kind: value.kind, artifactId: value.artifactId };
}

function requireDelivery(job: CreatorJob, kind: string): CreatorArtifact {
  const candidates = job.artifacts.filter(item => item.kind === kind && item.status === 'completed');
  if (candidates.length !== 1) {
    throw new Error(`真实交付 ${kind} 数量错误：${candidates.length}`);
  }
  return candidates[0]!;
}

function findRuntimeExecutable(runtimeRoot: string, pattern: RegExp): string {
  const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8')) as {
    resources: Array<{ path: string; kind: string }>;
  };
  const resource = manifest.resources.find(item => item.kind === 'executable' && pattern.test(item.path));
  if (resource === undefined) throw new Error(`Runtime 缺少可执行文件：${pattern}`);
  return resolve(runtimeRoot, resource.path);
}

function createEvidenceRoot(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = resolve(
    process.env.OPENCREATOR_STICKMAN_E2E_EVIDENCE_DIR
      ?? join(repoRoot, 'test-results', 'stickman-real-pipeline', timestamp)
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function request(
  method: 'GET' | 'POST',
  url: string,
  payload?: object
): Promise<{ statusCode: number; json(): any }> {
  return await server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer stickman-real-e2e' },
    ...(payload === undefined ? {} : { payload })
  }) as unknown as { statusCode: number; json(): any };
}
