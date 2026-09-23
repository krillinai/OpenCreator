import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCreatorPresetCatalog } from '../../src/creator/presets/catalog.js';
import {
  compileCreatorPresets,
  validateCreatorPresets
} from '../../src/creator/presets/compiler.js';
import type {
  CreatorPresetCatalog,
  CreatorPresetRegistry
} from '../../src/creator/presets/types.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { copyOfficialPreset } from '../helpers/creator-preset-fixtures.js';

const presets = [
  { module: 'image-generation', id: 'real-person-die-cut-sticker-poster' },
  { module: 'video-generation', id: 'real-person-sticker-poster-motion' }
] as const;

let temporaryRoot = '';
let catalog: CreatorPresetCatalog;
let registry: CreatorPresetRegistry;

beforeAll(async () => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'real-person-sticker-presets-'));
  const sourceRoot = join(temporaryRoot, 'template');
  const outputRoot = join(temporaryRoot, 'output');
  for (const preset of presets) {
    copyOfficialPreset({ sourceRoot, module: preset.module, sourceId: preset.id });
  }
  catalog = await validateCreatorPresets({ sourceRoot });
  await compileCreatorPresets({ sourceRoot, outputRoot });
  registry = await loadCreatorPresetCatalog({
    root: outputRoot,
    templates: createDefaultCreatorTemplateRegistry()
  });
});

afterAll(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('real-person sticker tutorial presets', () => {
  it('publishes both presets while recommending only the image preset', () => {
    expect(catalog.presets).toHaveLength(2);
    for (const preset of catalog.presets) {
      expect(preset.status).toBe('published');
      expect(preset.featured).toBe(preset.id === 'real-person-die-cut-sticker-poster');
      expect(preset.runtimeTemplate).toEqual({
        id: preset.module,
        version: preset.module === 'image-generation' ? 2 : 1
      });
      expect(preset.defaults).not.toHaveProperty('referenceImageArtifactId');
      expect(preset.author).toMatchObject({
        name: '小洁AI实战',
        url: 'https://www.douyin.com/video/7683887650173032805'
      });
      expect(preset.cover.width).toBe(1280);
      expect(preset.cover.height).toBe(720);
      expect(preset.preview?.width).toBe(720);
      expect(preset.preview?.height).toBe(880);
    }
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const published = registry.listPublished(locale);
      expect(published.map(preset => preset.id).sort()).toEqual(
        presets.map(preset => preset.id).sort()
      );
      expect(published.filter(preset => preset.featured).map(preset => preset.id)).toEqual([
        'real-person-die-cut-sticker-poster'
      ]);
    }
  });

  it('packages the same local author avatar for both presets and locales', () => {
    const avatarHashes = new Set<string>();
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const summary of registry.listPublished(locale)) {
        const preset = registry.get(summary);
        const avatar = preset.author?.avatar;
        expect(avatar).toMatchObject({ width: 300, height: 300, mime: 'image/jpeg' });
        expect(avatar?.source).toBe(`${summary.module}/${summary.id}/1/author-avatar.jpg`);
        expect(summary.author).toEqual({
          name: '小洁AI实战',
          url: 'https://www.douyin.com/video/7683887650173032805',
          avatarUrl: `/creator-presets/${avatar?.sha256}.jpg`
        });
        avatarHashes.add(avatar!.sha256);
      }
    }
    expect(avatarHashes.size).toBe(1);
  });

  it('preserves photographed people and freezes the existing sticker background', () => {
    const zh = registry.listPublished('zh-CN');
    const en = registry.listPublished('en-US');
    const image = zh.find(preset => preset.module === 'image-generation');
    const video = zh.find(preset => preset.module === 'video-generation');
    expect(image?.prompt).toContain('高清摄影质感');
    expect(image?.prompt).toContain('纯黑白无渐变');
    expect(image?.prompt).toContain('白色裁切边');
    expect(image?.description).toContain('蓝调示例');
    expect(video?.prompt).toContain('完全冻结静止');
    expect(video?.prompt).toContain('镜头完全固定不动');
    expect(video?.prompt).toContain('不凭空创造桌子、窗户');
    expect(en.find(preset => preset.id === image?.id)?.prompt).toContain('photorealistic');
    expect(en.find(preset => preset.id === video?.id)?.prompt).toContain('freeze');
    const imageSource = registry.get({ ...presets[0], version: 1 });
    expect(imageSource.requirements).toBeUndefined();
    expect(imageSource.defaults).toMatchObject({
      size: '1024x1536', quality: 'high', candidateCount: 1
    });
    const videoSource = registry.get({ ...presets[1], version: 1 });
    expect(videoSource.defaults.duration).toBe(4);
    expect(videoSource.requirements).toBeUndefined();
  });

  it('serves separate content-addressed covers, tutorial previews, and a video excerpt', () => {
    for (const preset of registry.listPublished('zh-CN')) {
      expect(preset.coverUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.jpg$/);
      expect(preset.previewUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.jpg$/);
      expect(preset.previewUrl).not.toBe(preset.coverUrl);
      if (preset.module === 'image-generation') {
        expect(preset.previewVideoUrl).toBeUndefined();
      } else {
        expect(preset.previewVideoUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.mp4$/);
      }
    }
    const video = registry.get({ ...presets[1], version: 1 });
    expect(video.previewVideo?.mime).toBe('video/mp4');
    expect(video.previewVideo?.size).toBeGreaterThan(0);
    expect(video.previewVideo?.size).toBeLessThan(8 * 1024 * 1024);
  });
});
