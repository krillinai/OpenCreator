import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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

  it('marks the shell as sidebar collapsed', () => {
    render(
      <WorkbenchLayout
        sidebar={<div>左侧</div>}
        main={<div>中间</div>}
        sidebarCollapsed
      />
    );

    expect(screen.getByRole('main')).toHaveClass('clawee-shell', 'sidebar-collapsed');
    expect(screen.getByLabelText('Clawee 导航')).toHaveAttribute('data-collapsed', 'true');
  });

  it('opens the mobile navigation as a focus-managed drawer and restores focus after closing', async () => {
    const user = userEvent.setup();

    render(<MobileLayoutHarness />);

    const trigger = screen.getByRole('button', { name: '打开导航' });
    await user.click(trigger);

    expect(screen.getByLabelText('Clawee 导航')).toHaveAttribute('data-mobile-open', 'true');
    expect(screen.getByRole('button', { name: '关闭导航' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.getByLabelText('Clawee 导航')).toHaveAttribute('data-mobile-open', 'false');
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '关闭导航遮罩' }));

    expect(screen.getByLabelText('Clawee 导航')).toHaveAttribute('data-mobile-open', 'false');
  });
});

function MobileLayoutHarness() {
  const [open, setOpen] = useState(false);

  return (
    <WorkbenchLayout
      sidebar={<button type="button">导航操作</button>}
      main={<div>工作区</div>}
      mobileSidebarOpen={open}
      onOpenMobileSidebar={() => setOpen(true)}
      onCloseMobileSidebar={() => setOpen(false)}
    />
  );
}
