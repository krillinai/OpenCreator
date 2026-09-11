import type {
  CreatorJob,
  CreatorPresetListResponse,
  CreatorRuntimeWorkspace,
  CreatorServicesConfig
} from '@opencreator/protocol';
import type { Locator, Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import {
  prepareCreatorPresetE2E,
  type CreatorPresetE2EEnvironment
} from './fixtures/creator-presets.js';
import {
  expect,
  test,
  type RuntimeFixture
} from './fixtures/runtime.js';

let presetEnvironment: CreatorPresetE2EEnvironment;

test.beforeAll(() => {
  presetEnvironment = prepareCreatorPresetE2E();
});

test.afterAll(() => {
  presetEnvironment.dispose();
});

test('@AC-1 catalog 动态驱动首页、本地化和封面资源，升级后移除模板', async ({
  page,
  runtime
}) => {
  const zhCatalog = await listPresets(runtime, 'zh-CN');
  const enCatalog = await listPresets(runtime, 'en-US');
  const zhPreset = requirePreset(
    zhCatalog,
    'image-generation',
    'ecommerce-product-alt',
    1
  );
  const enPreset = requirePreset(
    enCatalog,
    'image-generation',
    'ecommerce-product-alt',
    1
  );

  expect(zhPreset).toMatchObject({
    title: '电商商品主图 Plus',
    description: '由临时 catalog 动态加入的电商视觉模板。'
  });
  expect(enPreset).toMatchObject({
    title: 'E-commerce Product Hero Plus',
    description: 'An e-commerce visual preset added by the temporary catalog.'
  });
  expect(zhPreset.coverUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.webp$/);
  expect(enPreset.coverUrl).toBe(zhPreset.coverUrl);

  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/new`);
  await expect(page.getByRole('heading', { name: '精选模板' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '输入任务' })).toHaveCount(0);
  await selectCreatorModule(page, '图像生成');
  const zhCard = page.getByRole('button', {
    name: '使用电商商品主图 Plus模板'
  });
  await expect(zhCard).toBeVisible();
  await expect(zhCard).toContainText('由临时 catalog 动态加入的电商视觉模板。');
  await expectLoadedPresetCover(zhCard);

  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '精选应用' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^图像生成/ })).toBeVisible();
  await expect(page.getByRole('button', {
    name: '使用电商商品主图 Plus模板'
  })).toHaveCount(0);

  await runtime.api('PATCH', '/settings/ui', { language: 'en-US' });
  await page.goto(`${runtime.origin}/#/new`);
  await page.reload();
  await selectCreatorModule(page, 'Image Generation');
  const enCard = page.getByRole('button', {
    name: 'Use E-commerce Product Hero Plus preset'
  });
  await expect(enCard).toBeVisible();
  await expect(enCard).toContainText(
    'An e-commerce visual preset added by the temporary catalog.'
  );
  await expectLoadedPresetCover(enCard);

  await page.goto(`${runtime.origin}${enPreset.coverUrl}`);
  await runtime.restart({
    presetCatalogRoot: presetEnvironment.upgradedCatalogRoot
  });
  await page.goto(`${runtime.origin}/#/new`);
  await selectCreatorModule(page, 'Image Generation');
  const upgraded = await listPresets(runtime, 'en-US');
  expect(upgraded.catalogHash).not.toBe(enCatalog.catalogHash);
  expect(upgraded.presets).not.toContainEqual(expect.objectContaining({
    module: 'image-generation',
    id: 'ecommerce-product-alt'
  }));
  await expect(page.getByRole('button', {
    name: 'Use E-commerce Product Hero Plus preset'
  })).toHaveCount(0);
});

test('@AC-3 创建接口使用完整 fingerprint 幂等，页面真实双击只创建一个 Job', async ({
  page,
  runtime
}) => {
  const creationKey = 'e2e-full-fingerprint';
  const request = {
    projectId: runtime.projectId,
    preset: {
      module: 'image-generation',
      id: 'ecommerce-product',
      version: 1
    },
    locale: 'zh-CN',
    creationKey
  } as const;
  const first = await runtime.api<{ job: CreatorJob }>(
    'POST',
    '/creator/jobs',
    request
  );
  const replay = await runtime.api<{ job: CreatorJob }>(
    'POST',
    '/creator/jobs',
    request
  );
  expect(replay.job.id).toBe(first.job.id);

  const conflictingRequests = [
    {
      ...request,
      preset: {
        module: 'image-generation',
        id: 'ecommerce-product-alt',
        version: 1
      }
    },
    { ...request, locale: 'en-US' as const },
    {
      projectId: runtime.projectId,
      templateId: 'image-generation',
      templateVersion: 2,
      state: first.job.state,
      creationKey
    }
  ];
  for (const conflict of conflictingRequests) {
    const result = await runtime.apiResult('POST', '/creator/jobs', conflict);
    expect(result).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'creator_idempotency_key_reused'
        }
      }
    });
  }
  const jobsAfterApiChecks = await listJobs(runtime);
  expect(jobsAfterApiChecks.filter(job => job.id === first.job.id)).toHaveLength(1);

  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/new`);
  await expect(page.getByRole('heading', { name: '创作模块' })).toBeVisible();
  await selectCreatorModule(page, '图像生成');
  const card = page.getByRole('button', {
    name: '使用电商商品主图 Plus模板'
  });
  const createBodies: unknown[] = [];
  page.on('request', requestEvent => {
    const url = new URL(requestEvent.url());
    if (
      requestEvent.method() === 'POST'
      && url.pathname.endsWith('/creator/jobs')
    ) {
      createBodies.push(requestEvent.postDataJSON());
    }
  });
  const jobCountBeforeDoubleClick = (await listJobs(runtime)).length;
  await card.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page).toHaveURL(
    /#\/workbench\?tool=image-generation&jobId=creator_job_.*&returnTo=home/
  );
  expect(createBodies).toHaveLength(1);
  const route = new URL(page.url()).hash.slice(1);
  const jobId = new URL(route, runtime.origin).searchParams.get('jobId');
  expect(jobId).not.toBeNull();
  const created = await getJob(runtime, jobId!);
  expect(created).toMatchObject({
    templateId: 'image-generation',
    templateVersion: 2,
    status: 'draft',
    presetOrigin: {
      module: 'image-generation',
      id: 'ecommerce-product-alt',
      version: 1,
      locale: 'zh-CN'
    },
    stages: []
  });
  expect((await listJobs(runtime))).toHaveLength(jobCountBeforeDoubleClick + 1);
});

test('@AC-4 六模块解析严格默认值，工作台首帧预填并持久化用户编辑', async ({
  page,
  runtime
}) => {
  const jobs = new Map<CreatorRuntimeWorkspace, CreatorJob>();
  for (const preset of officialPresets) {
    jobs.set(
      preset.module,
      await createPresetJob(runtime, {
        ...preset,
        locale: 'zh-CN',
        creationKey: `ac4-${preset.module}`
      })
    );
  }

  expect(jobs.get('video-translation')!.state).toMatchObject({
    sourceLanguage: 'en',
    targetLanguage: 'zh_cn',
    bilingual: true,
    subtitleStyle: {
      fontPreset: 'sans',
      fontWeight: 'bold',
      fontSize: 'medium',
      primaryColor: '#FFFFFF',
      secondaryColor: '#FFD45C',
      outlineWidth: 2,
      shadow: {
        enabled: true,
        opacity: 0.65,
        offsetX: 2,
        offsetY: 2,
        blur: 1
      }
    }
  });
  expect(jobs.get('video-download')!.state).toMatchObject({
    mediaType: 'audio'
  });
  expect(jobs.get('image-generation')!.state).toMatchObject({
    prompt: '专业电商商品主图，主体清晰，干净背景，突出核心卖点，真实材质与自然光影，适合商品详情页首屏',
    provider: 'openai',
    size: '1536x1024',
    quality: 'medium',
    candidateCount: 2
  });
  expect(jobs.get('video-generation')!.state).toMatchObject({
    prompt: '高质感商品广告短片，产品居中，缓慢推进镜头，真实材质细节，专业棚拍光线，动作自然流畅',
    provider: 'seedance',
    size: '1280x720',
    duration: 5
  });
  expect(jobs.get('cover-generator')!.state).toMatchObject({
    sourceType: 'prompt',
    coverStyle: 'personal-growth',
    coverTextLanguage: 'zh-CN',
    coverHeadline: '改变，从今天开始',
    coverSubheadline: '建立真正有效的成长系统',
    ratio: '16:9',
    candidateCount: 2,
    quality: 'medium'
  });
  expect(jobs.get('smart-dubbing')!.state).toMatchObject({
    text: '在这里输入需要配音的文案。',
    ttsProvider: 'openai',
    voiceCode: 'marin',
    style: 'calm',
    speed: 1,
    format: 'mp3'
  });

  let translation = jobs.get('video-translation')!;
  translation = await updateJobState(runtime, translation, {
    currentStep: 2,
    furthestStep: 2
  });
  jobs.set('video-translation', translation);

  await runtime.openApp(page);
  await verifyWorkspaceEdit({
    page,
    runtime,
    module: 'video-translation',
    job: translation,
    heading: '视频翻译配音',
    field: page.getByLabel('自定义译文颜色'),
    initialValue: '#ffffff',
    editedValue: '#112233',
    statePath: ['subtitleStyle', 'primaryColor'],
    expectedPersistedValue: '#112233'
  });
  await verifyWorkspaceEdit({
    page,
    runtime,
    module: 'video-download',
    job: jobs.get('video-download')!,
    heading: '视频下载',
    field: page.getByRole('textbox', { name: '待下载视频链接' }),
    initialValue: '',
    editedValue: 'https://www.youtube.com/watch?v=OpenCreatorPreset',
    statePath: ['sourceUrl'],
    expectedPersistedValue: 'https://www.youtube.com/watch?v=OpenCreatorPreset',
    preservedState: { mediaType: 'audio' }
  });
  await verifyWorkspaceEdit({
    page,
    runtime,
    module: 'image-generation',
    job: jobs.get('image-generation')!,
    heading: '图像生成',
    field: page.getByRole('textbox', { name: '提示词' }),
    initialValue: '专业电商商品主图，主体清晰，干净背景，突出核心卖点，真实材质与自然光影，适合商品详情页首屏',
    editedValue: '已编辑的电商商品主图',
    statePath: ['prompt'],
    expectedPersistedValue: '已编辑的电商商品主图'
  });
  await verifyWorkspaceEdit({
    page,
    runtime,
    module: 'video-generation',
    job: jobs.get('video-generation')!,
    heading: '视频生成',
    field: page.getByRole('textbox', { name: '提示词' }),
    initialValue: '高质感商品广告短片，产品居中，缓慢推进镜头，真实材质细节，专业棚拍光线，动作自然流畅',
    editedValue: '已编辑的商品广告镜头',
    statePath: ['prompt'],
    expectedPersistedValue: '已编辑的商品广告镜头'
  });
  await verifyWorkspaceEdit({
    page,
    runtime,
    module: 'cover-generator',
    job: jobs.get('cover-generator')!,
    heading: '封面生成',
    field: page.getByRole('textbox', { name: '内容与补充要求' }),
    initialValue: '个人成长主题，真实人物半身近景，情绪明确，主体与标题留白平衡，强对比、可信、适合知识视频封面',
    editedValue: '已编辑的个人成长封面要求',
    statePath: ['prompt'],
    expectedPersistedValue: '已编辑的个人成长封面要求',
    preservedState: {
      coverStyle: 'personal-growth',
      coverTextLanguage: 'zh-CN'
    }
  });
  await verifyWorkspaceEdit({
    page,
    runtime,
    module: 'smart-dubbing',
    job: jobs.get('smart-dubbing')!,
    heading: '智能配音',
    field: page.getByRole('textbox', { name: '配音文案内容' }),
    initialValue: '在这里输入需要配音的文案。',
    editedValue: '已编辑的沉静旁白文案。',
    statePath: ['text'],
    expectedPersistedValue: '已编辑的沉静旁白文案。',
    preservedState: { style: 'calm' }
  });
});

test('@AC-6 legacy v1 与 Preset v1/v2 在 catalog 升级和 Daemon 重启后稳定恢复', async ({
  page,
  runtime
}) => {
  const legacy = await runtime.api<{ job: CreatorJob }>(
    'POST',
    '/creator/jobs',
    {
      projectId: runtime.projectId,
      templateId: 'video-translation',
      templateVersion: 1,
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=LegacyCreator',
        sourceLanguage: 'en',
        targetLanguage: 'zh_cn',
        bilingual: true,
        subtitleFont: 'serif',
        subtitleSize: 'large',
        subtitleColor: '#ABCDEF',
        currentStep: 2,
        furthestStep: 2
      },
      creationKey: 'ac6-legacy-v1'
    }
  ).then(response => response.job);
  let presetV1 = await createPresetJob(runtime, {
    module: 'video-translation',
    id: 'bilibili-bilingual',
    version: 1,
    locale: 'zh-CN',
    creationKey: 'ac6-preset-v1'
  });
  let presetV2 = await createPresetJob(runtime, {
    module: 'video-translation',
    id: 'bilibili-bilingual',
    version: 2,
    locale: 'zh-CN',
    creationKey: 'ac6-preset-v2'
  });
  presetV1 = await updateJobState(runtime, presetV1, {
    currentStep: 2,
    furthestStep: 2
  });
  presetV2 = await updateJobState(runtime, presetV2, {
    currentStep: 2,
    furthestStep: 2
  });
  const snapshots = new Map([
    [legacy.id, legacy],
    [presetV1.id, presetV1],
    [presetV2.id, presetV2]
  ]);

  await runtime.restart({
    presetCatalogRoot: presetEnvironment.upgradedCatalogRoot
  });
  for (const [jobId, before] of snapshots) {
    const after = await getJob(runtime, jobId);
    expect(after.templateVersion).toBe(before.templateVersion);
    expect(after.presetOrigin).toEqual(before.presetOrigin);
    expect(after.state).toEqual(before.state);
  }

  const upgradedCatalog = await listPresets(runtime, 'zh-CN');
  const listedTranslation = upgradedCatalog.presets.filter(preset => (
    preset.module === 'video-translation'
    && preset.id === 'bilibili-bilingual'
  ));
  expect(listedTranslation).toHaveLength(1);
  expect(listedTranslation[0]!.version).toBe(2);

  const newV2 = await createPresetJob(runtime, {
    module: 'video-translation',
    id: 'bilibili-bilingual',
    version: 2,
    locale: 'zh-CN',
    creationKey: 'ac6-upgraded-v2'
  });
  expect(presetV2.state.subtitleStyle).toMatchObject({
    fontPreset: 'rounded',
    fontSize: 'large',
    primaryColor: '#00FF66'
  });
  expect(newV2.state.subtitleStyle).toMatchObject({
    fontPreset: 'rounded',
    fontSize: 'small',
    primaryColor: '#FF00AA'
  });

  await runtime.openApp(page);
  await openWorkspace(page, runtime, 'video-translation', legacy.id);
  await expect(page.getByRole('heading', {
    name: '视频翻译配音'
  })).toBeVisible();
  await expect(page.getByRole('radio', { name: '大', exact: true }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('自定义译文颜色')).toHaveValue('#abcdef');

  await openWorkspace(page, runtime, 'video-translation', presetV2.id);
  await expect(page.getByRole('radio', { name: '大', exact: true }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('自定义译文颜色')).toHaveValue('#00ff66');
});

test('@AC-7 缺 Provider 时保留可编辑草稿、进入 needs_input 且不调用付费执行器', async ({
  page,
  runtime
}) => {
  const fakeProvider = await startFakeProvider();
  try {
    const response = await runtime.api<{
      config: CreatorServicesConfig;
    }>('GET', '/creator-services/config');
    const config = structuredClone(response.config);
    config.video.veo.baseUrl = fakeProvider.origin;
    config.video.veo.apiKey = '';
    await runtime.api('PATCH', '/creator-services/config', config);

    const job = await createPresetJob(runtime, {
      module: 'video-generation',
      id: 'configuration-required',
      version: 1,
      locale: 'zh-CN',
      creationKey: 'ac7-missing-provider'
    });
    expect(job).toMatchObject({
      status: 'draft',
      state: {
        provider: 'veo',
        model: 'veo-3.1-generate-preview',
        prompt: '需要配置服务的视频广告镜头'
      },
      stages: []
    });

    await runtime.openApp(page);
    await openWorkspace(page, runtime, 'video-generation', job.id);
    const prompt = page.getByRole('textbox', { name: '提示词' });
    await expect(prompt).toHaveValue('需要配置服务的视频广告镜头');
    await prompt.fill('缺少服务时仍应保留的编辑内容');
    await expectJobState(runtime, job.id, ['prompt'], '缺少服务时仍应保留的编辑内容');

    await page.getByRole('button', { name: '继续' }).click();
    await expect(page.getByRole('combobox', { name: '视频服务' }))
      .toHaveValue('veo');
    await expect(page.getByRole('combobox', { name: '模型版本' }))
      .toHaveValue('veo-3.1-generate-preview');
    await page.getByRole('button', { name: '继续' }).click();
    await page.getByRole('button', { name: '开始生成' }).click();

    await expect.poll(async () => (await getJob(runtime, job.id)).status)
      .toBe('needs_input');
    const waiting = await getJob(runtime, job.id);
    expect(waiting.state).toMatchObject({
      prompt: '缺少服务时仍应保留的编辑内容',
      provider: 'veo',
      model: 'veo-3.1-generate-preview',
      needsInput: {
        code: 'creator_preset_requirement_missing',
        deepLink: '#/settings?tab=ai-services&section=video'
      }
    });
    expect(waiting.stages.at(-1)).toMatchObject({
      stageId: 'generate',
      status: 'failed',
      errorCode: 'creator_preset_requirement_missing'
    });
    expect(fakeProvider.calls()).toBe(0);
    const settingsLink = page.getByRole('link', { name: '打开 AI 服务设置' });
    await expect(settingsLink).toBeVisible();
    await expect(settingsLink).toHaveAttribute(
      'href',
      '#/settings?tab=ai-services&section=video'
    );
  } finally {
    await fakeProvider.close();
  }
});

const officialPresets: Array<{
  module: CreatorRuntimeWorkspace;
  id: string;
  version: number;
}> = [
  {
    module: 'video-translation',
    id: 'bilibili-bilingual',
    version: 1
  },
  {
    module: 'video-download',
    id: 'audio-download',
    version: 1
  },
  {
    module: 'image-generation',
    id: 'ecommerce-product',
    version: 1
  },
  {
    module: 'video-generation',
    id: 'product-ad',
    version: 1
  },
  {
    module: 'cover-generator',
    id: 'personal-growth',
    version: 1
  },
  {
    module: 'smart-dubbing',
    id: 'calm-narration',
    version: 1
  }
];

async function listPresets(
  runtime: RuntimeFixture,
  locale: 'zh-CN' | 'en-US'
): Promise<CreatorPresetListResponse> {
  return await runtime.api(
    'GET',
    `/creator/presets?locale=${encodeURIComponent(locale)}`
  );
}

function requirePreset(
  catalog: CreatorPresetListResponse,
  module: CreatorRuntimeWorkspace,
  id: string,
  version: number
): CreatorPresetListResponse['presets'][number] {
  const preset = catalog.presets.find(candidate => (
    candidate.module === module
    && candidate.id === id
    && candidate.version === version
  ));
  expect(preset, `catalog 缺少 ${module}/${id}/${version}`).toBeDefined();
  return preset!;
}

async function expectLoadedPresetCover(card: Locator): Promise<void> {
  const image = card.locator('img');
  await expect.poll(async () => image.evaluate(element => ({
    complete: element.complete,
    width: element.naturalWidth,
    height: element.naturalHeight
  }))).toEqual({
    complete: true,
    width: 1280,
    height: 720
  });
}

async function selectCreatorModule(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', {
    name: new RegExp(`^${name}，`)
  }).click();
}

async function createPresetJob(
  runtime: RuntimeFixture,
  input: {
    module: CreatorRuntimeWorkspace;
    id: string;
    version: number;
    locale: 'zh-CN' | 'en-US';
    creationKey: string;
  }
): Promise<CreatorJob> {
  return await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    preset: {
      module: input.module,
      id: input.id,
      version: input.version
    },
    locale: input.locale,
    creationKey: input.creationKey
  }).then(response => response.job);
}

async function listJobs(runtime: RuntimeFixture): Promise<CreatorJob[]> {
  return await runtime.api<{ jobs: CreatorJob[] }>(
    'GET',
    `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`
  ).then(response => response.jobs);
}

async function getJob(
  runtime: RuntimeFixture,
  jobId: string
): Promise<CreatorJob> {
  return await runtime.api<{ job: CreatorJob }>(
    'GET',
    `/creator/jobs/${encodeURIComponent(jobId)}`
  ).then(response => response.job);
}

async function updateJobState(
  runtime: RuntimeFixture,
  job: CreatorJob,
  patch: Record<string, unknown>
): Promise<CreatorJob> {
  return await runtime.api<{ job: CreatorJob }>(
    'POST',
    `/creator/jobs/${encodeURIComponent(job.id)}/actions`,
    {
      action: 'update-settings',
      expectedRevision: job.revision,
      input: {
        patch,
        objectId: Object.keys(patch).sort().join(',')
      }
    }
  ).then(response => response.job);
}

async function openWorkspace(
  page: Page,
  runtime: RuntimeFixture,
  module: CreatorRuntimeWorkspace,
  jobId: string
): Promise<void> {
  await page.goto(
    `${runtime.origin}/#/workbench?tool=${encodeURIComponent(module)}`
    + `&jobId=${encodeURIComponent(jobId)}`
  );
}

