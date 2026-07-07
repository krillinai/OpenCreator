import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkbenchLayout } from './WorkbenchLayout.js';

describe('WorkbenchLayout', () => {
  it('renders sidebar, main, and detail regions when detail is open', () => {
    render(
      <WorkbenchLayout
        sidebar={<div>左侧</div>}
        main={<div>中间</div>}
        detail={<div>详情内容</div>}
        detailOpen
      />
    );

    expect(screen.getByLabelText('Clawee 导航')).toBeInTheDocument();
    expect(screen.getByLabelText('Clawee 工作区')).toBeInTheDocument();
    expect(screen.getByLabelText('详情')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('clawee-shell', 'has-detail');
  });

  it('does not render detail when detail is closed', () => {
    render(
      <WorkbenchLayout
        sidebar={<div>左侧</div>}
        main={<div>中间</div>}
        detail={<div>详情内容</div>}
        detailOpen={false}
      />
    );

    expect(screen.getByLabelText('Clawee 导航')).toHaveClass('clawee-sidebar-pane');
    expect(screen.getByLabelText('Clawee 工作区')).toHaveClass('clawee-main-pane');
    expect(screen.queryByLabelText('详情')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('clawee-shell');
    expect(screen.getByRole('main')).not.toHaveClass('has-detail');
  });
});
