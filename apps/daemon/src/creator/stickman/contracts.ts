import { z } from 'zod';

export const stickmanSourceSpanSchema = z.object({
  id: z.string().regex(/^source-\d{3}$/),
  text: z.string().trim().min(1)
}).strict();

export const stickmanSourceClaimSchema = z.object({
  id: z.string().regex(/^claim-\d{3}$/),
  text: z.string().trim().min(1),
  sourceSpanIds: z.array(z.string().regex(/^source-\d{3}$/)).min(1).max(200)
}).strict();

export const stickmanSourceBriefSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  audience: z.string().min(1),
  claims: z.array(stickmanSourceClaimSchema).min(1).max(200),
  sourceSpans: z.array(stickmanSourceSpanSchema).min(1).max(200)
}).strict().superRefine((value, context) => {
  uniqueIds(value.sourceSpans.map(span => span.id), 'source span', context);
  uniqueIds(value.claims.map(claim => claim.id), 'source claim', context);
  const sourceSpanIds = new Set(value.sourceSpans.map(span => span.id));
  const referencedSpanIds = new Set(value.claims.flatMap(claim => claim.sourceSpanIds));
  for (const claim of value.claims) {
    for (const sourceSpanId of claim.sourceSpanIds) {
      if (!sourceSpanIds.has(sourceSpanId)) {
        context.addIssue({ code: 'custom', message: `Unknown source span: ${sourceSpanId}` });
      }
    }
  }
  for (const sourceSpan of value.sourceSpans) {
    if (!referencedSpanIds.has(sourceSpan.id)) {
      context.addIssue({ code: 'custom', message: `Unclaimed source span: ${sourceSpan.id}` });
    }
  }
});

export const stickmanNarrationBudgetSchema = z.object({
  unit: z.enum(['characters', 'words']),
  unitsPerMinute: z.number().positive(),
  minUnits: z.number().int().positive(),
  maxUnits: z.number().int().positive()
}).strict().refine(value => value.minUnits <= value.maxUnits, {
  message: 'Narration budget minimum cannot exceed its maximum'
});

export const stickmanContentPlanSchema = z.object({
  title: z.string().min(1),
  audience: z.string().min(1),
  objective: z.string().min(1),
  targetDurationSeconds: z.number().positive().max(600),
  retainedClaimIds: z.array(z.string().regex(/^claim-\d{3}$/)).min(1).max(200),
  discardedClaimIds: z.array(z.string().regex(/^claim-\d{3}$/)).max(200),
  narrationBudget: stickmanNarrationBudgetSchema,
  sections: z.array(z.object({
    id: z.string().regex(/^section-\d{2}$/),
    title: z.string().min(1),
    claimIds: z.array(z.string().regex(/^claim-\d{3}$/)).min(1).max(200)
  }).strict()).min(1).max(200)
}).strict().superRefine((value, context) => {
  uniqueIds(value.sections.map(item => item.id), 'content plan section', context);
  uniqueIds(value.retainedClaimIds, 'retained claim', context);
  uniqueIds(value.discardedClaimIds, 'discarded claim', context);
  const retained = new Set(value.retainedClaimIds);
  for (const claimId of value.discardedClaimIds) {
    if (retained.has(claimId)) {
      context.addIssue({ code: 'custom', message: `Claim cannot be retained and discarded: ${claimId}` });
    }
  }
  const covered = new Set(value.sections.flatMap(section => section.claimIds));
  for (const claimId of covered) {
    if (!retained.has(claimId)) {
      context.addIssue({ code: 'custom', message: `Section references a non-retained claim: ${claimId}` });
    }
  }
  for (const claimId of retained) {
    if (!covered.has(claimId)) {
      context.addIssue({ code: 'custom', message: `Retained claim is missing from sections: ${claimId}` });
    }
  }
});

