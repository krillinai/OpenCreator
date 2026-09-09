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
  sha256
} from '../../src/creator/presets/compiler.js';
import {
  loadCreatorPresetCatalog
} from '../../src/creator/presets/catalog.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import {
  copyOfficialPreset
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
