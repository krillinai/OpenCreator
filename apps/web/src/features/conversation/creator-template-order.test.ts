import type { CreatorPresetSummary } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import { orderCreatorPresets, type OperatorOrder } from './creator-template-order.js';

const template = (id: string, sortOrder: number): CreatorPresetSummary => ({
  module: 'video-generation', id, version: 1, title: id,
  description: '', coverUrl: '', prompt: null, tags: [], featured: true,
  sortOrder, requirements: null, highlights: []
});

describe('operator template order', () => {
  it('places configured templates first and retains the source order for the rest', () => {
    const order: OperatorOrder = {
      recommended: [{ preset: 'video-generation/third', order: 2 }, { preset: 'video-generation/second', order: 1 }],
      all: [], video: [], image: []
    };
    const presets = [template('first', 10), template('second', 20), template('third', 30)];
    expect(orderCreatorPresets(presets, 'recommended', order).map(item => item.id))
      .toEqual(['second', 'third', 'first']);
    expect(orderCreatorPresets(presets, 'video', order).map(item => item.id))
      .toEqual(['first', 'second', 'third']);
    expect(presets.map(item => item.id)).toEqual(['first', 'second', 'third']);
  });
});