export const stickmanScriptSegmentSchema = z.object({
  id: z.string().regex(/^segment-[a-z0-9-]+$/),
  order: z.number().int().positive(),
  narration: z.string().min(1),
  claimIds: z.array(z.string().regex(/^claim-\d{3}$/)).min(1).max(200),
  sourceSpanIds: z.array(z.string().regex(/^source-\d{3}$/)).min(1).max(200),
  narrationUnits: z.number().int().positive(),
  estimatedDurationSeconds: z.number().positive().max(5)
}).strict();

export const stickmanScriptManifestSchema = z.object({
  contract: z.literal('stickman-narration-script-v2'),
  reviewStatus: z.enum(['needs_review', 'approved']),
  contentLocked: z.boolean(),
  title: z.string().min(1),
  language: z.string().min(1),
  targetDurationSeconds: z.number().positive().max(600),
  narrationBudget: stickmanNarrationBudgetSchema,
  segmentCount: z.number().int().positive(),
  totalNarrationUnits: z.number().int().positive(),
  estimatedTotalDurationSeconds: z.number().positive(),
  segments: z.array(stickmanScriptSegmentSchema).min(1).max(200)
}).strict().superRefine((value, context) => {
  uniqueIds(value.segments.map(segment => segment.id), 'script segment', context);
  for (const [index, segment] of value.segments.entries()) {
    if (segment.order !== index + 1 || segment.id !== `segment-${String(index + 1).padStart(2, '0')}`) {
      context.addIssue({ code: 'custom', message: 'Script segment ids and order must be contiguous' });
      break;
    }
  }
  if (value.segmentCount !== value.segments.length) {
    context.addIssue({ code: 'custom', message: 'Script segment count does not match' });
  }
  const totalUnits = value.segments.reduce((total, segment) => total + segment.narrationUnits, 0);
  if (value.totalNarrationUnits !== totalUnits) {
    context.addIssue({ code: 'custom', message: 'Script narration unit total does not match' });
  }
  const estimatedDuration = totalUnits / value.narrationBudget.unitsPerMinute * 60;
  if (Math.abs(value.estimatedTotalDurationSeconds - estimatedDuration) > 0.011) {
    context.addIssue({ code: 'custom', message: 'Script estimated duration does not match its narration budget' });
  }
  if (value.contentLocked !== (value.reviewStatus === 'approved')) {
    context.addIssue({ code: 'custom', message: 'Script lock state does not match its review status' });
  }
});

export const stickmanAudioTimingSchema = z.object({
  scriptArtifactId: z.string().min(1),
  timingSource: z.literal('ffprobe_cumulative_tts_duration'),
  segments: z.array(z.object({
    segmentId: z.string().regex(/^segment-[a-z0-9-]+$/),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    durationSeconds: z.number().positive(),
    audioArtifactId: z.string().min(1),
    audioSha256: z.string().regex(/^[a-f0-9]{64}$/i)
  }).strict()).min(1).max(200),
  totalDurationSeconds: z.number().positive()
}).strict().superRefine((value, context) => {
  uniqueIds(value.segments.map(segment => segment.segmentId), 'audio timing segment', context);
  let cursor = 0;
  for (const segment of value.segments) {
    if (
      Math.abs(segment.startSeconds - cursor) > 0.001
      || Math.abs(segment.endSeconds - segment.startSeconds - segment.durationSeconds) > 0.001
    ) {
      context.addIssue({ code: 'custom', message: `Invalid audio timing: ${segment.segmentId}` });
    }
    cursor = segment.endSeconds;
  }
  if (Math.abs(cursor - value.totalDurationSeconds) > 0.001) {
    context.addIssue({ code: 'custom', message: 'Audio timing total does not match its segments' });
  }
});

export const stickmanMotionSchema = z.enum([
  'static',
  'push-in',
  'pan-left',
  'pan-right',
  'zoom-out'
]);

