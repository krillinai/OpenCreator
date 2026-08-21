import type { MouseEvent } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { extractWorkspaceFilePaths } from './markdown-inline.js';

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: undefined });
  });

  it('renders assistant markdown blocks and inline formatting', () => {
    render(
      <MarkdownRenderer
        variant="assistant"
        text={[
          '# 天气结论',
          '',
          '今天是 **29°C**，适合 `轻量户外活动`。',
          '',
          '- 带伞',
          '- [x] 查看空气质量',
          '',
          '> 下午可能转阴',
          '',
          '| 时间 | 温度 |',
          '| --- | ---: |',
          '| 上午 | 27 |',
          '| 下午 | 29 |',
        ].join('\n')}
      />
    );

    expect(screen.getByRole('heading', { name: '天气结论', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('29°C')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getByText('轻量户外活动')).toHaveProperty('tagName', 'CODE');
    expect(screen.getByText('带伞')).toBeInTheDocument();
    expect(screen.getByText('查看空气质量')).toBeInTheDocument();
    expect(screen.getByText('下午可能转阴')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('removes private citation markers without exposing internal source ids', () => {
    render(
      <MarkdownRenderer
        variant="assistant"
        text={[
          '天气数据已确认。 \uE200cite\uE202turn0forecast0\uE201',
          '',
          '页面已经完成。\uE200cite\uE202turn3search0\uE202turn3search1\uE201'
        ].join('\n')}
      />
    );

    expect(screen.getByText('天气数据已确认。')).toBeInTheDocument();
    expect(screen.getByText('页面已经完成。')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('turn0forecast0');
    expect(document.body).not.toHaveTextContent('turn3search0');
    expect(document.body).not.toHaveTextContent('\uE200');
    expect(document.body).not.toHaveTextContent('\uE201');
    expect(document.body).not.toHaveTextContent('\uE202');
  });

  it('renders fenced code without syntax highlighting or innerHTML', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<MarkdownRenderer variant="assistant" text={'```ts\nconst value = 1;\n```'} />);

    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByText('const value = 1;')).toBeInTheDocument();
    expect(document.querySelector('.md-code-highlighted')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '复制' }));

    expect(writeText).toHaveBeenCalledWith('const value = 1;');
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
  });

  it('collapses long code at a complete line boundary and expands all content', async () => {
    const user = userEvent.setup();
    const body = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const { container } = render(
      <MarkdownRenderer variant="assistant" text={`\`\`\`text\n${body}\n\`\`\``} />
    );
    const code = container.querySelector('.md-code code');

    expect(code?.textContent).toBe([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      '…',
    ].join('\n'));

    await user.click(screen.getByRole('button', { name: '展开代码' }));

    expect(code?.textContent).toBe(body);
    expect(screen.getByRole('button', { name: '收起代码' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('falls back when clipboard copy fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    });

    render(<MarkdownRenderer variant="assistant" text={'```txt\nhello\n```'} />);

    await user.click(screen.getByRole('button', { name: '复制' }));

    expect(screen.getByRole('button', { name: '复制失败' })).toBeInTheDocument();
  });

  it('does not render unsafe links as anchors', () => {
    render(
      <MarkdownRenderer
        variant="assistant"
        text={'[bad](javascript:alert(1)) [data](data:text/html,x) [file](file:///tmp/a) [vb](vbscript:msgbox(1))'}
      />
    );

    expect(screen.getByText('bad')).toBeInTheDocument();
    expect(screen.getByText('data')).toBeInTheDocument();
    expect(screen.getByText('file')).toBeInTheDocument();
    expect(screen.getByText('vb')).toBeInTheDocument();
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('renders safe links and routes relative links through onLinkClick', async () => {
    const onLinkClick = vi.fn((href: string, event: MouseEvent<HTMLAnchorElement>) => {
      if (href === 'docs/readme.md') event.preventDefault();
    });
    const user = userEvent.setup();

    render(
      <MarkdownRenderer
        variant="assistant"
        text={'[OpenAI](https://openai.com) [local](docs/readme.md) https://example.com/path.'}
        onLinkClick={onLinkClick}
      />
    );

    expect(screen.getByRole('link', { name: 'OpenAI' })).toHaveAttribute('href', 'https://openai.com');
    expect(screen.getByRole('link', { name: 'local' })).toHaveAttribute('href', 'docs/readme.md');
    expect(screen.getByRole('link', { name: 'https://example.com/path' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'local' }));

    expect(onLinkClick).toHaveBeenCalledWith('docs/readme.md', expect.any(Object));
  });

  it('shows html and image syntax as text without creating DOM nodes or images', () => {
    render(<MarkdownRenderer variant="assistant" text={'<script>alert(1)</script>\n\n![alt text](https://example.com/a.png)'} />);

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.getByText(/alt text/)).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('keeps user variant conservative', () => {
    render(<MarkdownRenderer variant="user" text={'# 不是标题\n1. 不是列表\n*不是斜体*\n`是代码`'} />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText('# 不是标题')).toBeInTheDocument();
    expect(screen.getByText('1. 不是列表')).toBeInTheDocument();
    expect(screen.getByText('*不是斜体*')).toBeInTheDocument();
    expect(screen.getByText('是代码')).toHaveProperty('tagName', 'CODE');
  });

  it('marks skill references in user messages without changing surrounding text', () => {
    render(
      <MarkdownRenderer
        variant="user"
        text="使用 $zhiyu-brainstorm 分析需求，再继续执行。"
      />
    );

    const skill = screen.getByText('Zhiyu Brainstorm').closest('.md-skill-reference');
    expect(skill).toBeInTheDocument();
    expect(skill).toHaveAttribute(
      'title',
      '技能：zhiyu-brainstorm'
    );
    expect(screen.getByText(/分析需求，再继续执行/)).toBeInTheDocument();
  });

  it('keeps dollar amounts literal in user messages', () => {
    const { container } = render(
      <MarkdownRenderer variant="user" text="44:33 Raising $300M in Six Months" />
    );

    expect(container).toHaveTextContent('44:33 Raising $300M in Six Months');
    expect(container.querySelector('.md-skill-reference')).not.toBeInTheDocument();
  });

  it('formats skill acronyms as readable labels', () => {
    render(<MarkdownRenderer variant="user" text="$seo-audit https://www.workbuddy.cn/" />);

    expect(screen.getByText('SEO Audit')).toBeInTheDocument();
    expect(screen.queryByText('$seo-audit')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'https://www.workbuddy.cn/' });
    expect(link).toHaveAttribute(
      'href',
      'https://www.workbuddy.cn/'
    );
    expect(link.querySelector('img')).toHaveAttribute(
      'src',
      '/site-icons/workbuddy.svg'
    );
  });

  it('extracts unique workspace files for final artifact cards', () => {
    expect(extractWorkspaceFilePaths(
      '打开 reports/aso-audit.html，也可以查看 `reports/aso-audit.html` 和 data/score.xlsx。'
    )).toEqual(['reports/aso-audit.html', 'data/score.xlsx']);
  });

  it('does not throw on nested or multiline emphasis', () => {
    render(<MarkdownRenderer variant="assistant" text={'**a *b* c**\n\n**第一行\n第二行**'} />);

    expect(screen.getByText(/a/)).toBeInTheDocument();
    expect(screen.getByText(/第一行/)).toBeInTheDocument();
  });
});
