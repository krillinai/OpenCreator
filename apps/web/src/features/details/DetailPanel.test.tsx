import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DetailPanel } from './DetailPanel.js';

describe('DetailPanel', () => {
  it('shows title, subtitle, and content in file mode', () => {
    render(
      <DetailPanel
        mode="file"
        title="notes.txt"
        subtitle="apps/web/notes.txt"
        content={'# OpenCreator\n\nDetail content'}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'notes.txt' })).toBeInTheDocument();
    expect(screen.getByText('apps/web/notes.txt')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '详情内容' }).querySelector('pre')?.textContent).toBe(
      '# OpenCreator\n\nDetail content'
    );
  });

  it('renders markdown file content with document markdown renderer', () => {
    render(
      <DetailPanel
        mode="file"
        title="README.md"
        subtitle="apps/web/README.md"
        content={'# OpenCreator\n\n当前温度 **29°C**'}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'OpenCreator', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('29°C')).toHaveProperty('tagName', 'STRONG');
    expect(screen.queryByText('# OpenCreator')).not.toBeInTheDocument();
  });

  it('renders html file content as source instead of executing markup', () => {
    render(
      <DetailPanel
        mode="file"
        title="preview.html"
        content={'<h1>Unsafe</h1><script>alert(1)</script>'}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('<h1>Unsafe</h1><script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('formats json file content when possible', () => {
    render(<DetailPanel mode="file" title="data.json" content={'{"a":1,"b":{"c":2}}'} onClose={vi.fn()} />);

    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
    expect(screen.getByText(/"c": 2/)).toBeInTheDocument();
  });

  it('calls onClose from the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<DetailPanel mode="file" title="README.md" content="content" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '关闭详情' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls change action callbacks', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onRevert = vi.fn();

    render(
      <DetailPanel
        mode="change"
        title="变更详情"
        content="- old\n+ new"
        onClose={vi.fn()}
        onApprove={onApprove}
        onRevert={onRevert}
      />
    );

    await user.click(screen.getByRole('button', { name: '撤销' }));
    await user.click(screen.getByRole('button', { name: '审核' }));

    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('disables change actions when callbacks are missing', () => {
    render(<DetailPanel mode="change" title="变更详情" content="diff content" onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '审核' })).toBeDisabled();
  });

  it('shows run content without change actions', () => {
    render(<DetailPanel mode="run" title="运行详情" content="run completed" onClose={vi.fn()} />);

    expect(screen.getByText('run completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '审核' })).not.toBeInTheDocument();
  });
});
