import { dirname } from 'node:path';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildKrillinCliCommandArguments,
  createKrillinCliEnvironment,
  outputMappings,
  parseKrillinCliProgressFrame,
  resolveKrillinCliSource
} from '../../src/creator/krillin/cli-runner.js';
import { createKrillinConfigToml } from '../../src/creator/krillin/config-bridge.js';
import { buildKrillinStageOptions } from '../../src/creator/krillin/adapter.js';

describe('KrillinAI CLI protocol', () => {
  it.each([true, false])('preserves French-to-Chinese settings through the adapter and CLI with platform captions=%s', preferPlatformCaptions => {
    const stage = {
      job: { templateId: 'video-translation', state: {
        sourceUrl: 'https://youtu.be/french', sourceLanguage: 'fr', targetLanguage: 'zh_cn',
        bilingual: true, subtitlePosition: 'top', preferPlatformCaptions
      } },
      stageRun: { stageId: 'subtitle', id: 'stage' }, workdir: '/job/stage'
    };
    const options = buildKrillinStageOptions(stage as never);
    expect(options).toMatchObject({ originLanguage: 'fr', targetLanguage: 'zh_cn', bilingual: true });
    const args = buildKrillinCliCommandArguments(stage as never, [], options, undefined);
    expect(args.slice(args.indexOf('--origin-lang'), args.indexOf('--origin-lang') + 4))
      .toEqual(['--origin-lang', 'fr', '--target-lang', 'zh_cn']);
    expect(args[args.indexOf('--caption-source') + 1]).toBe(preferPlatformCaptions ? 'any' : 'whisper');
    expect(args).toContain('--bilingual-top=true');
    expect(args).not.toContain('--source-only');
  });

  it.each(['source_subtitle', 'target_subtitle'])('passes %s as an explicit CLI input', kind => {
    const args = buildKrillinCliCommandArguments({ stageRun: { stageId: 'subtitle', id: 'stage' }, workdir: '/job/stage' } as never,
      [{ id: 'srt', kind, path: '/job/local.srt' }], { sourceUrl: 'https://youtu.be/test', originLanguage: 'en', targetLanguage: 'zh_cn' }, undefined);
    expect(args).toContain('--input-srt');
    expect(args).toContain('/job/local.srt');
    expect(args).toContain(`--srt-translated=${kind === 'target_subtitle'}`);
  });
  it('uses the original YouTube URL for platform captions and local media otherwise', () => {
    expect(resolveKrillinCliSource([
      { id: 'source-1', kind: 'source_video', path: 'D:\\media\\source.webm' }
    ], {
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      captionSource: 'any'
    })).toBe('https://www.youtube.com/watch?v=demo');
    expect(resolveKrillinCliSource([
      { id: 'source-1', kind: 'source_video', path: 'D:\\media\\source.webm' }
    ], {
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      captionSource: 'whisper'
    })).toBe('local:D:\\media\\source.webm');
    expect(resolveKrillinCliSource([
      { id: 'source-1', kind: 'source_video', path: 'D:\\media\\source.webm' }
    ], { sourceUrl: 'https://example.com/video' })).toBe('local:D:\\media\\source.webm');
    expect(resolveKrillinCliSource([], {
      sourceUrl: 'https://www.youtube.com/watch?v=demo'
    })).toBe('https://www.youtube.com/watch?v=demo');
  });

  it('enables packaged offline dependencies in the minimal environment', () => {
    const inherited = process.platform === 'win32'
      ? { SystemRoot: 'C:\\Windows' }
      : { HOME: '/Users/opencreator' };
    const ytDlpExecutable = process.platform === 'win32'
      ? 'C:\\OpenCreator\\python\\python.exe'
      : '/opt/opencreator/python/bin/python3';
    const env = createKrillinCliEnvironment(
      { ...inherited, SECRET_VALUE: 'hidden' },
      'D:\\runtime\\bin',
      'D:\\resources',
      'D:\\dependencies\\bin',
      {
        version: '2026.08.31.120000',
        executable: ytDlpExecutable,
        prefixArgs: ['-I', '-B', '/runtime/yt-dlp'],
        env: { SSL_CERT_FILE: '/runtime/cacert.pem' },
        script: '/runtime/yt-dlp'
      }
    );
    expect(env).toMatchObject({
      ...inherited,
      KRILLINAI_RESOURCE_ROOT: 'D:\\resources',
      KRILLINAI_OFFLINE_DEPENDENCIES: '1',
      OPENCREATOR_KRILLINAI_CLI: '1',
      KRILLINAI_YT_DLP_EXECUTABLE: ytDlpExecutable,
      KRILLINAI_YT_DLP_PREFIX_ARGS: JSON.stringify(['-I', '-B', '/runtime/yt-dlp'])
    });
    expect(String(env.PATH)).toContain('D:\\dependencies\\bin');
    expect(String(env.PATH)).toContain(dirname(ytDlpExecutable));
    expect(String(env.PATH)).toContain('D:\\runtime\\bin');
    expect(env.SSL_CERT_FILE).toBe('/runtime/cacert.pem');
    expect(env.SECRET_VALUE).toBeUndefined();
    if (process.platform === 'win32') {
      expect(JSON.parse(env.OPENCREATOR_YT_DLP_COMMAND!)).toEqual([
        ytDlpExecutable, '-I', '-B', '/runtime/yt-dlp'
      ]);
    } else {
      expect(env.OPENCREATOR_YT_DLP_COMMAND).toBeUndefined();
    }
  });

  it('parses and constrains progress frames while ignoring result frames', () => {
    expect(parseKrillinCliProgressFrame(
      '{"type":"progress","phase":" transcribing_audio ","percent":140,"message":" working "}'
    )).toEqual({
      type: 'progress',
      phase: 'transcribing_audio',
      percent: 99,
      message: 'working'
    });
    expect(parseKrillinCliProgressFrame('{"ok":true,"stage":"subtitle"}')).toBeUndefined();
    expect(parseKrillinCliProgressFrame('not-json')).toBeUndefined();
  });

  it('maps the short mixed subtitle to the vertical subtitle artifact', () => {
    expect(outputMappings('subtitle')).toContainEqual([
      'short_origin_mixed_srt',
      'vertical_subtitle'
    ]);
  });

  it('passes large-v3-turbo to the Whisper.cpp runtime without remapping', () => {
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisper.cpp';
    config.transcription.whisperCpp.model = 'large-v3-turbo';

    expect(createKrillinConfigToml(config)).toContain('model = "large-v3-turbo"');
  });
});
