import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';

const jsonRecord = z.record(z.string(), z.unknown()) as never;

export function createVideoTranslationTemplate(): CreatorTemplateDefinition {
  return {
    id: 'video-translation',
    version: 1,
    renderer: 'video-translation',
    inputSchema: z.object({
      sourceType: z.enum(['url', 'file']).default('url'),
      sourceUrl: z.string().default(''),
      sourceArtifactId: z.string().optional(),
      sourceLanguage: z.string().default('zh_cn'),
      targetLanguage: z.string().default('en'),
      preferPlatformCaptions: z.boolean().default(true),
      bilingual: z.boolean().default(true),
      subtitlePosition: z.enum(['top', 'bottom']).default('top'),
      dubbing: z.boolean().default(false),
      voiceCode: z.string().default(''),
      composeVideo: z.boolean().default(false),
      videoFormat: z.enum(['horizontal', 'vertical', 'all']).default('horizontal'),
      subtitleCues: z.array(z.object({
        id: z.union([z.string(), z.number()]),
        start: z.string(),
        end: z.string(),
        text: z.string()
      })).default([]),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [
      {
        id: 'subtitle',
        executor: 'krillinai',
        allowedJobStatuses: ['draft', 'running', 'needs_input', 'failed'],
        inputArtifacts: [{
          kind: 'source_video',
          selector: 'latest-completed',
          optional: true
        }],
        outputArtifacts: [
          { kind: 'source_video', status: 'completed' },
          { kind: 'source_subtitle', status: 'completed' },
          { kind: 'target_subtitle', status: 'completed' },
          { kind: 'bilingual_subtitle', status: 'completed' },
          { kind: 'vertical_subtitle', status: 'completed' }
        ]
      },
      {
        id: 'tts',
        executor: 'krillinai',
        dependsOn: ['subtitle'],
        optional: true,
        allowedJobStatuses: ['draft', 'running', 'needs_input', 'failed'],
        inputArtifacts: [{
          kind: 'target_subtitle',
          selector: 'latest-completed'
        }],
        outputArtifacts: [
          { kind: 'dubbed_audio', status: 'completed' },
          { kind: 'dubbed_video', status: 'completed' }
        ]
      },
      {
        id: 'render-horizontal',
        executor: 'krillinai',
        dependsOn: ['subtitle'],
        optional: true,
        allowedJobStatuses: ['draft', 'running', 'needs_input', 'failed'],
        inputArtifacts: [
          { kind: 'source_video', selector: 'latest-completed' },
          { kind: 'target_subtitle', selector: 'latest-completed' },
          { kind: 'bilingual_subtitle', selector: 'latest-completed', optional: true },
          { kind: 'dubbed_audio', selector: 'latest-completed', optional: true }
        ],
        outputArtifacts: [{ kind: 'horizontal_video', status: 'completed' }]
      },
      {
        id: 'render-vertical',
        executor: 'krillinai',
        dependsOn: ['subtitle'],
        optional: true,
        allowedJobStatuses: ['draft', 'running', 'needs_input', 'failed'],
        inputArtifacts: [
          { kind: 'source_video', selector: 'latest-completed' },
          { kind: 'vertical_subtitle', selector: 'latest-completed', optional: true },
          { kind: 'target_subtitle', selector: 'latest-completed' },
          { kind: 'bilingual_subtitle', selector: 'latest-completed', optional: true },
          { kind: 'dubbed_audio', selector: 'latest-completed', optional: true }
        ],
        outputArtifacts: [{ kind: 'vertical_video', status: 'completed' }]
      }
    ],
    actions: [
      {
        id: 'update-settings',
        inputSchema: jsonRecord,
        allowedStages: ['subtitle', 'tts', 'render-horizontal', 'render-vertical']
      },
      {
        id: 'edit-subtitle',
        inputSchema: jsonRecord,
        allowedStages: ['subtitle', 'tts', 'render-horizontal', 'render-vertical'],
        invalidates: [{
          sourceArtifactKind: 'target_subtitle',
          propagateThroughStageGraph: true
        }]
      },
      {
        id: 'run-stage',
        inputSchema: jsonRecord,
        allowedStages: ['subtitle', 'tts', 'render-horizontal', 'render-vertical']
      },
      {
        id: 'undo-action',
        inputSchema: jsonRecord,
        allowedStages: ['subtitle', 'tts', 'render-horizontal', 'render-vertical']
      }
    ],
    outputs: [
      { kind: 'target_subtitle', required: true },
      { kind: 'horizontal_video', required: false },
      { kind: 'vertical_video', required: false }
    ],
    agentGuidance: [
      '帮助用户调整视频翻译内容与参数，修改前读取最新 revision。',
      '更新设置必须写入 input.patch。',
      '字幕样式字段为 subtitleStyle，可包含 primaryColor、secondaryColor、outlineColor、outlineWidth；不要使用 subtitleColor 等未定义别名。',
      '启动执行时使用 availableStageIds 中的 subtitle、tts、render-horizontal 或 render-vertical。'
    ].join(' ')
  };
}
