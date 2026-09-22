import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalJson,
  compileCreatorPresets,
  sha256,
  validateCreatorPresets
} from '../../src/creator/presets/compiler.js';
import {
  createCreatorPresetRegistry,
  loadCreatorPresetCatalog
} from '../../src/creator/presets/catalog.js';
import { createCreatorPresetTags } from '../../src/creator/presets/presentation.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import {
  copyOfficialPreset,
  officialPresetRoot
} from '../helpers/creator-preset-fixtures.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-preset-registry-'));
  const sourceRoot = join(tempDir, 'template');
  const outputRoot = join(tempDir, 'output');
  mkdirSync(sourceRoot, { recursive: true });
  return { sourceRoot, outputRoot };
}

describe('creator preset registry', () => {
  it('excludes development samples and functional shortcuts from the product catalog', async () => {
    const catalog = await validateCreatorPresets({ sourceRoot: officialPresetRoot });
    const registry = createCreatorPresetRegistry({
      catalog,
      catalogHash: sha256(canonicalJson(catalog))
    });
    const removed = [
      'image-generation/portrait-editorial',
      'image-generation/ecommerce-product',
      'image-generation/social-poster',
      'video-generation/cinematic-story',
      'video-generation/product-ad',
      'video-generation/vertical-social',
      'cover-generator/bilibili-red-blue-white',
      'cover-generator/personal-growth',
      'cover-generator/psychology',
      'cover-generator/wealth-platinum-red',
      'smart-dubbing/calm-narration',
      'smart-dubbing/professional-news',
      'smart-dubbing/warm-storytelling',
      'video-translation/vertical-knowledge',
      'video-translation/bilibili-bilingual',
      'video-translation/youtube-dubbed',
      'video-download/highest-quality-video',
      'video-download/audio-download'
    ];
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const identities = registry.listPublished(locale).map(preset => (
        `${preset.module}/${preset.id}`
      ));
      expect(identities).toEqual(expect.arrayContaining([
        'image-generation/exploded-food-infographic',
        'video-generation/aerial-pullback-rise-reveal'
      ]));
      for (const identity of removed) expect(identities).not.toContain(identity);
    }
    const sourceIdentities = catalog.presets.map(preset => `${preset.module}/${preset.id}`);
    for (const identity of removed) expect(sourceIdentities).not.toContain(identity);
  });

  it('localizes identifier and source-language tags while preserving unknown tags', () => {
    const preset = {
      tags: ['camera-motion', '商业广告', 'reference-template', 'custom-tag']
    };

    expect(createCreatorPresetTags(preset, 'zh-CN')).toEqual([
      '镜头运动',
      '商业广告',
      '参考模板',
      'custom-tag'
    ]);
    expect(createCreatorPresetTags(preset, 'en-US')).toEqual([
      'Camera motion',
      'Commercial advertising',
      'Reference template',
      'custom-tag'
    ]);
  });

  it('validates and localizes video taxonomy tags from their source manifests', async () => {
    const fixture = setup();
    const cases = [
      ['rainforest-mysterious-light', 'nature-landscape', '自然风光', 'Natural landscapes'],
      ['brutalist-courtyard-martial-arts', 'architecture-interior', '建筑空间', 'Architecture and interiors'],
      ['bedroom-falling-book-catch', 'architecture-interior', '建筑空间', 'Architecture and interiors'],
      ['nyc-parkour-web-swing', 'city-street', '城市街景', 'City streets'],
      ['anime-skateboard-chase-nyc', 'anime-style', '动漫风格', 'Anime style'],
      ['seoul-sunday-dv-home-video', 'city-street', '城市街景', 'City streets']
    ] as const;
    for (const [id, tag, zh, en] of cases) {
      const source = JSON.parse(readFileSync(
        join(officialPresetRoot, 'video-generation', id, '1', 'template.json'),
        'utf8'
      )) as { tags: string[] };
      expect(source.tags).toContain(tag);
      expect(createCreatorPresetTags(source, 'zh-CN')).toContain(zh);
      expect(createCreatorPresetTags(source, 'en-US')).toContain(en);
      copyOfficialPreset({ sourceRoot: fixture.sourceRoot, module: 'video-generation', sourceId: id });
    }
    const catalog = await validateCreatorPresets({ sourceRoot: fixture.sourceRoot });
    const registry = createCreatorPresetRegistry({
      catalog,
      catalogHash: sha256(canonicalJson(catalog))
    });
    for (const [id, tag, zh, en] of cases) {
      const chinese = registry.listPublished('zh-CN').find(preset => preset.id === id);
      const english = registry.listPublished('en-US').find(preset => preset.id === id);
      expect(chinese?.tags).toContain(zh);
      expect(english?.tags).toContain(en);
      expect(chinese?.tagIds).toEqual(english?.tagIds);
      expect(chinese?.tagIds).toContain(tag);
    }
  });

  it('keeps specific image filter tags available in both locales', async () => {
    const fixture = setup();
    const cases = [
      ['animated-campus-world-reference-board', 'anime-style', '动漫风格', 'Anime style'],
      ['city-corner-3d-billboard-photography', '3d-render', '三维场景', '3D render'],
      ['croissant-baking-storyboard', 'storyboard', '故事分镜', 'Storyboard'],
      ['watercolor-editorial-illustration-poster', 'watercolor', '水彩', 'Watercolor'],
      ['minimal-conceptual-line-art-poster', 'minimalist', '极简设计', 'Minimalist']
    ] as const;
    for (const [id, tag] of cases) {
      copyOfficialPreset({ sourceRoot: fixture.sourceRoot, module: 'image-generation', sourceId: id });
      const source = JSON.parse(readFileSync(
        join(officialPresetRoot, 'image-generation', id, '1', 'template.json'),
        'utf8'
      )) as { tags: string[] };
      expect(source.tags).toContain(tag);
    }
    const catalog = await validateCreatorPresets({ sourceRoot: fixture.sourceRoot });
    const registry = createCreatorPresetRegistry({
      catalog,
      catalogHash: sha256(canonicalJson(catalog))
    });
    for (const [id, tag, zh, en] of cases) {
      const chinese = registry.listPublished('zh-CN').find(preset => preset.id === id);
      const english = registry.listPublished('en-US').find(preset => preset.id === id);
      expect(chinese?.tagIds).toContain(tag);
      expect(english?.tagIds).toContain(tag);
      expect(chinese?.tags).toContain(zh);
      expect(english?.tags).toContain(en);
    }
  });

  it('returns localized latest published presets and keeps hidden presets addressable', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'ecommerce-product',
      id: 'localized',
      version: 1,
      update: manifest => ({
        ...manifest,
        title: { 'zh-CN': '旧版', 'en-US': 'Old version' }
      })
    });
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'ecommerce-product',
      id: 'localized',
      version: 2,
      update: manifest => ({
        ...manifest,
        title: { 'zh-CN': '新版', 'en-US': 'New version' }
      })
    });
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'ecommerce-product',
      id: 'hidden-one',
      status: 'hidden'
    });
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'ecommerce-product',
      id: 'draft-one',
      status: 'draft'
    });
    await compileCreatorPresets(fixture);
    const registry = await loadCreatorPresetCatalog({
      root: fixture.outputRoot,
      templates: createDefaultCreatorTemplateRegistry()
    });

    const zhPresets = registry.listPublished('zh-CN');
    const enPresets = registry.listPublished('en-US');
    expect(zhPresets.map(preset => preset.title)).toEqual(['新版']);
    expect(enPresets.map(preset => preset.title)).toEqual(['New version']);
    expect(zhPresets[0]?.prompt).toContain('专业电商商品主图');
    expect(enPresets[0]?.prompt).toContain('Professional e-commerce product hero image');
    expect(zhPresets[0]?.tags).toEqual(['电商', '图像', '商品']);
    expect(enPresets[0]?.tags).toEqual(['E-commerce', 'Image', 'Product']);
    expect(zhPresets[0]?.highlights).toEqual([
      { text: '1536 × 1024', colors: [] },
      { text: '标准质量', colors: [] },
      { text: '2 张', colors: [] }
    ]);
    expect(enPresets[0]?.highlights).toEqual([
      { text: '1536 × 1024', colors: [] },
      { text: 'Standard quality', colors: [] },
      { text: '2 images', colors: [] }
    ]);
    expect(registry.get({
      module: 'image-generation',
      id: 'hidden-one',
      version: 1
    }).status).toBe('hidden');
    expect(() => registry.get({
      module: 'image-generation',
      id: 'draft-one',
      version: 1
    })).toThrow('Unknown creator preset');
  });

  it('returns a complete preview URL and falls back to the cover for older presets', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'ecommerce-product'
    });
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'y2k-streetwear-mobile-landing-page'
    });
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'felt-country-miniature-world'
    });
    await compileCreatorPresets(fixture);
    const registry = await loadCreatorPresetCatalog({
      root: fixture.outputRoot,
      templates: createDefaultCreatorTemplateRegistry()
    });

    const summaries = registry.listPublished('zh-CN');
    const legacy = summaries.find(preset => preset.id === 'ecommerce-product');
    const withPreview = summaries.find(
      preset => preset.id === 'y2k-streetwear-mobile-landing-page'
    );
    const withAvatar = summaries.find(
      preset => preset.id === 'felt-country-miniature-world'
    );
    expect(legacy?.previewUrl).toBe(legacy?.coverUrl);
    expect(withPreview?.previewUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.webp$/);
    expect(withPreview?.previewUrl).not.toBe(withPreview?.coverUrl);
    expect(withPreview?.author).toEqual({
      name: '@cezanne_cupcake_haze12',
      url: 'https://higgsfield.ai/publications/0bbfc974-900c-4a1e-8561-3d9ada80177a'
    });
    expect(withAvatar?.author).toEqual({
      name: '@volkan_iras',
      url: 'https://x.com/volkan_iras/status/2051403524966141980',
      avatarUrl: expect.stringMatching(/^\/creator-presets\/[a-f0-9]{64}\.webp$/)
    });
  });

  it('returns a content-addressed video preview URL', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'video-generation',
      sourceId: 'aerial-pullback-rise-reveal'
    });
    await compileCreatorPresets(fixture);
    const registry = await loadCreatorPresetCatalog({
      root: fixture.outputRoot,
      templates: createDefaultCreatorTemplateRegistry()
    });

    const preset = registry.listPublished('zh-CN')[0];
    expect(preset?.previewVideoUrl)
      .toMatch(/^\/creator-presets\/[a-f0-9]{64}\.mp4$/);
    expect(preset?.author).toEqual({
      name: 'Higgsfield.AI Team',
      url: 'https://higgsfield.ai/academy/how-to-use/turn-your-video-into-cinema-using-wan-camera-control'
    });
  });

  it('fails catalog health when runtime binding asset or catalog hash is invalid', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'ecommerce-product'
    });
    await compileCreatorPresets(fixture);

    const manifestPath = join(fixture.outputRoot, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const asset = manifest.files.find((file: { path: string }) => file.path.startsWith('assets/'));
    writeFileSync(join(fixture.outputRoot, asset.path), 'broken');
    await expect(loadCreatorPresetCatalog({
      root: fixture.outputRoot,
      templates: createDefaultCreatorTemplateRegistry()
    })).rejects.toThrow('resource hash mismatch');

    rmSync(fixture.outputRoot, { recursive: true, force: true });
    await compileCreatorPresets(fixture);
    writeFileSync(join(fixture.outputRoot, 'catalog.json'), '{}\n');
    await expect(loadCreatorPresetCatalog({
      root: fixture.outputRoot,
      templates: createDefaultCreatorTemplateRegistry()
    })).rejects.toThrow('catalog hash does not match manifest');

    rmSync(fixture.outputRoot, { recursive: true, force: true });
    await compileCreatorPresets(fixture);
    const catalogPath = join(fixture.outputRoot, 'catalog.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    catalog.presets[0].runtimeTemplate = { id: 'missing-runtime', version: 99 };
    const catalogBytes = Buffer.from(`${canonicalJson(catalog)}\n`);
    writeFileSync(catalogPath, catalogBytes);
    const updatedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    updatedManifest.catalogHash = sha256(catalogBytes);
    const catalogEntry = updatedManifest.files.find(
      (file: { path: string }) => file.path === 'catalog.json'
    );
    catalogEntry.sha256 = updatedManifest.catalogHash;
    catalogEntry.size = catalogBytes.length;
    writeFileSync(manifestPath, `${canonicalJson(updatedManifest)}\n`);
    await expect(loadCreatorPresetCatalog({
      root: fixture.outputRoot,
      templates: createDefaultCreatorTemplateRegistry()
    })).rejects.toThrow('incompatible runtime binding missing-runtime@99');
  });
});
