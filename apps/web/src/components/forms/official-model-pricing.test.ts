import { expect, it } from 'vitest';
import type { GatewayModel } from '@opencreator/protocol';
import { officialModelPrice, officialModelPriceDescription, officialVideoModelListPrice } from './official-model-pricing.js';

const zh = (value: string) => value;
const en = (_: string, value: string) => value;
const model = (modality: GatewayModel['modality'], price: NonNullable<GatewayModel['price']>, extra: Partial<GatewayModel> = {}): GatewayModel => ({ id: 'test', modality, capabilities: [], price, ...extra });
const video = model('video', { version: 'v1', videoUnitsPerSecond: { '480p': 10_000_000, '720p': 37_354_133, '1080p': 44_824_959 } }, { durations: [4, 6, 8], resolutions: ['480p', '720p', '1080p'], aspectRatios: ['9:16', '16:9'] });

it.each([
  [model('text', { version: 'v1', inputPerMillion: 2091.831996, outputPerMillion: 10459.15998 }), '输入 2092 / 输出 10459 积分/百万 token', 'Input 2092 / output 10459 credits/M tokens'],
  [model('text', { version: 'v1', inputPerMillion: 119.533223, outputPerMillion: 478.132891 }), '输入 120 / 输出 478 积分/百万 token', 'Input 120 / output 478 credits/M tokens'],
  [model('image', { version: 'v1', billing: 'usage', estimates: { image: { creditUnits: '63800876', images: 1 } }, inputPerMillion: 5229.57999, imageInputPerMillion: 10459.15998, outputPerMillion: 31377.47994 }), '约 64 积分/张', 'About 64 credits / image'],
  [model('image', { version: 'legacy', perRequest: 10 }), '约 10 积分/张', 'About 10 credits / image'],
  [model('speech', { version: 'v1', perMillionCharacters: 15688.735488 }), '约 16 积分/千字符', 'About 16 credits / 1,000 characters'],
  [model('speech', { version: 'v1', perMillionCharacters: 31377.470976 }), '约 31 积分/千字符', 'About 31 credits / 1,000 characters'],
  [model('speech', { version: 'v1', inputPerMillion: 156.88735487919675, outputPerMillion: 3137.7470975839346, estimates: { call: { creditUnits: '3153436', usage: { input: 100, output: 1000 } } } }), '文本输入 157 / 音频输出 3138 积分/百万 token', 'Text input 157 / audio output 3138 credits/M tokens'],
  [model('speech', { version: 'v1', inputPerMillion: 313.7747097583935, outputPerMillion: 6275.494195167869, estimates: { call: { creditUnits: '6306872', usage: { input: 100, output: 1000 } } } }), '文本输入 314 / 音频输出 6275 积分/百万 token', 'Text input 314 / audio output 6275 credits/M tokens'],
  [model('speech', { version: 'legacy', perMinute: 20, perMillionCharacters: 4000, estimates: { minute: { creditUnits: '21200000' } } }), '约 21 积分/分钟', 'About 21 credits / minute'],
  [model('transcription', { version: 'v1', perMinute: 6.275494 }), '约 6 积分/分钟', 'About 6 credits / minute'],
  [video, '720p：每秒约 37 积分', '720p: about 37 credits per second'],
] as const)('uses the requested billing unit for %j', (value, chinese, english) => {
  expect(officialModelPrice(value, zh)).toBe(chinese);
  expect(officialModelPrice(value, en)).toBe(english);
});

it('quotes each video second at a supported resolution independently of clip duration', () => {
  expect(officialModelPriceDescription(video, zh)).toContain('720p：每秒约 37 积分');
  const fallback = { ...video, durations: [4, 6], resolutions: ['1080p'], aspectRatios: ['9:16'] };
  expect(officialModelPrice(fallback, zh)).toBe('1080p：每秒约 45 积分');
  expect(officialModelPriceDescription(fallback, zh)).toContain('1080p：每秒约 45 积分');
  expect(officialModelPrice({ ...video, durations: [] }, zh)).toBe(officialModelPrice(video, zh));
});

it.each([
  { clipCredits: '600000000', seconds: 3, rate: 200_000_000, expected: '200' },
  { clipCredits: '2000000000', seconds: 8, rate: 250_000_000, expected: '250' },
  { clipCredits: '85714286', seconds: 2, rate: 42_857_143, expected: '43' }
])('shows a one-second video list price instead of a $seconds-second sample clip', ({ clipCredits, seconds, rate, expected }) => {
  const value = model('video', {
    version: 'v1', videoUnitsPerSecond: { '720p': rate },
    estimates: { clip: { creditUnits: clipCredits, seconds, resolution: '720p' } }
  }, { resolutions: ['720p'], durations: [seconds] });
  expect(officialVideoModelListPrice(value, zh)).toBe(`约 ${expected} 积分 / 1 秒 · 720p`);
  expect(officialVideoModelListPrice(value, en)).toBe(`About ${expected} credits / 1s · 720p`);
});

it('does not infer a per-second price from a clip estimate without a per-second tariff', () => {
  const value = model('video', { version: 'v1', estimates: {
    clip: { creditUnits: '600000000', seconds: 3, resolution: '720p' }
  } });
  expect(officialVideoModelListPrice(value, zh)).toBe('价格暂不可用');
});

