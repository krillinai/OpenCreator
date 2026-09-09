import type {
  CreatorPresetRef,
  CreatorPresetSummary
} from '@opencreator/protocol';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreatorTemplateRegistry } from '../templates/types.js';
import { canonicalJson, sha256 } from './compiler.js';
import { creatorPresetSourceManifestSchema } from './schema.js';
import type {
  CompiledCreatorPreset,
  CreatorPresetBuildManifest,
  CreatorPresetCatalog,
  CreatorPresetLocale,
  CreatorPresetRegistry
} from './types.js';
import { createCreatorPresetHighlights } from './presentation.js';

export async function loadCreatorPresetCatalog(input: {
  root?: string;
  templates: CreatorTemplateRegistry;
}): Promise<CreatorPresetRegistry> {
  const root = path.resolve(input.root ?? resolveCreatorPresetCatalogRoot());
  const catalogPath = path.join(root, 'catalog.json');
  const manifestPath = path.join(root, 'manifest.json');
  const [catalogBytes, manifestBytes] = await Promise.all([
    readFile(catalogPath),
    readFile(manifestPath)
  ]);
  const manifest = parseBuildManifest(manifestBytes, manifestPath);
  const catalogHash = sha256(catalogBytes);
  if (catalogHash !== manifest.catalogHash) {
    throw new Error(`${catalogPath}: catalog hash does not match manifest`);
  }
  const catalog = parseCatalog(catalogBytes, catalogPath);
  const knownFiles = new Set<string>();
  for (const file of manifest.files) {
    if (knownFiles.has(file.path)) {
      throw new Error(`${manifestPath}: duplicate file ${file.path}`);
    }
    knownFiles.add(file.path);
    const absolute = resolveCatalogFile(root, file.path);
    const bytes = await readFile(absolute);
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
      throw new Error(`${absolute}: packaged creator preset resource hash mismatch`);
    }
  }
  if (!knownFiles.has('catalog.json')) {
    throw new Error(`${manifestPath}: catalog.json is missing from the file manifest`);
  }
  const assetEntries = manifest.files
    .filter(file => file.path.startsWith('assets/'))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (sha256(canonicalJson(assetEntries)) !== manifest.assetSetHash) {
    throw new Error(`${manifestPath}: asset set hash does not match`);
  }
  for (const preset of catalog.presets) {
    const asset = preset.cover.asset;
    if (!knownFiles.has(asset)) {
      throw new Error(`${catalogPath}: missing cover asset ${asset}`);
    }
    try {
      input.templates.get(preset.runtimeTemplate.id, preset.runtimeTemplate.version);
    } catch {
      throw new Error(
        `${catalogPath}: incompatible runtime binding `
        + `${preset.runtimeTemplate.id}@${preset.runtimeTemplate.version}`
      );
    }
  }
  return createCreatorPresetRegistry({
    catalog,
    catalogHash
  });
}

export function createCreatorPresetRegistry(input: {
  catalog: CreatorPresetCatalog;
  catalogHash: string;
}): CreatorPresetRegistry {
  const presets = [...input.catalog.presets].sort(comparePresets);
  const byIdentity = new Map(
    presets.map(preset => [identityKey(preset), preset] as const)
  );
  return {
    catalogHash: input.catalogHash,
    listPublished(locale) {
      const latest = new Map<string, CompiledCreatorPreset>();
      for (const preset of presets) {
        if (preset.status !== 'published') continue;
        const key = `${preset.module}/${preset.id}`;
        const current = latest.get(key);
        if (current === undefined || current.version < preset.version) {
          latest.set(key, preset);
        }
      }
      return [...latest.values()]
        .map(preset => localizePreset(preset, locale))
        .sort((left, right) => (
          left.sortOrder - right.sortOrder
          || left.title.localeCompare(right.title)
          || left.module.localeCompare(right.module)
          || left.id.localeCompare(right.id)
          || left.version - right.version
        ));
    },
    get(ref) {
      const preset = byIdentity.get(identityKey(ref));
      if (preset === undefined || preset.status === 'draft') {
        throw new Error(`Unknown creator preset: ${identityKey(ref)}`);
      }
      return preset;
    }
  };
}

export function normalizeCreatorPresetLocale(value: unknown): CreatorPresetLocale {
  return value === 'en-US' ? 'en-US' : 'zh-CN';
}

