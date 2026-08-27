import { describe, expect, it } from 'vitest';
import {
  createKrillinCliEnvironment,
  outputMappings,
  parseKrillinCliProgressFrame,
  resolveKrillinCliSource
} from '../../src/creator/krillin/cli-runner.js';

describe('KrillinAI CLI protocol', () => {
  it('marks materialized videos as local CLI inputs', () => {
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
    const env = createKrillinCliEnvironment(
      { ...inherited, SECRET_VALUE: 'hidden' },
      'D:\\runtime\\bin',
      'D:\\resources',
      'D:\\dependencies\\bin'
    );
    expect(env).toMatchObject({
      ...inherited,
      KRILLINAI_RESOURCE_ROOT: 'D:\\resources',
      KRILLINAI_OFFLINE_DEPENDENCIES: '1',
      OPENCREATOR_KRILLINAI_CLI: '1'
    });
    expect(String(env.PATH)).toContain('D:\\dependencies\\bin');
    expect(String(env.PATH)).toContain('D:\\runtime\\bin');
    expect(env.SECRET_VALUE).toBeUndefined();
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
});
