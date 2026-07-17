const WINDOW_RESIZING_CLASS = 'is-window-resizing';
const RESIZE_SETTLE_DELAY_MS = 140;

export function installWindowResizeStability(): () => void {
  let settleTimer: number | undefined;

  function handleResize() {
    document.documentElement.classList.add(WINDOW_RESIZING_CLASS);
    if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      document.documentElement.classList.remove(WINDOW_RESIZING_CLASS);
      settleTimer = undefined;
    }, RESIZE_SETTLE_DELAY_MS);
  }

  window.addEventListener('resize', handleResize, { passive: true });

  return () => {
    window.removeEventListener('resize', handleResize);
    if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    document.documentElement.classList.remove(WINDOW_RESIZING_CLASS);
  };
}
