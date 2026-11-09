import { z } from 'zod/v3';
import type { CreatorTemplateDefinition } from './types.js';
import { creatorSubtitleStyleSchema } from '../presets/module-schemas.js';
import { validateTranslationOutputLanguage } from '../output-validation.js';

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
      sourceType: z.enum(['url', 'file', 'subtitle']).default('url'),
      sourceUrl: z.string().default(''),
      sourceArtifactId: z.string().nullable().optional(),
      importedSourceSubtitleId: z.string().nullable().optional(),
      importedTargetSubtitleId: z.string().nullable().optional(),
      sourceLanguage: z.string().default('zh_cn'),
      targetLanguage: z.string().default('en'),
      preferPlatformCaptions: z.boolean().default(true),
      skipVideoDownload: z.boolean().default(false),
      bilingual: z.boolean().default(true),
      subtitlePosition: z.enum(['top', 'bottom']).default('top'),
      ...(version === 2
        ? { subtitleStyle: creatorSubtitleStyleSchema }
        : {}),
      dubbing: z.boolean().default(false),
      ttsProvider: z.enum(['openai', 'aliyun', 'edge-tts', 'minimax', 'volcengine']).optional(),
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
    }).passthrough().transform(state => state.sourceType === 'subtitle'
      ? { ...state, composeVideo: false, dubbing: false }
      : state) as never,
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
        }, { kind: 'source_subtitle', selector: 'state-artifact-id', stateKey: 'importedSourceSubtitleId', optional: true },
        { kind: 'target_subtitle', selector: 'state-artifact-id', stateKey: 'importedTargetSubtitleId', optional: true }],
        outputArtifacts: [
          { kind: 'source_video', status: 'completed' },
          { kind: 'source_subtitle', status: 'completed' },
          { kind: 'target_subtitle', status: 'completed' },
          { kind: 'bilingual_subtitle', status: 'completed' },
          { kind: 'vertical_subtitle', status: 'completed' }
        ],
        outputValidators: [validateTranslationOutputLanguage]
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
          kind: 'source_subtitle',
          selector: 'latest-completed',
          optional: true
        }, {
          kind: 'source_video',
          selector: 'latest-completed',
          optional: true
        }],
        outputArtifacts: [
          { kind: 'source_video', status: 'completed' },
          { kind: 'source_subtitle', status: 'completed' },
          { kind: 'target_subtitle', status: 'completed' },
          { kind: 'bilingual_subtitle', status: 'completed' },
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
          { kind: 'source_video', selector: 'latest-completed', optional: true },
          { kind: 'source_subtitle', selector: 'latest-completed', optional: true },
          { kind: 'target_subtitle', selector: 'latest-completed' },
          { kind: 'bilingual_subtitle', selector: 'latest-completed', optional: true },
          { kind: 'dubbed_audio', selector: 'latest-completed', optional: true },
          { kind: 'dubbed_video', selector: 'latest-completed', optional: true }
        ],
        outputArtifacts: [{ kind: 'source_video', status: 'completed' }, { kind: 'horizontal_video', status: 'completed' }]
      },
      {
        id: 'render-vertical',
        executor: 'krillinai',
        dependsOn: ['subtitle'],
        optional: true,
        allowedJobStatuses: ['draft', 'running', 'needs_input', 'failed'],
        inputArtifacts: [
          { kind: 'source_video', selector: 'latest-completed', optional: true },
          { kind: 'source_subtitle', selector: 'latest-completed', optional: true },
          { kind: 'vertical_subtitle', selector: 'latest-completed', optional: true },
          { kind: 'target_subtitle', selector: 'latest-completed' },
          { kind: 'bilingual_subtitle', selector: 'latest-completed', optional: true },
          { kind: 'dubbed_audio', selector: 'latest-completed', optional: true },
          { kind: 'dubbed_video', selector: 'latest-completed', optional: true }
        ],
        outputArtifacts: [{ kind: 'source_video', status: 'completed' }, { kind: 'vertical_video', status: 'completed' }]
      },
      {
        id: 'preview-source-video',
        executor: 'download',
        optional: true,
        resultVersionPolicy: 'none',
        jobCompletionPolicy: 'preserve',
        invalidateDependentArtifacts: false,
        allowedJobStatuses: ['draft', 'running', 'needs_input', 'failed', 'completed', 'canceled'],
        inputArtifacts: [],
        outputArtifacts: [{ kind: 'source_video', status: 'completed' }]
      },
      {
        id: 'prepare-source-video',
        executor: 'download',
        optional: true,
        resultVersionPolicy: 'attach',
        jobCompletionPolicy: 'preserve',
        invalidateDependentArtifacts: false,
        allowedJobStatuses: ['draft', 'running', 'needs_input', 'failed', 'completed', 'canceled'],
        inputArtifacts: [{ kind: 'source_video', selector: 'latest-completed', optional: true }],
        outputArtifacts: [{ kind: 'source_video', status: 'completed' }]
      }
    ],
    actions: [
      { id: 'import-subtitle', inputSchema: jsonRecord, allowedStages: ['subtitle', 'tts', 'render-horizontal', 'render-vertical'] },
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
    ].map(action => ({ ...action, allowedStages: [...action.allowedStages, 'prepare-source-video', 'preview-source-video'] })),
    outputs: [
      { kind: 'target_subtitle', required: true },
      { kind: 'horizontal_video', required: false },
      { kind: 'vertical_video', required: false }
    ],
    agentGuidance: [
      '仅翻译字幕文件时设置 sourceType 为 subtitle，使用 import-subtitle 导入 source_subtitle，只运行 subtitle 阶段，不需要 sourceUrl、视频、ASR、配音、合成或字幕样式。',
      '导入用户提供的 UTF-8 SRT 使用 import-subtitle，input 包含 fileName、contentBase64（原文件字节的 base64，最多512 KiB）、kind（source_subtitle 或 target_subtitle）和 language。未知原文语言时 language 传 auto，由本地正文识别；返回仍为 auto 时需请用户选择源语言再翻译。用户明确指定语言时传对应代码。原文跳过 ASR，译文跳过 ASR 与翻译。不要编造字幕。',
      '帮助用户调整视频翻译内容与参数，修改前读取最新 revision。',
      '更新设置必须写入 input.patch。',
      version === 2
        ? '字幕样式只使用完整的 subtitleStyle 结构，不要使用 subtitleFont、subtitleSize、subtitleColor 或任意 ASS 标签。'
        : '历史任务可读取旧字幕样式字段，不要改变其模板版本。',
      '启动执行时使用 availableStageIds 中的 subtitle、tts、render-horizontal 或 render-vertical。',
      '字幕已完成但需要视频预览时，使用 prepare-source-video 并明确 inputResultVersion。它仅补齐所选版本的原视频，不重新翻译或创建新版本。',
      '翻译前预览当前链接使用 preview-source-video，仅下载原视频，不启动翻译或创建结果版本。'
    ].join(' ')
  };
}
