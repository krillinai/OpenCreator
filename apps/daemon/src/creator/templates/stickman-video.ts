import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';

const record = z.record(z.string(), z.unknown()) as never;

export function createStickmanVideoTemplate(): CreatorTemplateDefinition {
  return {
    id: 'stickman-video',
    version: 1,
    renderer: 'stickman-video',
    inputSchema: z.object({
      topic: z.string().default(''),
      style: z.string().default('极简黑白线稿'),
      characterPrompt: z.string().default('统一的极简火柴人角色'),
      ratio: z.enum(['16:9', '1:1', '9:16']).default('16:9'),
      targetDurationSeconds: z.number().positive().max(600).default(30),
      voice: z.string().default('alloy'),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [
      {
        id: 'script', executor: 'stickman', allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'],
        inputArtifacts: [],
        outputArtifacts: [
          { kind: 'script_manifest', status: 'completed' },
          { kind: 'script_segment', status: 'completed' },
          { kind: 'target_subtitle', status: 'completed' }
        ]
      },
      {
        id: 'storyboard', executor: 'stickman', dependsOn: ['script'], allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'],
        inputArtifacts: [
          { kind: 'script_manifest', selector: 'latest-completed' },
          { kind: 'script_segment', selector: 'latest-completed' }
        ],
        outputArtifacts: [
          { kind: 'storyboard_manifest', status: 'completed' },
          { kind: 'storyboard_image', status: 'completed' }
        ]
      },
      {
        id: 'narration', executor: 'stickman', dependsOn: ['script'], allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'],
        inputArtifacts: [
          { kind: 'script_manifest', selector: 'latest-completed' },
          { kind: 'script_segment', selector: 'latest-completed' }
        ],
        outputArtifacts: [
          { kind: 'narration_manifest', status: 'completed' },
          { kind: 'segment_audio', status: 'completed' }
        ]
      },
      {
        id: 'render', executor: 'stickman', dependsOn: ['storyboard', 'narration'], allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'],
        inputArtifacts: [
          { kind: 'storyboard_manifest', selector: 'latest-completed' },
          { kind: 'narration_manifest', selector: 'latest-completed' }
        ],
        outputArtifacts: [{ kind: 'stickman_video', status: 'completed' }]
      }
    ],
    actions: [
      {
        id: 'update-settings', inputSchema: record, allowedStages: ['script', 'storyboard', 'narration', 'render'],
        invalidates: [{ sourceArtifactKind: 'script_manifest', propagateThroughStageGraph: true }]
      },
      {
        id: 'edit-script-segment', inputSchema: record, allowedStages: ['storyboard', 'narration', 'render'],
        invalidates: [{ sourceArtifactKind: 'script_segment', propagateThroughStageGraph: true }]
      },
      { id: 'run-stage', inputSchema: record, allowedStages: ['script', 'storyboard', 'narration', 'render'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['script', 'storyboard', 'narration', 'render'] }
    ],
    outputs: [{ kind: 'stickman_video', required: true }],
    agentGuidance: '先生成脚本，再生成逐段分镜和配音，最后合成视频；修改单段脚本时保留其他段落的有效资产。'
  };
}
