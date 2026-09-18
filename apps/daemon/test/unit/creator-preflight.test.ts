import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig, type CreatorJob, type CreatorJson } from '@opencreator/protocol';
import { createCreatorPreflight } from '../../src/creator/preflight.js';
import { createImageGenerationTemplate } from '../../src/creator/templates/image-generation.js';
import { createVideoDownloadTemplate } from '../../src/creator/templates/video-download.js';
import { createStickmanVideoTemplate } from '../../src/creator/templates/stickman-video.js';
import { createCoverTemplate } from '../../src/creator/templates/cover.js';
import { createKrillinCreatorServicesCapabilities } from '../../src/creator/krillin/capabilities.js';

let root = '';

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('creator preflight', () => {
  it('blocks a stage with missing provider credentials and provides a settings repair', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    const job = fakeJob('image-generation', { provider: 'openai', prompt: 'test' });
    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['image']
    }).check(job, createImageGenerationTemplate().stages[0]!);

    expect(result.canStart).toBe(false);
    expect(result.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'image-provider',
        repair: expect.objectContaining({ deepLink: '#/settings?tab=ai-services&section=image' })
      })
    ]));
  });

  it('reports local dependency failures before creating a download stage', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const job = fakeJob('video-download', { sourceUrl: 'https://youtu.be/example' });
    const result = await createCreatorPreflight({
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['download'],
      validateRuntimeAssets: true
    }).check(job, createVideoDownloadTemplate().stages[0]!);

    expect(result.canStart).toBe(false);
    expect(result.blocked.map(item => item.id)).toEqual(expect.arrayContaining(['ffmpeg', 'ffprobe', 'yt-dlp']));
    expect(result.blocked.every(item => item.repair.label.length > 0)).toBe(true);
  });

  it('blocks a reference image when the configured provider cannot edit images', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const referencePath = join(root, 'reference.png');
    await writeFile(referencePath, 'image');
    const config = createDefaultCreatorServicesConfig();
    config.image.jimeng.apiKey = 'test-key';
    const job = fakeJob('image-generation', {
      provider: 'jimeng',
      prompt: 'test',
      referenceImageArtifactId: 'reference-image'
    });
    job.artifacts.push({
      id: 'reference-image',
      jobId: job.id,
      kind: 'reference_image',
      status: 'completed',
      version: 1,
      path: referencePath,
      scopeKey: null,
      inputFingerprint: null,
      sha256: null,
      sourceArtifactIds: [],
      metadata: {},
      createdAt: new Date(0).toISOString()
    });

    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['image']
    }).check(job, createImageGenerationTemplate().stages[0]!);

    expect(result.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'reference-image-capability' })
    ]));
  });

  it.each([
    ['source-brief', 'stickman-content', 'llm'],
    ['narration', 'stickman-audio', 'tts'],
    ['images', 'stickman-image', 'image-provider'],
    ['render-clean', 'stickman-remotion', 'ffprobe']
  ] as const)('checks the real Stickman %s executor requirements', async (stageId, executor, blockedId) => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const stage = createStickmanVideoTemplate().stages.find(candidate => candidate.id === stageId)!;
    const result = await createCreatorPreflight({
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: [executor]
    }).check(fakeJob('stickman-video', {}), stage);

    expect(result.blocked.map(item => item.id)).toContain(blockedId);
  });

  it('checks the Cover source analysis executor instead of the image executor', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const stage = createCoverTemplate().stages.find(candidate => candidate.id === 'analyze-source')!;
    const result = await createCreatorPreflight({
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['cover-analysis']
    }).check(fakeJob('cover', { sourceType: 'youtube', sourceUrl: 'https://youtu.be/example' }), stage);

    expect(result.blocked.map(item => item.id)).toEqual(expect.arrayContaining(['llm', 'yt-dlp']));
  });

  it('resolves historical stale inputs the same way as StageRunner', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const referencePath = join(root, 'reference.png');
    await writeFile(referencePath, 'image');
    const config = createDefaultCreatorServicesConfig();
    config.image.openai.apiKey = 'test-key';
    config.image.openai.baseUrl = 'https://example.test/v1';
    config.image.openai.model = 'image-model';
    const job = fakeJob('image-generation', {
      provider: 'openai',
      prompt: 'test',
      referenceImageArtifactId: 'reference-image',
      resultSnapshots: [{
        version: 1,
        createdAt: new Date(0).toISOString(),
        action: 'generate',
        stageId: 'generate',
        description: 'historical',
        artifactRefs: { reference_image: ['reference-image'] },
        changedArtifactIds: ['reference-image'],
        staleArtifactIds: [],
        state: { referenceImageArtifactId: 'reference-image', provider: 'openai' }
      }]
    });
    job.artifacts.push({
      id: 'reference-image',
      jobId: job.id,
      kind: 'reference_image',
      status: 'stale',
      version: 1,
      path: referencePath,
      scopeKey: null,
      inputFingerprint: null,
      sha256: null,
      sourceArtifactIds: [],
      metadata: {},
      createdAt: new Date(0).toISOString()
    });

    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['image']
    }).check(job, createImageGenerationTemplate().stages[0]!, { inputResultVersion: 1 });

    expect(result.blocked.map(item => item.id)).not.toContain('input-artifact:reference_image');
    expect(result.ready.map(item => item.id)).toContain('input-file:reference-image');
  });
});

function fakeJob(templateId: string, state: Record<string, CreatorJson>): CreatorJob {
  return {
    id: 'job-preflight',
    projectId: 'project-preflight',
    templateId,
    templateVersion: templateId === 'image-generation' ? 2 : 2,
    status: 'draft',
    revision: 0,
    state,
    agentThreadId: null,
    stages: [],
    artifacts: [],
    providerRequests: [],
    activities: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}
