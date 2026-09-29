import type { CreatorPresetSummary } from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CreatorDashboard } from './CreatorDashboard.js';

vi.mock('./creator-template-featured-运营加精.json', () => ({
  default: {
    featured: ['video-generation/new-pick'],
    excluded: ['video-generation/old-pick']
  }
}));

function preset(id: string, featured: boolean): CreatorPresetSummary {
  return {
    module: 'video-generation', id, version: 1, title: id,
    description: '', coverUrl: '', prompt: null, tags: [], featured,
    sortOrder: 1, requirements: null, highlights: []
  };
}

it('uses operator picks for the recommended category without changing the catalog', () => {
  render(<CreatorDashboard presets={[preset('old-pick', true), preset('new-pick', false)]} />);
  expect(screen.getByRole('button', { name: '查看new-pick模板详情' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看old-pick模板详情' })).not.toBeInTheDocument();
});
