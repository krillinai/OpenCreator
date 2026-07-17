import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAutoHidingScrollbars } from './scrollbar-visibility.js';

describe('auto-hiding scrollbars', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.is-scrollbar-active').forEach((element) => {
      element.classList.remove('is-scrollbar-active');
    });
  });

  it('shows the active scrollbar while scrolling and hides it after settling', () => {
    vi.useFakeTimers();
    const scrollArea = document.createElement('div');
    document.body.append(scrollArea);
    const uninstall = installAutoHidingScrollbars();

    scrollArea.dispatchEvent(new Event('scroll'));
    expect(scrollArea).toHaveClass('is-scrollbar-active');

    vi.advanceTimersByTime(500);
    scrollArea.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(500);
    expect(scrollArea).toHaveClass('is-scrollbar-active');

    vi.advanceTimersByTime(150);
    expect(scrollArea).not.toHaveClass('is-scrollbar-active');

    uninstall();
    scrollArea.remove();
  });

  it('cleans up active scrollbar state and listeners', () => {
    vi.useFakeTimers();
    const scrollArea = document.createElement('div');
    document.body.append(scrollArea);
    const uninstall = installAutoHidingScrollbars();

    scrollArea.dispatchEvent(new Event('scroll'));
    uninstall();
    expect(scrollArea).not.toHaveClass('is-scrollbar-active');

    scrollArea.dispatchEvent(new Event('scroll'));
    expect(scrollArea).not.toHaveClass('is-scrollbar-active');
    scrollArea.remove();
  });
});