it('explains video cost with a supported duration and unrounded database rates', () => {
  const description = officialModelPriceDescription(video, zh);
  expect(description).toContain('费用 = 每秒积分 × 视频秒数');
  expect(description).toContain('清晰度不同，单价不同');
  expect(description).toContain('例如生成 4 秒 720p 视频，约 149 积分');
  expect(description).not.toContain('生成 5 秒');
  expect(officialModelPriceDescription(video, en)).toContain('a 4-second 720p video costs about 149 credits');
  expect(officialModelPriceDescription({ ...video, durations: [4, 5, 6] }, zh)).toContain('生成 5 秒 720p 视频，约 187 积分');
  expect(officialModelPriceDescription({ ...video, durations: [] }, zh)).not.toContain('例如');
  expect(video.durations).toEqual([4, 6, 8]);
});

it('retains the workload assumptions and actual tariffs in price descriptions', () => {
  const text = model('text', { version: 'v1', inputPerMillion: 2091.83, cachedInputPerMillion: 104.59, cacheWritePerMillion: 2614.79, outputPerMillion: 10459.16 });
  expect(officialModelPriceDescription(text, zh)).toContain('按实际输入、输出');
  expect(officialModelPriceDescription(text, zh)).toContain('缓存输入 105');
  expect(officialModelPriceDescription(text, zh)).toContain('缓存写入 2615');
  expect(officialModelPriceDescription(model('transcription', { version: 'v1', perMinute: 6.275494 }), zh)).toContain('不足一分钟按比例扣积分');
});

it('does not present audio-only estimates for token-priced speech', () => {
  const speech = model('speech', { version: 'v1', inputPerMillion: 14343.986732, perMinute: 17.929983 });
  expect(officialModelPrice(speech, zh)).toBe('文本输入 14344 积分/百万 token + 18 积分/分钟');
  expect(officialModelPriceDescription(speech, zh)).toContain('文本输入 14344 积分/百万 token + 18 积分/分钟');
});

it('keeps integer rates and never substitutes a fixed text call or video clip price', () => {
  expect(officialModelPrice(model('text', { version: 'v1', inputPerMillion: 1499.9996, outputPerMillion: 0.0001 }), zh)).toBe('输入 1500 / 输出 <1 积分/百万 token');
  expect(officialModelPrice(model('text', { version: 'v1', inputPerMillion: 150, outputPerMillion: 600 }), zh)).toBe('输入 150 / 输出 600 积分/百万 token');
  expect(officialModelPrice(video, zh)).not.toContain('积分/段');
});

it('does not guess missing or invalid model prices', () => {
  expect(officialModelPrice({ ...video, price: undefined }, zh)).toBe('');
  for (const value of [model('image', { version: 'v1', billing: 'usage', outputPerMillion: 100 }), model('speech', { version: 'v1', perMillionCharacters: NaN })]) {
    expect(officialModelPrice(value, zh)).toBe('暂无法估算');
  }
  expect(officialModelPrice({ ...video, price: { version: 'v1' } }, zh)).toBe('价格暂不可用');
});

it('uses current audio token tariffs independently of example workloads', () => {
  const value = model('transcription', { version: 'db-1', inputPerMillion: 100, outputPerMillion: 500,
    estimates: { call: { creditUnits: '2000000', usage: { input: 1000, output: 100 } } } });
  expect(officialModelPrice(value, zh)).toBe('音频输入 100 / 文本输出 500 积分/百万 token');
  expect(officialModelPriceDescription(value, zh)).toContain('按实际音频输入及文本输出用量结算');
  expect(officialModelPriceDescription(value, zh)).not.toContain('估算');
  value.price!.estimates!.call!.creditUnits = '4000000';
  expect(officialModelPrice(value, zh)).toBe('音频输入 100 / 文本输出 500 积分/百万 token');
  value.price!.outputPerMillion = 800;
  expect(officialModelPrice(value, zh)).toBe('音频输入 100 / 文本输出 800 积分/百万 token');
  delete value.price!.estimates;
  expect(officialModelPrice(value, zh)).toBe('音频输入 100 / 文本输出 800 积分/百万 token');
});

it.each([NaN, Infinity, -1])('does not replace an invalid speech token rate (%s) with a per-call estimate', invalid => {
  const value = model('speech', { version: 'v1', inputPerMillion: 100, outputPerMillion: invalid,
    estimates: { call: { creditUnits: '3000000', usage: { input: 100, output: 1000 } } } });
  expect(officialModelPrice(value, zh)).toBe('价格暂不可用');
  expect(officialModelPrice(value, en)).toBe('Price unavailable');
});

it('shows free text input and the audio output rate without inventing a duration or call cost', () => {
  const value = model('speech', { version: 'v1', inputPerMillion: 0, outputPerMillion: 100 });
  expect(officialModelPrice(value, zh)).toBe('文本输入 0 / 音频输出 100 积分/百万 token');
  expect(officialModelPriceDescription(value, zh)).toContain('按实际文本输入及音频输出用量结算');
  expect(officialModelPriceDescription(value, zh)).not.toMatch(/积分\/次|估算|分钟/);
});
