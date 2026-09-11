import type {
  CreatorJson,
  CreatorPresetRef,
  CreatorPresetRequirements,
  CreatorPresetSummary,
  CreatorRuntimeWorkspace
} from '@opencreator/protocol';
import type { ZodType } from 'zod';

export type CreatorPresetLocale = 'zh-CN' | 'en-US';
export type CreatorPresetStatus = 'draft' | 'published' | 'hidden';

export type CreatorPresetLocalizedText = Record<CreatorPresetLocale, string>;

export type CreatorPresetSourceManifest = CreatorPresetRef & {
  schemaVersion: 1;
  runtimeTemplate: {
    id: string;
    version: number;
  };
  status: CreatorPresetStatus;
  featured: boolean;
  sortOrder: number;
  title: CreatorPresetLocalizedText;
  description: CreatorPresetLocalizedText;
  cover: string;
  preview?: string;
  previewVideo?: string;
  author?: {
    name: string;
    url?: string;
    avatar?: string;
  };
  tags: string[];
  requirements?: CreatorPresetRequirements;
  defaults: Record<string, CreatorJson>;
  defaultsByLocale?: Partial<Record<CreatorPresetLocale, Record<string, CreatorJson>>>;
};

export type CompiledCreatorPresetAsset = {
  source: string;
  asset: string;
  sha256: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  size: number;
};

export type CompiledCreatorPresetVideoAsset = {
  source: string;
  asset: string;
  sha256: string;
  mime: 'video/mp4';
  size: number;
};

export type CompiledCreatorPreset = Omit<
  CreatorPresetSourceManifest,
  'cover' | 'preview' | 'previewVideo' | 'author'
> & {
  cover: CompiledCreatorPresetAsset;
  preview?: CompiledCreatorPresetAsset;
  previewVideo?: CompiledCreatorPresetVideoAsset;
  author?: {
    name: string;
    url?: string;
    avatar?: CompiledCreatorPresetAsset;
  };
  contentHash: string;
};

export type CreatorPresetCatalog = {
  schemaVersion: 1;
  presets: CompiledCreatorPreset[];
};

export type CreatorPresetBuildManifest = {
  schemaVersion: 1;
  catalogHash: string;
  assetSetHash: string;
  files: Array<{
    path: string;
    sha256: string;
    size: number;
  }>;
};

export type CreatorPresetModuleDefinition = {
  module: CreatorRuntimeWorkspace;
  runtimeTemplate: {
    id: string;
    version: number;
  };
  defaultsSchema: ZodType<Record<string, CreatorJson>>;
  localeDefaultsSchema: ZodType<Record<string, CreatorJson>>;
  validateRequirement(requirement: CreatorPresetRequirements | undefined): void;
  applyFixedFields(state: Record<string, CreatorJson>): Record<string, CreatorJson>;
};

export type CreatorPresetCompilerOptions = {
  sourceRoot: string;
  outputRoot?: string;
  modules?: readonly CreatorPresetModuleDefinition[];
};

export type ResolvedCreatorPreset = {
  preset: CompiledCreatorPreset;
  locale: CreatorPresetLocale;
  title: string;
  state: Record<string, CreatorJson>;
};

export type CreatorPresetRegistry = {
  readonly catalogHash: string;
  listPublished(locale: CreatorPresetLocale): CreatorPresetSummary[];
  get(ref: CreatorPresetRef): CompiledCreatorPreset;
};
