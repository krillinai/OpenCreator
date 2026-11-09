import { describe, expect, it } from 'vitest';
import { buildKrillinSubtitleStyle } from '../../src/creator/krillin/adapter.js';

describe('Creator KrillinAI subtitle style mapping', () => {
  it.each([
    ['system', 'regular', 'small', 'OpenCreator Sans Regular', false, [14, 10, 12, 7]],
    ['sans', 'medium', 'medium', 'OpenCreator Sans Medium', false, [18, 12, 15, 9]],
    ['serif', 'bold', 'large', 'OpenCreator Serif Bold', true, [22, 15, 18, 11]],
    ['rounded', 'bold', 'medium', 'OpenCreator Rounded Bold', true, [18, 12, 15, 9]]
  ] as const)(
    'maps %s/%s/%s to validated horizontal and vertical ASS styles',
    (fontPreset, fontWeight, fontSize, fontName, bold, sizes) => {
      const result = buildKrillinSubtitleStyle({
        fontPreset,
        fontWeight,
        fontSize,
        primaryColor: '#FFE0A3',
        secondaryColor: '#FFFFFF',
        outlineColor: '#2B1B12',
        outlineWidth: 4,
        shadow: {
          enabled: true,
          color: '#123456',
          opacity: 0.4,
          offsetX: -3,
          offsetY: 5,
          blur: 1.5
        }
      }) as {
        horizontal: { major: Record<string, unknown>; minor: Record<string, unknown> };
        vertical: { major: Record<string, unknown>; minor: Record<string, unknown> };
      };
      const styles = [
        result.horizontal.major,
        result.horizontal.minor,
        result.vertical.major,
        result.vertical.minor
      ];

      expect(styles.map(style => style.font_name)).toEqual(Array(4).fill(fontName));
      expect(styles.map(style => style.bold)).toEqual(Array(4).fill(bold));
      expect(styles.map(style => style.font_size)).toEqual(sizes);
      expect(styles.map(style => style.outline_color)).toEqual(Array(4).fill('#2B1B12'));
      expect(styles.map(style => style.outline)).toEqual(Array(4).fill(4));
      expect(styles.map(style => style.back_color)).toEqual(Array(4).fill('&H99563412'));
      expect(styles.map(style => style.shadow)).toEqual(Array(4).fill(5));
      expect(styles.map(style => style.override_tags)).toEqual(
        Array(4).fill('\\xshad-3\\yshad5\\blur1.5')
      );
      expect(result.horizontal.major.primary_color).toBe('#FFE0A3');
      expect(result.vertical.major.primary_color).toBe('#FFE0A3');
      expect(result.horizontal.minor.primary_color).toBe('#FFFFFF');
      expect(result.vertical.minor.primary_color).toBe('#FFFFFF');
    }
  );

  it('disables shadow without retaining controlled override tags', () => {
    const result = buildKrillinSubtitleStyle({
      shadow: { enabled: false }
    }) as {
      horizontal: { major: Record<string, unknown> };
    };

    expect(result.horizontal.major.shadow).toBe(0);
    expect(result.horizontal.major.override_tags).toBe('');
  });

  it('moves both subtitle lines together while retaining each format baseline', () => {
    const base = buildKrillinSubtitleStyle({ fontPreset: 'sans' }) as {
      horizontal: { major: Record<string, unknown>; minor: Record<string, unknown> };
      vertical: { major: Record<string, unknown>; minor: Record<string, unknown> };
    };
    const raised = buildKrillinSubtitleStyle({ fontPreset: 'sans', verticalOffset: 40 }) as typeof base;
    expect([base.horizontal.major.margin_v, base.horizontal.minor.margin_v,
      base.vertical.major.margin_v, base.vertical.minor.margin_v]).toEqual([20, 30, 101, 92]);
    expect([raised.horizontal.major.margin_v, raised.horizontal.minor.margin_v,
      raised.vertical.major.margin_v, raised.vertical.minor.margin_v]).toEqual([60, 70, 141, 132]);
    expect(() => buildKrillinSubtitleStyle({ verticalOffset: -21 })).toThrow();
  });

  it('rejects unsupported style fields instead of dropping them', () => {
    expect(() => buildKrillinSubtitleStyle({
      rawAssStyle: 'Style: unsafe'
    })).toThrowError(expect.objectContaining({
      code: 'creator_subtitle_style_unsupported'
    }));
  });

  it('omits empty style state instead of overriding KrillinAI defaults', () => {
    expect(buildKrillinSubtitleStyle(undefined)).toBeUndefined();
    expect(buildKrillinSubtitleStyle({})).toBeUndefined();
  });
});
