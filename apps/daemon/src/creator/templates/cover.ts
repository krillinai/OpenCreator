import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';

const record = z.record(z.string(), z.unknown()) as never;
export function createCoverTemplate(): CreatorTemplateDefinition {
  return {
    id: 'cover', version: 1, renderer: 'cover-generator',
    inputSchema: z.object({
      prompt: z.string().default(''), ratio: z.enum(['16:9', '1:1', '9:16']).default('16:9'),
      candidateCount: z.number().int().min(1).max(8).default(3), currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [{
      id: 'generate', executor: 'image', allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'],
      inputArtifacts: [{ kind: 'reference_image', selector: 'latest-completed', optional: true }],
      outputArtifacts: [{ kind: 'cover_image', status: 'completed' }]
    }],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['generate'] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['generate'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['generate'] }
    ],
    outputs: [{ kind: 'cover_image', required: true }],
    agentGuidance: '明确封面主题、比例和候选数；参考图能力不支持时必须显式报错。'
  };
}
