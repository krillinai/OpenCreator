import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppLayout } from './AppLayout.js';

describe('AppLayout', () => {
  it('renders sidebar, main, and detail regions when detail is open', () => {
    render(
      <AppLayout
        sidebar={<div>左侧</div>}
        main={<div>中间</div>}
        detail={<div>详情内容</div>}
        detailOpen
      />
    );

    expect(screen.getByLabelText('OpenCreator 导航')).toBeInTheDocument();
    expect(screen.getByLabelText('OpenCreator 工作区')).toBeInTheDocument();
    expect(screen.getByLabelText('详情')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('opencreator-shell', 'has-detail');
  });

  it('does not render detail when detail is closed', () => {
    render(
      <AppLayout
        sidebar={<div>左侧</div>}
        main={<div>中间</div>}
        detail={<div>详情内容</div>}
        detailOpen={false}
      />
    );

    expect(screen.getByLabelText('OpenCreator 导航')).toHaveClass('opencreator-sidebar-pane');
    expect(screen.getByLabelText('OpenCreator 工作区')).toHaveClass('opencreator-main-pane');
    expect(screen.queryByLabelText('详情')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('opencreator-shell');
    expect(screen.getByRole('main')).not.toHaveClass('has-detail');
  });

  it('renders an optional main titlebar before the main content', () => {
    render(
      <AppLayout
        sidebar={<div>左侧</div>}
        mainHeader={<div>会话标题</div>}
        main={<div>工作区</div>}
      />
    );

    const mainPane = screen.getByLabelText('OpenCreator 工作区');
    expect(mainPane).toHaveAttribute('data-has-main-header', 'true');
    expect(mainPane.querySelector('.opencreator-main-titlebar')).toHaveTextContent('会话标题');
    expect(mainPane.querySelector('.opencreator-main-content')).toHaveTextContent('工作区');
  });

  it('keeps the main titlebar slot absent when no header is provided', () => {
    render(
      <AppLayout
        sidebar={<div>左侧</div>}
        main={<div>工作区</div>}
      />
    );

    const mainPane = screen.getByLabelText('OpenCreator 工作区');
    expect(mainPane).not.toHaveAttribute('data-has-main-header');
    expect(mainPane.querySelector('.opencreator-main-titlebar')).not.toBeInTheDocument();
  });

  it('marks the shell as sidebar collapsed', () => {
    render(
      <AppLayout
        sidebar={<div>左侧</div>}
        main={<div>中间</div>}
        sidebarCollapsed
      />
    );

    expect(screen.getByRole('main')).toHaveClass('opencreator-shell', 'sidebar-collapsed');
    expect(screen.getByLabelText('OpenCreator 导航')).toHaveAttribute('data-collapsed', 'true');
  });

  it('removes navigation and expands the main workspace in immersive mode', () => {
    render(
      <AppLayout
        sidebar={<div>左侧</div>}
        main={<div>沉浸工作区</div>}
        immersive
      />
    );

    expect(screen.getByRole('main')).toHaveClass('opencreator-shell', 'is-immersive');
    expect(screen.queryByLabelText('OpenCreator 导航')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开导航' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('OpenCreator 工作区')).toHaveTextContent('沉浸工作区');
  });

  it('opens the mobile navigation as a focus-managed drawer and restores focus after closing', async () => {
    const user = userEvent.setup();

    render(<MobileLayoutHarness />);

    const trigger = screen.getByRole('button', { name: '打开导航' });
    await user.click(trigger);

    expect(screen.getByLabelText('OpenCreator 导航')).toHaveAttribute('data-mobile-open', 'true');
    expect(screen.getByRole('button', { name: '关闭导航' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.getByLabelText('OpenCreator 导航')).toHaveAttribute('data-mobile-open', 'false');
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '关闭导航遮罩' }));

    expect(screen.getByLabelText('OpenCreator 导航')).toHaveAttribute('data-mobile-open', 'false');
  });
});

function MobileLayoutHarness() {
  const [open, setOpen] = useState(false);

  return (
    <AppLayout
      sidebar={<button type="button">导航操作</button>}
      main={<div>工作区</div>}
      mobileSidebarOpen={open}
      onOpenMobileSidebar={() => setOpen(true)}
      onCloseMobileSidebar={() => setOpen(false)}
    />
  );
}
