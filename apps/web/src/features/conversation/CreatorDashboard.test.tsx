import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CreatorDashboard,
  getCreatorSkillPromptHint,
  type CreatorSkill
} from './CreatorDashboard.js';

describe('CreatorDashboard', () => {
  it('renders visual Skills without creator capability blocks', () => {
    render(<CreatorDashboard onSelectSkill={vi.fn()} />);

    expect(screen.queryByRole('heading', { name: '点击进入对应 Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^视频翻译/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^动画生成/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^数字人/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Skill 分类' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('最近');
    expect(screen.getByRole('tab', { name: '推荐' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '最近' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /使用.+ Skill/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: '使用知识卡片 Skill' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用多语言视频翻译 Skill' }))
      .toHaveAttribute('data-skill-id', 'video-translation-multilingual');
  });

  it('selects a Skill and keeps it in recent usage', () => {
    const onSelectSkill = vi.fn();
    render(<CreatorDashboard onSelectSkill={onSelectSkill} />);

    fireEvent.click(screen.getByRole('button', { name: '使用数字人口播 Skill' }));
    expect(onSelectSkill).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'avatar-presenter',
      title: '数字人口播'
    }));
    const selectedSkill = onSelectSkill.mock.lastCall?.[0] as CreatorSkill;
    expect(getCreatorSkillPromptHint(selectedSkill, 'zh-CN'))
      .toBe('描述你希望用「数字人口播」完成的内容和要求');

    fireEvent.click(screen.getByRole('tab', { name: '最近' }));
    expect(screen.getByRole('button', { name: '使用数字人口播 Skill' })).toBeInTheDocument();
  });

  it('shows an empty state before a Skill has been used', () => {
    render(<CreatorDashboard onSelectSkill={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '最近' }));
    expect(screen.getByText('还没有使用过 Skill')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /使用.+ Skill/ })).not.toBeInTheDocument();
  });

  it('exposes a structured interaction and an inactive prompt hint', () => {
    const onSelectSkill = vi.fn();
    render(<CreatorDashboard onSelectSkill={onSelectSkill} />);

    fireEvent.click(screen.getByRole('button', { name: '使用多语言视频翻译 Skill' }));

    expect(onSelectSkill).toHaveBeenCalledWith(expect.objectContaining({
      interaction: { type: 'workspace', workspace: 'video-translation' },
      promptHint: {
        zhCN: '上传视频，或者输入有效的视频链接',
        enUS: 'Upload a video or enter a valid video link'
      }
    }));
  });

  it('shows a different set of Skills for each category', () => {
    const onSelectSkill = vi.fn();
    render(<CreatorDashboard onSelectSkill={onSelectSkill} />);

    expect(screen.getByRole('button', { name: '使用多语言视频翻译 Skill' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '数字人' }));

    expect(screen.getByRole('tab', { name: '数字人' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: '使用多语言视频翻译 Skill' }))
      .not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /使用.+ Skill/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '使用课程讲解 Skill' }));
    expect(onSelectSkill).toHaveBeenCalledWith(expect.objectContaining({
      id: 'avatar-course-lesson',
      title: '课程讲解'
    }));
  });
});
