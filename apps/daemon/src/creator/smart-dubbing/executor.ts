import {
  smartDubbingStyles,
  type CreatorJson,
  type CreatorTtsProvider,
  type SmartDubbingFormat,
  type SmartDubbingStyle
} from '@opencreator/protocol';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KrillinTtsServiceError,
  type KrillinTtsService
} from '../krillin/tts-service.js';
import { smartDubbingInstructions } from '../../smart-dubbing/styles.js';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';

export function createSmartDubbingExecutor(input: {
  ttsService: Pick<KrillinTtsService, 'synthesize'>;
}): CreatorExecutor {
  return {
    id: 'smart-dubbing',
    async run(stage) {
      stage.reportProgress({ phase: 'validating', percent: 5 });
      const request = readRequest(stage.job.state);
      if (stage.signal.aborted) {
        throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
      }
      stage.reportProgress({ phase: 'generating_voice', percent: 20 });
      try {
        const synthesis = await input.ttsService.synthesize({
          text: request.text,
          ...(request.provider === undefined ? {} : { provider: request.provider }),
          ...(request.model === undefined ? {} : { model: request.model }),
          ...(request.voiceCode === undefined ? {} : { voiceId: request.voiceCode }),
          format: request.format,
          speed: request.speed,
          instructions: smartDubbingInstructions(request.style),
          signal: stage.signal
        });
        if (stage.signal.aborted) {
          throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
        }
        stage.reportProgress({ phase: 'finalizing_output', percent: 90 });
        const fileName = `OpenCreator-dubbing.${synthesis.format}`;
        const path = join(stage.workdir, fileName);
        await writeFile(path, synthesis.content, { mode: 0o600 });
        const characterCount = [...request.text].length;
        return {
          outputs: [{
            kind: 'dubbed_audio',
            status: 'completed',
            path,
            metadata: {
              fileName,
              mime: synthesis.mime,
              bytes: synthesis.content.length,
              sha256: createHash('sha256').update(synthesis.content).digest('hex'),
              provider: synthesis.provider,
              model: synthesis.model,
              voiceCode: synthesis.voiceId,
              voiceName: request.voiceName ?? synthesis.voiceId,
              style: request.style,
              speed: request.speed,
              format: synthesis.format,
              characterCount,
              settingsSnapshot: stage.job.state
            }
          }],
          progress: {
            phase: 'completed',
            percent: 100,
            completed: 1,
            failed: 0,
            total: 1
          }
        };
      } catch (error) {
        if (stage.signal.aborted) {
          throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
        }
        if (error instanceof CreatorExecutorError) throw error;
        if (error instanceof KrillinTtsServiceError) {
          const code = error.code === 'VALIDATION_FAILED'
            ? 'creator_stage_input_missing'
            : error.code;
          throw new CreatorExecutorError(code, error.message);
        }
        throw new CreatorExecutorError(
          'creator_tts_upstream_error',
          error instanceof Error ? error.message : 'Speech synthesis failed'
        );
      }
    }
  };
}

function readRequest(state: Record<string, CreatorJson>): {
  text: string;
  provider?: Exclude<CreatorTtsProvider, 'edge-tts'>;
  model?: string;
  voiceCode?: string;
  voiceName?: string;
  style: SmartDubbingStyle;
  speed: number;
  format: SmartDubbingFormat;
} {
  const text = readString(state.text)?.trim() ?? '';
  if (!text || [...text].length > 5_000) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      'Dubbing text must contain between 1 and 5000 characters'
    );
  }
  const provider = readString(state.ttsProvider);
  if (provider !== undefined && !['openai', 'aliyun', 'minimax'].includes(provider)) {
    throw new CreatorExecutorError(
      'unsupported_capability',
      'The selected TTS provider does not support smart dubbing'
    );
  }
  const style = readString(state.style) ?? 'natural';
  if (!(smartDubbingStyles as readonly string[]).includes(style)) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Dubbing style is invalid');
  }
  const speed = typeof state.speed === 'number' ? state.speed : 1;
  if (!Number.isFinite(speed) || speed < 0.75 || speed > 1.25) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Dubbing speed is invalid');
  }
  const format = state.format === 'wav' ? 'wav' : 'mp3';
  return {
    text,
    ...(provider === undefined
      ? {}
      : { provider: provider as Exclude<CreatorTtsProvider, 'edge-tts'> }),
    ...(readString(state.ttsModel) === undefined ? {} : { model: readString(state.ttsModel) }),
    ...(readString(state.voiceCode) === undefined ? {} : { voiceCode: readString(state.voiceCode) }),
    ...(readString(state.voiceName) === undefined ? {} : { voiceName: readString(state.voiceName) }),
    style: style as SmartDubbingStyle,
    speed,
    format
  };
}

function readString(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
