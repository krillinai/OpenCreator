import { creatorPromptMaxLength, videoGenerationSizes, videoGenerationDurations } from '@opencreator/protocol';
import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';

const record = z.record(z.string(), z.unknown()) as never;

export function createVideoGenerationTemplate(): CreatorTemplateDefinition {
  return {
    id: 'video-generation',
    version: 1,
    renderer: 'video-generation',
    inputSchema: z.object({
      prompt: z.string().max(creatorPromptMaxLength).default(''),
      provider: z.enum(['seedance', 'kling', 'veo']).default('seedance'),
      model: z.string().trim().min(1).max(200).optional(),
      size: z.string().regex(/^(?:\d+x\d+|[A-Za-z0-9._-]+@\d+:\d+)$/).default('1280x720'),
      duration: z.number().int().positive().max(600).default(5),
      referenceImageArtifactId: z.string().nullable().default(null),
      currentStage: z.string().nullable().default(null)
    }).passthrough().superRefine((value, context) => {
      if (value.officialModels !== undefined) return;
      if (!(videoGenerationSizes as readonly string[]).includes(value.size)) context.addIssue({ code: 'custom', path: ['size'], message: 'Unsupported custom video size' });
      if (!(videoGenerationDurations as readonly number[]).includes(value.duration)) context.addIssue({ code: 'custom', path: ['duration'], message: 'Unsupported custom video duration' });
    }) as never,
    stages: [{
      id: 'generate',
      executor: 'video',
      allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input', 'completed'],
      inputArtifacts: [{
        kind: 'reference_image',
        selector: 'state-artifact-id',
        stateKey: 'referenceImageArtifactId',
        optional: true
      }],
      outputArtifacts: [{ kind: 'generated_video', status: 'completed' }]
    }],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['generate'] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['generate'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['generate'] }
    ],
    outputs: [{ kind: 'generated_video', required: true }],
    agentGuidance: [
      '先明确主体动作、场景、镜头运动、光线和视觉风格。',
      '可通过 referenceImageArtifactId 显式绑定参考图。',
      '再设置视频服务、具体模型版本、画幅和时长，启动执行时使用 generate 阶段。',
      '重新生成会创建新的结果版本并保留历史视频。'
    ].join('')
  };
}
