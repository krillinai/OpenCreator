import { z } from 'zod/v3';
import type { CreatorTemplateDefinition } from './types.js';
const record = z.record(z.string(), z.unknown()) as never;

export function createLegacyAutoClipTemplate(): CreatorTemplateDefinition {
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
    agentGuidance: '分析高光片段后自动将全部片段分别渲染为独立视频文件。'
  };
}

export function createAutoClipTemplateV2(): CreatorTemplateDefinition {
  return {
    id: 'auto-clip',
    version: 2,
    renderer: 'auto-clips',
    inputSchema: z.object({
      sourceType: z.enum(['url', 'file']).default('url'),
      sourceUrl: z.string().default(''),
      sourceArtifactId: z.string().nullable().default(null),
      formatId: z.string().default('bestvideo+bestaudio/best'),
      sourceLanguage: z.string().default('auto'),
      targetLanguage: z.string().default('zh-CN'),
      preferPlatformCaptions: z.boolean().default(true),
      focus: z.enum(['balanced', 'viral', 'knowledge']).default('balanced'),
      genre: z.enum(['auto', 'talk', 'podcast', 'tutorial', 'interview', 'entertainment', 'sports', 'gaming', 'news']).default('auto'),
      duration: z.enum(['15-30', '30-60', '60-90']).default('30-60'),
      clipCount: z.number().int().min(1).max(20).default(3),
      aspectRatio: z.enum(['source', '16:9', '9:16', '1:1']).default('source'),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [
      {
        id: 'probe',
        executor: 'download',
        completesJob: false,
        resultVersionPolicy: 'none',
        allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
        inputArtifacts: [],
        outputArtifacts: [{ kind: 'download_probe', status: 'completed' }]
      },
      {
        id: 'download',
        executor: 'download',
        completesJob: false,
        resultVersionPolicy: 'none',
        dependsOn: ['probe'],
        allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
        inputArtifacts: [{ kind: 'download_probe', selector: 'latest-completed' }],
        outputArtifacts: [{ kind: 'source_video', status: 'completed' }]
      },
      {
        id: 'subtitle',
        executor: 'krillinai',
        completesJob: false,
        resultVersionPolicy: 'none',
        dependsOn: ['download'],
        allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
        inputArtifacts: [{ kind: 'source_video', selector: 'latest-completed' }],
        outputArtifacts: [{ kind: 'target_subtitle', status: 'completed' }]
      },
      {
        id: 'analyze',
        executor: 'clip',
        completesJob: false,
        dependsOn: ['subtitle'],
        allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
        inputArtifacts: [
          { kind: 'source_video', selector: 'latest-completed' },
          { kind: 'target_subtitle', selector: 'latest-completed' }
        ],
        outputArtifacts: [{ kind: 'clip_candidates', status: 'completed' }]
      },
      {
        id: 'render',
        executor: 'clip',
        resultVersionPolicy: 'none',
        dependsOn: ['analyze'],
        allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
        inputArtifacts: [
          { kind: 'source_video', selector: 'latest-completed' },
          { kind: 'clip_candidates', selector: 'latest-completed' }
        ],
        outputArtifacts: [{ kind: 'auto_clip_video', status: 'completed' }]
      }
    ],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['probe', 'download', 'subtitle', 'analyze', 'render'] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['probe', 'download', 'subtitle', 'analyze', 'render'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['probe', 'download', 'subtitle', 'analyze', 'render'] }
    ],
    outputs: [{ kind: 'auto_clip_video', required: true }],
    agentGuidance: [
      '这是视频切片模板。',
      'URL 来源从 probe 开始并设置 workflow=true，本地或导入视频从 subtitle 开始并设置 workflow=true。',
      '工作流必须从 analyze 自动继续到 render，将本次分析出的全部片段直接生成视频。',
      '不得把多个候选片段拼接成一个文件。'
    ].join(' ')
  };
}

export function createAutoClipTemplate(): CreatorTemplateDefinition {
  return {
    id: 'auto-clip',
    version: 3,
    renderer: 'auto-clips',
    inputSchema: z.object({
      sourceType: z.enum(['url', 'file']).default('url'),
      sourceUrl: z.string().default(''),
      sourceArtifactId: z.string().nullable().default(null),
      duration: z.enum(['15-30', '30-60', '60-90', '90-180']).default('90-180'),
      clipCount: z.number().int().min(1).max(20).default(3),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [{
      id: 'clip',
      executor: 'krillinai',
      allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
      inputArtifacts: [{ kind: 'source_video', selector: 'state-artifact-id', stateKey: 'sourceArtifactId', optional: true }],
      outputArtifacts: [{ kind: 'source_video', status: 'completed' }, { kind: 'clip_index', status: 'completed' }, { kind: 'auto_clip_video', status: 'completed' }]
    }],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['clip'] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['clip'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['clip'] }
    ],
    outputs: [{ kind: 'auto_clip_video', required: true }],
    agentGuidance: '提交视频来源、切片数量和目标时长，运行 clip 阶段；KrillinAI 负责原文字幕、选片和视频切割。'
  };
}
