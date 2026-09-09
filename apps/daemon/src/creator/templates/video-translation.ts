import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';
import { creatorSubtitleStyleSchema } from '../presets/module-schemas.js';

const jsonRecord = z.record(z.string(), z.unknown()) as never;

export function createLegacyVideoTranslationTemplate(): CreatorTemplateDefinition {
  return createVideoTranslationTemplateDefinition(1);
}

export function createVideoTranslationTemplate(): CreatorTemplateDefinition {
  return createVideoTranslationTemplateDefinition(2);
}

function createVideoTranslationTemplateDefinition(version: 1 | 2): CreatorTemplateDefinition {
  return {
    id: 'video-translation',
    version,
    renderer: 'video-translation',
    inputSchema: z.object({
      sourceType: z.enum(['url', 'file']).default('url'),
      sourceUrl: z.string().default(''),
      sourceArtifactId: z.string().nullable().optional(),
      sourceLanguage: z.string().default('zh_cn'),
      targetLanguage: z.string().default('en'),
      preferPlatformCaptions: z.boolean().default(true),
      bilingual: z.boolean().default(true),
      subtitlePosition: z.enum(['top', 'bottom']).default('top'),
      ...(version === 2
        ? { subtitleStyle: creatorSubtitleStyleSchema }
        : {}),
      dubbing: z.boolean().default(false),
      ttsProvider: z.enum(['openai', 'aliyun', 'edge-tts', 'minimax']).optional(),
      ttsModel: z.string().optional(),
      voiceCode: z.string().optional(),
      voiceName: z.string().optional(),
      composeVideo: z.boolean().default(false),
      videoFormat: z.enum(['horizontal', 'vertical', 'all']).default('horizontal'),
      verticalTitle: z.string().max(80).default(''),
      verticalSubtitle: z.string().max(140).default(''),
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
          selector: 'state-artifact-id',
          stateKey: 'sourceArtifactId',
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
        }, {
          kind: 'source_video',
          selector: 'latest-completed',
          optional: true
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
          { kind: 'dubbed_audio', selector: 'latest-completed', optional: true },
          { kind: 'dubbed_video', selector: 'latest-completed', optional: true }
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
          { kind: 'dubbed_audio', selector: 'latest-completed', optional: true },
          { kind: 'dubbed_video', selector: 'latest-completed', optional: true }
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
        }, {
          sourceArtifactKind: 'vertical_subtitle',
          propagateThroughStageGraph: true
        }]
      },
      {
        id: 'run-stage',
        inputSchema: jsonRecord,
        allowedStages: ['subtitle', 'tts', 'render-horizontal', 'render-vertical']
      },
      {
        id: 'commit-version',
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
      version === 2
        ? '字幕样式只使用完整的 subtitleStyle 结构，不要使用 subtitleFont、subtitleSize、subtitleColor 或任意 ASS 标签。'
        : '历史任务可读取旧字幕样式字段，不要改变其模板版本。',
      '启动执行时使用 availableStageIds 中的 subtitle、tts、render-horizontal 或 render-vertical。'
    ].join(' ')
  };
}
