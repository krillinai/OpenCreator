import {
  creatorRuntimeWorkspaces,
  type CreatorJson,
  type CreatorPresetRequirements
} from '@opencreator/protocol';
import { z } from 'zod';

const localeTextSchema = z.object({
  'zh-CN': z.string().trim().min(1).max(160),
  'en-US': z.string().trim().min(1).max(160)
}).strict();

const requirementSchema = z.object({
  service: z.enum(['tts', 'image', 'video']),
  provider: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(128).optional()
}).strict();

const authorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(500)
    .refine(value => value.startsWith('https://'), 'Author URL must use HTTPS')
    .optional(),
  avatar: z.string().trim().min(1).max(240).optional()
}).strict();

const creatorJsonSchema: z.ZodType<CreatorJson> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(creatorJsonSchema),
  z.record(creatorJsonSchema)
]));

const creatorJsonRecordSchema = z.record(creatorJsonSchema);

export const creatorPresetSourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  version: z.number().int().positive(),
  module: z.enum(creatorRuntimeWorkspaces),
  runtimeTemplate: z.object({
    id: z.string().trim().min(1).max(80),
    version: z.number().int().positive()
  }).strict(),
  status: z.enum(['draft', 'published', 'hidden']),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(-10_000).max(10_000).default(0),
  title: localeTextSchema,
  description: localeTextSchema,
  cover: z.string().trim().min(1).max(240),
  preview: z.string().trim().min(1).max(240).optional(),
  previewVideo: z.string().trim().min(1).max(240).optional(),
  author: authorSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  requirements: requirementSchema.optional(),
  defaults: creatorJsonRecordSchema,
  defaultsByLocale: z.object({
    'zh-CN': creatorJsonRecordSchema.optional(),
    'en-US': creatorJsonRecordSchema.optional()
  }).strict().optional()
}).strict();

export const creatorPresetForbiddenFieldNames = new Set([
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'accesskeyid',
  'access_key_id',
  'accesskeysecret',
  'access_key_secret',
  'secretkey',
  'secret_key',
  'password',
  'credential',
  'credentials',
  'token',
  'sourceurl',
  'source_url',
  'sourceartifactid',
  'source_artifact_id',
  'referenceimageartifactid',
  'reference_image_artifact_id',
  'subtitle',
  'subtitles',
  'subtitletext',
  'subtitle_text',
  'selectedoptionid',
  'selected_option_id',
  'formatid',
  'format_id',
  'remotetaskid',
  'remote_task_id',
  'progress',
  'error',
  'result',
  'artifact',
  'artifacts',
  'currentstep',
  'current_step',
  'furtheststep',
  'furthest_step',
  'currentstage',
  'current_stage',
  'workspacephase',
  'workspace_phase',
  'resulttab',
  'result_tab',
  'resultversion',
  'result_version',
  'draftbaseversion',
  'draft_base_version',
  'font_name',
  'raw_ass_style',
  'override_tags'
]);

export function validatePresetPublicFields(
  value: Record<string, CreatorJson>,
  location: string
): void {
  visitPresetValue(value, location);
}

export function normalizePresetRequirement(
  value: CreatorPresetRequirements | undefined
): CreatorPresetRequirements | undefined {
  return value === undefined ? undefined : requirementSchema.parse(value);
}

function visitPresetValue(value: CreatorJson, location: string): void {
  if (typeof value === 'string' && isAbsolutePath(value)) {
    throw new Error(`${location}: absolute paths are not allowed`);
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitPresetValue(item, `${location}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll('-', '_').toLowerCase();
    if (creatorPresetForbiddenFieldNames.has(normalized)) {
      throw new Error(`${location}.${key}: field is not allowed in creator presets`);
    }
    visitPresetValue(child, `${location}.${key}`);
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/')
    || value.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/.test(value);
}