async function verifyWorkspaceEdit(input: {
  page: Page;
  runtime: RuntimeFixture;
  module: CreatorRuntimeWorkspace;
  job: CreatorJob;
  heading: string;
  field: Locator;
  initialValue: string;
  editedValue: string;
  statePath: string[];
  expectedPersistedValue: unknown;
  preservedState?: Record<string, unknown>;
}): Promise<void> {
  await openWorkspace(input.page, input.runtime, input.module, input.job.id);
  await expect(input.page.getByRole('heading', {
    name: input.heading,
    exact: true
  })).toBeVisible();
  await expect(input.field).toHaveValue(input.initialValue);
  await input.field.fill(input.editedValue);
  await expectJobState(
    input.runtime,
    input.job.id,
    input.statePath,
    input.expectedPersistedValue
  );
  if (input.preservedState !== undefined) {
    expect((await getJob(input.runtime, input.job.id)).state)
      .toMatchObject(input.preservedState);
  }
  await input.page.reload();
  await expect(input.field).toHaveValue(input.editedValue);
}

async function expectJobState(
  runtime: RuntimeFixture,
  jobId: string,
  path: string[],
  expected: unknown
): Promise<void> {
  await expect.poll(async () => {
    let current: unknown = (await getJob(runtime, jobId)).state;
    for (const segment of path) {
      if (
        current === null
        || typeof current !== 'object'
        || Array.isArray(current)
      ) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }).toEqual(expected);
}

async function startFakeProvider(): Promise<{
  origin: string;
  calls(): number;
  close(): Promise<void>;
}> {
  let callCount = 0;
  const server = createServer((_request, response) => {
    callCount += 1;
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'provider must not be called' }));
  });
  const origin = await listen(server);
  return {
    origin,
    calls: () => callCount,
    close: () => closeServer(server)
  };
}

async function listen(server: Server): Promise<string> {
  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Fake provider did not bind a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}
