import { z } from 'zod/v3';
import type { CreatorTemplateDefinition } from './types.js';

const record = z.record(z.string(), z.unknown()) as never;

export function createTranscriptionTemplate(): CreatorTemplateDefinition {
  return {
    id: 'transcription',
    version: 1,
    renderer: 'transcription',
    inputSchema: z.object({
      sourceType: z.enum(['url', 'file']).default('file'),
      sourceUrl: z.string().default(''),
      sourceArtifactId: z.string().nullable().optional(),
      sourceLanguage: z.string().default('zh_cn'),
      targetLanguage: z.string().default('zh_cn'),
      preferPlatformCaptions: z.boolean().default(false),
      currentStep: z.union([z.literal(0), z.literal(1)]).default(0),
      furthestStep: z.union([z.literal(0), z.literal(1)]).default(0),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [{
      id: 'transcription',
      executor: 'krillinai',
      allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
      inputArtifacts: [{
        kind: 'source_video',
        selector: 'state-artifact-id',
        stateKey: 'sourceArtifactId',
        optional: true
      }],
      outputArtifacts: [
        { kind: 'source_video', status: 'completed' },
        { kind: 'source_subtitle', status: 'completed' }
      ]
    }],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['transcription'] },
      { id: 'edit-subtitle', inputSchema: record, allowedStages: ['transcription'] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['transcription'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['transcription'] }
    ],
    outputs: [{ kind: 'source_subtitle', required: true }],
    agentGuidance: [
      '帮助用户把视频或音频转录为原文文本和带时间轴的 SRT 字幕，不进行翻译、配音或视频合成。',
      '更新设置必须写入 input.patch，可调整 sourceType、sourceUrl、sourceLanguage 和 preferPlatformCaptions。',
      '本地文件上传后使用 sourceArtifactId 关联 source_video；确认来源和语言后运行 transcription 阶段，不得伪造转录文本。',
      '用户校对转录字幕时使用 edit-subtitle 保存 source_subtitle 的 cues，保留原时间轴和来源产物。'
    ].join(' ')
  };
}
