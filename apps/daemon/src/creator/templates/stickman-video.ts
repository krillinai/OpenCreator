import { z } from 'zod';
import type { CreatorTemplateAction, CreatorTemplateDefinition, CreatorTemplateStage } from './types.js';

const jsonRecord = z.record(z.string(), z.unknown());
const positiveVersion = z.number().int().positive();
const stageId = z.string().min(1);
const artifactId = z.string().min(1);
const scopeKey = z.string().min(1);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/i);

const workflowTarget = z.enum([
  'script_ready',
  'audio_ready',
  'visuals_ready',
  'delivery_ready'
]);
const visualAssetRef = z.object({
  assetId: z.string().min(1),
  revision: z.number().int().positive()
}).strict();

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
  'ingest-text',
  'source-transcript',
  'source-brief',
  'content-plan',
  'script',
  'narration',
  'audio-timing',
  'storyboard',
  'style-assets',
  'prompt-pack',
  'images',
  'visual-validation',
  'timeline',
  'render-clean',
  'media-validation',
  'package-validation'
] as const;

export function createStickmanVideoTemplate(): CreatorTemplateDefinition {
  const allStages = [...stickmanVideoStageIds];
  return {
    id: 'stickman-video',
    version: 2,
    renderer: 'stickman-video',
    inputSchema: z.object({
      sourceType: z.enum(['url', 'text']).default('url'),
      sourceUrl: z.string().default(''),
      sourceText: z.string().max(50_000).default(''),
      topic: z.string().default(''),
      characterAsset: visualAssetRef.default({
        assetId: 'stickman.character.default',
        revision: 1
      }),
      styleAsset: visualAssetRef.default({
        assetId: 'stickman.style.paper-pencil',
        revision: 1
      }),
      ratio: z.literal('16:9').default('16:9'),
      targetDurationSeconds: z.number().positive().max(600).default(30),
      sourceLanguage: z.string().default('auto'),
      targetLanguage: z.string().default('zh-CN'),
      ttsProvider: z.enum(['openai', 'aliyun', 'edge-tts', 'minimax']).optional(),
      ttsModel: z.string().optional(),
      voiceCode: z.string().optional(),
      voiceName: z.string().optional(),
      workflowTarget: workflowTarget.default('script_ready'),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [
      stage({ id: 'ingest-text', executor: 'stickman-content', inputArtifacts: [], outputArtifacts: [{ kind: 'source_text', status: 'completed' }] }),
      stage({ id: 'source-transcript', executor: 'krillinai', inputArtifacts: [], outputArtifacts: [{ kind: 'source_subtitle', status: 'completed' }] }),
      stage({ id: 'source-brief', executor: 'stickman-content', inputArtifacts: [{ kind: 'source_text', selector: 'latest-completed', optional: true }, { kind: 'source_subtitle', selector: 'latest-completed', optional: true }], outputArtifacts: [{ kind: 'source_brief', status: 'completed' }] }),
      stage({ id: 'content-plan', executor: 'stickman-content', dependsOn: ['source-brief'], inputArtifacts: [{ kind: 'source_brief', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'content_plan', status: 'completed' }] }),
      stage({ id: 'script', executor: 'stickman-content', dependsOn: ['content-plan'], inputArtifacts: [{ kind: 'content_plan', selector: 'latest-completed' }, { kind: 'source_brief', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'script_manifest', status: 'completed' }] }),
      stage({ id: 'narration', executor: 'stickman-audio', dependsOn: ['script'], inputArtifacts: [{ kind: 'script_manifest', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'narration_audio', status: 'completed' }] }),
      stage({ id: 'audio-timing', executor: 'stickman-audio', dependsOn: ['narration'], inputArtifacts: [{ kind: 'script_manifest', selector: 'latest-completed' }, { kind: 'narration_audio', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'audio_timing', status: 'completed' }] }),
      stage({ id: 'storyboard', executor: 'stickman-content', dependsOn: ['audio-timing'], inputArtifacts: [{ kind: 'script_manifest', selector: 'latest-completed' }, { kind: 'audio_timing', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'shot_spec', status: 'completed' }] }),
      stage({ id: 'style-assets', executor: 'stickman-content', dependsOn: ['storyboard'], inputArtifacts: [{ kind: 'shot_spec', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'character_reference', status: 'completed' }, { kind: 'style_reference', status: 'completed' }, { kind: 'style_contract', status: 'completed' }] }),
      stage({ id: 'prompt-pack', executor: 'stickman-content', dependsOn: ['style-assets'], inputArtifacts: [{ kind: 'shot_spec', selector: 'latest-completed' }, { kind: 'character_reference', selector: 'latest-completed' }, { kind: 'style_reference', selector: 'latest-completed', optional: true }, { kind: 'style_contract', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'image_prompt_pack', status: 'completed' }] }),
      stage({ id: 'images', executor: 'stickman-image', dependsOn: ['prompt-pack'], invalidateDependentArtifacts: false, replaceOutputArtifactsInScope: true, inputArtifacts: [{ kind: 'shot_spec', selector: 'latest-completed' }, { kind: 'image_prompt_pack', selector: 'latest-completed' }, { kind: 'character_reference', selector: 'latest-completed' }, { kind: 'style_reference', selector: 'latest-completed', optional: true }, { kind: 'style_contract', selector: 'latest-completed' }, { kind: 'shot_image', selector: 'latest-completed', optional: true }], outputArtifacts: [{ kind: 'shot_image', status: 'completed' }] }),
      stage({ id: 'visual-validation', executor: 'stickman-validation', dependsOn: ['images'], inputArtifacts: [{ kind: 'shot_spec', selector: 'latest-completed' }, { kind: 'shot_image', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'visual_validation', status: 'completed' }] }),
      stage({ id: 'timeline', executor: 'stickman-timeline', dependsOn: ['visual-validation'], inputArtifacts: [{ kind: 'script_manifest', selector: 'latest-completed' }, { kind: 'audio_timing', selector: 'latest-completed' }, { kind: 'shot_spec', selector: 'latest-completed' }, { kind: 'shot_image', selector: 'latest-completed' }, { kind: 'narration_audio', selector: 'latest-completed' }, { kind: 'visual_validation', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'timeline_manifest', status: 'completed' }, { kind: 'narration_subtitle', status: 'completed' }] }),
      stage({ id: 'render-clean', executor: 'stickman-remotion', dependsOn: ['timeline'], inputArtifacts: [{ kind: 'timeline_manifest', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'clean_video', status: 'completed' }] }),
      stage({ id: 'media-validation', executor: 'stickman-media-validation', dependsOn: ['render-clean'], inputArtifacts: [{ kind: 'clean_video', selector: 'latest-completed' }, { kind: 'timeline_manifest', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'media_validation', status: 'completed' }] }),
      stage({ id: 'package-validation', executor: 'stickman-delivery', dependsOn: ['media-validation'], final: true, invalidateDependentArtifacts: false, inputArtifacts: [
        { kind: 'clean_video', selector: 'latest-completed' },
        { kind: 'narration_subtitle', selector: 'latest-completed' },
        { kind: 'visual_validation', selector: 'latest-completed' },
        { kind: 'audio_timing', selector: 'latest-completed' },
        { kind: 'timeline_manifest', selector: 'latest-completed' },
        { kind: 'media_validation', selector: 'latest-completed' },
        { kind: 'narration_audio', selector: 'latest-completed' }
      ], outputArtifacts: [
        { kind: 'clean_video', status: 'completed' },
        { kind: 'narration_subtitle', status: 'completed' },
        { kind: 'delivery_manifest', status: 'completed' }
      ] })
    ],
    actions: [
      action('update-settings', z.object({ patch: jsonRecord, activityMode: z.enum(['draft', 'semantic']).optional(), objectId: z.string().optional() }).strict(), allStages),
      action('edit-script', z.object({ artifactId, content: z.string().min(1), baseResultVersion: positiveVersion.optional() }).strict(), ['script', 'storyboard']),
      action('approve-script', z.object({ artifactId, revision: z.number().int().nonnegative() }).strict(), ['script']),
      action('continue-after-audio', z.object({ artifactId, revision: z.number().int().nonnegative() }).strict(), ['audio-timing']),
      action('continue-after-visuals', z.object({ artifactId, revision: z.number().int().nonnegative() }).strict(), ['visual-validation']),
      action('edit-shot', z.object({ artifactId, scopeKey, patch: jsonRecord, revision: z.number().int().nonnegative() }).strict(), ['storyboard', 'images', 'visual-validation']),
      action('regenerate-shot', z.object({ scopeKey, inputFingerprint: fingerprint, revision: z.number().int().nonnegative() }).strict(), ['images', 'visual-validation']),
      action('generate-missing-shots', z.object({ revision: z.number().int().nonnegative() }).strict(), ['images', 'visual-validation']),
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
      { kind: 'narration_subtitle', required: true },
      { kind: 'delivery_manifest', required: true }
    ],
    agentGuidance: '按脚本、配音、分镜画面、动画合成和成片交付的阶段边界推进；计费请求未知时只能建议用户显式处置。'
  };
}
