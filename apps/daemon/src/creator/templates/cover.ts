import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';

const record = z.record(z.string(), z.unknown()) as never;

export function createLegacyCoverTemplate(): CreatorTemplateDefinition {
  return {
    id: 'cover',
    version: 1,
    renderer: 'cover-generator',
    inputSchema: z.object({
      prompt: z.string().default(''),
      ratio: z.enum(['16:9', '1:1', '9:16']).default('16:9'),
      candidateCount: z.number().int().min(1).max(8).default(3),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [{
      id: 'generate',
      executor: 'image',
      allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'],
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

export function createCoverTemplate(): CreatorTemplateDefinition {
  return {
    id: 'cover',
    version: 2,
    renderer: 'cover-generator',
    inputSchema: z.object({
      sourceType: z.enum(['prompt', 'youtube']).default('prompt'),
      sourceUrl: z.string().default(''),
      prompt: z.string().default(''),
      ratio: z.enum(['16:9', '1:1', '9:16']).default('16:9'),
      candidateCount: z.number().int().min(1).max(4).default(2),
      quality: z.enum(['low', 'medium', 'high']).default('medium'),
      provider: z.enum(['openai', 'jimeng', 'kling', 'gemini']).optional(),
      referenceImageArtifactId: z.string().nullable().default(null),
      currentStep: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
      furthestStep: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
      workspacePhase: z.enum(['configure', 'result']).default('configure'),
      resultVersion: z.number().int().positive().nullable().default(null),
      resultTab: z.enum(['options', 'references', 'settings']).default('options'),
      draftBaseVersion: z.number().int().positive().nullable().default(null),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [
      {
        id: 'analyze-source',
        executor: 'cover-analysis',
        optional: true,
        resultVersionPolicy: 'none',
        invalidateDependentArtifacts: false,
        allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
        inputArtifacts: [],
        outputArtifacts: [
          { kind: 'cover_brief', status: 'completed' },
          { kind: 'source_keyframe', status: 'completed' }
        ]
      },
      {
        id: 'generate',
        executor: 'image',
        dependsOn: ['analyze-source'],
        allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
        inputArtifacts: [
          { kind: 'cover_brief', selector: 'latest-completed', optional: true },
          { kind: 'source_keyframe', selector: 'latest-completed', optional: true },
          {
            kind: 'reference_image',
            selector: 'state-artifact-id',
            stateKey: 'referenceImageArtifactId',
            optional: true
          }
        ],
        outputArtifacts: [{ kind: 'cover_image', status: 'completed' }]
      }
    ],
    actions: [
      {
        id: 'update-settings',
        inputSchema: record,
        allowedStages: ['analyze-source', 'generate']
      },
      {
        id: 'run-stage',
        inputSchema: record,
        allowedStages: ['analyze-source', 'generate']
      },
      {
        id: 'undo-action',
        inputSchema: record,
        allowedStages: ['analyze-source', 'generate']
      }
    ],
    outputs: [{ kind: 'cover_image', required: true }],
    agentGuidance: [
      '明确封面主题、比例和候选数。',
      '仅提示词任务直接运行 generate；YouTube 来源先运行 analyze-source 并设置 workflow=true。',
      '参考图必须通过 referenceImageArtifactId 显式绑定，不能假定最新上传图片。'
    ].join(' ')
  };
}