export const stickmanShotSchema = z.object({
  id: z.string().regex(/^shot-[a-z0-9-]+$/),
  sourceSegmentId: z.string().regex(/^segment-[a-z0-9-]+$/),
  semanticAnchor: z.string().trim().min(1),
  visualDescription: z.string().trim().min(1),
  compositionAndAction: z.string().trim().min(1),
  keyObjects: z.array(z.string().trim().min(1)).min(1).max(12),
  continuityReason: z.string().trim(),
  motion: stickmanMotionSchema,
  motionReason: z.string().trim().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  durationSeconds: z.number().positive()
}).strict();

export const stickmanShotSpecSchema = z.object({
  scriptArtifactId: z.string().min(1),
  audioTimingArtifactId: z.string().min(1),
  timingSource: z.literal('ffprobe_cumulative_tts_duration'),
  shots: z.array(stickmanShotSchema).min(1).max(200)
}).strict().superRefine((value, context) => {
  uniqueIds(value.shots.map(shot => shot.id), 'shot', context);
  uniqueIds(value.shots.map(shot => shot.sourceSegmentId), 'shot source segment', context);
  let cursor = 0;
  for (const shot of value.shots) {
    if (
      Math.abs(shot.startSeconds - cursor) > 0.001
      || Math.abs(shot.endSeconds - shot.startSeconds - shot.durationSeconds) > 0.001
    ) {
      context.addIssue({ code: 'custom', message: `Invalid shot timing: ${shot.id}` });
    }
    cursor = shot.endSeconds;
  }
});

export const stickmanImagePromptPackSchema = z.object({
  shotSpecArtifactId: z.string().min(1),
  characterReferenceArtifactId: z.string().min(1),
  styleContractArtifactId: z.string().min(1),
  styleReferenceArtifactId: z.string().min(1).optional(),
  prompts: z.array(z.object({
    shotId: z.string().regex(/^shot-[a-z0-9-]+$/),
    visualDescription: z.string().trim().min(1),
    prompt: z.string().min(1)
  }).strict()).min(1).max(200)
}).strict().superRefine((value, context) => {
  uniqueIds(value.prompts.map(prompt => prompt.shotId), 'image prompt shot', context);
});

