import { describe, expect, it } from 'vitest';
import { renderStickmanPublishCopy } from '../../src/creator/stickman/publish-copy.js';

describe('stickman publish copy', () => {
  it('renders deterministic Shorts metadata without a network call', () => {
    expect(renderStickmanPublishCopy({
      title: 'Why tiny habits compound',
      language: 'en-US',
      durationSeconds: 29.6,
      ratio: '9:16',
      narration: [
        'Small actions feel invisible at first.',
        'Repeated daily, they become the system that changes the result.'
      ]
    })).toBe([
      '# Why tiny habits compound',
      '',
      'Description:',
      'Small actions feel invisible at first. Repeated daily, they become the system that changes the result.',
      '',
      'Language: en-US',
      'Duration: 00:30',
      'Format: YouTube Short (9:16)',
      '',
      'Hashtags: #Shorts #StickFigure #Explained'
    ].join('\n') + '\n');
  });
});
