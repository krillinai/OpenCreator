import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CreatorResizableLayout from './CreatorResizableLayout.js';

describe('CreatorResizableLayout', () => {
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
  });
});
