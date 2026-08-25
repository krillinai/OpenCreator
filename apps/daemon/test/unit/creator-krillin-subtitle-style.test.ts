import { describe, expect, it } from 'vitest';
import { buildKrillinSubtitleStyle } from '../../src/creator/krillin/adapter.js';

describe('Creator KrillinAI subtitle style mapping', () => {
  it('maps translated text to Major and original English text to Minor on both layouts', () => {
    expect(buildKrillinSubtitleStyle({
      primaryColor: '#FFE0A3',
      secondaryColor: '#FFFFFF',
      outlineColor: '#2B1B12',
      outlineWidth: 4
    })).toEqual({
      version: 1,
      horizontal: {
        major: {
          primary_color: '#FFE0A3',
          outline_color: '#2B1B12',
          outline: 4
        },
        minor: {
          primary_color: '#FFFFFF',
          outline_color: '#2B1B12',
          outline: 4
        }
      },
      vertical: {
        major: {
          primary_color: '#FFE0A3',
          outline_color: '#2B1B12',
          outline: 4
        },
        minor: {
          primary_color: '#FFFFFF',
          outline_color: '#2B1B12',
          outline: 4
        }
      }
    });
  });

  it('omits empty style state instead of overriding KrillinAI defaults', () => {
    expect(buildKrillinSubtitleStyle(undefined)).toBeUndefined();
    expect(buildKrillinSubtitleStyle({})).toBeUndefined();
  });
});
