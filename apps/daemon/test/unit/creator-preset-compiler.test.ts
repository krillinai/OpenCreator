import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compileCreatorPresets,
  validateCreatorPresets
} from '../../src/creator/presets/compiler.js';
import {
  copyOfficialPreset,
  directoryFiles,
  hashDirectory,
  updatePresetManifest
} from '../helpers/creator-preset-fixtures.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-preset-compiler-'));
  const sourceRoot = join(tempDir, 'template');
  mkdirSync(sourceRoot, { recursive: true });
  return {
    sourceRoot,
    outputRoot: join(tempDir, 'output')
  };
}

describe('creator preset compiler', () => {
  it('rejects traversal symlinks sensitive fields and mismatched directory identity', async () => {
    const fixture = setup();
    const sensitive = copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'ecommerce-product'
    });
    updatePresetManifest(sensitive, manifest => ({
      ...manifest,
      defaults: { ...manifest.defaults, apiKey: 'must-not-compile' }
    }));
    await expect(validateCreatorPresets(fixture)).rejects.toThrow(
      'defaults.apiKey: field is not allowed'
    );

    rmSync(fixture.sourceRoot, { recursive: true, force: true });
    mkdirSync(fixture.sourceRoot, { recursive: true });
    const mismatch = copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'video-download',
      sourceId: 'audio-download'
    });
    updatePresetManifest(mismatch, manifest => ({ ...manifest, id: 'wrong-id' }));
    await expect(validateCreatorPresets(fixture)).rejects.toThrow(
      'directory identity does not match module/id/version'
    );

    rmSync(fixture.sourceRoot, { recursive: true, force: true });
    mkdirSync(fixture.sourceRoot, { recursive: true });
    const linked = copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'video-download',
      sourceId: 'audio-download'
    });
    const cover = join(linked, 'cover.webp');
    const outside = join(tempDir, 'outside.webp');
    writeFileSync(outside, readFileSync(cover));
    rmSync(cover);
    symlinkSync(outside, cover);
    await expect(validateCreatorPresets(fixture)).rejects.toThrow(
      'symbolic links are not allowed'
    );

    rmSync(fixture.sourceRoot, { recursive: true, force: true });
    mkdirSync(fixture.sourceRoot, { recursive: true });
    const traversal = copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'video-download',
      sourceId: 'audio-download'
    });
    updatePresetManifest(traversal, manifest => ({ ...manifest, cover: '../cover.webp' }));
    await expect(validateCreatorPresets(fixture)).rejects.toThrow(
      'cover: traversal is not allowed'
    );
  });

  it('produces byte-stable catalog and content-addressed assets', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'video-download',
      sourceId: 'audio-download'
    });
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'ecommerce-product'
    });
    const firstOutput = join(tempDir, 'first');
    const secondOutput = join(tempDir, 'second');
    const first = await compileCreatorPresets({
      sourceRoot: fixture.sourceRoot,
      outputRoot: firstOutput
    });
    const second = await compileCreatorPresets({
      sourceRoot: fixture.sourceRoot,
      outputRoot: secondOutput
    });

    expect(second).toEqual(first);
    expect(directoryFiles(secondOutput)).toEqual(directoryFiles(firstOutput));
    const catalog = JSON.parse(readFileSync(join(firstOutput, 'catalog.json'), 'utf8'));
    expect(catalog.presets.every((preset: { cover: { asset: string; sha256: string } }) => (
      preset.cover.asset === `assets/${preset.cover.sha256}.webp`
    ))).toBe(true);
  });

  it('validates and packages an uncropped complete preview', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'y2k-streetwear-mobile-landing-page'
    });

    await compileCreatorPresets(fixture);
    const catalog = JSON.parse(readFileSync(
      join(fixture.outputRoot, 'catalog.json'),
      'utf8'
    ));
    const presetWithPreview = catalog.presets[0];
    expect(presetWithPreview.preview).toMatchObject({
      source: 'image-generation/y2k-streetwear-mobile-landing-page/1/preview.webp',
      asset: `assets/${presetWithPreview.preview.sha256}.webp`,
      mime: 'image/webp'
    });
    expect(presetWithPreview.preview.height).toBeGreaterThan(presetWithPreview.preview.width);
    expect(presetWithPreview.author).toEqual({
      name: '@cezanne_cupcake_haze12',
      url: 'https://higgsfield.ai/publications/0bbfc974-900c-4a1e-8561-3d9ada80177a'
    });
    expect(readFileSync(join(fixture.outputRoot, presetWithPreview.preview.asset))).toEqual(
      readFileSync(join(
        fixture.sourceRoot,
        presetWithPreview.preview.source
      ))
    );
  });

  it('validates and packages a square author avatar', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'image-generation',
      sourceId: 'felt-country-miniature-world'
    });

    await compileCreatorPresets(fixture);
    const catalog = JSON.parse(readFileSync(
      join(fixture.outputRoot, 'catalog.json'),
      'utf8'
    ));
    const avatar = catalog.presets[0].author.avatar;
    expect(avatar).toMatchObject({
      source: 'image-generation/felt-country-miniature-world/1/author-avatar.webp',
      asset: `assets/${avatar.sha256}.webp`,
      mime: 'image/webp',
      width: 96,
      height: 96
    });
    expect(readFileSync(join(fixture.outputRoot, avatar.asset))).toEqual(
      readFileSync(join(fixture.sourceRoot, avatar.source))
    );
  });

  it('validates and packages an MP4 example video', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'video-generation',
      sourceId: 'aerial-pullback-rise-reveal'
    });

    await compileCreatorPresets(fixture);
    const catalog = JSON.parse(readFileSync(
      join(fixture.outputRoot, 'catalog.json'),
      'utf8'
    ));
    const previewVideo = catalog.presets[0].previewVideo;
    expect(previewVideo).toMatchObject({
      source: 'video-generation/aerial-pullback-rise-reveal/1/example.mp4',
      asset: `assets/${previewVideo.sha256}.mp4`,
      mime: 'video/mp4'
    });
    expect(readFileSync(join(fixture.outputRoot, previewVideo.asset))).toEqual(
      readFileSync(join(fixture.sourceRoot, previewVideo.source))
    );
  });

  it('compiles the English video translation locale with Runtime language ids', async () => {
    const fixture = setup();
    copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'video-translation',
      sourceId: 'bilibili-bilingual'
    });

    await compileCreatorPresets(fixture);
    const catalog = JSON.parse(readFileSync(
      join(fixture.outputRoot, 'catalog.json'),
      'utf8'
    ));
    expect(catalog.presets[0].defaultsByLocale['en-US']).toMatchObject({
      sourceLanguage: 'zh_cn',
      targetLanguage: 'en'
    });
  });

  it('keeps cross-module duplicate ids and multiple versions distinct', async () => {
    const fixture = setup();
    for (const version of [1, 2]) {
      copyOfficialPreset({
        sourceRoot: fixture.sourceRoot,
        module: 'video-download',
        sourceId: 'audio-download',
        id: 'shared-preset',
        version
      });
      copyOfficialPreset({
        sourceRoot: fixture.sourceRoot,
        module: 'image-generation',
        sourceId: 'ecommerce-product',
        id: 'shared-preset',
        version
      });
    }

    const catalog = await validateCreatorPresets(fixture);
    expect(catalog.presets.map(preset => (
      `${preset.module}/${preset.id}/${preset.version}`
    ))).toEqual([
      'image-generation/shared-preset/1',
      'image-generation/shared-preset/2',
      'video-download/shared-preset/1',
      'video-download/shared-preset/2'
    ]);
    expect(new Set(catalog.presets.map(preset => preset.contentHash))).toHaveLength(4);
  });

  it('does not replace the last complete catalog after a failed compile', async () => {
    const fixture = setup();
    const preset = copyOfficialPreset({
      sourceRoot: fixture.sourceRoot,
      module: 'video-download',
      sourceId: 'audio-download'
    });
    await compileCreatorPresets(fixture);
    const before = hashDirectory(fixture.outputRoot);

    updatePresetManifest(preset, manifest => ({
      ...manifest,
      defaults: { ...manifest.defaults, currentStage: 'generate' }
    }));
    await expect(compileCreatorPresets(fixture)).rejects.toThrow(
      'defaults.currentStage: field is not allowed'
    );

    expect(hashDirectory(fixture.outputRoot)).toBe(before);
  });
});
