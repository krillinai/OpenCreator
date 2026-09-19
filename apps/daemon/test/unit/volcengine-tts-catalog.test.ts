import { describe, expect, it } from 'vitest';
import {
  defaultVolcengineVoiceId,
  listVolcengineTtsVoices,
  resolveVolcengineTtsRoute,
  volcengineSpeechRate,
  volcengineTtsVoices
} from '../../src/creator/krillin/volcengine-tts-catalog.js';

describe('volcengine TTS catalog', () => {
  it('maps official small-model voice names instead of the old 御姐 mix-up', () => {
    const voices = listVolcengineTtsVoices('volcano_tts');
    expect(voices.length).toBeGreaterThan(100);
    expect(voices.find(voice => voice.id === 'BV019_streaming')).toMatchObject({
      name: '重庆小伙',
      gender: 'male'
    });
    expect(voices.find(voice => voice.id === 'BV033_streaming')).toMatchObject({
      name: '温柔小哥',
      gender: 'male'
    });
    expect(voices.find(voice => voice.id === 'BV119_streaming')).toMatchObject({
      name: '通用赘婿',
      gender: 'male'
    });
    expect(voices.find(voice => voice.id === 'BV019_streaming')?.name).not.toMatch(/御姐/);
    expect(voices.some(voice => voice.id === 'zh_female_gaolengyujie_uranus_bigtts')).toBe(false);
  });

  it('includes Doubao 2.0 御姐 voices on the V3 catalog', () => {
    const voices = listVolcengineTtsVoices('seed-tts-2.0');
    expect(voices.length).toBeGreaterThan(200);
    expect(voices.find(voice => voice.id === 'zh_female_gaolengyujie_uranus_bigtts')).toMatchObject({
      name: '高冷御姐 2.0',
      gender: 'female',
      recommended: true
    });
    expect(voices.some(voice => voice.id === 'BV019_streaming')).toBe(false);
  });

  it('keeps clone clusters empty so a custom Speaker ID can be entered', () => {
    expect(listVolcengineTtsVoices('seed-icl-2.0')).toEqual([]);
    expect(listVolcengineTtsVoices('volcano_icl')).toEqual([]);
    expect(defaultVolcengineVoiceId('seed-icl-2.0')).toBe('');
    expect(defaultVolcengineVoiceId('seed-tts-2.0')).toBe('zh_female_cancan_uranus_bigtts');
  });

  it('routes 2.0 and clone speaker IDs to V3 even when the saved cluster is volcano_tts', () => {
    expect(resolveVolcengineTtsRoute('volcano_tts', 'BV001_streaming')).toEqual({
      api: 'v1',
      cluster: 'volcano_tts',
      resourceId: 'volcano_tts'
    });
    expect(resolveVolcengineTtsRoute('volcano_tts', 'zh_female_gaolengyujie_uranus_bigtts')).toEqual({
      api: 'v3',
      cluster: 'seed-tts-2.0',
      resourceId: 'seed-tts-2.0'
    });
    expect(resolveVolcengineTtsRoute('volcano_tts', 'S_cloned_speaker')).toEqual({
      api: 'v3',
      cluster: 'seed-icl-2.0',
      resourceId: 'seed-icl-2.0'
    });
    expect(resolveVolcengineTtsRoute('volcano_icl', 'S_cloned_speaker')).toEqual({
      api: 'v1',
      cluster: 'volcano_icl',
      resourceId: 'volcano_icl'
    });
    expect(resolveVolcengineTtsRoute('seed-icl-2.0', 'S_cloned_speaker')).toEqual({
      api: 'v3',
      cluster: 'seed-icl-2.0',
      resourceId: 'seed-icl-2.0'
    });
  });

  it('keeps unique official voice IDs and converts playback speed to speech_rate', () => {
    const ids = volcengineTtsVoices.map(voice => voice.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(volcengineSpeechRate(1)).toBe(0);
    expect(volcengineSpeechRate(1.5)).toBe(50);
    expect(volcengineSpeechRate(0.5)).toBe(-50);
  });
});
