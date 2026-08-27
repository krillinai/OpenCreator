import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';

const record = z.record(z.string(), z.unknown()) as never;

export function createImageGenerationTemplate(): CreatorTemplateDefinition {
  return {
    id: 'image-generation',
    version: 1,
    renderer: 'image-generation',
    inputSchema: z.object({
      prompt: z.string().max(4_000).default(''),
      provider: z.enum(['openai', 'jimeng', 'kling', 'gemini']).default('openai'),
      size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
      quality: z.enum(['low', 'medium', 'high']).default('medium'),
      candidateCount: z.number().int().min(1).max(4).default(2),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [{
      id: 'generate',
      executor: 'image',
      allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input', 'completed'],
      inputArtifacts: [],
      outputArtifacts: [{ kind: 'generated_image', status: 'completed' }]
    }],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['generate'] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['generate'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['generate'] }
    ],
    outputs: [{ kind: 'generated_image', required: true }],
    agentGuidance: '先明确画面主体、环境、风格、光线和构图，再设置图像服务、画幅、质量与候选数量。启动执行时使用 generate 阶段。'
  };
}
