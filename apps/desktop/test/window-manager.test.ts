import { describe, expect, it, vi } from 'vitest';
import {
  applyWindowAction,
  closeWindowForQuit,
  contentWindowBounds,
  DebouncedWindowStateWriter,
  nativeWindowBackgroundColor,
  nativeWindowChromeOptions,
  youtubeEmbedRequestHeaders
} from '../src/main/window-manager.js';

describe('Window state debounce', () => {
  it('coalesces move and resize bursts and flushes the final state', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const writer = new DebouncedWindowStateWriter(write, 300);

    for (let index = 0; index < 20; index += 1) writer.schedule();
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(write).not.toHaveBeenCalled();
    writer.flush();
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(write).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('Native window chrome', () => {
  it('identifies only YouTube embed navigations from the desktop app', () => {
    const requestHeaders = { Accept: 'text/html' };
    expect(youtubeEmbedRequestHeaders({
      url: 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE',
      resourceType: 'subFrame',
      requestHeaders
    })).toEqual({ ...requestHeaders, Referer: 'https://github.com/krillinai/OpenCreator/' });
    for (const [url, resourceType] of [
      ['https://www.youtube-nocookie.com/embed/M7lc1UVf-VE', 'mainFrame'],
      ['https://www.youtube-nocookie.com/youtubei/v1/player', 'xhr'],
      ['https://example.com/embed/M7lc1UVf-VE', 'subFrame']
    ]) {
      expect(youtubeEmbedRequestHeaders({ url: url!, resourceType: resourceType!, requestHeaders }))
        .toBe(requestHeaders);
    }
  });

  it.each(['win32', 'darwin'] as const)(
    'hides and destroys the renderer immediately while quitting on %s',
    () => {
      const window = {
        destroy: vi.fn(),
        hide: vi.fn(),
        isDestroyed: vi.fn(() => false)
      };

      closeWindowForQuit(window);

      expect(window.hide).toHaveBeenCalledOnce();
      expect(window.destroy).toHaveBeenCalledOnce();
      expect(window.hide.mock.invocationCallOrder[0]).toBeLessThan(
        window.destroy.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
      );
    }
  );

  it('does nothing when the renderer is already destroyed', () => {
    const window = {
      destroy: vi.fn(),
      hide: vi.fn(),
      isDestroyed: vi.fn(() => true)
    };

    closeWindowForQuit(window);

    expect(window.hide).not.toHaveBeenCalled();
    expect(window.destroy).not.toHaveBeenCalled();
  });

  it('persists outer position with content viewport dimensions', () => {
    expect(contentWindowBounds({
      getBounds: () => ({ x: 40, y: 60, width: 993, height: 719 }),
      getContentBounds: () => ({ x: 47, y: 92, width: 980, height: 680 })
    })).toEqual({ x: 40, y: 60, width: 980, height: 680 });
  });

  it('keeps close behavior and toggles native minimize and zoom actions', () => {
    const window = {
      close: vi.fn(),
      minimize: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      unmaximize: vi.fn()
    };
    applyWindowAction(window, 'close');
    applyWindowAction(window, 'minimize');
    applyWindowAction(window, 'zoom');
    window.isMaximized.mockReturnValue(true);
    applyWindowAction(window, 'zoom');

    expect(window.close).toHaveBeenCalledOnce();
    expect(window.minimize).toHaveBeenCalledOnce();
    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.unmaximize).toHaveBeenCalledOnce();
  });

  it('uses an inset native title bar on macOS', () => {
    expect(nativeWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 }
    });
  });

  it('keeps the platform title bar outside macOS', () => {
    expect(nativeWindowChromeOptions('win32')).toEqual({});
    expect(nativeWindowChromeOptions('linux')).toEqual({});
  });

  it('matches the native window background to the shared theme', () => {
    expect(nativeWindowBackgroundColor('dark')).toBe('#0a0a0a');
    expect(nativeWindowBackgroundColor('light')).toBe('#e5e5e5');
  });
});
