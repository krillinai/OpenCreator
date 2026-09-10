import { createHash } from 'node:crypto';
import {
  createReadStream,
  readFileSync,
  statSync,
  type ReadStream
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  CreatorVisualAssetCatalogResponse,
  CreatorVisualAssetRef,
  CreatorVisualAssetSummary
} from '@opencreator/protocol';
import { z } from 'zod';

const localizedTextSchema = z.object({
  zhCN: z.string().trim().min(1),
  en: z.string().trim().min(1)
}).strict();

const referenceFileSchema = z.object({
  role: z.string().trim().min(1),
  path: z.string().trim().min(1)
}).strict();

const characterSchema = z.object({
  id: z.string().trim().min(1),
  revision: z.number().int().positive(),
  name: localizedTextSchema,
  description: localizedTextSchema,
  previewFile: z.string().trim().min(1),
  referenceFiles: z.array(referenceFileSchema).min(1).max(1),
  identity: z.object({
    preserve: z.string().trim().min(1),
    prohibit: z.string().trim().min(1)
  }).strict(),
  tags: z.array(z.string().trim().min(1)).default([])
}).strict();

const styleSchema = z.object({
  id: z.string().trim().min(1),
  revision: z.number().int().positive(),
  name: localizedTextSchema,
  description: localizedTextSchema,
  recommended: z.boolean().default(false),
  previewFile: z.string().trim().min(1).nullable(),
  referenceFiles: z.array(referenceFileSchema).max(1),
  rendering: z.object({
    medium: z.string().trim().min(1),
    surface: z.string().trim().min(1),
    linework: z.string().trim().min(1),
    shading: z.string().trim().min(1),
    palette: z.string().trim().min(1),
    sceneDensity: z.string().trim().min(1),
    composition: z.string().trim().min(1),
    characterRendering: z.string().trim().min(1)
  }).strict(),
  semanticRenderingRules: z.object({
    color: z.string().trim().min(1),
    light: z.string().trim().min(1),
    complexEnvironment: z.string().trim().min(1)
  }).strict(),
  forbiddenDirections: z.array(z.string().trim().min(1)).min(1),
  styleAttributes: z.object({
    medium: localizedTextSchema,
    palette: localizedTextSchema,
    sceneDensity: localizedTextSchema,
    swatch: z.object({
      background: z.string().regex(/^#[a-f0-9]{6}$/i),
      foreground: z.string().regex(/^#[a-f0-9]{6}$/i),
      accent: z.string().regex(/^#[a-f0-9]{6}$/i),
      texture: z.enum(['none', 'paper', 'screentone', 'marker'])
    }).strict()
  }).strict(),
  tags: z.array(z.string().trim().min(1)).default([])
}).strict();

const catalogSchema = z.object({
  version: z.literal(1),
  templateId: z.literal('stickman-video'),
  characters: z.array(characterSchema).min(1),
  styles: z.array(styleSchema).min(1)
}).strict();

export type StickmanCharacterAsset = z.infer<typeof characterSchema>;
export type StickmanStyleAsset = z.infer<typeof styleSchema>;
export type StickmanVisualAssetCatalog = z.infer<typeof catalogSchema>;

export const DEFAULT_STICKMAN_CHARACTER_ASSET: CreatorVisualAssetRef = {
  assetId: 'stickman.character.default',
  revision: 1
};

export const DEFAULT_STICKMAN_STYLE_ASSET: CreatorVisualAssetRef = {
  assetId: 'stickman.style.paper-pencil',
  revision: 1
};

export type ResolvedVisualAssetFile = {
  role: string;
  path: string;
  sha256: string;
  bytes: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
};

export type StickmanVisualAssetRegistry = ReturnType<typeof createStickmanVisualAssetRegistry>;

export function createStickmanVisualAssetRegistry(input: {
  root: string;
  catalogPath?: string;
}) {
  const root = resolve(input.root);
  const catalogPath = input.catalogPath === undefined
    ? resolveInside(root, 'visual-assets/catalog.json')
    : resolve(input.catalogPath);
  const catalog = catalogSchema.parse(JSON.parse(readFileSync(catalogPath, 'utf8')));
  assertUniqueAssets(catalog);
  const characters = new Map(catalog.characters.map(asset => [assetKey(asset), asset]));
  const styles = new Map(catalog.styles.map(asset => [assetKey(asset), asset]));

  return {
    list(kind?: 'character' | 'style'): CreatorVisualAssetCatalogResponse {
      const assets = [
        ...(kind === 'style' ? [] : catalog.characters.map(characterSummary)),
        ...(kind === 'character' ? [] : catalog.styles.map(styleSummary))
      ];
      return { assets };
    },
    character(reference: CreatorVisualAssetRef): StickmanCharacterAsset {
      const asset = characters.get(assetRefKey(reference));
      if (asset === undefined) {
        throw new StickmanVisualAssetError(
          'creator_character_asset_not_found',
          `Character asset ${reference.assetId}@${reference.revision} is unavailable`
        );
      }
      return asset;
    },
    style(reference: CreatorVisualAssetRef): StickmanStyleAsset {
      const asset = styles.get(assetRefKey(reference));
      if (asset === undefined) {
        throw new StickmanVisualAssetError(
          'creator_style_asset_not_found',
          `Visual style ${reference.assetId}@${reference.revision} is unavailable`
        );
      }
      return asset;
    },
    referenceFiles(asset: StickmanCharacterAsset | StickmanStyleAsset): ResolvedVisualAssetFile[] {
      return asset.referenceFiles.map(file => inspectImageFile(root, file));
    },
    preview(reference: CreatorVisualAssetRef): { stream: ReadStream; path: string; mimeType: string } | undefined {
      const character = characters.get(assetRefKey(reference));
      const style = styles.get(assetRefKey(reference));
      const previewFile = character?.previewFile ?? style?.previewFile ?? null;
      if (previewFile === null) return undefined;
      const path = resolveInside(root, previewFile);
      const info = statSync(path);
      if (!info.isFile() || info.size === 0) return undefined;
      return { stream: createReadStream(path), path, mimeType: imageMime(path) };
    }
  };
}

export class StickmanVisualAssetError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'StickmanVisualAssetError';
  }
}

export function readVisualAssetRef(
  value: unknown,
  fallback: CreatorVisualAssetRef
): CreatorVisualAssetRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  return typeof record.assetId === 'string'
    && Number.isSafeInteger(record.revision)
    && Number(record.revision) > 0
    ? { assetId: record.assetId, revision: Number(record.revision) }
    : fallback;
}

