import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compileCreatorPresets,
  validateCreatorPresets
} from '../../src/creator/presets/compiler.js';
import { loadCreatorPresetCatalog } from '../../src/creator/presets/catalog.js';
import type {
  CreatorPresetCatalog,
  CreatorPresetRegistry
} from '../../src/creator/presets/types.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { copyOfficialPreset } from '../helpers/creator-preset-fixtures.js';

const presets = [
  { module: 'image-generation', id: 'retro-halftone-illustration' },
  { module: 'image-generation', id: 'retro-scrapbook-poster' },
  { module: 'video-generation', id: 'retro-illustration-micro-motion' }
] as const;

let temporaryRoot = '';
let catalog: CreatorPresetCatalog;
let registry: CreatorPresetRegistry;

beforeAll(async () => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'retro-illustration-presets-'));
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

describe('retro illustration tutorial presets', () => {
  it('binds two image presets and one video preset to existing runtimes', () => {
    expect(catalog.presets).toHaveLength(3);
    for (const preset of catalog.presets) {
      expect(preset.runtimeTemplate).toEqual({
        id: preset.module,
        version: preset.module === 'image-generation' ? 2 : 1
      });
      expect(preset.defaults).not.toHaveProperty('referenceImageArtifactId');
      expect(preset.author).toMatchObject({
        name: '小洁AI实战',
        url: 'https://www.douyin.com/video/7624869691328485361'
      });
      expect(preset.cover.width).toBe(1280);
      expect(preset.cover.height).toBe(720);
      expect(preset.preview?.width).toBeGreaterThanOrEqual(640);
    }
  });

  it('packages the same local author avatar for both published presets and locales', () => {
    const avatarHashes = new Set<string>();
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const summary of registry.listPublished(locale)) {
        const preset = registry.get(summary);
        const avatar = preset.author?.avatar;
        expect(avatar).toMatchObject({ width: 300, height: 300, mime: 'image/jpeg' });
        expect(avatar?.source).toBe(`${summary.module}/${summary.id}/1/author-avatar.jpg`);
        expect(summary.author).toEqual({
          name: '小洁AI实战',
          url: 'https://www.douyin.com/video/7624869691328485361',
          avatarUrl: `/creator-presets/${avatar?.sha256}.jpg`
        });
        avatarHashes.add(avatar!.sha256);
      }
    }
    expect(avatarHashes.size).toBe(1);
  });

  it('keeps the unsupported two-reference workflow draft and inaccessible', () => {
    const poster = catalog.presets.find(preset => preset.id === 'retro-scrapbook-poster');
    expect(poster?.status).toBe('draft');
    expect(poster?.defaultsByLocale?.['zh-CN']?.prompt).toContain('图一');
    expect(poster?.defaultsByLocale?.['zh-CN']?.prompt).toContain('图二');
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const published = registry.listPublished(locale);
      expect(published.map(preset => preset.id).sort()).toEqual([
        'retro-halftone-illustration',
        'retro-illustration-micro-motion'
      ]);
      expect(published.filter(preset => preset.featured).map(preset => preset.id)).toEqual([
        'retro-illustration-micro-motion'
      ]);
    }
    expect(() => registry.get({
      module: 'image-generation', id: 'retro-scrapbook-poster', version: 1
    })).toThrow('Unknown creator preset');
  });

  it('localizes prompts and serves content-addressed reference previews', () => {
    const zh = registry.listPublished('zh-CN');
    const en = registry.listPublished('en-US');
    const image = zh.find(preset => preset.id === 'retro-halftone-illustration');
    const video = zh.find(preset => preset.id === 'retro-illustration-micro-motion');
    expect(image?.prompt).toContain('半色调网点');
    expect(video?.prompt).toContain('全程固定镜头');
    expect(video?.prompt).toContain('文字不能重绘');
    expect(en.find(preset => preset.id === image?.id)?.prompt).toContain('halftone');
    expect(en.find(preset => preset.id === video?.id)?.prompt).toContain('camera fixed');
    for (const preset of [...zh, ...en]) {
      expect(preset.previewUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.jpg$/);
      expect(preset.previewUrl).not.toBe(preset.coverUrl);
    }
    expect(video?.previewVideoUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.mp4$/);
    const imageSource = registry.get({
      module: 'image-generation', id: 'retro-halftone-illustration', version: 1
    });
    expect(imageSource.requirements).toBeUndefined();
    expect(imageSource.defaults.candidateCount).toBe(1);
    const videoSource = registry.get({
      module: 'video-generation', id: 'retro-illustration-micro-motion', version: 1
    });
    expect(videoSource.defaults.duration).toBe(5);
    expect(videoSource.previewVideo?.mime).toBe('video/mp4');
    expect(videoSource.previewVideo?.size).toBeGreaterThan(0);
    expect(videoSource.previewVideo?.size).toBeLessThan(8 * 1024 * 1024);
  });
});
