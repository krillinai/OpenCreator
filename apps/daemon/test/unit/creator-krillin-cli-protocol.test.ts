import { dirname } from 'node:path';
import { parse } from '@iarna/toml';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildKrillinCliCommandArguments,
  createKrillinCliEnvironment,
  outputMappings,
  parseKrillinCliProgressFrame,
  resolveKrillinNlpPython,
  resolveKrillinCliSource
} from '../../src/creator/krillin/cli-runner.js';
import { createKrillinConfigToml } from '../../src/creator/krillin/config-bridge.js';
import { buildKrillinStageOptions, normalizeKrillinFailure } from '../../src/creator/krillin/adapter.js';

describe('KrillinAI CLI protocol', () => {
  it('translates a standalone SRT without passing an old video or translated import', () => {
    const stage = { job: { templateId: 'video-translation', state: { sourceType: 'subtitle', sourceUrl: 'https://youtu.be/old', sourceLanguage: 'en', targetLanguage: 'zh_cn' } }, stageRun: { stageId: 'subtitle', id: 'stage' }, workdir: '/job/stage' };
    const args = buildKrillinCliCommandArguments(stage as never, [
      { id: 'srt', kind: 'source_subtitle', path: '/job/source.srt' },
      { id: 'old', kind: 'source_video', path: '/job/old.mp4' },
      { id: 'old-target', kind: 'target_subtitle', path: '/job/old-target.srt' }
    ], buildKrillinStageOptions(stage as never), undefined, 'https://youtu.be/old');
    expect(args.slice(0, 2)).toEqual(['subtitle', '--origin-lang']);
    expect(args).toContain('/job/source.srt');
    expect(args).toContain('--srt-translated=false');
    expect(args).not.toContain('--prepare-video');
    expect(args).not.toContain('/job/old.mp4');
    expect(args).not.toContain('/job/old-target.srt');
    expect(args).not.toContain('https://youtu.be/old');
    expect(() => buildKrillinCliCommandArguments(stage as never, [], buildKrillinStageOptions(stage as never), undefined))
      .toThrow('imported source SRT');
  });
  it.each(['audio_no_speech', 'audio_transcription_empty', 'audio_transcription_invalid_response', 'audio_transcription_timestamps_missing', 'audio_transcription_api_failed'])('preserves %s through usage-error normalization', code => {
    const message = 'OpenAI transcription response was classified by the runtime';
    expect(normalizeKrillinFailure({ code, kind: 'usage', message })).toEqual({ code, message });
  });
  it.each(['top', 'bottom'])('passes semantic subtitle ordering to the render command with translation on %s', subtitlePosition => {
    const stage = { job: { templateId: 'video-translation', state: { bilingual: true, subtitlePosition } }, stageRun: { stageId: 'render-horizontal', id: 'render' }, workdir: '/job/render' };
    const args = buildKrillinCliCommandArguments(stage as never, [
      { id: 'source', kind: 'source_video', path: '/job/video.mp4' },
      { id: 'target', kind: 'target_subtitle', path: '/job/target.srt' },
      { id: 'bilingual', kind: 'bilingual_subtitle', path: '/job/bilingual.srt' }
    ], buildKrillinStageOptions(stage as never), '/job/style.json');
    expect(args[args.indexOf('--line-mode') + 1]).toBe(`bilingual-target-${subtitlePosition}`);
    expect(args).toContain('--subtitle-style-file');
  });

  it('passes saved legacy styles instead of silently using runtime defaults', () => {
    const stage = { job: { templateId: 'video-translation', state: { subtitleFont: 'rounded', subtitleSize: 'large', subtitleColor: '#123456', subtitleShadowOffsetX: -4, subtitleShadowOffsetY: 6, subtitleShadowBlur: 2 } }, stageRun: { stageId: 'render-horizontal' } };
    expect(buildKrillinStageOptions(stage as never).subtitleStyle).toMatchObject({ horizontal: { major: { font_name: 'OpenCreator Rounded Bold', font_size: 22, primary_color: '#123456', override_tags: '\\xshad-4\\yshad6\\blur2' } } });
  });

  it.each([true, false])('keeps edited vertical subtitles and renders the requested bilingual=%s mode', bilingual => {
    const stage = { job: { templateId: 'video-translation', state: { bilingual, subtitlePosition: 'bottom' } }, stageRun: { stageId: 'render-vertical', id: 'render' }, workdir: '/job/render' };
    const args = buildKrillinCliCommandArguments(stage as never, [
      { id: 'source', kind: 'source_video', path: '/job/video.mp4' },
      { id: 'target', kind: 'target_subtitle', path: '/job/target.srt' },
      { id: 'vertical', kind: 'vertical_subtitle', path: '/job/edited-vertical.srt' }
    ], buildKrillinStageOptions(stage as never), undefined);
    expect(args[args.indexOf('--subtitle') + 1]).toBe('/job/edited-vertical.srt');
    expect(args[args.indexOf('--mixed-target-subtitle') + 1]).toBe('/job/target.srt');
    expect(args[args.indexOf('--line-mode') + 1]).toBe('bilingual-target-bottom');
    expect(args.includes('--target-only')).toBe(!bilingual);
  });
  it.each(['render-horizontal', 'render-vertical'] as const)('burns the dubbing-aligned %s subtitles selected by the style settings', stageId => {
    for (const bilingual of [true, false]) {
      const stage = { job: { templateId: 'video-translation', state: { dubbing: true, bilingual } }, stageRun: { stageId, id: 'render' }, workdir: '/job/render' };
      const args = buildKrillinCliCommandArguments(stage as never, [
        { id: 'source', kind: 'source_video', path: '/job/video.mp4' },
        { id: 'dubbed', kind: 'dubbed_video', path: '/job/dubbed.mp4' },
        { id: 'target', kind: 'target_subtitle', path: '/job/tts/target.srt' },
        { id: 'bilingual', kind: 'bilingual_subtitle', path: '/job/tts/bilingual.srt' },
        { id: 'vertical', kind: 'vertical_subtitle', path: '/job/subtitle/vertical.srt' }
      ], buildKrillinStageOptions(stage as never), undefined);
      expect(args[args.indexOf('--subtitle') + 1]).toBe(bilingual ? '/job/tts/bilingual.srt' : '/job/tts/target.srt');
      expect(args[args.indexOf('--line-mode') + 1]).toBe(bilingual ? 'bilingual-target-top' : 'target-only');
      expect(args).toContain('/job/dubbed.mp4');
    }
  });
  it.each([true, false])('never prepares video in the translation subtitle stage, even when composeVideo=%s', composeVideo => {
    const stage = { job: { templateId: 'video-translation', state: { sourceUrl: 'https://youtu.be/demo', sourceLanguage: 'en', targetLanguage: 'zh_cn', composeVideo } }, stageRun: { stageId: 'subtitle', id: 'stage' }, workdir: '/job/stage' };
    const options = buildKrillinStageOptions(stage as never);
    expect(buildKrillinCliCommandArguments(stage as never, [], options, undefined)).not.toContain('--prepare-video');
  });

  it.each([true, false])('generates a subtitle-free dubbed video for video sources (composeVideo=%s)', composeVideo => {
    const state = { sourceUrl: 'https://youtu.be/demo', dubbing: true, composeVideo };
    const stage = { job: { templateId: 'video-translation', state }, stageRun: { stageId: 'tts', id: 'tts' }, workdir: '/job/tts' };
    const subtitle = { id: 'subtitle', kind: 'target_subtitle', path: '/job/target.srt' };
    const tts = buildKrillinCliCommandArguments(stage as never, [subtitle], buildKrillinStageOptions(stage as never), undefined);
    expect(tts).not.toContain('--audio-only');
    expect(tts).toContain('--source-url');
    expect(tts.slice(tts.indexOf('--input-srt'), tts.indexOf('--input-srt') + 2))
      .toEqual(['--input-srt', '/job/tts/target_language_srt.srt']);
    const render = { ...stage, job: { ...stage.job, state: { ...state, composeVideo: true } }, stageRun: { stageId: 'render-horizontal', id: 'render' } };
    const args = buildKrillinCliCommandArguments(render as never, [subtitle, { id: 'audio', kind: 'dubbed_audio', path: '/job/dubbed.wav' }], buildKrillinStageOptions(render as never), undefined);
    expect(args).toContain('--source-url');
    expect(args).toContain('--media-workdir');
    expect(args.slice(args.indexOf('--audio'), args.indexOf('--audio') + 2)).toEqual(['--audio', '/job/dubbed.wav']);
  });
  it('keeps subtitle-only dubbing audio-only when there is no source video', () => {
    const stage = { job: { templateId: 'video-translation', state: { sourceType: 'subtitle', dubbing: true } }, stageRun: { stageId: 'tts', id: 'tts' }, workdir: '/job/tts' };
    const args = buildKrillinCliCommandArguments(stage as never,
      [{ id: 'subtitle', kind: 'target_subtitle', path: '/job/target.srt' }], buildKrillinStageOptions(stage as never), undefined);
    expect(args).toContain('--audio-only');
    expect(args).not.toContain('--source-url');
  });
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

  it.each([
    ['Spanish', 'es'],
    ['Italian', 'it'],
    ['Brazilian Portuguese', 'pt'],
    ['Indonesian', 'id'],
    ['Thai', 'th']
  ])('preserves %s source language through the adapter and CLI', (_name, sourceLanguage) => {
    const stage = {
      job: { templateId: 'video-translation', state: {
        sourceUrl: 'https://youtu.be/multilingual', sourceLanguage, targetLanguage: 'zh_cn',
        bilingual: true, subtitlePosition: 'top', preferPlatformCaptions: false
      } },
      stageRun: { stageId: 'subtitle', id: 'stage' }, workdir: '/job/stage'
    };
    const options = buildKrillinStageOptions(stage as never);
    expect(options.originLanguage).toBe(sourceLanguage);
    const args = buildKrillinCliCommandArguments(stage as never, [], options, undefined);
    expect(args.slice(args.indexOf('--origin-lang'), args.indexOf('--origin-lang') + 4))
      .toEqual(['--origin-lang', sourceLanguage, '--target-lang', 'zh_cn']);
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

  it('binds NLP to the manifest-pinned interpreter and ignores inherited Python settings', () => {
    const root = process.platform === 'win32' ? 'C:\\OpenCreator' : '/opt/opencreator';
    const manifest = {
      nlp: { executable: 'python/python.exe' },
      resources: [{ path: 'python/python.exe', kind: 'executable' }]
    };
    const python = resolveKrillinNlpPython(root, manifest as never);
    const env = createKrillinCliEnvironment({ KRILLINAI_NLP_PYTHON: '/untrusted/python', PYTHONPATH: '/untrusted' }, '/runtime', root, '/dependencies', undefined, python);
    expect(env.KRILLINAI_NLP_PYTHON).toBe(python);
    expect(env.PYTHONPATH).toBeUndefined();
    expect(() => resolveKrillinNlpPython(root, { ...manifest, resources: [] } as never)).toThrow('Missing manifest-pinned NLP Python');
    expect(() => resolveKrillinNlpPython(root, {
      nlp: { executable: '../python' }, resources: [{ path: '../python', kind: 'executable' }]
    } as never)).toThrow('resource_path_escape');
    expect(resolveKrillinNlpPython(root, { resources: [] } as never)).toBeUndefined();
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

  it('preserves zero completed sentences and ignores invalid translation counts', () => {
    expect(parseKrillinCliProgressFrame('{"type":"progress","phase":"translating_subtitles","percent":5,"completed":0,"total":52}'))
      .toMatchObject({ completed: 0, total: 52, percent: 5 });
    for (const counts of [{ completed: -1, total: 52 }, { completed: 53, total: 52 }, { completed: 1.5, total: 52 }, { completed: 0, total: 0 }, { completed: '1', total: 52 }]) {
      const frame = parseKrillinCliProgressFrame(JSON.stringify({ type: 'progress', percent: 5, ...counts }));
      expect(frame).toEqual({ type: 'progress', percent: 5 });
    }
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

  it('passes the configured FunASR endpoint, model and timeout to KrillinAI', () => {
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'funasr';
    config.transcription.funasr = {
      baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'funasr-secret', model: 'sensevoice', timeoutMs: 60000
    };

    const document = parse(createKrillinConfigToml(config)) as {
      transcribe: { provider: string; funasr: Record<string, string | number> };
    };
    expect(document.transcribe).toMatchObject({
      provider: 'funasr',
      funasr: {
        base_url: 'http://127.0.0.1:8000/v1', api_key: 'funasr-secret', model: 'sensevoice', timeout_ms: 60000
      }
    });
  });
});
