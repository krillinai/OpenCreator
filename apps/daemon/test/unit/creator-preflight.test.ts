import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig, type CreatorJob, type CreatorJson } from '@opencreator/protocol';
import { createCreatorPreflight, CreatorPreflightError } from '../../src/creator/preflight.js';
import { createImageGenerationTemplate } from '../../src/creator/templates/image-generation.js';
import { createVideoDownloadTemplate } from '../../src/creator/templates/video-download.js';
import { createStickmanVideoTemplate } from '../../src/creator/templates/stickman-video.js';
import { createCoverTemplate } from '../../src/creator/templates/cover.js';
import { createSmartDubbingTemplate } from '../../src/creator/templates/smart-dubbing.js';
import { createVideoTranslationTemplate } from '../../src/creator/templates/video-translation.js';
import { createKrillinCreatorServicesCapabilities } from '../../src/creator/krillin/capabilities.js';
import { createGatewayCreatorSource } from '../../src/gateway/creator-service-source.js';

let root = '';

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('creator preflight', () => {
  it('blocks multiple official Stickman references before submitting any generation', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-official-references-'));
    const config = createDefaultCreatorServicesConfig();
    const source = createGatewayCreatorSource({
      account: { peekState: () => ({ source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', models: [], activationError: null }), modelCredentials: async () => ({ accountId: 'a', modelKey: 'secret', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://gateway.example/v1', defaults: { image: 'image' }, models: [{ id: 'image', modality: 'image', capabilities: ['edit'] }] }) },
      manual: { read: async () => config, write: async c => c, reset: async () => config }, getLocalOrigin: () => 'http://127.0.0.1:39999'
    });
    const job = fakeJob('stickman-video', { provider: 'gemini' });
    job.artifacts = ['character_reference', 'style_reference'].map((kind, i) => ({ id: `ref-${i}`, jobId: job.id, kind, version: 1, scopeKey: null, inputFingerprint: null, sourceArtifactIds: [], path: join(root, `${i}.png`), status: 'completed', metadata: {}, sha256: 'hash', producerStageRunId: null, createdAt: job.createdAt, updatedAt: job.updatedAt }));
    const result = await createCreatorPreflight({ configStore: source.store, readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'), resourceRoot: root, jobsRoot: join(root, 'jobs'), validateRuntimeAssets: false }).check(job, createStickmanVideoTemplate().stages.find(stage => stage.executor === 'stickman-image')!);
    expect(result.blocked).toContainEqual(expect.objectContaining({ id: 'reference-image-count', message: expect.stringContaining('1 张') }));
  });
  it.each(['reference', 'speech-style'])('blocks unverified official %s before executing', async feature => {
    root = await mkdtemp(join(tmpdir(), 'creator-official-capability-'));
    const config = createDefaultCreatorServicesConfig();
    const source = createGatewayCreatorSource({
      account: { peekState: () => ({ source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', models: [], activationError: null }), modelCredentials: async () => ({ accountId: 'a', modelKey: 'secret', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://gateway.example/v1', defaults: { image: 'image', speech: 'speech' }, models: [] }) },
      manual: { read: async () => config, write: async c => c, reset: async () => config }, getLocalOrigin: () => 'http://127.0.0.1:39999'
    });
    const job = feature === 'reference'
      ? fakeJob('image-generation', { provider: 'openai', prompt: 'draw', referenceImageArtifactId: 'reference' })
      : fakeJob('smart-dubbing', { text: 'hello', speed: 1 });
    const template = feature === 'reference' ? createImageGenerationTemplate() : createSmartDubbingTemplate();
    const result = await createCreatorPreflight({ configStore: source.store, readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'), resourceRoot: root, jobsRoot: join(root, 'jobs'), validateRuntimeAssets: false }).check(job, template.stages[0]!);
    expect(result.blocked.map(item => item.id)).toContain(feature === 'reference' ? 'reference-image-capability' : 'tts-style-capability');
  });
  it.each(['openai', 'codex-native'])('blocks missing reference input for %s before starting a task', async provider => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-reference-'));
    const check = createCreatorPreflight({
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'),
      resourceRoot: root, jobsRoot: join(root, 'jobs'), executorIds: ['image'], validateRuntimeAssets: false
    });
    const job = fakeJob('image-generation', { provider, prompt: '以上传的人物照片为唯一主体，生成复古海报', referenceImageArtifactId: 'missing-artifact' });
    const result = await check.check(job, createImageGenerationTemplate().stages[0]!);
    expect(result.canStart).toBe(false);
    expect(result.blocked).toContainEqual(expect.objectContaining({ id: 'reference-image-required', message: expect.stringContaining('上传参考图') }));
    expect(new CreatorPreflightError(result)).toMatchObject({ code: 'creator_stage_input_missing', publicFacts: { kind: 'validation', upstreamCode: 'IMAGE_REFERENCE_MISSING' } });
  });
  it('allows rendering to prepare an installable Remotion component without downloading during preflight', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-remotion-'));
    const status = vi.fn(async () => ({ id: 'remotion' as const, name: 'Remotion', available: true, version: null, supportedVersion: '4.0.473', installedAt: null, path: root, source: 'release', models: [], model: null, state: 'not_installed' as const, item: null, downloadedBytes: 0, totalBytes: null, percent: null, bytesPerSecond: null, remainingSeconds: null, error: null }));
    const stage = createStickmanVideoTemplate().stages.find(candidate => candidate.id === 'render-clean')!;
    const result = await createCreatorPreflight({
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'),
      resourceRoot: root, jobsRoot: join(root, 'jobs'), ffprobePath: '/fixture/ffprobe',
      executorIds: ['stickman-remotion'], remotionComponent: { status }
    }).check(fakeJob('stickman-video', {}), stage);
    expect(status).toHaveBeenCalledOnce();
    expect(result.blocked.map(item => item.id)).not.toContain('stickman-runtime');
    expect(result.warning).toContainEqual(expect.objectContaining({ id: 'stickman-runtime', message: expect.stringContaining('按需准备') }));
  });

  it('prepares preview from the saved Bilibili source without translation or Whisper credentials', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    const job = fakeJob('video-translation', {
      sourceType: 'url', sourceUrl: 'https://www.bilibili.com/video/BV18E421w7bf?p=99',
      resultSnapshots: [{ version: 1, createdAt: '2026-10-02T00:00:00.000Z', action: 'stage-succeeded',
        stageId: 'subtitle', description: 'Subtitles', artifactRefs: {}, changedArtifactIds: [], staleArtifactIds: [],
        state: { sourceType: 'url', sourceUrl: 'https://www.bilibili.com/video/BV18E421w7bf?p=3' }
      }]
    });
    const get = vi.fn(async () => ({ platform: 'bilibili' as const, title: 'Course',
      parts: [1, 2, 3].map(index => ({ index, title: `Lesson ${index}` })) }));
    const preflight = createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'),
      resourceRoot: join(root, 'runtime'), jobsRoot: join(root, 'jobs'),
      executorIds: ['download'], validateRuntimeAssets: false, videoMetadataService: { get }
    });
    const stage = createVideoTranslationTemplate().stages.find(candidate => candidate.id === 'prepare-source-video')!;
    expect((await preflight.check(job, stage, { inputResultVersion: 1 })).canStart).toBe(true);
    expect(get).toHaveBeenCalledWith('https://www.bilibili.com/video/BV18E421w7bf?p=3');
    expect((await preflight.check(job, stage)).blocked).toContainEqual(expect.objectContaining({ id: 'input-result-version' }));
  });

  it.each([undefined, 3])('checks Bilibili selection for Agent stage requests: %s', async part => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    config.llm.source = 'codex';
    const job = fakeJob('video-translation', { sourceType: 'url',
      sourceUrl: `https://www.bilibili.com/video/BV18E421w7bf${part === undefined ? '' : `?p=${part}`}` });
    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'),
      resourceRoot: join(root, 'runtime'), jobsRoot: join(root, 'jobs'),
      executorIds: ['krillinai'], validateRuntimeAssets: false,
      videoMetadataService: { get: async () => ({ platform: 'bilibili', title: 'Course',
        parts: [1, 2, 3].map(index => ({ index, title: `Lesson ${index}` })) }) }
    }).check(job, createVideoTranslationTemplate().stages.find(stage => stage.id === 'subtitle')!);
    if (part === undefined) {
      expect(result.canStart).toBe(false);
      expect(result.blocked).toContainEqual(expect.objectContaining({ id: 'bilibili-part', message: expect.stringContaining('选择要翻译的分集') }));
    } else {
      expect(result.blocked.map(item => item.id)).not.toContain('bilibili-part');
    }
  });

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

  it('waits for Runtime verification before checking Runtime-backed stages', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const stage = createVideoDownloadTemplate().stages[0]!;
    let releaseVerification!: () => void;
    const ensureRuntimeReady = vi.fn(() => new Promise<void>(resolve => {
      releaseVerification = resolve;
    }));
    let settled = false;
    const checking = createCreatorPreflight({
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['download'],
      validateRuntimeAssets: true,
      ensureRuntimeReady
    }).check(fakeJob('video-download', { sourceUrl: 'https://youtu.be/example' }), stage)
      .then(result => {
        settled = true;
        return result;
      });

    await vi.waitFor(() => expect(ensureRuntimeReady).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    releaseVerification();
    const result = await checking;

    expect(result.blocked.map(item => item.id)).toEqual(expect.arrayContaining(['ffmpeg', 'ffprobe', 'yt-dlp']));
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

  it('accepts Codex subscription image generation only with checked native capability', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    config.image.provider = 'codex-native';
    const stage = createStickmanVideoTemplate().stages.find(candidate => candidate.id === 'images')!;
    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['stickman-image'],
      validateRuntimeAssets: false,
      readCodexImageStatus: async () => ({ authentication: 'chatgpt', ready: true, executionMode: 'native', message: '原生工具已就绪' })
    }).check(fakeJob('stickman-video', { provider: 'codex-native' }), stage);

    expect(result.blocked.map(item => item.id)).not.toContain('image-provider');
    expect(result.ready).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'image-provider', executionMode: 'local' })
    ]));
  });

  it.each([undefined, false])('blocks unchecked or unsupported Codex image capability (%s)', async available => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    config.image.provider = 'codex-native';
    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'),
      resourceRoot: root, jobsRoot: join(root, 'jobs'), validateRuntimeAssets: false,
      ...(available === undefined ? {} : { readCodexImageStatus: async () => ({ authentication: 'chatgpt' as const, ready: false, executionMode: null, message: 'Runtime 不支持原生生图' }) })
    }).check(fakeJob('image-generation', { provider: 'codex-native', prompt: 'test' }), createImageGenerationTemplate().stages[0]!);
    expect(result.canStart).toBe(false);
    expect(result.blocked).toContainEqual(expect.objectContaining({ id: 'image-provider' }));
  });

  it('reports Codex API mode separately from local native generation', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'),
      resourceRoot: root, jobsRoot: join(root, 'jobs'), validateRuntimeAssets: false,
      readCodexImageStatus: async () => ({ authentication: 'api_key', ready: true, executionMode: 'api', message: '接口需支持图片生成' })
    }).check(fakeJob('image-generation', { provider: 'codex-native', prompt: 'test' }), createImageGenerationTemplate().stages[0]!);
    expect(result.ready).toContainEqual(expect.objectContaining({ id: 'image-provider', executionMode: 'remote', message: '接口需支持图片生成' }));
  });

  it.each([
    ['source-brief', 'stickman-content', 'llm'],
    ['narration', 'stickman-audio', 'tts'],
    ['images', 'stickman-image', 'image-provider'],
    ['render-clean', 'stickman-remotion', 'ffprobe']
  ] as const)('checks the real Stickman %s executor requirements', async (stageId, executor, blockedId) => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const stage = createStickmanVideoTemplate().stages.find(candidate => candidate.id === stageId)!;
    const config = createDefaultCreatorServicesConfig();
    if (blockedId === 'image-provider') config.image.provider = 'openai';
    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
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

  it('validates Volcengine TTS with App ID and Access Token credentials', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    config.tts.provider = 'volcengine';
    const stage = createSmartDubbingTemplate().stages.find(candidate => candidate.id === 'tts')!;
    const preflight = createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['smart-dubbing'],
      validateRuntimeAssets: false
    });

    const blocked = await preflight.check(fakeJob('smart-dubbing', { ttsProvider: 'volcengine' }), stage);
    expect(blocked.blocked.map(item => item.id)).toContain('tts');

    config.tts.volcengine.appId = 'app-id';
    config.tts.volcengine.accessToken = 'access-token';
    const ready = await preflight.check(fakeJob('smart-dubbing', { ttsProvider: 'volcengine' }), stage);
    expect(ready.blocked.map(item => item.id)).not.toContain('tts');
  });

  it('blocks Volcengine transcription when its shared credentials are missing', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'volcengine';
    const stage = createVideoTranslationTemplate().stages.find(candidate => candidate.id === 'subtitle')!;
    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['krillinai'],
      validateRuntimeAssets: false
    }).check(fakeJob('video-translation', {
      sourceType: 'file',
      sourceArtifactId: 'missing-source'
    }), stage);

    expect(result.blocked.map(item => item.id)).toContain('transcription-config');
  });

  it('accepts automatically resolved Codex credentials for subtitle translation', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-preflight-'));
    const config = createDefaultCreatorServicesConfig();
    config.llm.source = 'codex';
    config.llm.apiKey = 'internal-bridge-key';
    config.llm.model = 'gpt-5.6-sol';
    const stage = createVideoTranslationTemplate().stages.find(candidate => candidate.id === 'subtitle')!;
    const result = await createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'),
      resourceRoot: join(root, 'runtime'),
      jobsRoot: join(root, 'jobs'),
      executorIds: ['krillinai'],
      validateRuntimeAssets: false
    }).check(fakeJob('video-translation', {
      sourceType: 'url',
      sourceUrl: 'https://youtu.be/example'
    }), stage);

    expect(result.blocked.map(item => item.id)).not.toContain('llm');
    expect(result.ready).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'llm', executionMode: 'local' })
    ]));
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
