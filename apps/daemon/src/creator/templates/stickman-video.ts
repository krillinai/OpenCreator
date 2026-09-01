import { z } from 'zod';
import type { CreatorTemplateAction, CreatorTemplateDefinition, CreatorTemplateStage } from './types.js';

const jsonRecord = z.record(z.string(), z.unknown());
const positiveVersion = z.number().int().positive();
const stageId = z.string().min(1);
const artifactId = z.string().min(1);
const scopeKey = z.string().min(1);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/i);

const action = (
  id: string,
  schema: z.ZodTypeAny,
  allowedStages: string[]
): CreatorTemplateAction => ({ id, inputSchema: schema as never, allowedStages });

const stage = (
  definition: Omit<CreatorTemplateStage, 'allowedJobStatuses' | 'jobCompletionPolicy'>
    & { final?: boolean }
): CreatorTemplateStage => {
  const { final = false, ...value } = definition;
  return {
    ...value,
    allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input', 'completed'],
    jobCompletionPolicy: final ? 'complete' : 'continue',
    resultVersionPolicy: final ? 'snapshot' : 'none'
  };
};

export const stickmanVideoStageIds = [
  'acquire-source',
  'source-transcript',
  'source-brief',
  'content-plan',
  'script',
  'storyboard',
  'images',
  'narration',
  'visual-validation',
  'timeline',
  'render-clean',
  'cover',
  'subtitles',
  'publish-copy',
  'bilingual-render',
  'package-validation'
] as const;

