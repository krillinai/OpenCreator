import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CreatorResizableLayout from './CreatorResizableLayout.js';

describe('CreatorResizableLayout', () => {
  afterEach(() => { document.documentElement.dir = 'ltr'; });

  it('reveals the Agent pane for each details request and falls back to the panel before a stage exists', () => {
    const agentPanel = <aside className="creator-collaboration-panel" aria-label="Task details" tabIndex={-1}>
      <article data-stage-run-id="previous-stage" tabIndex={-1}>Previous stage</article>
      <article data-stage-run-id="current-stage" tabIndex={-1}>Current stage</article>
    </aside>;
    const content = (request?: { key: number; stageRunId?: string }) => <LanguageProvider initialPreference="zh-CN">
      <CreatorResizableLayout workspace={<div>Workspace</div>} agentPanel={agentPanel} agentPanelRequest={request} />
    </LanguageProvider>;
    const { rerender } = render(content());
    expect(screen.getByRole('tab', { name: '创作' })).toHaveAttribute('aria-selected', 'true');
    rerender(content({ key: 1, stageRunId: 'current-stage' }));
    expect(screen.getByRole('tab', { name: 'Agent' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Current stage')).toHaveFocus();
    fireEvent.click(screen.getByRole('tab', { name: '创作' }));
    expect(screen.getByRole('tab', { name: '创作' })).toHaveAttribute('aria-selected', 'true');
    rerender(content({ key: 2 }));
    expect(screen.getByRole('tab', { name: 'Agent' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('complementary', { name: 'Task details' })).toHaveFocus();
  });

  it('follows the pointer and arrow keys when the workspace starts on the right', () => {
    render(
      <LanguageProvider initialPreference="ar-SA">
        <CreatorResizableLayout workspace={<div>Workspace</div>} agentPanel={<div>Agent</div>} />
      </LanguageProvider>
    );
    const separator = screen.getByRole('separator');
    const layout = separator.parentElement as HTMLDivElement;
    vi.spyOn(layout, 'getBoundingClientRect').mockReturnValue({
      left: 100, right: 1300, width: 1200, top: 0, bottom: 800, height: 800,
      x: 100, y: 0, toJSON: () => ({})
    });
    fireEvent.mouseDown(separator, { button: 0, clientX: 600 });
    fireEvent.mouseMove(window, { clientX: 580 });
    fireEvent.mouseUp(window);
    expect(layout).toHaveStyle({ '--creator-workspace-pane-width': '720px' });
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(layout).toHaveStyle({ '--creator-workspace-pane-width': '752px' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(layout).toHaveStyle({ '--creator-workspace-pane-width': '720px' });
  });

  it('resizes every Creator workspace with the same mouse and keyboard controls', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorResizableLayout
          workspace={<div>工作区</div>}
          agentPanel={<div>Agent 对话区</div>}
        />
      </LanguageProvider>
    );

    const separator = screen.getByRole('separator', { name: '调整操作区和对话区宽度' });
    const layout = separator.parentElement as HTMLDivElement;
    vi.spyOn(layout, 'getBoundingClientRect').mockReturnValue({
      bottom: 800,
      height: 800,
      left: 0,
      right: 1200,
      top: 0,
      width: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    fireEvent.mouseDown(separator, { button: 0, clientX: 800 });
    expect(document.querySelector('.pane-resize-shield')).not.toBeInTheDocument();
    fireEvent.mouseUp(window);
    expect(layout.style.getPropertyValue('--creator-workspace-pane-width')).toBe('');

    fireEvent.mouseDown(separator, { button: 0, clientX: 800 });
    fireEvent.mouseMove(window, { clientX: 720 });
    fireEvent.mouseUp(window);
    expect(layout).toHaveStyle({ '--creator-workspace-pane-width': '720px' });

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(layout).toHaveStyle({ '--creator-workspace-pane-width': '688px' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(layout).toHaveStyle({ '--creator-workspace-pane-width': '720px' });

    fireEvent.doubleClick(separator);
    expect(layout.style.getPropertyValue('--creator-workspace-pane-width')).toBe('');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(layout).toHaveStyle({ '--creator-workspace-pane-width': '841px' });
  });
});