const stickmanVisualAssetReferenceSchema = z.object({
  role: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  bytes: z.number().int().positive(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp'])
}).strict();

const stickmanRenderingContractSchema = z.object({
  medium: z.string().min(1),
  surface: z.string().min(1),
  linework: z.string().min(1),
  shading: z.string().min(1),
  palette: z.string().min(1),
  sceneDensity: z.string().min(1),
  composition: z.string().min(1),
  characterRendering: z.string().min(1)
}).strict();

export const stickmanStyleContractSchema = z.object({
  contract: z.literal('stickman-visual-profile-v2'),
  ratio: z.literal('16:9'),
  character: z.object({
    assetId: z.string().min(1),
    revision: z.number().int().positive(),
    identity: z.object({
      preserve: z.string().min(1),
      prohibit: z.string().min(1)
    }).strict(),
    references: z.array(stickmanVisualAssetReferenceSchema).min(1).max(8)
  }).strict(),
  style: z.object({
    assetId: z.string().min(1),
    revision: z.number().int().positive(),
    rendering: stickmanRenderingContractSchema,
    semanticRenderingRules: z.object({
      color: z.string().min(1),
      light: z.string().min(1),
      complexEnvironment: z.string().min(1)
    }).strict(),
    forbiddenDirections: z.array(z.string().min(1)).min(1),
    references: z.array(stickmanVisualAssetReferenceSchema).max(8)
  }).strict()
}).strict();

export const stickmanVisualValidationSchema = z.object({
  ok: z.literal(true),
  validation: z.literal('automated_decode_aspect_nonblank_hash_and_ocr'),
  approvedShotSpecArtifactId: z.string().min(1),
  shotCount: z.number().int().positive(),
  ocrStatus: z.enum(['passed', 'unavailable']),
  publishable: z.boolean(),
  warnings: z.array(z.string().min(1)),
  shots: z.array(z.object({
    shotId: z.string().regex(/^shot-[a-z0-9-]+$/),
    imageArtifactId: z.string().min(1),
    imageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    brightnessMean: z.number().nonnegative().max(255),
    contrastStddev: z.number().nonnegative(),
    ocrStatus: z.enum(['passed', 'unavailable']),
    detectedText: z.array(z.string())
  }).strict()).min(1).max(200)
}).strict().superRefine((value, context) => {
  uniqueIds(value.shots.map(shot => shot.shotId), 'validated shot', context);
  if (value.shotCount !== value.shots.length) {
    context.addIssue({ code: 'custom', message: 'Visual validation shot count does not match' });
  }
  if (value.publishable !== (value.ocrStatus === 'passed' && value.warnings.length === 0)) {
    context.addIssue({ code: 'custom', message: 'Visual publishability does not match its checks' });
  }
});

export const stickmanTimelineSchema = z.object({
  fps: z.number().int().positive(),
  width: z.literal(1280),
  height: z.literal(720),
  totalFrames: z.number().int().positive(),
  shots: z.array(z.object({
    shotId: z.string().min(1),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().positive(),
    imageArtifactId: z.string().min(1),
    audioArtifactId: z.string().min(1),
    motion: stickmanMotionSchema,
    imageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    audioSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    imagePath: z.string().min(1).optional(),
    audioPath: z.string().min(1).optional()
  }).strict()).min(1)
}).strict();

export const stickmanMediaValidationSchema = z.object({
  ok: z.literal(true),
  validation: z.literal('ffprobe_and_three_frame_sampling'),
  cleanVideoArtifactId: z.string().min(1),
  cleanVideoSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  timelineArtifactId: z.string().min(1),
  duration: z.number().positive(),
  expectedDuration: z.number().positive(),
  durationTolerance: z.number().positive(),
  width: z.literal(1280),
  height: z.literal(720),
  hasVideo: z.literal(true),
  hasAudio: z.literal(true),
  sampledFrames: z.array(z.object({
    index: z.number().int().min(1).max(3),
    timestampSeconds: z.number().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    width: z.literal(1280),
    height: z.literal(720),
    brightnessMean: z.number().nonnegative().max(255),
    contrastStddev: z.number().nonnegative()
  }).strict()).length(3)
}).strict();

export const stickmanDeliveryManifestSchema = z.object({
  packageStatus: z.enum(['technical-draft', 'publishable']),
  placeholderAssets: z.array(z.string().min(1)),
  blockingChecks: z.array(z.string().min(1)),
  files: z.array(z.object({
    name: z.enum([
      'stickman-video.mp4',
      'narration.srt'
    ]),
    relativePath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    bytes: z.number().int().nonnegative(),
    mime: z.string().min(1),
    sourceArtifactId: z.string().min(1)
  }).strict()).length(2)
}).strict();

export type StickmanSourceBrief = z.infer<typeof stickmanSourceBriefSchema>;
export type StickmanContentPlan = z.infer<typeof stickmanContentPlanSchema>;
export type StickmanScriptManifest = z.infer<typeof stickmanScriptManifestSchema>;
export type StickmanAudioTiming = z.infer<typeof stickmanAudioTimingSchema>;
export type StickmanShotSpec = z.infer<typeof stickmanShotSpecSchema>;
export type StickmanShot = z.infer<typeof stickmanShotSchema>;
export type StickmanImagePromptPack = z.infer<typeof stickmanImagePromptPackSchema>;
export type StickmanStyleContract = z.infer<typeof stickmanStyleContractSchema>;
export type StickmanVisualValidation = z.infer<typeof stickmanVisualValidationSchema>;
export type StickmanTimeline = z.infer<typeof stickmanTimelineSchema>;
export type StickmanMediaValidation = z.infer<typeof stickmanMediaValidationSchema>;
export type StickmanDeliveryManifest = z.infer<typeof stickmanDeliveryManifestSchema>;

function uniqueIds(ids: string[], label: string, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      context.addIssue({ code: 'custom', message: `Duplicate ${label}: ${id}` });
    }
    seen.add(id);
  }
}