function characterSummary(asset: StickmanCharacterAsset): CreatorVisualAssetSummary {
  return {
    id: asset.id,
    revision: asset.revision,
    templateId: 'stickman-video',
    kind: 'character',
    source: 'builtin',
    status: 'ready',
    name: asset.name,
    description: asset.description,
    previewUrl: previewUrl(asset),
    referenceCount: asset.referenceFiles.length,
    recommended: asset.id === DEFAULT_STICKMAN_CHARACTER_ASSET.assetId,
    tags: asset.tags
  };
}

function styleSummary(asset: StickmanStyleAsset): CreatorVisualAssetSummary {
  return {
    id: asset.id,
    revision: asset.revision,
    templateId: 'stickman-video',
    kind: 'style',
    source: 'builtin',
    status: 'ready',
    name: asset.name,
    description: asset.description,
    previewUrl: asset.previewFile === null ? null : previewUrl(asset),
    referenceCount: asset.referenceFiles.length,
    recommended: asset.recommended,
    tags: asset.tags,
    styleAttributes: asset.styleAttributes
  };
}

function previewUrl(asset: { id: string; revision: number }): string {
  return `/creator/visual-assets/${encodeURIComponent(asset.id)}/revisions/${asset.revision}/preview`;
}

function inspectImageFile(root: string, file: z.infer<typeof referenceFileSchema>): ResolvedVisualAssetFile {
  const path = resolveInside(root, file.path);
  const info = statSync(path);
  if (!info.isFile() || info.size === 0) {
    throw new StickmanVisualAssetError(
      'creator_visual_asset_invalid',
      `Visual asset file is empty: ${file.path}`
    );
  }
  return {
    role: file.role,
    path,
    sha256: hashFile(path),
    bytes: info.size,
    mimeType: imageMime(path)
  };
}

function hashFile(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function imageMime(path: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.png')) return 'image/png';
  throw new StickmanVisualAssetError(
    'creator_visual_asset_invalid',
    `Unsupported visual asset image type: ${path}`
  );
}

function resolveInside(root: string, child: string): string {
  const target = resolve(root, child);
  const value = relative(root, target);
  if (value !== '' && !value.startsWith('..') && !isAbsolute(value)) return target;
  throw new StickmanVisualAssetError(
    'creator_visual_asset_invalid',
    `Visual asset path escapes its root: ${child}`
  );
}

function assetKey(asset: { id: string; revision: number }): string {
  return `${asset.id}@${asset.revision}`;
}

function assetRefKey(reference: CreatorVisualAssetRef): string {
  return `${reference.assetId}@${reference.revision}`;
}

function assertUniqueAssets(catalog: StickmanVisualAssetCatalog): void {
  const keys = [...catalog.characters, ...catalog.styles].map(assetKey);
  if (new Set(keys).size !== keys.length) {
    throw new StickmanVisualAssetError(
      'creator_visual_asset_invalid',
      'Visual asset catalog contains duplicate asset revisions'
    );
  }
}
