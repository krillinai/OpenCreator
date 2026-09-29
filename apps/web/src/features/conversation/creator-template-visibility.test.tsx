import type { CreatorPresetSummary } from '@opencreator/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CreatorDashboard } from './CreatorDashboard.js';

vi.mock('./creator-template-visibility-运营上下架.json', () => ({
  default: { archived: ['video-generation/hidden'] }
}));

function preset(id: string): CreatorPresetSummary {
  return {
    module: 'video-generation', id, version: 1, title: id,
    description: '', coverUrl: '', prompt: null, tags: [], featured: true,
    sortOrder: id === 'hidden' ? 1 : 2, requirements: null, highlights: []
  };
}

it('removes archived templates from all home categories', () => {
  render(<CreatorDashboard presets={[preset('hidden'), preset('visible')]} />);
  expect(screen.queryByRole('button', { name: '查看hidden模板详情' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看visible模板详情' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '全部' }));
  expect(screen.queryByRole('button', { name: '查看hidden模板详情' })).not.toBeInTheDocument();
});
