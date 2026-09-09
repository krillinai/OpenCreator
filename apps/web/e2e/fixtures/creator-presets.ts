import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CreatorPresetE2EEnvironment = {
  root: string;
  initialCatalogRoot: string;
  upgradedCatalogRoot: string;
  dispose(): void;
};

const repositoryRoot = resolve(
  fileURLToPath(new URL('../../../../', import.meta.url))
);

export function prepareCreatorPresetE2E(): CreatorPresetE2EEnvironment {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-presets-e2e-'));
  const initialSourceRoot = join(root, 'template-initial');
  const upgradedSourceRoot = join(root, 'template-upgraded');
  const initialCatalogRoot = join(root, 'catalog-initial');
  const upgradedCatalogRoot = join(root, 'catalog-upgraded');
  cpSync(join(repositoryRoot, 'template'), initialSourceRoot, { recursive: true });
  addAlternativeImagePreset(initialSourceRoot);
  addVideoTranslationV2(initialSourceRoot);
  addMissingVideoRequirementPreset(initialSourceRoot);
  cpSync(initialSourceRoot, upgradedSourceRoot, { recursive: true });
  removeAlternativeImagePreset(upgradedSourceRoot);
  hideVideoTranslationV1(upgradedSourceRoot);
  updateVideoTranslationV2(upgradedSourceRoot);
  compile(initialSourceRoot, initialCatalogRoot);
  compile(upgradedSourceRoot, upgradedCatalogRoot);

  const previous = process.env.OPENCREATOR_E2E_PRESET_CATALOG_ROOT;
  process.env.OPENCREATOR_E2E_PRESET_CATALOG_ROOT = initialCatalogRoot;
  return {
    root,
    initialCatalogRoot,
    upgradedCatalogRoot,
    dispose() {
      if (previous === undefined) {
        delete process.env.OPENCREATOR_E2E_PRESET_CATALOG_ROOT;
      } else {
        process.env.OPENCREATOR_E2E_PRESET_CATALOG_ROOT = previous;
      }
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100
      });
    }
  };
}

function addAlternativeImagePreset(sourceRoot: string): void {
  const source = readManifest(
    sourceRoot,
    'image-generation',
    'ecommerce-product',
    1
  );
  writePreset(sourceRoot, 'image-generation', 'ecommerce-product-alt', 1, {
    ...source,
    id: 'ecommerce-product-alt',
    title: {
      'zh-CN': '电商商品主图 Plus',
      'en-US': 'E-commerce Product Hero Plus'
    },
    description: {
      'zh-CN': '由临时 catalog 动态加入的电商视觉模板。',
      'en-US': 'An e-commerce visual preset added by the temporary catalog.'
    },
    sortOrder: 31,
    defaults: {
      prompt: '',
      size: '1536x1024',
      quality: 'high',
      candidateCount: 4
    },
    defaultsByLocale: {
      'zh-CN': {
        prompt: '动态目录商品主图，白色背景，真实材质，突出核心卖点'
      },
      'en-US': {
        prompt: 'Dynamic catalog product hero, white background, realistic materials'
      }
    }
  }, join(
    sourceRoot,
    'image-generation',
    'ecommerce-product',
    '1',
    'cover.webp'
  ));
}

function addVideoTranslationV2(sourceRoot: string): void {
  const source = readManifest(
    sourceRoot,
    'video-translation',
    'bilibili-bilingual',
    1
  );
  writePreset(sourceRoot, 'video-translation', 'bilibili-bilingual', 2, {
    ...source,
    version: 2,
    title: {
      'zh-CN': 'B站双语精翻 Pro',
      'en-US': 'Bilibili Bilingual Translation Pro'
    },
    sortOrder: 9,
    defaults: {
      ...source.defaults,
      subtitleStyle: {
        ...(source.defaults as { subtitleStyle: Record<string, unknown> }).subtitleStyle,
        fontPreset: 'rounded',
        fontSize: 'large',
        primaryColor: '#00FF66'
      }
    }
  }, join(
    sourceRoot,
    'video-translation',
    'bilibili-bilingual',
    '1',
    'cover.webp'
  ));
}

function addMissingVideoRequirementPreset(sourceRoot: string): void {
  const source = readManifest(
    sourceRoot,
    'video-generation',
    'product-ad',
    1
  );
  writePreset(sourceRoot, 'video-generation', 'configuration-required', 1, {
    ...source,
    id: 'configuration-required',
    featured: false,
    sortOrder: 41,
    title: {
      'zh-CN': '需配置的视频广告',
      'en-US': 'Video Ad Requiring Configuration'
    },
    description: {
      'zh-CN': '验证未配置视频服务时保留可编辑草稿。',
      'en-US': 'Verifies editable drafts when the video service is not configured.'
    },
    requirements: {
      service: 'video',
      provider: 'veo',
      model: 'veo-3.1-generate-preview'
    },
    defaults: {
      prompt: '需要配置服务的视频广告镜头',
      size: '1280x720',
      duration: 8
    },
    defaultsByLocale: {
      'zh-CN': {
        prompt: '需要配置服务的视频广告镜头'
      },
      'en-US': {
        prompt: 'Video advertisement shot that requires provider configuration'
      }
    }
  }, join(
    sourceRoot,
    'video-generation',
    'product-ad',
    '1',
    'cover.webp'
  ));
}

function removeAlternativeImagePreset(sourceRoot: string): void {
  rmSync(join(sourceRoot, 'image-generation', 'ecommerce-product-alt'), {
    recursive: true,
    force: true
  });
}

function hideVideoTranslationV1(sourceRoot: string): void {
  const path = manifestPath(
    sourceRoot,
    'video-translation',
    'bilibili-bilingual',
    1
  );
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.status = 'hidden';
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function updateVideoTranslationV2(sourceRoot: string): void {
  const path = manifestPath(
    sourceRoot,
    'video-translation',
    'bilibili-bilingual',
    2
  );
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.defaults.subtitleStyle.primaryColor = '#FF00AA';
  manifest.defaults.subtitleStyle.fontSize = 'small';
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readManifest(
  sourceRoot: string,
  module: string,
  id: string,
  version: number
): Record<string, unknown> {
  return JSON.parse(readFileSync(
    manifestPath(sourceRoot, module, id, version),
    'utf8'
  )) as Record<string, unknown>;
}

function writePreset(
  sourceRoot: string,
  module: string,
  id: string,
  version: number,
  manifest: Record<string, unknown>,
  coverSource: string
): void {
  const directory = dirname(manifestPath(sourceRoot, module, id, version));
  mkdirSync(directory, { recursive: true });
  copyFileSync(coverSource, join(directory, 'cover.webp'));
  writeFileSync(
    join(directory, 'template.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

function manifestPath(
  sourceRoot: string,
  module: string,
  id: string,
  version: number
): string {
  return join(sourceRoot, module, id, String(version), 'template.json');
}

function compile(sourceRoot: string, outputRoot: string): void {
  execFileSync(process.execPath, [
    '--import',
    'tsx',
    'apps/daemon/scripts/creator-presets.ts',
    'compile'
  ], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      OPENCREATOR_PRESET_SOURCE_ROOT: sourceRoot,
      OPENCREATOR_PRESET_CATALOG_ROOT: outputRoot
    },
    stdio: 'pipe'
  });
}
