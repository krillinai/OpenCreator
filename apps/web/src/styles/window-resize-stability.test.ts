import { afterEach, describe, expect, it, vi } from 'vitest';
import { installWindowResizeStability } from './window-resize-stability.js';

describe('window resize stability', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove('is-window-resizing');
  });

  it('keeps resize effects paused until the viewport settles', () => {
    vi.useFakeTimers();
    const uninstall = installWindowResizeStability();

    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement).toHaveClass('is-window-resizing');

    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(100);
    expect(document.documentElement).toHaveClass('is-window-resizing');

    vi.advanceTimersByTime(40);
    expect(document.documentElement).not.toHaveClass('is-window-resizing');
    uninstall();
  });

  it('cleans up the listener, timer, and class', () => {
    vi.useFakeTimers();
    const uninstall = installWindowResizeStability();

    window.dispatchEvent(new Event('resize'));
    uninstall();
    expect(document.documentElement).not.toHaveClass('is-window-resizing');

    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement).not.toHaveClass('is-window-resizing');
  });
});
