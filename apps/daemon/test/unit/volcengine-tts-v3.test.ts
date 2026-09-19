import { describe, expect, it } from 'vitest';
import { parseVolcengineV3Audio } from '../../src/creator/krillin/volcengine-tts-v3.js';

describe('volcengine V3 TTS frames', () => {
  it('concatenates multi-chunk audio and stops at the completion frame', () => {
    const audio = parseVolcengineV3Audio([
      JSON.stringify({ code: 0, data: Buffer.from('aa').toString('base64') }),
      JSON.stringify({ code: 0, data: Buffer.from('bb').toString('base64') }),
      JSON.stringify({ code: 20000000, message: 'OK' }),
      JSON.stringify({ code: 0, data: Buffer.from('cc').toString('base64') })
    ].join('\n'));

    expect(audio.equals(Buffer.from('aabb'))).toBe(true);
  });

  it('accepts SSE data wrappers around JSON frames', () => {
    const audio = parseVolcengineV3Audio([
      `data: ${JSON.stringify({ code: 0, data: Buffer.from('sse').toString('base64') })}`,
      'data: {"code":20000000,"message":"OK"}'
    ].join('\n'));

    expect(audio.equals(Buffer.from('sse'))).toBe(true);
  });

  it('fails on malformed frames instead of dropping them', () => {
    expect(() => parseVolcengineV3Audio('{"code":0,"data":"YQ=="}\n{not-json}\n'))
      .toThrow(/non-JSON frame/i);
    expect(() => parseVolcengineV3Audio(JSON.stringify({ message: 'oops' })))
      .toThrow(/missing a numeric code/i);
    expect(() => parseVolcengineV3Audio(JSON.stringify({ code: 45000000, message: 'quota exceeded' })))
      .toThrow(/quota exceeded/);
    expect(() => parseVolcengineV3Audio(JSON.stringify({ code: 0, data: '@@@' })))
      .toThrow(/invalid audio encoding/i);
  });

  it('fails when a completion frame arrives without audio', () => {
    expect(() => parseVolcengineV3Audio(JSON.stringify({ code: 20000000, message: 'OK' })))
      .toThrow(/completed without audio/i);
  });
});
