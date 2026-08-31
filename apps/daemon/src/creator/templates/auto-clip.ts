import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';
const record = z.record(z.string(), z.unknown()) as never;
export function createAutoClipTemplate(): CreatorTemplateDefinition {
  return {
    id: 'auto-clip', version: 1, renderer: 'auto-clips',
    inputSchema: z.object({
      sourceType: z.enum(['url', 'file']).default('url'),
      sourceUrl: z.string().default(''),
      sourceArtifactId: z.string().nullable().default(null),
      formatId: z.string().default('bestvideo+bestaudio/best'),
      sourceLanguage: z.string().default('auto'),
      targetLanguage: z.string().default('zh-CN'),
      preferPlatformCaptions: z.boolean().default(true),
      selectedCandidateIds: z.array(z.string()).default([]),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [
      { id: 'probe', executor: 'download', allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'], inputArtifacts: [], outputArtifacts: [{ kind: 'download_probe', status: 'completed' }] },
      { id: 'download', executor: 'download', dependsOn: ['probe'], allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'], inputArtifacts: [{ kind: 'download_probe', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'source_video', status: 'completed' }] },
      { id: 'subtitle', executor: 'krillinai', dependsOn: ['download'], allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'], inputArtifacts: [{ kind: 'source_video', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'target_subtitle', status: 'completed' }] },
      { id: 'analyze', executor: 'clip', dependsOn: ['subtitle'], allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'], inputArtifacts: [{ kind: 'source_video', selector: 'latest-completed' }, { kind: 'target_subtitle', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'clip_candidates', status: 'completed' }] },
      { id: 'render', executor: 'clip', dependsOn: ['analyze'], allowedJobStatuses: ['draft', 'running', 'failed', 'needs_input'], inputArtifacts: [{ kind: 'source_video', selector: 'latest-completed' }, { kind: 'clip_candidates', selector: 'latest-completed' }], outputArtifacts: [{ kind: 'auto_clip_video', status: 'completed' }] }
    ],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['probe', 'download', 'subtitle', 'analyze', 'render'], invalidates: [{ sourceArtifactKind: 'clip_candidates', propagateThroughStageGraph: true }] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['probe', 'download', 'subtitle', 'analyze', 'render'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['probe', 'download', 'subtitle', 'analyze', 'render'] }
    ],
    outputs: [{ kind: 'auto_clip_video', required: true }],
    agentGuidance: '先分析并展示四维评分候选，用户选择后再渲染。'
  };
}
