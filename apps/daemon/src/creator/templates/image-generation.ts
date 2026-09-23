import { creatorPromptMaxLength } from '@opencreator/protocol';
import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';

const record = z.record(z.string(), z.unknown()) as never;

export function createLegacyImageGenerationTemplate(): CreatorTemplateDefinition {
  return createImageGenerationTemplateDefinition(1, false);
}

export function createImageGenerationTemplate(): CreatorTemplateDefinition {
  return createImageGenerationTemplateDefinition(2, true);
}

function createImageGenerationTemplateDefinition(
  version: number,
  supportsReferenceImage: boolean
): CreatorTemplateDefinition {
  return {
    id: 'image-generation',
    version,
    renderer: 'image-generation',
    inputSchema: z.object({
      prompt: z.string().max(creatorPromptMaxLength).default(''),
      provider: z.enum(['openai', 'jimeng', 'kling', 'gemini', 'codex-native']).optional(),
      size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
      quality: z.enum(['low', 'medium', 'high']).default('medium'),
      candidateCount: z.number().int().min(1).max(4).optional(),
      ...(supportsReferenceImage
        ? { referenceImageArtifactId: z.string().nullable().default(null) }
        : {}),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [{
      id: 'generate',
      executor: 'image',
      allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input', 'completed'],
      inputArtifacts: supportsReferenceImage
        ? [{
            kind: 'reference_image',
            selector: 'state-artifact-id',
            stateKey: 'referenceImageArtifactId',
            optional: true
          }]
        : [],
      outputArtifacts: [{ kind: 'generated_image', status: 'completed' }]
    }],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['generate'] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['generate'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['generate'] }
    ],
    outputs: [{ kind: 'generated_image', required: true }],
    agentGuidance: supportsReferenceImage
      ? '先明确画面主体、环境、风格、光线和构图，可通过 referenceImageArtifactId 显式绑定参考图，再设置图像服务、画幅、质量与候选数量。启动执行时使用 generate 阶段。'
      : '先明确画面主体、环境、风格、光线和构图，再设置图像服务、画幅、质量与候选数量。启动执行时使用 generate 阶段。'
  };
}
