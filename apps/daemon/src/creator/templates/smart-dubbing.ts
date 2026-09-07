import { smartDubbingStyles } from '@opencreator/protocol';
import { z } from 'zod';
import type { CreatorTemplateDefinition } from './types.js';

const record = z.record(z.string(), z.unknown()) as never;

export function createSmartDubbingTemplate(): CreatorTemplateDefinition {
  return {
    id: 'smart-dubbing',
    version: 1,
    renderer: 'smart-dubbing',
    inputSchema: z.object({
      text: z.string().max(5_000).default(''),
      ttsProvider: z.enum(['openai', 'aliyun', 'minimax']).optional(),
      ttsModel: z.string().max(256).optional(),
      voiceCode: z.string().max(256).optional(),
      voiceName: z.string().max(256).optional(),
      style: z.enum(smartDubbingStyles).default('natural'),
      speed: z.number().min(0.75).max(1.25).default(1),
      format: z.enum(['mp3', 'wav']).default('mp3'),
      currentStep: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
      furthestStep: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
      currentStage: z.string().nullable().default(null)
    }).passthrough() as never,
    stages: [{
      id: 'tts',
      executor: 'smart-dubbing',
      allowedJobStatuses: ['draft', 'running', 'completed', 'failed', 'needs_input'],
      inputArtifacts: [],
      outputArtifacts: [{ kind: 'dubbed_audio', status: 'completed' }]
    }],
    actions: [
      { id: 'update-settings', inputSchema: record, allowedStages: ['tts'] },
      { id: 'run-stage', inputSchema: record, allowedStages: ['tts'] },
      { id: 'undo-action', inputSchema: record, allowedStages: ['tts'] }
    ],
    outputs: [{ kind: 'dubbed_audio', required: true }],
    agentGuidance: [
      '帮助用户把文案转换为可下载的配音音频。',
      '更新设置必须写入 input.patch，可调整 text、ttsProvider、ttsModel、voiceCode、voiceName、style、speed 和 format。',
      '确认文案和音色后运行 tts 阶段，不得调用视频翻译模板或伪造音频结果。'
    ].join(' ')
  };
}
