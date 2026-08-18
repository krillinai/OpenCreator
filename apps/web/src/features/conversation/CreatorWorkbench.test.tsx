import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreatorWorkbench } from './CreatorWorkbench.js';

describe('CreatorWorkbench', () => {
  it('renders visual templates without creator capability blocks', () => {
    render(<CreatorWorkbench onSelectPrompt={vi.fn()} />);

    expect(screen.queryByRole('heading', { name: '点击进入对应工作台' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^视频翻译/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^动画生成/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^数字人/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: '模板分类' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('最近');
    expect(screen.getByRole('tab', { name: '推荐' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '最近' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('heading', { name: '示例模版' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /使用.+模板/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: '使用知识卡片模板' })).not.toBeInTheDocument();
  });

  it('prefills the composer when a template is selected', () => {
    const onSelectPrompt = vi.fn();
    render(<CreatorWorkbench onSelectPrompt={onSelectPrompt} />);

    fireEvent.click(screen.getByRole('button', { name: '使用数字人口播模板' }));
    expect(onSelectPrompt).toHaveBeenLastCalledWith(expect.stringContaining('数字人口播'));

    fireEvent.click(screen.getByRole('tab', { name: '最近' }));
    expect(screen.getByRole('button', { name: '使用数字人口播模板' })).toBeInTheDocument();
  });

  it('shows an empty state before a template has been used', () => {
    render(<CreatorWorkbench onSelectPrompt={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '最近' }));
    expect(screen.getByText('还没有使用过模版')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /使用.+模板/ })).not.toBeInTheDocument();
  });

  it('shows a different set of templates for each category', () => {
    const onSelectPrompt = vi.fn();
    render(<CreatorWorkbench onSelectPrompt={onSelectPrompt} />);

    expect(screen.getByRole('button', { name: '使用多语言视频翻译模板' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '数字人' }));

    expect(screen.getByRole('tab', { name: '数字人' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: '使用多语言视频翻译模板' }))
      .not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /使用.+模板/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '使用课程讲解模板' }));
    expect(onSelectPrompt).toHaveBeenCalledWith(expect.stringContaining('课程讲解'));
  });
});