export function resolveCreatorPresetCatalogRoot(): string {
  const configured = process.env.OPENCREATOR_PRESET_CATALOG_ROOT?.trim();
  if (configured) return path.resolve(configured);

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryCandidate = path.resolve(
    moduleDirectory,
    '../../../../..',
    '.runtime/generated/creator-presets'
  );
  if (existsSync(repositoryCandidate)) return repositoryCandidate;

  return path.resolve(moduleDirectory, '../../../runtime/creator-presets');
}

export function resolveCreatorPresetAsset(
  root: string,
  fileName: string
): string {
  if (!/^[a-f0-9]{64}\.(?:png|jpe?g|webp)$/.test(fileName)) {
    throw new Error('Invalid creator preset asset name');
  }
  return resolveCatalogFile(root, `assets/${fileName}`);
}

function parseCatalog(bytes: Buffer, file: string): CreatorPresetCatalog {
  const value = parseJson(bytes, file);
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.presets)) {
    throw new Error(`${file}: invalid creator preset catalog`);
  }
  const presets = value.presets.map((candidate, index) => {
    if (!isRecord(candidate) || !isRecord(candidate.cover)) {
      throw new Error(`${file}.presets.${index}: invalid compiled preset`);
    }
    const {
      cover: compiledCover,
      contentHash,
      ...sourceCandidate
    } = candidate;
    const source = creatorPresetSourceManifestSchema.parse({
      ...sourceCandidate,
      cover: compiledCover.source
    });
    if (
      typeof contentHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(contentHash)
      || typeof compiledCover.asset !== 'string'
      || typeof compiledCover.sha256 !== 'string'
      || typeof compiledCover.mime !== 'string'
      || typeof compiledCover.width !== 'number'
      || typeof compiledCover.height !== 'number'
      || typeof compiledCover.size !== 'number'
    ) {
      throw new Error(`${file}.presets.${index}: invalid compiled cover metadata`);
    }
    return {
      ...source,
      cover: compiledCover,
      contentHash
    } as CompiledCreatorPreset;
  });
  const identities = new Set<string>();
  for (const preset of presets) {
    const key = identityKey(preset);
    if (identities.has(key)) throw new Error(`${file}: duplicate preset ${key}`);
    identities.add(key);
  }
  return { schemaVersion: 1, presets };
}

function parseBuildManifest(bytes: Buffer, file: string): CreatorPresetBuildManifest {
  const value = parseJson(bytes, file);
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.catalogHash !== 'string'
    || typeof value.assetSetHash !== 'string'
    || !Array.isArray(value.files)
  ) {
    throw new Error(`${file}: invalid creator preset build manifest`);
  }
  const files = value.files.map((candidate, index) => {
    if (
      !isRecord(candidate)
      || typeof candidate.path !== 'string'
      || typeof candidate.sha256 !== 'string'
      || typeof candidate.size !== 'number'
    ) {
      throw new Error(`${file}.files.${index}: invalid file entry`);
    }
    return {
      path: candidate.path,
      sha256: candidate.sha256,
      size: candidate.size
    };
  });
  return {
    schemaVersion: 1,
    catalogHash: value.catalogHash,
    assetSetHash: value.assetSetHash,
    files
  };
}

function localizePreset(
  preset: CompiledCreatorPreset,
  locale: CreatorPresetLocale
): CreatorPresetSummary {
  return {
    module: preset.module,
    id: preset.id,
    version: preset.version,
    title: preset.title[locale],
    description: preset.description[locale],
    coverUrl: `/creator-presets/${path.basename(preset.cover.asset)}`,
    tags: preset.tags,
    featured: preset.featured,
    sortOrder: preset.sortOrder,
    requirements: preset.requirements ?? null,
    highlights: createCreatorPresetHighlights(preset, locale)
  };
}

function resolveCatalogFile(root: string, relative: string): string {
  if (relative.includes('\\') || path.isAbsolute(relative)) {
    throw new Error(`${relative}: invalid creator preset resource path`);
  }
  const absolute = path.resolve(root, relative);
  const relation = path.relative(root, absolute);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`${relative}: creator preset resource escapes catalog root`);
  }
  return absolute;
}

function identityKey(ref: CreatorPresetRef): string {
  return `${ref.module}/${ref.id}/${ref.version}`;
}

function comparePresets(left: CreatorPresetRef, right: CreatorPresetRef): number {
  return left.module.localeCompare(right.module)
    || left.id.localeCompare(right.id)
    || left.version - right.version;
}

function parseJson(bytes: Buffer, file: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${file}: invalid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