export function createStickmanVideoTemplate(): CreatorTemplateDefinition {
  const allStages = [...stickmanVideoStageIds];
  return {
    id: 'stickman-video',
    version: 2,
    renderer: 'stickman-video',
    inputSchema: z.object({
      sourceType: z.literal('url').default('url'),
      sourceUrl: z.string().default(''),
      topic: z.string().default(''),
      style: z.string().default('极简黑白线稿'),
      characterPrompt: z.string().default('统一的极简火柴人角色'),
      ratio: z.literal('16:9').default('16:9'),
      targetDurationSeconds: z.number().positive().max(600).default(30),
      sourceLanguage: z.string().default('auto'),
      targetLanguage: z.string().default('zh-CN'),
      voice: z.string().default('alloy'),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [
      stage({ id: 'acquire-source', executor: 'download', inputArtifacts: [], outputArtifacts: [{ kind: 'source_video', status: 'completed' }] }),
      stage({ id: 'source-transcript', executor: 'krillinai', dependsOn: ['acquire-source'], inputArtifacts: [{ kind: 'source_video', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'source_subtitle', status: 'completed' }] }),
      stage({ id: 'source-brief', executor: 'stickman-content', dependsOn: ['source-transcript'], inputArtifacts: [{ kind: 'source_subtitle', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'source_brief', status: 'completed' }] }),
      stage({ id: 'content-plan', executor: 'stickman-content', dependsOn: ['source-brief'], inputArtifacts: [{ kind: 'source_brief', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'content_plan', status: 'completed' }] }),
      stage({ id: 'script', executor: 'stickman-content', dependsOn: ['content-plan'], inputArtifacts: [{ kind: 'content_plan', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'script_manifest', status: 'completed' }, { kind: 'narration_subtitle', status: 'completed' }] }),
      stage({ id: 'storyboard', executor: 'stickman-content', dependsOn: ['script'], inputArtifacts: [{ kind: 'script_manifest', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'shot_spec', status: 'completed' }, { kind: 'character_reference', status: 'completed' }] }),
      stage({ id: 'images', executor: 'stickman-image', dependsOn: ['storyboard'], inputArtifacts: [{ kind: 'shot_spec', selector: 'latest-completed' }, { kind: 'character_reference', selector: 'latest-completed', optional: true }], outputArtifacts: [{ kind: 'shot_image', status: 'completed' }] }),
      stage({ id: 'narration', executor: 'krillinai', dependsOn: ['script'], inputArtifacts: [{ kind: 'script_manifest', selector: 'latest-completed' }, { kind: 'narration_subtitle', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'narration_audio', status: 'completed' }] }),
      stage({ id: 'visual-validation', executor: 'stickman-validation', dependsOn: ['images'], inputArtifacts: [{ kind: 'shot_spec', selector: 'latest-completed' }, { kind: 'shot_image', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'visual_validation', status: 'completed' }] }),
      stage({ id: 'timeline', executor: 'stickman-timeline', dependsOn: ['visual-validation', 'narration'], inputArtifacts: [{ kind: 'shot_spec', selector: 'latest-completed' }, { kind: 'shot_image', selector: 'latest-completed' }, { kind: 'narration_audio', selector: 'latest-completed' }, { kind: 'visual_validation', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'timeline_manifest', status: 'completed' }] }),
      stage({ id: 'render-clean', executor: 'stickman-remotion', dependsOn: ['timeline'], inputArtifacts: [{ kind: 'timeline_manifest', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'clean_video', status: 'completed' }] }),
      stage({ id: 'cover', executor: 'stickman-image', dependsOn: ['render-clean'], inputArtifacts: [{ kind: 'clean_video', selector: 'latest-completed' }, { kind: 'content_plan', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'cover_image', status: 'completed' }] }),
      stage({ id: 'subtitles', executor: 'krillinai', dependsOn: ['render-clean'], inputArtifacts: [{ kind: 'clean_video', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'bilingual_subtitle', status: 'completed' }] }),
      stage({ id: 'publish-copy', executor: 'stickman-content', dependsOn: ['render-clean'], inputArtifacts: [{ kind: 'content_plan', selector: 'latest-completed' }, { kind: 'script_manifest', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'publish_copy', status: 'completed' }] }),
      stage({ id: 'bilingual-render', executor: 'krillinai', dependsOn: ['subtitles'], inputArtifacts: [{ kind: 'clean_video', selector: 'latest-completed' }, { kind: 'bilingual_subtitle', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'bilingual_video', status: 'completed' }] }),
      stage({ id: 'package-validation', executor: 'stickman-delivery', dependsOn: ['cover', 'publish-copy', 'bilingual-render'], final: true, inputArtifacts: [
        { kind: 'clean_video', selector: 'latest-completed' },
        { kind: 'cover_image', selector: 'latest-completed' },
        { kind: 'publish_copy', selector: 'latest-completed' },
        { kind: 'bilingual_video', selector: 'latest-completed' },
        { kind: 'bilingual_subtitle', selector: 'latest-completed' }
      ], outputArtifacts: [
        { kind: 'clean_video', status: 'completed' },
        { kind: 'cover_image', status: 'completed' },
        { kind: 'publish_copy', status: 'completed' },
        { kind: 'bilingual_video', status: 'completed' },
        { kind: 'bilingual_subtitle', status: 'completed' },
        { kind: 'delivery_manifest', status: 'completed' }
      ] })
    ],
    actions: [
      action('update-settings', z.object({ patch: jsonRecord, activityMode: z.enum(['draft', 'semantic']).optional(), objectId: z.string().optional() }).strict(), allStages),
      action('edit-script', z.object({ artifactId, content: z.string().min(1), baseResultVersion: positiveVersion.optional() }).strict(), ['script', 'storyboard']),
      action('approve-script', z.object({ artifactId, revision: z.number().int().nonnegative() }).strict(), ['script']),
      action('edit-shot', z.object({ artifactId, scopeKey, patch: jsonRecord, revision: z.number().int().nonnegative() }).strict(), ['storyboard', 'images']),
      action('approve-storyboard', z.object({ artifactId, revision: z.number().int().nonnegative() }).strict(), ['storyboard']),
      action('regenerate-shot', z.object({ scopeKey, inputFingerprint: fingerprint, revision: z.number().int().nonnegative() }).strict(), ['images']),
      action('approve-visuals', z.object({ artifactId, revision: z.number().int().nonnegative() }).strict(), ['visual-validation']),
      action('run-stage', z.object({ stageId, baseResultVersion: positiveVersion.optional(), inputResultVersion: positiveVersion.optional(), targetResultVersion: positiveVersion.optional() }).strict(), allStages),
      action('commit-version', z.object({ baseResultVersion: positiveVersion }).strict(), ['package-validation']),
      action('retry-stage', z.object({ stageId, scopeKey: scopeKey.optional() }).strict(), allStages),
      action('resolve-provider-request', z.discriminatedUnion('decision', [
        z.object({ ledgerId: z.string().min(1), revision: z.number().int().nonnegative(), decision: z.literal('query') }).strict(),
        z.object({ ledgerId: z.string().min(1), revision: z.number().int().nonnegative(), decision: z.literal('confirm-resubmit'), acceptDuplicateBilling: z.literal(true) }).strict(),
        z.object({ ledgerId: z.string().min(1), revision: z.number().int().nonnegative(), decision: z.literal('cancel-scope') }).strict()
      ]), allStages),
      action('undo-action', z.object({ patch: jsonRecord }).strict(), allStages)
    ],
    outputs: [
      { kind: 'clean_video', required: true },
      { kind: 'cover_image', required: true },
      { kind: 'publish_copy', required: true },
      { kind: 'bilingual_video', required: true },
      { kind: 'bilingual_subtitle', required: true },
      { kind: 'delivery_manifest', required: true }
    ],
    agentGuidance: '按审核门推进脚本、分镜、镜头图片、时间线和固定五项交付；计费请求未知时只能建议用户显式处置。'
  };
}
