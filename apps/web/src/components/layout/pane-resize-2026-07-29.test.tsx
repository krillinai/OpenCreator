import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { beginPaneResize } from './pane-resize-2026-07-29.js';

afterEach(() => {
  window.dispatchEvent(new Event('blur'));
});

describe('pane resize', () => {
  it('keeps drag events in the parent page and stops updating after release', () => {
    function TestResize() {
      const [clientX, setClientX] = useState(0);
      return (
        <>
          <div
            role="separator"
            aria-label="测试分隔条"
            onMouseDown={event => beginPaneResize(event, setClientX)}
          />
          <output aria-label="拖拽位置">{clientX}</output>
        </>
      );
    }

    render(<TestResize />);
    const separator = screen.getByRole('separator', { name: '测试分隔条' });

    fireEvent.mouseDown(separator, { button: 0, clientX: 120 });

    expect(document.documentElement).toHaveClass('is-pane-resizing');
    expect(document.querySelector('.pane-resize-shield')).not.toBeNull();
    expect(screen.getByLabelText('拖拽位置')).toHaveTextContent('120');

    fireEvent.mouseMove(window, { clientX: 280 });
    expect(screen.getByLabelText('拖拽位置')).toHaveTextContent('280');

    fireEvent.mouseUp(window);
    expect(document.documentElement).not.toHaveClass('is-pane-resizing');
    expect(document.querySelector('.pane-resize-shield')).toBeNull();

    fireEvent.mouseMove(window, { clientX: 360 });
    expect(screen.getByLabelText('拖拽位置')).toHaveTextContent('280');
  });
});
