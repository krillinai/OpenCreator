import { z } from 'zod';

export const stickmanSourceBriefSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(1).max(12)
}).strict();

export const stickmanContentPlanSchema = z.object({
  title: z.string().min(1),
  audience: z.string().min(1),
  objective: z.string().min(1),
  outline: z.array(z.string().min(1)).min(1).max(12)
}).strict();

export const stickmanScriptSegmentSchema = z.object({
  id: z.string().regex(/^segment-[a-z0-9-]+$/),
  narration: z.string().min(1),
  durationSeconds: z.number().positive().max(60),
  sourceKeyPoint: z.string().min(1)
}).strict();

export const stickmanScriptManifestSchema = z.object({
  title: z.string().min(1),
  language: z.string().min(1),
  segments: z.array(stickmanScriptSegmentSchema).min(1).max(24)
}).strict().superRefine((value, context) => {
  uniqueIds(value.segments.map(segment => segment.id), 'script segment', context);
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
  narration: z.string().min(1),
  imagePrompt: z.string().min(1),
  motion: stickmanMotionSchema,
  durationSeconds: z.number().positive().max(60)
}).strict();

export const stickmanShotSpecSchema = z.object({
  scriptArtifactId: z.string().min(1),
  shots: z.array(stickmanShotSchema).min(1).max(24)
}).strict().superRefine((value, context) => {
  uniqueIds(value.shots.map(shot => shot.id), 'shot', context);
  uniqueIds(value.shots.map(shot => shot.sourceSegmentId), 'shot source segment', context);
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

export const stickmanPublishCopySchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).min(1).max(20)
}).strict();

export const stickmanDeliveryManifestSchema = z.object({
  files: z.array(z.object({
    name: z.enum([
      'landscape-clean.mp4',
      'youtube-cover.png',
      'publish-copy-youtube.md',
      'horizontal_bilingual.mp4',
      'bilingual_srt.srt'
    ]),
    relativePath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    bytes: z.number().int().nonnegative(),
    mime: z.string().min(1),
    sourceArtifactId: z.string().min(1)
  }).strict()).length(5)
}).strict();

export type StickmanSourceBrief = z.infer<typeof stickmanSourceBriefSchema>;
export type StickmanContentPlan = z.infer<typeof stickmanContentPlanSchema>;
export type StickmanScriptManifest = z.infer<typeof stickmanScriptManifestSchema>;
export type StickmanShotSpec = z.infer<typeof stickmanShotSpecSchema>;
export type StickmanShot = z.infer<typeof stickmanShotSchema>;
export type StickmanTimeline = z.infer<typeof stickmanTimelineSchema>;
export type StickmanPublishCopy = z.infer<typeof stickmanPublishCopySchema>;
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
